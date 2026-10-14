package cn.lingonest.app;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

/** Isolated namespaces: no learning DB, real keys, or existing audio are touched. */
public class SpeechIntegrationTest {
    private Context context; private String name; private File sandbox;
    @Before public void before() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        name = "speech-test-" + UUID.randomUUID(); sandbox = new File(context.getCacheDir(), name); assertTrue(sandbox.mkdirs());
    }
    @After public void after() throws Exception {
        new AiSpeechService(sandbox).clear(); new File(sandbox, "speech-audio").delete(); sandbox.delete();
        context.deleteSharedPreferences(name); KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null); keys.deleteEntry(name);
    }
    private JSONObject input() throws Exception {
        return new JSONObject().put("mode", "ai").put("protocol", "mimo-chat").put("baseUrl", "https://api.example.com/v1").put("model", "test-tts").put("voice", "Chloe").put("speed", 0.9).put("instructions", "Read exactly.").put("apiKey", "fake-only-credential-" + name);
    }
    @Test public void keyIsEncryptedAndNeverReturnedToJavascript() throws Exception {
        SpeechConfigStore store = new SpeechConfigStore(context, name, name); SpeechConfig config = store.save(input());
        SpeechConfig restored = new SpeechConfigStore(context, name, name).load(); assertEquals(config.apiKey, restored.apiKey);
        assertTrue(SpeechConfigStore.publicConfig(restored).getBoolean("hasKey")); assertFalse(SpeechConfigStore.publicConfig(restored).has("apiKey"));
        File file = new File(context.getApplicationInfo().dataDir, "shared_prefs/" + name + ".xml");
        assertFalse(new String(Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8).contains(config.apiKey));
    }
    @Test public void retainingKeyCannotSendItToANewHost() throws Exception {
        SpeechConfigStore store = new SpeechConfigStore(context, name, name); SpeechConfig original = store.save(input());
        JSONObject changed = input().put("apiKey", "").put("baseUrl", "https://another.example.com/v1");
        try { store.save(changed); fail(); } catch (IllegalArgumentException expected) { }
        assertEquals(original.baseUrl, store.load().baseUrl);
        SpeechConfig retained = store.save(input().put("apiKey", "").put("speed", 1.25)); assertEquals(original.apiKey, retained.apiKey);
    }
    @Test public void cachesValidatedAudioAndReusesItWithoutNetworkAfterRestart() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        AiSpeechService service = new AiSpeechService(sandbox, (config, text, cancelled) -> { requests.incrementAndGet(); return wav(); });
        SpeechConfig config = new SpeechConfig("ai", "mimo-chat", "https://api.example.com/v1", "test-tts", "Chloe", 1, "", "fake");
        assertFalse(service.prepare(config, "Hello.", () -> false).cached);
        AiSpeechService restarted = new AiSpeechService(sandbox, (c, t, cancel) -> { throw new AssertionError("Must not use network"); });
        SpeechConfig slower = new SpeechConfig("ai", "mimo-chat", "https://api.example.com/v1", "test-tts", "Chloe", 0.75, "", "different-key");
        assertTrue(restarted.prepare(slower, "Hello.", () -> false).cached); assertEquals(1, requests.get());
        assertEquals(1, restarted.info()[0]); restarted.clear(); assertEquals(0, restarted.info()[0]);
    }
    @Test public void rejectsNonAudioAndCancelledOutputWithoutCaching() throws Exception {
        SpeechConfig config = new SpeechConfig("ai", "openai-speech", "https://api.example.com/v1", "test-tts", "alloy", 1, "", "fake");
        AiSpeechService invalid = new AiSpeechService(sandbox, (c, t, cancel) -> "{\"error\":\"not audio\"}".getBytes());
        try { invalid.prepare(config, "Hello.", () -> false); fail(); } catch (Exception expected) { }
        assertEquals(0, invalid.info()[0]);
        AiSpeechService cancelled = new AiSpeechService(sandbox, (c, t, cancel) -> { throw new AssertionError("Cancelled request must not send"); });
        try { cancelled.prepare(config, "Hello.", () -> true); fail(); } catch (AiSpeechService.Failure expected) { assertEquals("AUDIO_INTERRUPTED", expected.code); }
        assertEquals(0, cancelled.info()[0]);
    }
    private static byte[] wav() {
        return sampleWav();
    }
    @Test public void courseAudioReusesLegacyPreviewThenSurvivesPreviewDeletion() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        AiSpeechService speech = new AiSpeechService(sandbox, (c,t,cancel) -> { requests.incrementAndGet(); return sampleWav(); });
        SpeechConfig config = new SpeechConfig("ai", "mimo-chat", "https://api.example.com/v1", "test-tts", "Chloe", 1, "", "fake");
        speech.prepare(config, "Hello.", ()->false);
        CourseAudioSpec spec = new CourseAudioSpec("test.course", "1", "Test", java.util.Collections.singletonList(new CourseAudioSpec.Asset("hello", "Hello.")));
        CourseAudioStore store = new CourseAudioStore(sandbox); String generation = store.begin(spec, config);
        File stage = store.stage(spec, generation); speech.downloadTo(config, "Hello.", stage, ()->false);
        store.commit(spec, generation, spec.asset("hello"), stage); store.finish(spec, generation); speech.clear();
        File permanent = new CourseAudioStore(sandbox).playable(spec, "hello"); assertNotNull(permanent); assertEquals(1, requests.get());
        android.media.MediaMetadataRetriever reader = new android.media.MediaMetadataRetriever();
        try { reader.setDataSource(permanent.getAbsolutePath()); assertTrue(Long.parseLong(reader.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)) > 0); }
        finally { reader.release(); store.clear(spec); new File(sandbox,"course-audio").delete(); }
    }
    private static byte[] sampleWav() {
        int samples = 8000; ByteBuffer b = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes()).putInt(36 + samples * 2).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)1);
        b.putInt(16000).putInt(32000).putShort((short)2).putShort((short)16).put("data".getBytes()).putInt(samples * 2);
        for (int i = 0; i < samples; i++) b.putShort((short)(Math.sin(i * 2 * Math.PI * 440 / 16000) * 5000));
        return b.array();
    }
}
