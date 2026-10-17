import { contentNative, contentRequest, type ContentKind } from "./content";
import type { SourceImage } from "../../packages/learning-modes/contracts";

// The native transport exposes one global cancellation operation. Only its
// current owner may call it; later requests wait for that cancellation barrier.
let active: { owner: object; token: number } | undefined;
let cancellation: Promise<void> = Promise.resolve();
export function createContentRequests() {
  const owner = {};
  let epoch = 0, disposed = false;
  async function cancel() {
    epoch++;
    if (active?.owner !== owner) return;
    active = undefined;
    cancellation = cancellation.then(() => contentNative.cancelRequest()).catch(() => {});
    await cancellation;
  }
  return {
    async request(kind: ContentKind, prompt: string, images: SourceImage[] = []) {
      const token = ++epoch;
      await cancellation;
      if (disposed || token !== epoch) throw Error("处理已取消，结果已忽略。");
      if (active) throw Error("另一课程正在使用内容服务，请等待完成。");
      const operation = { owner, token }; active = operation;
      try {
        const result = await contentRequest(kind, prompt, images);
        if (disposed || token !== epoch || active !== operation) throw Error("处理已取消，结果已忽略。");
        return result;
      } finally { if (active === operation) active = undefined; }
    },
    cancel,
    dispose() { disposed = true; return cancel(); },
  };
}
