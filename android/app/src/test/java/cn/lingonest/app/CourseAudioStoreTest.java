package cn.lingonest.app;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import static org.junit.Assert.*;

/** Real filesystem durability/ownership tests; Android decoding is tested separately. */
public class CourseAudioStoreTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private CourseAudioSpec spec(String version) { return new CourseAudioSpec("test.course", version, "Test", Arrays.asList(new CourseAudioSpec.Asset("a", "Hello."), new CourseAudioSpec.Asset("b", "Good morning."))); }
    private SpeechConfig config(String voice, double speed, String key) { return new SpeechConfig("ai", "mimo-chat", "https://api.example.com/v1", "test-tts", voice, speed, "Read exactly.", key); }
    private void bytes(File file, String text) throws Exception { try (FileOutputStream out = new FileOutputStream(file)) { out.write(text.getBytes(StandardCharsets.UTF_8)); } }
    private void commit(CourseAudioStore store, CourseAudioSpec spec, String generation, String id, String value) throws Exception { File file = store.stage(spec, generation); bytes(file, value); store.commit(spec, generation, spec.asset(id), file); }
    private String full(CourseAudioStore store, CourseAudioSpec spec, SpeechConfig config, String prefix) throws Exception { String generation = store.begin(spec, config); commit(store, spec, generation, "a", prefix + "-a"); commit(store, spec, generation, "b", prefix + "-b"); store.finish(spec, generation); return generation; }

    @Test public void permanentCourseFilesSurviveRestartAndPreviewCleanup() throws Exception {
        File files = temporary.getRoot(); CourseAudioSpec spec = spec("1"); CourseAudioStore store = new CourseAudioStore(files);
        full(store, spec, config("Chloe", 1, "fake"), "old");
        File preview = new File(files, "speech-audio"); assertTrue(preview.mkdirs()); File cached = new File(preview, "preview.audio"); bytes(cached, "preview"); assertTrue(cached.delete());
        CourseAudioStore reopened = new CourseAudioStore(files); assertNotNull(reopened.playable(spec, "a"));
        assertTrue(reopened.status(spec, null).complete); assertEquals("Chloe", reopened.status(spec, null).voice);
    }
    @Test public void replacementKeepsOldVoiceUntilCompleteAndResumesWithoutRepeatingAssets() throws Exception {
        File files = temporary.getRoot(); CourseAudioStore store = new CourseAudioStore(files); CourseAudioSpec spec = spec("1");
        full(store, spec, config("Chloe", 1, "fake"), "old"); File old = store.playable(spec, "a");
        String next = store.begin(spec, config("Milo", 1, "new-key")); commit(store, spec, next, "a", "new-a");
        CourseAudioStore restarted = new CourseAudioStore(files);
        assertEquals(old, restarted.playable(spec, "a")); assertEquals(1, restarted.status(spec, null).pendingReady);
        assertEquals(next, restarted.begin(spec, config("Milo", 0.75, "another-key")));
        assertNotNull(restarted.existing(spec, next, spec.asset("a"))); assertNull(restarted.existing(spec, next, spec.asset("b")));
        commit(restarted, spec, next, "b", "new-b"); restarted.finish(spec, next);
        assertEquals("Milo", restarted.status(spec, null).voice); assertNotEquals(old, restarted.playable(spec, "a")); assertTrue(old.isFile());
    }
    @Test public void corruptedAudioIsDetectedAndOnlyTheMissingAssetNeedsRepair() throws Exception {
        CourseAudioStore store = new CourseAudioStore(temporary.getRoot()); CourseAudioSpec spec = spec("1"); SpeechConfig config = config("Chloe", 1, "fake");
        String generation = full(store, spec, config, "old"); File corrupt = store.playable(spec, "b"); bytes(corrupt, "changed");
        assertNull(store.playable(spec, "b")); assertEquals(1, store.status(spec, null).ready);
        assertEquals(generation, store.begin(spec, config)); assertNotNull(store.existing(spec, generation, spec.asset("a")));
        commit(store, spec, generation, "b", "repaired-b"); store.finish(spec, generation); assertTrue(store.status(spec, null).complete);
    }
    @Test public void anInterruptedNewSelectionFallsBackToThePreviousDurableSlot() throws Exception {
        CourseAudioStore store = new CourseAudioStore(temporary.getRoot()); CourseAudioSpec spec = spec("1");
        full(store, spec, config("Chloe", 1, "fake"), "old"); // selection revisions 1, 2
        store.begin(spec, config("Milo", 1, "fake")); // revision 3, slot 1
        File selection = new File(temporary.getRoot(), "course-audio/" + spec.digest + "/selection.1.properties"); bytes(selection, "interrupted");
        assertEquals("Chloe", new CourseAudioStore(temporary.getRoot()).status(spec, null).voice);
    }
    @Test public void bothDamagedSelectionSlotsFailClosedAndPreserveAudio() throws Exception {
        CourseAudioStore store = new CourseAudioStore(temporary.getRoot()); CourseAudioSpec spec = spec("1");
        full(store, spec, config("Chloe", 1, "fake"), "old"); File asset = store.playable(spec, "a");
        for (int i = 0; i < 2; i++) bytes(new File(temporary.getRoot(), "course-audio/" + spec.digest + "/selection." + i + ".properties"), "damaged");
        try { store.status(spec, null); fail(); } catch (java.io.IOException expected) { }
        assertTrue(asset.isFile());
    }
    @Test public void courseVersionsAndTextsHaveIndependentResourceIdentities() throws Exception {
        CourseAudioStore store = new CourseAudioStore(temporary.getRoot()); CourseAudioSpec old = spec("1"); full(store, old, config("Chloe", 1, "fake"), "old");
        assertNull(store.playable(spec("2"), "a"));
        CourseAudioSpec edited = new CourseAudioSpec("test.course", "1", "Test", Arrays.asList(new CourseAudioSpec.Asset("a", "Changed text.")));
        assertNotEquals(old.digest, edited.digest); assertNull(store.playable(edited, "a"));
        assertNotNull(store.playable(old, "a"));
    }
    @Test public void clearingOneCourseCannotDeleteAnotherCourseOrLearningData() throws Exception {
        CourseAudioStore store = new CourseAudioStore(temporary.getRoot()); CourseAudioSpec a = spec("1"), b = spec("2");
        full(store, a, config("Chloe", 1, "fake"), "a"); full(store, b, config("Chloe", 1, "fake"), "b");
        File learning = new File(temporary.getRoot(), "learning.db"); bytes(learning, "learning");
        store.clear(a); assertNull(store.playable(a, "a")); assertNotNull(store.playable(b, "a")); assertTrue(learning.isFile());
    }
    @Test public void aFreshCourseHasNoPreGeneratedAudio() throws Exception {
        CourseAudioStore store = new CourseAudioStore(temporary.getRoot()); CourseAudioSpec spec = spec("1");
        assertFalse(store.hasSelection(spec)); assertNull(store.playable(spec, "a"));
        assertEquals(0, store.status(spec, null).ready); assertEquals(2, store.status(spec, null).total);
        assertFalse(store.status(spec, null).complete); assertEquals("", store.status(spec, null).voice);
    }
    @Test public void firstGenerationCanResumeItsPartialPackAfterRestart() throws Exception {
        CourseAudioStore store = new CourseAudioStore(temporary.getRoot()); CourseAudioSpec spec = spec("1");
        SpeechConfig config = config("Chloe", 1, "fake"); String generation = store.begin(spec, config);
        commit(store, spec, generation, "a", "a"); CourseAudioStore restarted = new CourseAudioStore(temporary.getRoot());
        assertEquals(1, restarted.status(spec, null).ready); assertFalse(restarted.status(spec, null).complete);
        assertNotNull(restarted.playable(spec, "a")); assertNull(restarted.playable(spec, "b"));
        assertEquals(generation, restarted.begin(spec, config));
        commit(restarted, spec, generation, "b", "b"); restarted.finish(spec, generation);
        assertTrue(restarted.status(spec, null).complete);
    }
}
