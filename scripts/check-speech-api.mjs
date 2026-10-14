import { readSpeechEnv } from "./speech-env.mjs";
import fs from "node:fs/promises";

const config = readSpeechEnv();
const base = new URL(config.baseUrl);
if (
  base.protocol !== "https:" ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
)
  throw new Error("A clean HTTPS Base URL is required.");
const isMiMo = base.hostname === "api.xiaomimimo.com";
const model = config.model || (isMiMo ? "mimo-v2.5-tts" : "");
if (!model || !config.apiKey) throw new Error("Set MODEL and API_KEY in .env.");
const voice = isMiMo && config.voice === "alloy" ? "Chloe" : config.voice;
const text = "My favorite sport is ping-pong.";
const endpoint =
  config.baseUrl.replace(/\/$/, "") +
  (isMiMo ? "/chat/completions" : "/audio/speech");
const body = isMiMo
  ? {
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content:
            "Read the exact English text clearly and naturally, like a warm English teacher. Use a moderately slow pace. Do not add words.",
        },
        { role: "assistant", content: text },
      ],
      audio: { format: "wav", voice },
    }
  : { model, voice, input: text, response_format: "mp3", speed: 0.9 };
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: "Bearer " + config.apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
  redirect: "error",
  signal: AbortSignal.timeout(90000),
});
let bytes;
if (isMiMo) {
  const json = await response.json().catch(() => null);
  const encoded = json?.choices?.[0]?.message?.audio?.data;
  if (!response.ok || typeof encoded !== "string") {
    console.log(
      JSON.stringify({
        status: response.status,
        model,
        audio: false,
        errorType: json?.error?.type || null,
      }),
    );
    process.exitCode = 1;
  } else bytes = Buffer.from(encoded, "base64");
} else if (
  response.ok &&
  !response.headers.get("content-type")?.includes("json")
)
  bytes = Buffer.from(await response.arrayBuffer());
else {
  console.log(JSON.stringify({ status: response.status, model, audio: false }));
  process.exitCode = 1;
}
if (bytes) {
  await fs.mkdir("artifacts/speech-check", { recursive: true });
  const audioPath = `artifacts/speech-check/provider-sample.${isMiMo ? "wav" : "mp3"}`;
  await fs.writeFile(audioPath, bytes);
  const result = {
    status: response.status,
    baseUrl: base.origin + base.pathname,
    protocol: isMiMo ? "mimo-chat" : "openai-speech",
    model,
    voice,
    bytes: bytes.length,
    audioPath,
  };
  await fs.writeFile(
    "artifacts/speech-check/result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
}
