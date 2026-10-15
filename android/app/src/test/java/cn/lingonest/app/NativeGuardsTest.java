package cn.lingonest.app;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import static org.junit.Assert.*;

public class NativeGuardsTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void recordingPathsCannotEscapeOrSelectAnotherAppDirectory() throws Exception {
        File root = temporary.newFolder();
        String[] attacks = { "../recordings/a/x.m4a", "/data/data/other/x.m4a", "recordings/a/../b/x.m4a",
            "recordings/a/x.m4a/", "recordings/a/x.pending", "recordings/a%2Fb/x.m4a", "recordings\\a\\x.m4a" };
        for (String path : attacks) {
            try { NativeGuards.recordingFile(root, path); fail(path); }
            catch (IllegalArgumentException expected) { /* No bridge path aliases. */ }
        }
        assertEquals(new File(root, "recordings/student-1/clip_123.m4a").getCanonicalFile(),
            NativeGuards.recordingFile(root, "recordings/student-1/clip_123.m4a"));
    }

    @Test public void profilesRejectTraversalAndUnexpectedSeparators() {
        for (String value : new String[]{"", "..", "student/other", "student\\other", " student", "学生", "a".repeat(81)}) {
            try { NativeGuards.learnerId(value); fail(value); }
            catch (IllegalArgumentException expected) {}
        }
        assertEquals("learner-123_a", NativeGuards.learnerId("learner-123_a"));
    }

    @Test public void stateLimitCountsUtf8BytesNotJavaCharacters() {
        String chinese = "中".repeat(NativeGuards.MAX_STATE_BYTES / 3 + 1);
        assertTrue(chinese.length() < NativeGuards.MAX_STATE_BYTES);
        try { NativeGuards.payloadBytes(chinese); fail("UTF-8 overflow accepted"); }
        catch (IllegalArgumentException expected) {}
        assertArrayEquals(new byte[]{123,125}, NativeGuards.payloadBytes("{}"));
    }

    @Test public void integrityDigestDetectsSingleByteChange() {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", NativeGuards.sha256(new byte[0]));
        assertNotEquals(NativeGuards.sha256(new byte[]{1,2,3}), NativeGuards.sha256(new byte[]{1,2,4}));
    }

    @Test public void malformedUtf16CannotBeSilentlyReplacedWhileSaving() {
        try { NativeGuards.payloadBytes("\ud800"); fail("Unpaired surrogate accepted"); }
        catch (IllegalArgumentException expected) {}
    }
    @Test public void courseImageCleanupRejectsTraversalAndAllowsMissingFilesForRetry() throws Exception {
        File root = temporary.newFolder();
        String image = "course-images/12345678-1234-1234-1234-123456789abc.jpg";
        assertEquals(new File(root, image).getCanonicalFile(), NativeGuards.courseImageFile(root, image));
        for (String path : new String[]{"../" + image, "/" + image, "course-images/../secret.jpg", "course-images/x.jpg", "recordings/a/x.m4a"}) {
            try { NativeGuards.courseImageFile(root, path); fail(path); }
            catch (IllegalArgumentException expected) {}
        }
    }

    @Test public void courseImagesNormalizeTheTrustedAppDirectoryBeforeCheckingTheImagePath() throws Exception {
        File root = temporary.newFolder();
        String image = "course-images/12345678-1234-1234-1234-123456789abc.jpg";
        File saved = new File(root, image);
        assertTrue(saved.getParentFile().mkdirs());
        assertTrue(saved.createNewFile());
        File alias = new File(root, "../" + root.getName());
        assertNotEquals(alias.getAbsoluteFile(), alias.getCanonicalFile());
        File readable = NativeGuards.courseImageFile(alias, image);
        assertEquals(saved.getCanonicalFile(), readable);
        assertTrue(readable.isFile());
    }
}
