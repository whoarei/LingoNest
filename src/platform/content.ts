import { Capacitor, registerPlugin } from "@capacitor/core";
import { isAndroid } from "../native";
import type { SourceImage } from "../../packages/learning-modes/contracts";
export interface ContentConfiguration {
  baseUrl: string;
  model: string;
  hasKey: boolean;
}
export type ContentKind = "recognition" | "generation";
export const contentNative = registerPlugin<{
  getConfig(): Promise<Record<ContentKind, ContentConfiguration>>;
  saveConfig(input: {
    kind: ContentKind;
    baseUrl: string;
    model: string;
    apiKey: string;
  }): Promise<ContentConfiguration>;
  clearConfig(input: { kind: ContentKind }): Promise<void>;
  pickImage(input: {
    mode: "camera" | "gallery";
  }): Promise<SourceImage & { cancelled?: boolean }>;
  imageUrl(input: { path: string }): Promise<{ url: string }>;
  request(input: {
    kind: ContentKind;
    prompt: string;
    images?: SourceImage[];
  }): Promise<{ text: string }>;
  cancelRequest(): Promise<void>;
}>("CourseContent");
export async function imageSource(image: SourceImage): Promise<string> {
  if (image.path.startsWith("/source/")) return image.path;
  const result = await contentNative.imageUrl({ path: image.path });
  return Capacitor.convertFileSrc(result.url);
}
export async function contentRequest(
  kind: ContentKind,
  prompt: string,
  images: SourceImage[] = [],
): Promise<string> {
  if (!isAndroid)
    throw new Error(
      "拍照识别和自动课程生成请使用 Android 应用，并在设置中配置模型。",
    );
  return (await contentNative.request({ kind, prompt, images })).text;
}
