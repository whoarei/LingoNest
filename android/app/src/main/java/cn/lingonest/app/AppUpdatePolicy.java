package cn.lingonest.app;

import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.function.BooleanSupplier;

/** Update trust and bounded IO, independent of the WebView and Android lifecycle. */
final class AppUpdatePolicy {
    static final String REPOSITORY = "https://github.com/whoarei/LingoNest";
    static final String LATEST = REPOSITORY + "/releases/latest/download/update.json";
    static final String APPLICATION_ID = "cn.lingonest.app";
    static final String CERTIFICATE = "28c461e4f2f8612f9d7717d727e772177474798fd7c48b03ca3ffbca8c81bf0a";
    static final long MAX_APK_BYTES = 200L * 1024 * 1024;

    static final class Manifest {
        final String versionName, apkUrl, sha256, notes, publishedAt;
        final int versionCode, minSdk;
        final long size;

        Manifest(int schemaVersion, String applicationId, String versionName, int versionCode,
                 int minSdk, String apkUrl, long size, String sha256, String notes, String publishedAt) {
            if (schemaVersion != 1 || !APPLICATION_ID.equals(applicationId) || versionName == null ||
                versionName.length() > 80 || !versionName.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)") ||
                versionCode < 1 || versionCode > 2100000000 || minSdk < 24 || minSdk > 1000 ||
                size <= 0 || size > MAX_APK_BYTES || sha256 == null || !sha256.matches("[a-f0-9]{64}") ||
                notes == null || notes.length() > 16000 || publishedAt == null || publishedAt.length() > 80 ||
                !apkUrlFor(versionName).equals(apkUrl)) {
                throw new IllegalArgumentException("更新清单无效，请稍后重新检查。");
            }
            this.versionName = versionName; this.versionCode = versionCode; this.minSdk = minSdk;
            this.apkUrl = apkUrl; this.size = size; this.sha256 = sha256;
            this.notes = notes; this.publishedAt = publishedAt;
        }
    }

    static String apkUrlFor(String version) {
        return REPOSITORY + "/releases/download/v" + version + "/lingonest-" + version + "-release.apk";
    }

    static void requireTrustedUrl(URL url) throws IOException {
        String host = url.getHost();
        boolean github = "github.com".equals(host) &&
            (url.toString().equals(LATEST) || url.getPath().matches("/whoarei/LingoNest/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/(update\\.json|lingonest-[0-9]+\\.[0-9]+\\.[0-9]+-release\\.apk)"));
        boolean assets = "release-assets.githubusercontent.com".equals(host) ||
            "objects.githubusercontent.com".equals(host) || "github-releases.githubusercontent.com".equals(host);
        if (!"https".equals(url.getProtocol()) || (url.getPort() != -1 && url.getPort() != 443) ||
            url.getUserInfo() != null || url.getRef() != null || !(github || assets)) {
            throw new IOException("更新下载地址不受信任。");
        }
    }

    static String digest(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32768]; int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }

    static File prepareDownload(File root) throws IOException {
        File partial = new File(root, "update.pending.apk");
        if (partial.exists() && !partial.delete()) throw new IOException("无法清理上次未完成的下载。");
        return partial;
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    interface Progress { void accept(long bytes); }

    static void copy(InputStream input, OutputStream output, long limit, long expected,
                     BooleanSupplier cancelled, Progress progress) throws IOException {
        byte[] buffer = new byte[32768]; long total = 0; int count;
        while ((count = input.read(buffer)) != -1) {
            if (cancelled.getAsBoolean()) throw new InterruptedIOException("下载已取消。");
            total += count;
            if (total > limit) throw new IOException("下载文件超过允许大小。");
            output.write(buffer, 0, count); progress.accept(total);
        }
        if (cancelled.getAsBoolean()) throw new InterruptedIOException("下载已取消。");
        if (expected >= 0 && total != expected) throw new IOException("下载文件不完整，请重试。");
    }
}
