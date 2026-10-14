import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { readSpeechEnv } from "./speech-env.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const env = readSpeechEnv();
const base = new URL(env.baseUrl);
if (
  base.protocol !== "https:" ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  !env.apiKey
)
  throw new Error("Set a clean HTTPS BASE_URL and API_KEY in .env.");
const mimo = base.hostname === "api.xiaomimimo.com";
const source = {
  protocol: mimo ? "mimo-chat" : "openai-speech",
  baseUrl: env.baseUrl.replace(/\/+$/, ""),
  model: env.model || (mimo ? "mimo-v2.5-tts" : ""),
  voice: mimo && env.voice === "alloy" ? "Chloe" : env.voice,
  instructions: mimo
    ? "Read the exact English text clearly and naturally, like a warm English teacher. Do not add or change words."
    : "",
};
if (!source.model) throw new Error("Set MODEL in .env.");
const endpoint =
  source.baseUrl + (mimo ? "/chat/completions" : "/audio/speech");
const body = (text) =>
  mimo
    ? {
        model: source.model,
        stream: false,
        messages: [
          { role: "user", content: source.instructions },
          { role: "assistant", content: text },
        ],
        audio: { format: "wav", voice: source.voice },
      }
    : {
        model: source.model,
        input: text,
        voice: source.voice,
        response_format: "mp3",
        speed: 1.0,
      };
// Java includes the literal 1.0 in OpenAI requests; preserve identical cache identity.
const bodyString = (text) =>
  JSON.stringify(body(text)).replace('"speed":1}', '"speed":1.0}');
const generation = hash(
  "speech-v1\n" +
    source.protocol +
    "\n" +
    endpoint +
    "\n" +
    bodyString("course-audio-generation-v1"),
);
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
let spec;
try {
  spec = (await vite.ssrLoadModule("/src/course-speech.ts")).courseAudioSpec;
} finally {
  await vite.close();
}
// Optional developer-side probe only. Never write generated audio into APK source assets.
const output = path.resolve("artifacts/course-audio-samples-0.1.3");
await fs.mkdir(output, { recursive: true });
const manifestPath = path.join(output, "manifest.json");
let previous;
try {
  previous = JSON.parse(await fs.readFile(manifestPath, "utf8"));
} catch {
  /* First generation. */
}
if (previous && previous.generation !== generation)
  throw new Error(
    "Existing sample voice differs. Keep the archived samples and use the app for a different voice.",
  );
const manifest = {
  format: 1,
  ...spec,
  generation,
  source,
  generatedAt: previous?.generatedAt || new Date().toISOString(),
  assets: [],
};
async function save() {
  const partial = manifestPath + ".pending";
  await fs.writeFile(partial, JSON.stringify(manifest, null, 2));
  await fs.rename(partial, manifestPath);
}
try {
  for (const [index, asset] of spec.assets.entries()) {
    const filename = hash(asset.text) + (mimo ? ".wav" : ".mp3");
    const target = path.join(output, filename);
    const old = previous?.assets.find(
      (item) =>
        item.id === asset.id &&
        item.text === asset.text &&
        item.file === filename,
    );
    let bytes;
    if (old) {
      try {
        const existing = await fs.readFile(target);
        if (hash(existing) === old.sha256) bytes = existing;
      } catch {
        /* Resume missing file. */
      }
    }
    const reused = !!bytes;
    if (!bytes) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.apiKey,
          "Content-Type": "application/json",
        },
        body: bodyString(asset.text),
        redirect: "error",
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      if (mimo) {
        const encoded = (await response.json()).choices?.[0]?.message?.audio
          ?.data;
        if (typeof encoded !== "string")
          throw new Error("Missing audio response.");
        bytes = Buffer.from(encoded, "base64");
        if (
          bytes.toString("ascii", 0, 4) !== "RIFF" ||
          bytes.toString("ascii", 8, 12) !== "WAVE"
        )
          throw new Error("Invalid WAV response.");
      } else {
        if (response.headers.get("content-type")?.match(/json|text\//))
          throw new Error("Non-audio response.");
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (!bytes.length || bytes.length > 16 * 1024 * 1024)
        throw new Error("Invalid audio size.");
      await fs.writeFile(target + ".pending", bytes);
      await fs.rename(target + ".pending", target);
    }
    manifest.assets.push({
      ...asset,
      file: filename,
      sha256: hash(bytes),
      bytes: bytes.length,
    });
    await save();
    console.log(
      JSON.stringify({
        completed: index + 1,
        total: spec.assets.length,
        id: asset.id,
        bytes: bytes.length,
        reused,
      }),
    );
  }
  manifest.complete = true;
  await save();
  console.log(
    JSON.stringify({
      complete: true,
      total: spec.assets.length,
      bytes: manifest.assets.reduce((n, a) => n + a.bytes, 0),
      voice: source.voice,
      model: source.model,
    }),
  );
} catch {
  // Provider errors must never print echoed authorization, response bodies, or environment values.
  console.error(
    "Course audio generation stopped. Completed files are retained; run again to resume without repeating them.",
  );
  process.exitCode = 1;
}
