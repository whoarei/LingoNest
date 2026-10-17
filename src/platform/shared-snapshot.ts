import type { SnapshotCodec } from "../../packages/learning-modes/contracts";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export interface SnapshotPort<T> { load(): Promise<T>; save(value: T): Promise<void> }

/** One queue for application mutations, including multi-document deletion. */
export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async (): Promise<T> => {
      if (typeof navigator !== "undefined" && navigator.locks)
        return await navigator.locks.request("lingonest.application-mutations.v1", action);
      return await action();
    });
    this.tail = result.catch(() => {});
    return result;
  }
}

/** Owns the current snapshot. Mutations rebase on the latest committed revision. */
export class SharedSnapshot<T> {
  private value: T | undefined;
  private loading: Promise<T> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(value: T) => void>();
  constructor(private readonly repository: SnapshotPort<T>, private readonly codec: SnapshotCodec<T>) {}
  snapshot(): T {
    if (this.value === undefined) throw Error("数据尚未加载。");
    return clone(this.value);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private publish(value: T) {
    this.value = clone(value);
    for (const listener of this.listeners) listener(this.snapshot());
  }
  load(): Promise<T> {
    return this.loading ??= this.refresh();
  }
  async refresh(): Promise<T> {
    const value = await this.repository.load();
    this.codec.decode(JSON.stringify(value));
    this.publish(value);
    return this.snapshot();
  }
  update(change: (value: T) => T | void | Promise<T | void>): Promise<T> {
    const result = this.tail.then(async () => {
      const current = await this.refresh(), before = JSON.stringify(current);
      const next = (await change(current)) ?? current;
      this.codec.decode(JSON.stringify(next));
      if (JSON.stringify(next) !== before) {
        await this.repository.save(clone(next));
        this.publish(next);
      }
      return this.snapshot();
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
