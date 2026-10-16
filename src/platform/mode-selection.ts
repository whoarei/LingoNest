import { inject, readonly, ref, type InjectionKey } from "vue";
import type { SnapshotCodec, TeachingModeIdentity } from "../../packages/learning-modes/contracts";
import { SnapshotRepository } from "./snapshot-repository";

export interface ModeSettings { formatVersion: 1; activeModeId: string }
export function modeSettingsCodec(defaultModeId: string): SnapshotCodec<ModeSettings> {
  return {
    storageKey: "lingonest.mode-settings.v1",
    empty: () => ({ formatVersion: 1, activeModeId: defaultModeId }),
    decode(payload) {
      const value = JSON.parse(payload);
      if (value?.formatVersion !== 1 || typeof value.activeModeId !== "string" || !/^[a-z][a-z0-9-]*$/.test(value.activeModeId))
        throw Error("课程模式设置格式不受支持，已停止写入。已有课程与学习记录保留。");
      return { formatVersion: 1, activeModeId: value.activeModeId };
    },
  };
}
export function createModeSelection(
  modes: readonly { identity: Readonly<TeachingModeIdentity> }[],
  defaultModeId: string,
  repository = new SnapshotRepository(modeSettingsCodec(defaultModeId)),
) {
  const activeModeId = ref(defaultModeId), ready = ref(false), busy = ref(false), error = ref("");
  const preparations = new Set<() => Promise<void>>();
  let loaded: Promise<void> | undefined;
  async function load() {
    if (!loaded) loaded = (async () => {
      try {
        const settings = await repository.load();
        if (!repository.hasSnapshot) await repository.save(settings);
        activeModeId.value = settings.activeModeId;
        ready.value = true;
        error.value = "";
      } catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
        throw failure;
      }
    })();
    return loaded;
  }
  async function select(modeId: string) {
    if (!ready.value || busy.value) throw Error("课程模式设置尚未就绪，请稍后重试。");
    if (!modes.some(mode => mode.identity.id === modeId)) throw Error("该课程模式尚未安装，不能开放给孩子。");
    if (modeId === activeModeId.value) return;
    busy.value = true;
    error.value = "";
    try {
      for (const prepare of [...preparations]) await prepare();
      await repository.save({ formatVersion: 1, activeModeId: modeId });
      activeModeId.value = modeId;
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
      throw failure;
    } finally { busy.value = false; }
  }
  return {
    activeModeId: readonly(activeModeId), ready: readonly(ready), busy: readonly(busy), error: readonly(error),
    modes: modes.map(mode => mode.identity), load, select,
    beforeSwitch(prepare: () => Promise<void>) { preparations.add(prepare); return () => preparations.delete(prepare); },
  };
}
export type ModeSelection = ReturnType<typeof createModeSelection>;
export const modeSelectionKey: InjectionKey<ModeSelection> = Symbol("global-course-mode");
export function useModeSelection() {
  const selection = inject(modeSelectionKey);
  if (!selection) throw Error("课程模式宿主尚未就绪。");
  return selection;
}
