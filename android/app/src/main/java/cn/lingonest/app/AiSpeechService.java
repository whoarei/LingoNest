package cn.lingonest.app;

import android.media.MediaMetadataRetriever;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/** Bounded provider downloads, validated audio, and a private persistent LRU cache. No retry billing. */
final class AiSpeechService {
    static final int MAX_AUDIO_BYTES = 16 * 1024 * 1024;
    static final long MAX_CACHE_BYTES = 128L * 1024 * 1024;
    interface Transport { byte[] request(SpeechConfig config, String text, BooleanSupplier cancelled) throws Exception; }
    static final class Result { final File file; final boolean cached; Result(File file, boolean cached) { this.file = file; this.cached = cached; } }
    static final class Failure extends IOException { final String code; Failure(String code, String message) { super(message); this.code = code; } }
    private final File directory;
    private final Transport transport;
    private final AtomicReference<HttpURLConnection> connection = new AtomicReference<>();
    AiSpeechService(File filesDir) throws IOException { this(filesDir, null); }
    AiSpeechService(File filesDir, Transport testTransport) throws IOException {
        directory = new File(filesDir.getCanonicalFile(), "speech-audio");
        if (!directory.getCanonicalFile().equals(directory.getAbsoluteFile()) || (!directory.isDirectory() && !directory.mkdirs())) throw new IOException("语音缓存目录不可用。");
        transport = testTransport == null ? this::request : testTransport;
    }
    void cancel() { HttpURLConnection current = connection.getAndSet(null); if (current != null) current.disconnect(); }
    /** Course generation writes to its owner's staging file, never to the preview LRU. */
    void downloadTo(SpeechConfig config, String text, File target, BooleanSupplier cancelled) throws Exception {
        checkCancelled(cancelled);
        File oldCache = new File(directory, config.cacheKey(text) + ".audio");
        boolean copied = false, complete = false;
        try {
            if (oldCache.isFile()) {
                try { validate(oldCache); CourseAudioStore.copy(new java.io.FileInputStream(oldCache), target); copied = true; }
                catch (Exception invalidCache) { /* A legacy cache is optional; course assets remain independent. */ }
            }
            if (!copied) {
                byte[] audio = transport.request(config, text, cancelled); checkCancelled(cancelled);
                if (audio.length == 0 || audio.length > MAX_AUDIO_BYTES) throw new Failure("AUDIO_TOO_LARGE", "语音为空或超过 16 MB，请分段生成。");
                try (FileOutputStream out = new FileOutputStream(target)) { out.write(audio); out.getFD().sync(); }
            }
            validate(target); checkCancelled(cancelled); complete = true;
        } finally { if (!complete && target.exists()) target.delete(); }
    }
    Result prepare(SpeechConfig config, String text, BooleanSupplier cancelled) throws Exception {
        File target = new File(directory, config.cacheKey(text) + ".audio");
        if (target.isFile()) {
            try { validate(target); target.setLastModified(System.currentTimeMillis()); return new Result(target, true); }
            catch (Exception corrupt) { if (!target.delete()) throw new Failure("CACHE_ERROR", "语音缓存损坏且无法移除。"); }
        }
        checkCancelled(cancelled);
        byte[] audio = transport.request(config, text, cancelled);
        checkCancelled(cancelled);
        if (audio.length == 0 || audio.length > MAX_AUDIO_BYTES) throw new Failure("AUDIO_TOO_LARGE", "语音为空或超过 16 MB，请分段生成。");
        File partial = new File(directory, config.cacheKey(text) + ".part");
        try {
            try (FileOutputStream out = new FileOutputStream(partial)) { out.write(audio); out.getFD().sync(); }
            validate(partial); checkCancelled(cancelled);
            if (!partial.renameTo(target)) throw new Failure("CACHE_ERROR", "生成的语音未能保存，请检查设备空间。");
            evict(target); return new Result(target, false);
        } finally { if (partial.exists()) partial.delete(); }
    }
    private byte[] request(SpeechConfig config, String text, BooleanSupplier cancelled) throws Exception {
        HttpURLConnection http = (HttpURLConnection) new URL(config.endpoint()).openConnection();
        connection.set(http);
        try {
            checkCancelled(cancelled);
            http.setInstanceFollowRedirects(false); http.setConnectTimeout(15000); http.setReadTimeout(90000);
            http.setRequestMethod("POST"); http.setDoOutput(true);
            http.setRequestProperty("Content-Type", "application/json"); http.setRequestProperty("Authorization", "Bearer " + config.apiKey);
            http.setRequestProperty("Accept", "mimo-chat".equals(config.protocol) ? "application/json" : "audio/mpeg");
            byte[] body = config.body(text).getBytes(StandardCharsets.UTF_8); http.setFixedLengthStreamingMode(body.length);
            try (java.io.OutputStream out = http.getOutputStream()) { out.write(body); }
            int status = http.getResponseCode();
            if (status < 200 || status >= 300) throw httpFailure(status);
            String type = http.getContentType();
            if ("mimo-chat".equals(config.protocol)) {
                byte[] bytes = readBounded(http.getInputStream(), (MAX_AUDIO_BYTES * 4 / 3) + 65536, cancelled);
                try {
                    JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                    String encoded = json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getJSONObject("audio").getString("data");
                    if (encoded.length() > MAX_AUDIO_BYTES * 4 / 3 + 4) throw new Failure("AUDIO_TOO_LARGE", "返回音频过大，请分段生成。");
                    return Base64.decode(encoded, Base64.DEFAULT);
                } catch (Failure tooLarge) { throw tooLarge; }
                catch (Exception invalid) { throw new Failure("AUDIO_RESPONSE_INVALID", "接口没有返回有效音频，请确认模型支持 MiMo 语音合成。"); }
            }
            if (type != null && (type.contains("json") || type.startsWith("text/"))) throw new Failure("AUDIO_RESPONSE_INVALID", "接口返回了文字或 JSON，请确认支持 /audio/speech。");
            return readBounded(http.getInputStream(), MAX_AUDIO_BYTES, cancelled);
        } finally { connection.compareAndSet(http, null); http.disconnect(); }
    }
    private static byte[] readBounded(InputStream input, int limit, BooleanSupplier cancelled) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) { checkCancelled(cancelled); if ((long) out.size() + count > limit) throw new Failure("AUDIO_TOO_LARGE", "语音响应超过容量限制，请分段生成。"); out.write(buffer, 0, count); }
            return out.toByteArray();
        }
    }
    static Failure httpFailure(int status) {
        if (status == 401 || status == 403) return new Failure("SPEECH_AUTH_FAILED", "语音接口鉴权失败，请检查 API Key 和模型访问权限。");
        if (status == 429) return new Failure("SPEECH_RATE_LIMIT", "语音服务额度不足或请求过于频繁，请稍后再试。");
        if (status >= 300 && status < 400) return new Failure("SPEECH_REDIRECT", "语音接口要求重定向，请填写最终服务 Base URL。");
        if (status == 400 || status == 404 || status == 405 || status == 422) return new Failure("SPEECH_UNSUPPORTED", "语音接口或模型不可用（HTTP " + status + "），请检查协议、模型和音色。");
        return new Failure("SPEECH_HTTP_ERROR", "语音服务暂时不可用（HTTP " + status + "），请稍后重试。");
    }
    private static void validate(File file) throws Exception {
        if (!file.isFile() || file.length() == 0 || file.length() > MAX_AUDIO_BYTES) throw new IOException("无效音频。");
        MediaMetadataRetriever reader = new MediaMetadataRetriever();
        try {
            reader.setDataSource(file.getAbsolutePath());
            String duration = reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (duration == null || Long.parseLong(duration) <= 0) throw new Failure("AUDIO_RESPONSE_INVALID", "接口返回的内容不能播放为音频，请检查模型与输出格式。");
        } finally { reader.release(); }
    }
    private File[] cacheFiles() throws IOException {
        File[] files = directory.listFiles(file -> file.getName().matches("[a-f0-9]{64}\\.(audio|part)"));
        if (files == null) throw new IOException("语音缓存不可读取。");
        for (File file : files) if (!file.getCanonicalFile().equals(file.getAbsoluteFile())) throw new IOException("语音缓存路径无效。");
        return files;
    }
    long[] info() throws IOException { long bytes = 0, count = 0; for (File file : cacheFiles()) { bytes += file.length(); if (file.getName().endsWith(".audio")) count++; } return new long[]{ count, bytes }; }
    void clear() throws IOException { for (File file : cacheFiles()) if (!file.delete()) throw new IOException("部分语音缓存清理失败，请重试。"); }
    private void evict(File protectedFile) throws IOException {
        File[] files = cacheFiles(); Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        long used = Arrays.stream(files).mapToLong(File::length).sum();
        for (File file : files) { if (used <= MAX_CACHE_BYTES) break; if (!file.equals(protectedFile) && file.delete()) used -= file.length(); }
        if (used > MAX_CACHE_BYTES) throw new IOException("语音缓存容量不足。");
    }
    private static void checkCancelled(BooleanSupplier cancelled) throws Failure { if (cancelled.getAsBoolean()) throw new Failure("AUDIO_INTERRUPTED", "语音已取消。"); }
}
