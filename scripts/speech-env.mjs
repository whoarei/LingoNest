import fs from "node:fs";

// Developer-side only. This file is never imported by Vite or copied into the APK.
export function readSpeechEnv(filename = ".env") {
  const values = {};
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
    );
    if (!match) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]] = value;
  }
  return {
    baseUrl:
      values.TTS_BASE_URL || values.BASE_URL || values.OPENAI_BASE_URL || "",
    apiKey: values.TTS_API_KEY || values.API_KEY || values.OPENAI_API_KEY || "",
    model: values.TTS_MODEL || values.MODEL || "",
    voice: values.TTS_VOICE || values.VOICE || "alloy",
  };
}
