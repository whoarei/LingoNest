package cn.lingonest.app;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.net.URL;
import static org.junit.Assert.*;

public class AppUpdatePolicyTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private AppUpdatePolicy.Manifest manifest(String application, String url, int code, long size, String hash) {
        return new AppUpdatePolicy.Manifest(1, application, "0.1.17", code, 24, url, size, hash, "更新说明", "2026-10-24T15:00:00Z");
    }
    @Test public void candidateIsBoundToThisPackageAndVersionedRepositoryAsset() {
        String url = AppUpdatePolicy.apkUrlFor("0.1.17"), hash = "a".repeat(64);
        assertEquals(18, manifest(AppUpdatePolicy.APPLICATION_ID, url, 18, 5, hash).versionCode);
        String[][] invalid = {{"other.app", url}, {AppUpdatePolicy.APPLICATION_ID, url.replace("whoarei", "attacker")},
            {AppUpdatePolicy.APPLICATION_ID, url.replace("v0.1.17/", "latest/")}, {AppUpdatePolicy.APPLICATION_ID, url + "?redirect=other"}};
        for (String[] input : invalid) {
            try { manifest(input[0], input[1], 18, 5, hash); fail(input[1]); } catch (IllegalArgumentException expected) {}
        }
        for (long size : new long[]{0, -1, AppUpdatePolicy.MAX_APK_BYTES + 1}) {
            try { manifest(AppUpdatePolicy.APPLICATION_ID, url, 18, size, hash); fail("size " + size); } catch (IllegalArgumentException expected) {}
        }
        try { manifest(AppUpdatePolicy.APPLICATION_ID, url, 0, 5, hash); fail(); } catch (IllegalArgumentException expected) {}
        try { manifest(AppUpdatePolicy.APPLICATION_ID, url, 18, 5, "not-a-hash"); fail(); } catch (IllegalArgumentException expected) {}
    }
    @Test public void redirectsStayOnHttpsGithubReleaseHosts() throws Exception {
        for (String url : new String[]{AppUpdatePolicy.LATEST, AppUpdatePolicy.apkUrlFor("0.1.17"),
            "https://release-assets.githubusercontent.com/github-production-release-asset/123?sig=abc"}) AppUpdatePolicy.requireTrustedUrl(new URL(url));
        for (String url : new String[]{"http://github.com/whoarei/LingoNest/releases/latest/download/update.json",
            "https://release-assets.githubusercontent.com.evil.test/a", "https://github.com/other/repo/releases/download/v1.0.0/update.json",
            "https://user@release-assets.githubusercontent.com/a", "https://release-assets.githubusercontent.com:444/a",
            "https://release-assets.githubusercontent.com/a#fragment", "https://api.github.com/a"}) {
            try { AppUpdatePolicy.requireTrustedUrl(new URL(url)); fail(url); } catch (IOException expected) {}
        }
    }
    @Test public void streamingRejectsTruncationOverflowAndCancellation() throws Exception {
        byte[] input = {1,2,3,4}; ByteArrayOutputStream output = new ByteArrayOutputStream();
        AppUpdatePolicy.copy(new ByteArrayInputStream(input), output, 4, 4, () -> false, bytes -> {});
        assertArrayEquals(input, output.toByteArray());
        try { AppUpdatePolicy.copy(new ByteArrayInputStream(input), new ByteArrayOutputStream(), 3, 3, () -> false, bytes -> {}); fail(); } catch (IOException expected) {}
        try { AppUpdatePolicy.copy(new ByteArrayInputStream(input), new ByteArrayOutputStream(), 5, 5, () -> false, bytes -> {}); fail(); } catch (IOException expected) {}
        try { AppUpdatePolicy.copy(new ByteArrayInputStream(input), new ByteArrayOutputStream(), 4, 4, () -> true, bytes -> {}); fail(); } catch (InterruptedIOException expected) {}
        try { AppUpdatePolicy.copy(new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), 4, 0, () -> true, bytes -> {}); fail(); } catch (InterruptedIOException expected) {}
    }
    @Test public void digestDetectsCorruptCachedApk() throws Exception {
        File file = File.createTempFile("lingonest-update-", ".apk");
        try {
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(new byte[]{1,2,3}); }
            String first = AppUpdatePolicy.digest(file);
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(new byte[]{1,2,4}); }
            assertNotEquals(first, AppUpdatePolicy.digest(file));
        } finally { file.delete(); }
    }
    @Test public void aRetryReclaimsOnlyTheAbandonedPartialBeforeCheckingFreeSpace() throws Exception {
        File root = temporary.newFolder();
        File partial = new File(root, "update.pending.apk"), complete = new File(root, "update.apk"), data = new File(root, "learning.json");
        assertTrue(partial.createNewFile()); assertTrue(complete.createNewFile()); assertTrue(data.createNewFile());
        assertEquals(partial, AppUpdatePolicy.prepareDownload(root));
        assertFalse(partial.exists()); assertTrue(complete.isFile()); assertTrue(data.isFile());
        assertTrue(partial.mkdir()); assertTrue(new File(partial, "unexpected").createNewFile());
        try { AppUpdatePolicy.prepareDownload(root); fail("Must not recursively remove unexpected directories"); }
        catch (IOException expected) { assertTrue(new File(partial, "unexpected").exists()); }
    }
}
