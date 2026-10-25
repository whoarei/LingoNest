const state = window.__updateState = {
  ...window.__updateOptions, checks: 0, downloads: 0, installs: 0, settings: 0,
  manifest: { schemaVersion: 1, applicationId: 'cn.lingonest.app', versionName: '0.1.17', versionCode: 18,
    minSdkVersion: 24, apkUrl: 'https://github.com/whoarei/LingoNest/releases/download/v0.1.17/lingonest-0.1.17-release.apk',
    size: 5000000, sha256: 'a'.repeat(64), notes: '改善学习体验。\n<img src=x onerror=alert(1)>', publishedAt: '2026-10-24T15:00:00Z' },
};
let progress, rejectDownload;
export const appUpdateAPI = {
  getInfo: async () => ({ versionName: '0.1.16', versionCode: 17, sdkVersion: 29, supported: true,
    manifest: sessionStorage.getItem('update-fixture-cached') ? state.manifest : undefined }),
  addListener: async (_name, listener) => { progress = listener; return { remove: async () => {} }; },
  check: async () => {
    state.checks++;
    if (state.holdCheck) await new Promise(resolve => { window.__finishUpdateCheck = resolve; });
    if (state.failCheck) throw new Error('GitHub 暂时无法连接');
    sessionStorage.setItem('update-fixture-cached', 'true');
    return { manifest: state.manifest };
  },
  download: async () => {
    state.downloads++;
    progress?.({ versionCode: 18, received: 1000000, total: 5000000 });
    if (state.holdDownload) await new Promise((resolve, reject) => { rejectDownload = reject; window.__finishUpdateDownload = resolve; });
  },
  cancelDownload: async () => { rejectDownload?.(new Error('下载已取消，可稍后重试。')); },
  install: async () => {
    state.installs++;
    if (state.holdInstall) await new Promise(resolve => { window.__finishUpdateInstall = resolve; });
    if (state.failInstall) throw new Error('无法打开系统安装界面');
  },
  openInstallSettings: async () => { state.settings++; },
};
