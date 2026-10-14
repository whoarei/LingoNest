package cn.lingonest.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class SpeechConfigTest {
    private SpeechConfig config(String protocol, String voice, double speed, String key) {
        return new SpeechConfig("ai", protocol, "https://api.example.com/v1/", "test-tts", voice, speed, "Read exactly.", key);
    }
    @Test public void normalizesEndpointAndRejectsUnsafeUrls() {
        assertEquals("https://api.example.com/v1/audio/speech", config("openai-speech", "alloy", 1, "test-key").endpoint());
        for (String url : new String[]{"http://example.com/v1", "https://user:pass@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/v1#x", "https://example.com/v1/chat/completions"}) {
            try { SpeechConfig.cleanBaseUrl(url); fail(url); } catch (IllegalArgumentException expected) { }
        }
    }
    @Test public void voiceChangesInvalidateCacheButSpeedAndCredentialsDoNot() {
        SpeechConfig first = config("mimo-chat", "Chloe", 0.75, "first-key");
        assertEquals(first.cacheKey("Hello."), config("mimo-chat", "Chloe", 1.25, "second-key").cacheKey("Hello."));
        assertNotEquals(first.cacheKey("Hello."), config("mimo-chat", "Milo", 0.75, "first-key").cacheKey("Hello."));
        assertNotEquals(first.cacheKey("Hello."), first.cacheKey("Goodbye."));
    }
    @Test public void payloadPreservesTextAndUsesTheProviderRole() {
        String body = config("mimo-chat", "Chloe", 1, "never-in-body").body("  Say \"hello\".\nDon't change it.  ");
        assertTrue(body.contains("\"role\":\"assistant\",\"content\":\"Say \\\"hello\\\".\\u000aDon't change it.\""));
        assertTrue(body.contains("\"format\":\"wav\""));
        assertFalse(body.contains("never-in-body"));
        assertEquals("https://api.example.com/v1/chat/completions", config("mimo-chat", "Chloe", 1, "x").endpoint());
    }
    @Test public void rejectsHeaderInjectionInvalidSpeedAndLongText() {
        try { config("openai-speech", "alloy", 1, "key\nInjected: true"); fail(); } catch (IllegalArgumentException expected) { }
        for (double speed : new double[]{Double.NaN, 0, 4.1}) try { config("mimo-chat", "Chloe", speed, "x"); fail(); } catch (IllegalArgumentException expected) { }
        try { config("mimo-chat", "Chloe", 1, "x").body(new String(new char[3001]).replace('\0', 'a')); fail(); } catch (IllegalArgumentException expected) { }
    }
}
