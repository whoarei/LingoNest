import { execFileSync } from "node:child_process";
import { readSpeechEnv } from "./speech-env.mjs";
import path from "node:path";
import fs from "node:fs/promises";

// Developer-side debug APK only. Credentials travel directly to the native encrypted store.
// Never log a CDP expression, exception details, request body, or the API key.
const adbPath = path.join(
  process.env.ANDROID_HOME || "E:/Android/sdk",
  "platform-tools/adb.exe",
);
let serial = process.env.ANDROID_SERIAL;
const runAdb = (args) =>
  execFileSync(adbPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  }).trim();
const adb = (...args) => runAdb(["-s", serial, ...args]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket,
  forward,
  nextId = 1;
const pending = new Map();
async function evaluate(expression) {
  const id = nextId++;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Native speech operation timed out."));
    }, 120000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
  if (result.exceptionDetails)
    throw new Error("Native speech operation failed; check the app settings.");
  return result.result?.value;
}
try {
  if (!serial) {
    const devices = runAdb(["devices"])
      .split(/\r?\n/)
      .filter((line) => /\tdevice$/.test(line))
      .map((line) => line.split("\t")[0]);
    if (devices.length !== 1)
      throw new Error(
        "Connect one online Android device, or set ANDROID_SERIAL.",
      );
    serial = devices[0];
  }
  const input = readSpeechEnv();
  const base = new URL(input.baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !input.apiKey
  )
    throw new Error("Set a clean HTTPS BASE_URL and API_KEY in .env.");
  const mimo = base.hostname === "api.xiaomimimo.com";
  const config = {
    mode: "ai",
    protocol: mimo ? "mimo-chat" : "openai-speech",
    baseUrl: input.baseUrl,
    model: input.model || (mimo ? "mimo-v2.5-tts" : ""),
    voice: mimo && input.voice === "alloy" ? "Chloe" : input.voice,
    speed: 0.9,
    instructions: mimo
      ? "Read the exact English text clearly and naturally, like a warm English teacher. Do not add or change words."
      : "",
    apiKey: input.apiKey,
  };
  if (!config.model) throw new Error("Set MODEL in .env.");
  adb("shell", "am", "start", "-W", "-n", "cn.lingonest.app/.MainActivity");
  const pid = adb("shell", "pidof", "cn.lingonest.app");
  let debuggerReady = false;
  for (let i = 0; i < 50; i++) {
    if (
      adb("shell", "cat", "/proc/net/unix").includes(
        `webview_devtools_remote_${pid}`,
      )
    ) {
      debuggerReady = true;
      break;
    }
    await pause(100);
  }
  if (!debuggerReady)
    throw new Error(
      "Install the debug APK and unlock the phone before importing configuration.",
    );
  forward = adb(
    "forward",
    "tcp:0",
    `localabstract:webview_devtools_remote_${pid}`,
  );
  const targets = await (
    await fetch(`http://127.0.0.1:${forward}/json/list`, {
      signal: AbortSignal.timeout(5000),
    })
  ).json();
  const target = targets.find(
    (entry) =>
      entry.type === "page" && entry.url.startsWith("https://localhost"),
  );
  if (!target) throw new Error("The application WebView is not ready.");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () =>
      reject(new Error("Cannot connect to application WebView."));
  });
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data),
      entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    data.error
      ? entry.reject(new Error("Application WebView command failed."))
      : entry.resolve(data.result);
  };
  socket.onclose = () => {
    for (const entry of pending.values())
      entry.reject(new Error("Application WebView disconnected."));
    pending.clear();
  };
  let nativeReady = false;
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        "typeof Capacitor !== 'undefined' && !!Capacitor.Plugins.LingoNative",
      )
    ) {
      nativeReady = true;
      break;
    }
    await pause(100);
  }
  if (!nativeReady) throw new Error("Native application bridge is not ready.");
  const stored = await evaluate(
    `Capacitor.Plugins.LingoNative.setSpeechConfig(${JSON.stringify(config)})`,
  );
  config.apiKey = "";
  if (!stored?.hasKey || Object.hasOwn(stored, "apiKey"))
    throw new Error("Native credential storage verification failed.");
  const result = {
    configured: true,
    protocol: stored.protocol,
    model: stored.model,
    voice: stored.voice,
    speed: stored.speed,
    hasKey: stored.hasKey,
  };
  if (process.argv.includes("--verify")) {
    const text = "My favorite sport is ping-pong. Will you join us?";
    result.firstPlayback = await evaluate(
      `Capacitor.Plugins.LingoNative.speak(${JSON.stringify({ text })})`,
    );
    result.repeatPlayback = await evaluate(
      `Capacitor.Plugins.LingoNative.speak(${JSON.stringify({ text })})`,
    );
    try {
      await evaluate(
        `Capacitor.Plugins.LingoNative.setSpeechConfig(${JSON.stringify({ ...stored, speed: 0.75 })})`,
      );
      result.slowerPlayback = await evaluate(
        `Capacitor.Plugins.LingoNative.speak(${JSON.stringify({ text })})`,
      );
    } finally {
      await evaluate(
        `Capacitor.Plugins.LingoNative.setSpeechConfig(${JSON.stringify(stored)})`,
      );
    }
    if (!result.repeatPlayback?.cached || !result.slowerPlayback?.cached)
      throw new Error("Native cache reuse verification failed.");
    result.cache = await evaluate(
      "Capacitor.Plugins.LingoNative.getSpeechCacheInfo()",
    );
    await fs.mkdir("artifacts/speech-check", { recursive: true });
    await fs.writeFile(
      "artifacts/speech-check/android-result.json",
      JSON.stringify(result, null, 2),
    );
  }
  console.log(JSON.stringify(result));
  socket.close();
  // Reload public configuration in the UI without modifying learning data.
  adb("shell", "am", "force-stop", "cn.lingonest.app");
  adb("shell", "am", "start", "-W", "-n", "cn.lingonest.app/.MainActivity");
} catch (error) {
  console.error(
    error instanceof Error && !("stdout" in error) && !("stderr" in error)
      ? error.message.replace(/https?:\/\/\S+/g, "[service]")
      : "Android configuration import failed; check the device connection.",
  );
  process.exitCode = 1;
} finally {
  if (socket) socket.close();
  if (forward)
    try {
      adb("forward", "--remove", `tcp:${forward}`);
    } catch {
      /* Disconnected device: no credentials are logged. */
    }
}
