import { computed, ref } from "vue";
import { version } from "../../package.json";
import type { AppUpdateAPI, UpdateInfo, UpdateManifest } from "./app-update-bridge";

const DAY = 24 * 60 * 60 * 1000;
const RETRY_DELAY = 15 * 60 * 1000;
const KEY = "lingonest.app-update.schedule.v1";
export const releasePage = "https://github.com/whoarei/LingoNest/releases/latest";
interface Schedule { checkedAt: number; attemptedAt: number; currentCode: number; dismissedCode: number; dismissedAt: number }

/** Owned by the application frame; neither teaching mode owns update or reminder state. */
export function createAppUpdate(options: {
  api: AppUpdateAPI;
  enabled: boolean;
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const info = ref<UpdateInfo | null>(null), latest = ref<UpdateManifest | null>(null);
  const checking = ref(false), downloading = ref(false), installing = ref(false), downloaded = ref(false);
  const received = ref(0), message = ref(""), error = ref(""), permissionRequired = ref(false);
  let disposed = false, started = false;
  let subscription: { remove(): Promise<void> } | undefined;
  let infoRequest: Promise<void> | undefined;
  const initial: Schedule = { checkedAt: 0, attemptedAt: 0, currentCode: 0, dismissedCode: 0, dismissedAt: 0 };
  const schedule = ref<Schedule>({ ...initial });
  try {
    const saved = JSON.parse(options.storage?.getItem(KEY) ?? "null");
    if (saved && Object.keys(initial).every(key => Number.isSafeInteger(saved[key]) && saved[key] >= 0)) schedule.value = saved;
  } catch { /* Storage failure must never prevent learning or updates. */ }
  function save() { try { options.storage?.setItem(KEY, JSON.stringify(schedule.value)); } catch { /* Best effort. */ } }
  const currentVersion = computed(() => info.value?.versionName ?? version);
  const available = computed(() => !!info.value && !!latest.value && latest.value.versionCode > info.value.versionCode);
  const compatible = computed(() => available.value && !!info.value?.supported && latest.value!.minSdkVersion <= info.value!.sdkVersion);
  const notify = computed(() => compatible.value && !(schedule.value.dismissedCode === latest.value!.versionCode &&
    now() >= schedule.value.dismissedAt && now() - schedule.value.dismissedAt < DAY));
  const busy = computed(() => checking.value || downloading.value || installing.value);
  const unsupportedReason = computed(() => !options.enabled ? "浏览器预览不支持安装更新，请在 Android 应用中使用。" :
    info.value && !info.value.supported ? "当前为测试签名或非官方发布版本，请通过 GitHub 安装正式签名版本后再使用在线更新。" : "");
  function failure(value: unknown) { return value instanceof Error ? value.message : "操作未完成，请重试。"; }
  function loadInfo(): Promise<void> {
    if (!infoRequest) infoRequest = options.api.getInfo().then(loaded => {
      if (disposed) return;
      info.value = loaded;
      if (!latest.value && loaded.manifest) latest.value = loaded.manifest;
    }).finally(() => { infoRequest = undefined; });
    return infoRequest;
  }
  async function check(manual = true) {
    if (disposed || busy.value) return;
    if (!options.enabled) { if (manual) message.value = unsupportedReason.value; return; }
    checking.value = true;
    if (manual) { error.value = ""; message.value = ""; }
    try {
      if (!info.value) await loadInfo();
      if (disposed) return;
      if (!info.value?.supported) { if (manual) message.value = unsupportedReason.value; return; }
      schedule.value.attemptedAt = now(); save();
      const result = await options.api.check();
      if (disposed) return;
      if (latest.value?.versionCode !== result.manifest.versionCode || latest.value?.sha256 !== result.manifest.sha256) {
        downloaded.value = false; received.value = 0; permissionRequired.value = false;
      }
      latest.value = result.manifest;
      schedule.value.checkedAt = now(); schedule.value.attemptedAt = 0;
      schedule.value.currentCode = info.value.versionCode; save();
      if (manual) message.value = available.value ? compatible.value ? "发现新版本，可查看说明后下载。" : "此更新需要更高的 Android 版本。" : "当前已是最新版本。";
    } catch (value) { if (manual && !disposed) error.value = failure(value); }
    finally { checking.value = false; }
  }
  async function start() {
    if (started || disposed || !options.enabled) return;
    started = true;
    try {
      const handle = await options.api.addListener("progress", event => {
        if (!disposed && downloading.value && event.versionCode === latest.value?.versionCode)
          received.value = Math.max(0, Math.min(event.received, latest.value.size));
      });
      if (disposed) { await handle.remove(); return; }
      subscription = handle;
    } catch { /* Checking can still work if progress reporting is unavailable. */ }
    if (disposed) return;
    try {
      await loadInfo();
      if (disposed || !info.value?.supported) return;
      const time = now(), state = schedule.value;
      const recentlyChecked = !!latest.value && state.currentCode === info.value.versionCode && time >= state.checkedAt && time - state.checkedAt < DAY;
      const recentAttempt = state.attemptedAt > 0 && time >= state.attemptedAt && time - state.attemptedAt < RETRY_DELAY;
      if (!recentlyChecked && !recentAttempt) await check(false);
    } catch { /* A startup check never blocks the app or displays a global error. */ }
  }
  function dismiss() {
    if (latest.value) { schedule.value.dismissedCode = latest.value.versionCode; schedule.value.dismissedAt = now(); save(); }
  }
  async function download() {
    if (disposed || busy.value || !compatible.value) return;
    const code = latest.value!.versionCode;
    downloading.value = true; downloaded.value = false; received.value = 0;
    permissionRequired.value = false; error.value = ""; message.value = "";
    try {
      await options.api.download({ versionCode: code });
      if (!disposed) { downloaded.value = true; received.value = latest.value!.size; message.value = "安装包已校验，可点击安装更新。"; }
    } catch (value) { if (!disposed) error.value = failure(value); }
    finally { downloading.value = false; }
  }
  async function cancel() {
    try { await options.api.cancelDownload(); } catch (value) { if (!disposed) error.value = failure(value); }
  }
  async function install(prepare: () => Promise<void>) {
    if (disposed || busy.value || !downloaded.value || !compatible.value) return;
    installing.value = true; error.value = ""; message.value = "";
    try {
      await prepare();
      if (disposed) return;
      const result = await options.api.install({ versionCode: latest.value!.versionCode });
      permissionRequired.value = result.permissionRequired;
      message.value = result.permissionRequired ? "需要允许此应用安装更新。授权后请返回，再次点击安装更新。" : "系统安装界面已打开，请按系统提示完成安装。";
    } catch (value) { if (!disposed) error.value = failure(value); }
    finally { installing.value = false; }
  }
  async function openInstallSettings() {
    if (busy.value) return;
    try { await options.api.openInstallSettings(); } catch (value) { if (!disposed) error.value = failure(value); }
  }
  function dispose() {
    disposed = true;
    void subscription?.remove().catch(() => {});
    if (downloading.value) void options.api.cancelDownload().catch(() => {});
  }
  return { info, latest, currentVersion, available, compatible, notify, unsupportedReason, busy, checking, downloading,
    installing, downloaded, received, message, error, permissionRequired, start, check, dismiss, download, cancel, install, openInstallSettings, dispose };
}
