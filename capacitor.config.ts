import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "cn.lingonest.app",
  appName: "英语小窝",
  webDir: "dist",
  loggingBehavior: "none",
  android: { allowMixedContent: false, minWebViewVersion: 74 },
};
export default config;
