package cn.lingonest.app;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Public application maintenance. All install targets are selected and checked natively. */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean working = new AtomicBoolean(), cancelled = new AtomicBoolean();
    private volatile HttpURLConnection activeConnection;
    private volatile boolean downloading, destroyed;
    private AppUpdatePolicy.Manifest selected;

    interface Task { JSObject run() throws Exception; }
    private void execute(PluginCall call, String failureMessage, Task task) {
        if (destroyed || !working.compareAndSet(false, true)) { call.reject("更新正在处理，请稍候。", "UPDATE_BUSY"); return; }
        cancelled.set(false);
        io.execute(() -> {
            JSObject result = null; String error = null;
            try { result = task.run(); }
            catch (Exception failure) {
                String detail = failure.getMessage();
                error = cancelled.get() ? "下载已取消，可稍后重试。" :
                    failure instanceof IllegalArgumentException && detail != null && !detail.isEmpty() ? detail : failureMessage;
            } finally { working.set(false); }
            if (!destroyed) {
                if (error == null) call.resolve(result);
                else call.reject(error, "UPDATE_FAILED");
            }
        });
    }

    private int signatureFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }
    @SuppressWarnings("deprecation")
    private PackageInfo installed() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags());
    }
    @SuppressWarnings("deprecation")
    private long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    @SuppressWarnings("deprecation")
    private boolean trusted(PackageInfo info) throws Exception {
        if (info == null || info.applicationInfo == null || !AppUpdatePolicy.APPLICATION_ID.equals(info.packageName) ||
            (info.applicationInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) return false;
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null ? info.signingInfo.getApkContentsSigners() : info.signatures;
        return signatures != null && signatures.length == 1 && AppUpdatePolicy.CERTIFICATE.equals(
            AppUpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())));
    }
    private void requireSupported() throws Exception {
        if (!trusted(installed())) throw new IllegalArgumentException("当前为测试签名或非官方发布版本，请通过 GitHub 安装正式签名版本后再使用在线更新。");
    }
    private android.content.SharedPreferences preferences() {
        return getContext().getSharedPreferences("lingonest-app-update", android.content.Context.MODE_PRIVATE);
    }

    private long integer(JSONObject json, String key) throws Exception {
        Object value = json.get(key);
        if (!(value instanceof Number)) throw new IllegalArgumentException("更新清单字段无效。");
        double number = ((Number)value).doubleValue();
        if (!Double.isFinite(number) || number != Math.floor(number) || number < 0 || number > 2100000000L)
            throw new IllegalArgumentException("更新清单字段无效。");
        return (long)number;
    }
    private String string(JSONObject json, String key) throws Exception {
        Object value = json.get(key);
        if (!(value instanceof String)) throw new IllegalArgumentException("更新清单字段无效。");
        return (String)value;
    }
    private AppUpdatePolicy.Manifest parse(String text) throws Exception {
        if (text.length() > 65536) throw new IllegalArgumentException("更新清单过大。");
        JSONObject json = new JSONObject(text);
        return new AppUpdatePolicy.Manifest((int)integer(json, "schemaVersion"), string(json, "applicationId"),
            string(json, "versionName"), (int)integer(json, "versionCode"), (int)integer(json, "minSdkVersion"),
            string(json, "apkUrl"), integer(json, "size"), string(json, "sha256"), string(json, "notes"), string(json, "publishedAt"));
    }
    private JSObject json(AppUpdatePolicy.Manifest manifest) {
        return new JSObject().put("schemaVersion", 1).put("applicationId", AppUpdatePolicy.APPLICATION_ID)
            .put("versionName", manifest.versionName).put("versionCode", manifest.versionCode)
            .put("minSdkVersion", manifest.minSdk).put("apkUrl", manifest.apkUrl).put("size", manifest.size)
            .put("sha256", manifest.sha256).put("notes", manifest.notes).put("publishedAt", manifest.publishedAt);
    }
    private AppUpdatePolicy.Manifest cached() {
        if (selected == null) {
            try { selected = parse(preferences().getString("manifest", "")); } catch (Exception ignored) { /* Cache is optional. */ }
        }
        return selected;
    }

    @PluginMethod public void getInfo(PluginCall call) {
        execute(call, "无法读取应用版本，请重新打开应用。", () -> {
            PackageInfo current = installed(); boolean supported = trusted(current);
            JSObject result = new JSObject().put("versionName", current.versionName).put("versionCode", code(current))
                .put("sdkVersion", Build.VERSION.SDK_INT).put("supported", supported);
            AppUpdatePolicy.Manifest manifest = cached();
            if (supported && manifest != null) result.put("manifest", json(manifest));
            return result;
        });
    }

    private HttpURLConnection open(String address, boolean binary) throws Exception {
        URL url = new URL(address);
        long deadline = android.os.SystemClock.elapsedRealtime() + 20000;
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (destroyed || (binary && cancelled.get())) throw new InterruptedIOException();
            if (android.os.SystemClock.elapsedRealtime() > deadline) throw new IOException("Connection deadline exceeded");
            AppUpdatePolicy.requireTrustedUrl(url);
            HttpURLConnection connection = (HttpURLConnection)url.openConnection();
            activeConnection = connection;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
            connection.setRequestProperty("User-Agent", "LingoNest-Updater");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cache-Control", "no-cache");
            try {
                int status = connection.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new IOException();
                    url = new URL(url, location); connection.disconnect(); continue;
                }
                if (status == 404 && !binary) throw new IllegalArgumentException("当前发布尚未提供在线更新清单，可前往 GitHub 发布页查看。");
                if (status != 200) throw new IOException("HTTP " + status);
                return connection;
            } catch (Exception failure) { connection.disconnect(); throw failure; }
        }
        throw new IOException("Too many redirects");
    }
    @PluginMethod public void check(PluginCall call) {
        execute(call, "暂时无法连接 GitHub，请检查网络后重试。", () -> {
            requireSupported();
            HttpURLConnection connection = null;
            try {
                connection = open(AppUpdatePolicy.LATEST, false);
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                long deadline = android.os.SystemClock.elapsedRealtime() + 15000;
                try (InputStream input = connection.getInputStream()) {
                    AppUpdatePolicy.copy(input, body, 65536, -1,
                        () -> destroyed || android.os.SystemClock.elapsedRealtime() > deadline, bytes -> {});
                }
                AppUpdatePolicy.Manifest manifest = parse(new String(body.toByteArray(), StandardCharsets.UTF_8));
                preferences().edit().putString("manifest", json(manifest).toString()).apply();
                selected = manifest;
                return new JSObject().put("manifest", json(manifest));
            } finally { if (connection != null) connection.disconnect(); activeConnection = null; }
        });
    }

    private File root() throws IOException {
        File root = new File(getContext().getCacheDir(), "app-updates");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException();
        return root;
    }
    private AppUpdatePolicy.Manifest candidate(PluginCall call) throws Exception {
        requireSupported();
        AppUpdatePolicy.Manifest manifest = cached();
        Integer requested = call.getInt("versionCode");
        if (manifest == null || requested == null || requested != manifest.versionCode || manifest.versionCode <= code(installed()))
            throw new IllegalArgumentException("版本信息已变更，请重新检查更新。");
        if (manifest.minSdk > Build.VERSION.SDK_INT) throw new IllegalArgumentException("此更新需要更高的 Android 版本。");
        return manifest;
    }
    private void verify(File file, AppUpdatePolicy.Manifest manifest) throws Exception {
        if (!file.isFile() || file.length() != manifest.size || !manifest.sha256.equals(AppUpdatePolicy.digest(file)))
            throw new IllegalArgumentException("安装包校验失败，请重新下载。");
        PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
        if (!trusted(archive) || code(archive) != manifest.versionCode || !manifest.versionName.equals(archive.versionName) ||
            archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT)
            throw new IllegalArgumentException("安装包身份、签名或设备兼容性校验失败，请重新检查更新。");
    }

    @PluginMethod public void download(PluginCall call) {
        execute(call, "下载未完成，请检查网络、可用存储空间后重试。", () -> {
            downloading = true;
            HttpURLConnection connection = null; File partial = null;
            try {
                AppUpdatePolicy.Manifest manifest = candidate(call);
                File directory = root(), apk = new File(directory, "update.apk");
                partial = AppUpdatePolicy.prepareDownload(directory);
                if (apk.isFile()) {
                    try {
                        verify(apk, manifest);
                        if (cancelled.get() || destroyed) throw new InterruptedIOException();
                        return new JSObject();
                    } catch (InterruptedIOException stop) { throw stop; }
                      catch (Exception ignored) {
                        // An unusable cache must not consume space needed by its replacement.
                        if (!apk.delete()) throw new IOException("无法清理旧安装包。");
                    }
                }
                if (directory.getUsableSpace() < manifest.size + 20L * 1024 * 1024)
                    throw new IllegalArgumentException("存储空间不足，请清理后重试。");
                connection = open(manifest.apkUrl, true);
                long length = connection.getContentLengthLong();
                if (length >= 0 && length != manifest.size) throw new IOException("Unexpected content length");
                final long[] lastEvent = {0};
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    AppUpdatePolicy.copy(input, output, manifest.size, manifest.size, () -> cancelled.get() || destroyed, bytes -> {
                        long now = android.os.SystemClock.elapsedRealtime();
                        if (now - lastEvent[0] >= 200 || bytes == manifest.size) {
                            lastEvent[0] = now;
                            notifyListeners("progress", new JSObject().put("versionCode", manifest.versionCode).put("received", bytes).put("total", manifest.size));
                        }
                    });
                    output.getFD().sync();
                }
                verify(partial, manifest);
                if (cancelled.get() || destroyed) throw new InterruptedIOException();
                if (apk.exists() && !apk.delete()) throw new IOException();
                if (!partial.renameTo(apk)) throw new IOException();
                return new JSObject();
            } finally {
                if (partial != null) partial.delete();
                if (connection != null) connection.disconnect(); activeConnection = null; downloading = false;
            }
        });
    }
    @PluginMethod public void cancelDownload(PluginCall call) {
        if (working.get()) {
            cancelled.set(true);
            HttpURLConnection connection = activeConnection; if (downloading && connection != null) connection.disconnect();
        }
        call.resolve();
    }
    @PluginMethod public void install(PluginCall call) {
        execute(call, "无法打开系统安装界面，请重试或前往 GitHub 下载。", () -> {
            AppUpdatePolicy.Manifest manifest = candidate(call);
            File apk = new File(root(), "update.apk"); verify(apk, manifest);
            // Let the system installer handle source consent, including OEM one-time choices.
            // A false canRequestPackageInstalls() must not force a persistent settings grant.
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("app-update", uri));
            // Dispatch from the activity and wait only for launch, never claim installation success.
            java.util.concurrent.FutureTask<Void> launch = new java.util.concurrent.FutureTask<>(() -> {
                if (destroyed || getActivity() == null || getActivity().isFinishing()) throw new IOException("Activity closed");
                getActivity().startActivity(intent); return null;
            });
            getActivity().runOnUiThread(launch);
            try { launch.get(10, java.util.concurrent.TimeUnit.SECONDS); }
            catch (Exception failure) { launch.cancel(false); throw failure; }
            return new JSObject();
        });
    }
    @PluginMethod public void openInstallSettings(PluginCall call) {
        try {
            requireSupported();
            if (Build.VERSION.SDK_INT >= 26) getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())));
            call.resolve();
        } catch (Exception failure) { call.reject("无法打开安装来源设置，请在系统设置中管理此应用的安装来源权限。", "UPDATE_SETTINGS_FAILED"); }
    }
    @Override protected void handleOnDestroy() {
        destroyed = true; cancelled.set(true);
        HttpURLConnection connection = activeConnection; if (connection != null) connection.disconnect();
        io.shutdownNow();
    }
}
