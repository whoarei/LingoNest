package cn.lingonest.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.URL;
import javax.net.ssl.SSLException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Private image capture and explicit content-model requests; credentials never enter JS. */
@CapacitorPlugin(name = "CourseContent")
public class CourseContentPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean requesting = new AtomicBoolean(false);
    private SpeechConfigStore recognition, generation;
    private File cameraFile;
    private boolean selecting;
    private volatile HttpURLConnection activeConnection;
    private final AtomicInteger requestEpoch = new AtomicInteger();
    @PluginMethod public void cancelRequest(PluginCall call) { requestEpoch.incrementAndGet(); HttpURLConnection connection = activeConnection; if (connection != null) connection.disconnect(); call.resolve(); }
    @Override public void load() {
        recognition = new SpeechConfigStore(getContext(), "lingonest-content-recognition", "lingonest.content.recognition.v1");
        generation = new SpeechConfigStore(getContext(), "lingonest-content-generation", "lingonest.content.generation.v1");
    }
    SpeechConfigStore store(String kind) {
        if ("recognition".equals(kind)) return recognition;
        if ("generation".equals(kind)) return generation;
        throw new IllegalArgumentException("请选择识别或课程生成模型。");
    }
    private JSObject publicConfig(SpeechConfig config) {
        JSObject result = new JSObject(); result.put("baseUrl", config.baseUrl); result.put("model", config.model); result.put("hasKey", !config.apiKey.isEmpty()); return result;
    }
    @PluginMethod public void getConfig(PluginCall call) {
        io.execute(() -> { try { JSObject result = new JSObject(); result.put("recognition", publicConfig(recognition.load())); result.put("generation", publicConfig(generation.load())); call.resolve(result); }
            catch (Exception error) { call.reject("内容模型配置无法读取，请在设置中重新配置。", "CONTENT_CONFIG_ERROR"); } });
    }
    @PluginMethod public void saveConfig(PluginCall call) {
        io.execute(() -> { try {
            JSONObject input = call.getData(); input.put("mode", "ai"); input.put("protocol", "openai-speech"); input.put("voice", "alloy"); input.put("speed", 1); input.put("instructions", "");
            call.resolve(publicConfig(store(call.getString("kind")).save(input)));
        } catch (IllegalArgumentException error) { call.reject("配置无效：请使用 HTTPS 服务地址，并填写模型与 API Key；更换域名需重新填写 Key。", "INVALID_ARGUMENT"); }
          catch (Exception error) { call.reject("内容模型配置保存失败，请重试。", "CONTENT_CONFIG_ERROR"); } });
    }
    @PluginMethod public void clearConfig(PluginCall call) {
        io.execute(() -> { try { store(call.getString("kind")).clear(); call.resolve(); }
            catch (Exception error) { call.reject("内容模型配置移除失败。", "CONTENT_CONFIG_ERROR"); } });
    }
    @PluginMethod public void pickImage(PluginCall call) {
        if (selecting) { call.reject("请先完成当前图片选择。", "IMAGE_BUSY"); return; }
        selecting = true;
        try {
            Intent intent;
            if ("camera".equals(call.getString("mode"))) {
                File exports = new File(getContext().getCacheDir(), "exports");
                if (!exports.isDirectory() && !exports.mkdirs()) throw new IOException();
                cameraFile = new File(exports, "course-" + UUID.randomUUID() + ".jpg");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", cameraFile);
                intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                intent.setClipData(android.content.ClipData.newRawUri("course-image", uri));
            } else {
                cameraFile = null;
                intent = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
            }
            startActivityForResult(call, intent, "imageResult");
        } catch (Exception error) { selecting = false; if (cameraFile != null) cameraFile.delete(); cameraFile = null; call.reject("无法打开拍照或相册，请检查设备是否有可用应用。", "IMAGE_OPEN_FAILED"); }
    }
    @ActivityCallback private void imageResult(PluginCall call, ActivityResult result) {
        selecting = false;
        File captured = cameraFile; cameraFile = null;
        if (call == null) { if (captured != null) captured.delete(); return; }
        if (result.getResultCode() != Activity.RESULT_OK) { if (captured != null) captured.delete(); call.resolve(new JSObject().put("cancelled", true)); return; }
        io.execute(() -> {
            File incoming = null, saved = null;
            try {
                File root = new File(getContext().getFilesDir(), "course-images");
                if (!root.isDirectory() && !root.mkdirs()) throw new IOException();
                incoming = File.createTempFile("incoming-", ".tmp", root);
                Uri uri = result.getData() == null ? null : result.getData().getData();
                try (InputStream input = captured != null ? new FileInputStream(captured) : getContext().getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(incoming)) {
                    if (input == null) throw new IOException();
                    byte[] buffer = new byte[8192]; int count, total = 0;
                    while ((count = input.read(buffer)) != -1) { total += count; if (total > 20 * 1024 * 1024) throw new IOException(); output.write(buffer, 0, count); }
                }
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true; BitmapFactory.decodeFile(incoming.getPath(), bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException();
                BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
                while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 1600) options.inSampleSize *= 2;
                Bitmap bitmap = BitmapFactory.decodeFile(incoming.getPath(), options); if (bitmap == null) throw new IOException();
                try {
                    int orientation = new ExifInterface(incoming.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                    Matrix matrix = new Matrix();
                    switch (orientation) {
                        case ExifInterface.ORIENTATION_ROTATE_90: matrix.postRotate(90); break;
                        case ExifInterface.ORIENTATION_ROTATE_180: matrix.postRotate(180); break;
                        case ExifInterface.ORIENTATION_ROTATE_270: matrix.postRotate(270); break;
                        case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.postScale(-1, 1); break;
                        case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.postScale(1, -1); break;
                        case ExifInterface.ORIENTATION_TRANSPOSE: matrix.postScale(-1, 1); matrix.postRotate(90); break;
                        case ExifInterface.ORIENTATION_TRANSVERSE: matrix.postScale(-1, 1); matrix.postRotate(270); break;
                    }
                    Bitmap upright = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                    saved = new File(root, UUID.randomUUID() + ".jpg");
                    try (FileOutputStream output = new FileOutputStream(saved)) { if (!upright.compress(Bitmap.CompressFormat.JPEG, 90, output)) throw new IOException(); output.getFD().sync(); }
                    if (upright != bitmap) upright.recycle();
                } finally { bitmap.recycle(); }
                call.resolve(new JSObject().put("path", "course-images/" + saved.getName()).put("rotation", 0));
            } catch (Exception | OutOfMemoryError error) { if (saved != null) saved.delete(); call.reject("图片无法读取或超过 20 MB，请重新拍摄较清晰的单页图片。", "IMAGE_READ_FAILED"); }
            finally { if (incoming != null) incoming.delete(); if (captured != null) captured.delete(); }
        });
    }
    private File imageFile(String path) throws IOException {
        // Normalize the trusted app directory first: Android may expose it through
        // /data/data -> /data/user/0. Still reject aliases inside course-images.
        File file = NativeGuards.courseImageFile(getContext().getFilesDir(), path);
        if (!file.isFile()) throw new IOException();
        return file;
    }
    @PluginMethod public void imageUrl(PluginCall call) {
        io.execute(() -> { try { call.resolve(new JSObject().put("url", Uri.fromFile(imageFile(call.getString("path"))).toString())); }
            catch (Exception error) { call.reject("课程图片不存在或不可读取。", "IMAGE_READ_FAILED"); } });
    }
    @PluginMethod public void request(PluginCall call) {
        startRequest(call, false);
    }
    @PluginMethod public void testConfig(PluginCall call) {
        startRequest(call, true);
    }
    HttpURLConnection openConnection(URL url) throws IOException {
        return (HttpURLConnection) url.openConnection();
    }
    private void startRequest(PluginCall call, boolean testing) {
        if (!requesting.compareAndSet(false, true)) { call.reject("当前内容正在处理，请稍候。", "CONTENT_BUSY"); return; }
        final int epoch = requestEpoch.get();
        io.execute(() -> {
            HttpURLConnection connection = null;
            try {
                String kind = call.getString("kind");
                SpeechConfig config = store(kind).load();
                String prompt = testing ? ContentModelProbe.prompt(kind) : call.getString("prompt", "");
                if (prompt.isEmpty() || prompt.length() > 60000) throw new IllegalArgumentException();
                JSONArray images = testing ? null : call.getData().optJSONArray("images");
                if (images != null && images.length() > 6) throw new IllegalArgumentException();
                if (config.apiKey.isEmpty() || config.model.isEmpty()) { call.reject("请先在设置中配置对应的识别或课程生成模型。", "CONTENT_CONFIG_REQUIRED"); return; }
                JSONArray content = new JSONArray(); content.put(new JSONObject().put("type", "text").put("text", prompt));
                boolean probeImage = testing && "recognition".equals(kind);
                if (probeImage) content.put(new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", ContentModelProbe.imageUrl())));
                if (images != null) for (int i = 0; i < images.length(); i++) {
                    JSONObject image = images.getJSONObject(i); File file = imageFile(image.getString("path"));
                    int rotation = image.optInt("rotation"); if (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270) throw new IllegalArgumentException();
                    Bitmap bitmap = BitmapFactory.decodeFile(file.getPath()); if (bitmap == null) throw new IOException();
                    byte[] bytes;
                    try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        Matrix matrix = new Matrix(); matrix.postRotate(rotation);
                        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                        if (!rotated.compress(Bitmap.CompressFormat.JPEG, 90, output)) throw new IOException();
                        if (rotated != bitmap) rotated.recycle(); bytes = output.toByteArray();
                    } finally { bitmap.recycle(); }
                    content.put(new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))));
                }
                JSONObject body = new JSONObject().put("model", config.model).put("stream", false).put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", probeImage || images != null && images.length() > 0 ? content : prompt)));
                if ("api.xiaomimimo.com".equalsIgnoreCase(new URL(config.baseUrl).getHost())) {
                    body.put("response_format", new JSONObject().put("type", "json_object"));
                    body.put("thinking", new JSONObject().put("type", "disabled"));
                }
                connection = openConnection(new URL(config.baseUrl + "/chat/completions"));
                activeConnection = connection;
                if (epoch != requestEpoch.get()) { call.reject("处理已停止，草稿保留。", "CONTENT_CANCELLED"); return; }
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(90000);
                connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Authorization", "Bearer " + config.apiKey); connection.setRequestProperty("Content-Type", "application/json");
                byte[] request = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(request.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(request); }
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) { call.reject(ContentModelProbe.httpFailure(code), "CONTENT_REQUEST_FAILED"); return; }
                byte[] response;
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int count, total = 0;
                    while ((count = input.read(buffer)) != -1) { total += count; if (total > 2 * 1024 * 1024) throw new IOException(); output.write(buffer, 0, count); }
                    response = output.toByteArray();
                }
                JSONObject message = new JSONObject(new String(response, StandardCharsets.UTF_8)).getJSONArray("choices").getJSONObject(0).getJSONObject("message");
                String result = message.getString("content");
                if (result.trim().isEmpty() || result.length() > 200000) throw new ContentModelProbe.Failure("模型返回的内容为空或过长，请检查模型是否支持文本输出。");
                if (epoch != requestEpoch.get()) { call.reject("处理已停止，草稿保留。", "CONTENT_CANCELLED"); return; }
                if (testing) { ContentModelProbe.validate(kind, result); call.resolve(); }
                else call.resolve(new JSObject().put("text", result));
            } catch (Exception | OutOfMemoryError error) {
                String reason;
                if (epoch != requestEpoch.get()) { call.reject("处理已停止，草稿保留。", "CONTENT_CANCELLED"); return; }
                if (error instanceof SocketTimeoutException) reason = "模型请求超时，请检查网络或稍后重试。";
                else if (error instanceof UnknownHostException) reason = "无法找到模型服务，请检查服务地址和网络连接。";
                else if (error instanceof SSLException) reason = "无法建立安全连接，请检查服务的 HTTPS 证书或网络。";
                else if (error instanceof org.json.JSONException) reason = "模型服务返回格式不兼容，请使用兼容 Chat Completions 且支持文本输出的模型。";
                else if (error instanceof IllegalArgumentException) reason = "请求参数无效，请检查模型配置与输入内容。";
                else reason = "识别或课程生成未完成，请检查网络与模型配置后重试；已保存的草稿保留。";
                // Only locally authored validation messages may cross the bridge.
                if (error instanceof ContentModelProbe.Failure) reason = error.getMessage();
                call.reject(reason, "CONTENT_REQUEST_FAILED");
            }
            finally { if (connection != null) connection.disconnect(); activeConnection = null; requesting.set(false); }
        });
    }
    @Override protected void handleOnDestroy() { requestEpoch.incrementAndGet(); HttpURLConnection connection = activeConnection; if (connection != null) connection.disconnect(); io.shutdown(); }
}
