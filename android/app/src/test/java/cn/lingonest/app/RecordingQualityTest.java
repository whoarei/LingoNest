package cn.lingonest.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class RecordingQualityTest {
    @Test public void userStoppedAudibleCaptureCanBeReviewed() {
        assertNull(RecordingQuality.failureCode(2500, 1200, 8, "user"));
    }
    @Test public void silenceAndSingleClickDoNotBecomeReviewableAttempts() {
        assertEquals("RECORDING_SILENT", RecordingQuality.failureCode(2500, 0, 0, "user"));
        assertEquals("RECORDING_SILENT", RecordingQuality.failureCode(2500, 32000, 1, "user"));
        assertEquals("RECORDING_TOO_SHORT", RecordingQuality.failureCode(500, 1200, 4, "user"));
    }
    @Test public void backgroundAndDurationLimitNeverReturnUsableAudio() {
        assertEquals("RECORDING_INTERRUPTED", RecordingQuality.failureCode(2500, 1200, 8, "background"));
        assertEquals("RECORDING_INTERRUPTED", RecordingQuality.failureCode(2500, 1200, 8, "audio_interrupted"));
        assertEquals("RECORDING_TRUNCATED", RecordingQuality.failureCode(119900, 1200, 8, "duration_limit"));
        assertEquals("RECORDING_TRUNCATED", RecordingQuality.failureCode(120000, 1200, 8, "user"));
    }
}
