import type { SnapshotCodec } from "../../packages/learning-modes/contracts";
import { isAndroid, native } from "../native";

/** Shared persistence mechanics; payload semantics belong exclusively to the mode codec. */
export class SnapshotRepository<TState> {
  private revision = 0;
  private loaded = false;
  private stored = false;
  get hasSnapshot() { return this.loaded && this.stored; }

  constructor(
    private readonly codec: SnapshotCodec<TState>,
    private readonly options: { nativeLegacy?: boolean } = {},
  ) {}

  async load(): Promise<TState> {
    const result = isAndroid
      ? this.options.nativeLegacy
        ? await native.loadState()
        : await native.loadDocument({ key: this.codec.storageKey })
      : await this.webRead();
    const state = result.payload === null
      ? this.codec.empty()
      : this.codec.decode(result.payload);
    this.revision = result.revision;
    this.loaded = true;
    this.stored = result.payload !== null;
    return state;
  }

  private async webRead(): Promise<{ revision: number; payload: string | null }> {
    const data = localStorage.getItem(this.codec.storageKey);
    if (data === null) return { revision: 0, payload: null };
    const result = JSON.parse(data);
    if (!Number.isSafeInteger(result.revision) || typeof result.payload !== "string")
      throw new Error("浏览器预览数据损坏。");
    return result;
  }

  async save(state: TState): Promise<void> {
    if (!this.loaded) throw new Error("数据尚未加载，不能写入。");
    const payload = JSON.stringify(state);
    this.codec.decode(payload);
    if (new TextEncoder().encode(payload).byteLength > 10 * 1024 * 1024)
      throw new Error("学习记录已达到此预览版容量上限。");
    if (isAndroid) {
      const input = { expectedRevision: this.revision, payload };
      const result = this.options.nativeLegacy
        ? await native.saveState(input)
        : await native.saveDocument({ ...input, key: this.codec.storageKey });
      this.revision = result.revision;
      this.stored = true;
    } else {
      const write = async () => {
        const current = await this.webRead();
        if (current.revision !== this.revision)
          throw new Error("另一个页面已更新记录，请刷新后重试。");
        const next = this.revision + 1;
        localStorage.setItem(this.codec.storageKey, JSON.stringify({ revision: next, payload }));
        this.revision = next;
        this.stored = true;
      };
      if (navigator.locks) await navigator.locks.request(this.codec.storageKey, write);
      else await write();
    }
  }
}
