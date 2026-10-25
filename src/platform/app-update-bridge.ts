import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface UpdateManifest {
  schemaVersion: 1;
  applicationId: string;
  versionName: string;
  versionCode: number;
  minSdkVersion: number;
  apkUrl: string;
  size: number;
  sha256: string;
  notes: string;
  publishedAt: string;
}
export interface UpdateInfo {
  versionName: string;
  versionCode: number;
  sdkVersion: number;
  supported: boolean;
  manifest?: UpdateManifest;
}
export interface UpdateProgress { versionCode: number; received: number; total: number }
export interface AppUpdateAPI {
  getInfo(): Promise<UpdateInfo>;
  check(): Promise<{ manifest: UpdateManifest }>;
  download(options: { versionCode: number }): Promise<void>;
  cancelDownload(): Promise<void>;
  install(options: { versionCode: number }): Promise<void>;
  openInstallSettings(): Promise<void>;
  addListener(name: "progress", callback: (event: UpdateProgress) => void): Promise<PluginListenerHandle>;
}
export const appUpdateAPI = registerPlugin<AppUpdateAPI>("AppUpdate");
