import type { PassagePackage, PassageState, Publication, RuntimeContext } from "./model";
import { publishPassagePackage, transitionPassage, type PassageCommand } from "./runtime";
import { validatePassageState } from "./state";
import { copy, requireValid } from "./validation";

export interface PassagePersistence {
  load(): Promise<PassageState>;
  save(state: PassageState): Promise<void>;
  current?(): PassageState;
  update?(change: (state: PassageState) => PassageState): Promise<PassageState>;
}
/** Serializes transactions and exposes a snapshot only after persistence succeeds. */
export class PassageStore {
  private current: PassageState | null = null;
  private loading: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly repository: PassagePersistence, private readonly getContext: () => RuntimeContext) {}
  load(): Promise<void> {
    return this.loading ??= (async () => {
      const value = await this.repository.load(); validatePassageState(value); this.current = copy(value);
    })();
  }
  snapshot(): PassageState {
    requireValid(this.current, "数据尚未加载。");
    return copy(this.repository.current?.() ?? this.current);
  }
  private async transact(change: (state: PassageState, context: RuntimeContext) => PassageState): Promise<void> {
    const expected = copy(this.getContext());
    const assertScope = (context: RuntimeContext) => requireValid(context.activeModeId === expected.activeModeId &&
      context.learnerId === expected.learnerId && context.courseId === expected.courseId, "排队期间学习上下文已变化，请重试。");
    const result = this.queue.then(async () => {
      requireValid(this.current, "数据尚未加载。");
      if (this.repository.update) {
        this.current = copy(await this.repository.update(current => {
          const context = copy(this.getContext()); assertScope(context);
          const next = change(current, context); validatePassageState(next); assertScope(this.getContext());
          return next;
        }));
        return;
      }
      const context = copy(this.getContext()); assertScope(context);
      const next = change(this.current, context);
      if (next === this.current) return;
      validatePassageState(next); assertScope(this.getContext());
      await this.repository.save(copy(next));
      this.current = copy(next);
    });
    this.queue = result.catch(() => {});
    return result;
  }
  dispatch(command: PassageCommand): Promise<void> {
    const captured = copy(command);
    return this.transact((state, context) => transitionPassage(state, context, captured));
  }
  publish(pkg: PassagePackage, approval: Omit<Publication, "courseId" | "revision">): Promise<void> {
    const captured = copy(pkg), review = copy(approval);
    return this.transact(state => publishPassagePackage(state, captured, review));
  }
}
