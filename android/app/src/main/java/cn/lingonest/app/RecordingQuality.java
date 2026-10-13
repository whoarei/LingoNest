package cn.lingonest.app;

/** Conservative capture checks only; energy is not proof of intelligible speech or pronunciation. */
final class RecordingQuality {
    static final int MAX_DURATION_MS = 120000;
    static final int MIN_DURATION_MS = 800;
    static final int ENERGY_THRESHOLD = 250;
    private RecordingQuality() {}

    static String failureCode(long durationMs, int peakAmplitude, int audibleFrames, String stopReason) {
        if ("duration_limit".equals(stopReason) || durationMs >= MAX_DURATION_MS) return "RECORDING_TRUNCATED";
        if (!"user".equals(stopReason)) return "RECORDING_INTERRUPTED";
        if (durationMs < MIN_DURATION_MS) return "RECORDING_TOO_SHORT";
        if (peakAmplitude < ENERGY_THRESHOLD || audibleFrames < 2) return "RECORDING_SILENT";
        return null;
    }

    static String message(String code) {
        if ("RECORDING_TRUNCATED".equals(code)) return "录音达到 120 秒上限，可能不完整，请分段重新录制。";
        if ("RECORDING_INTERRUPTED".equals(code)) return "录音因切换后台或音频中断而结束，请重新录制。";
        if ("RECORDING_TOO_SHORT".equals(code)) return "录音太短，请至少录制一秒并完整说出答案。";
        if ("RECORDING_SILENT".equals(code)) return "未检测到足够声音，请检查麦克风并重新录制。";
        return "录音文件无效，请重新录制。";
    }
}
