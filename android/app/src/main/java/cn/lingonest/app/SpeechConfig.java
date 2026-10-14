package cn.lingonest.app;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;

/** Provider protocol is explicit: a chat-compatible server need not implement audio/speech. */
final class SpeechConfig {
    final String mode, protocol, baseUrl, model, voice, instructions, apiKey;
    final double speed;

    SpeechConfig(String mode, String protocol, String baseUrl, String model, String voice,
                 double speed, String instructions, String apiKey) {
        if (!"device".equals(mode) && !"ai".equals(mode)) throw invalid("请选择设备朗读或 AI 语音。");
        if (!"openai-speech".equals(protocol) && !"mimo-chat".equals(protocol)) throw invalid("语音接口类型无效。");
        this.mode = mode; this.protocol = protocol;
        this.baseUrl = baseUrl == null || baseUrl.trim().isEmpty() ? "" : cleanBaseUrl(baseUrl);
        this.model = cleanField(model, 128); this.voice = cleanField(voice, 128);
        this.instructions = instructions == null ? "" : instructions.trim();
        this.apiKey = apiKey == null ? "" : apiKey.trim(); this.speed = speed;
        if (!Double.isFinite(speed) || speed < 0.25 || speed > 4) throw invalid("语速范围为 0.25 到 4。建议英语学习使用 0.85–1.0。");
        if (this.instructions.length() > 2000) throw invalid("朗读风格说明不能超过 2000 个字符。");
        if (this.apiKey.length() > 4096 || this.apiKey.indexOf('\r') >= 0 || this.apiKey.indexOf('\n') >= 0) throw invalid("API Key 格式无效。");
        if ("ai".equals(mode) && (this.baseUrl.isEmpty() || this.model.isEmpty() || this.voice.isEmpty() || this.apiKey.isEmpty()))
            throw invalid("请填写服务地址、语音模型、音色和 API Key。");
    }
    static SpeechConfig defaults() { return new SpeechConfig("device", "openai-speech", "", "", "alloy", 0.9, "", ""); }
    static String cleanBaseUrl(String value) {
        try {
            URI uri = new URI(value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null ||
                uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getPort() == 0 || uri.getPort() > 65535)
                throw invalid("服务地址必须是 HTTPS Base URL，不能包含账户、查询参数或片段。");
            String result = uri.normalize().toASCIIString();
            while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
            if (result.endsWith("/chat/completions") || result.endsWith("/audio/speech")) throw invalid("填写 Base URL，例如 https://api.example.com/v1，而不是完整接口路径。");
            return result;
        } catch (Exception error) { if (error instanceof IllegalArgumentException) throw (IllegalArgumentException) error; throw invalid("服务地址格式无效。"); }
    }
    static String origin(String base) {
        if (base == null || base.isEmpty()) return "";
        URI uri = URI.create(cleanBaseUrl(base));
        return uri.getScheme().toLowerCase(java.util.Locale.ROOT) + "://" + uri.getHost().toLowerCase(java.util.Locale.ROOT) + ":" + (uri.getPort() < 0 ? 443 : uri.getPort());
    }
    String endpoint() { return baseUrl + ("mimo-chat".equals(protocol) ? "/chat/completions" : "/audio/speech"); }
    String text(String value) {
        if (value == null || value.trim().isEmpty() || value.length() > 3000) throw invalid("朗读文字不能为空且不能超过 3000 个字符。");
        return Normalizer.normalize(value.trim(), Normalizer.Form.NFC);
    }
    String body(String rawText) {
        String input = text(rawText);
        if ("mimo-chat".equals(protocol)) {
            String style = instructions.isEmpty() ? "Read the exact English text clearly and naturally. Do not add or change words." : instructions;
            return "{\"model\":" + quote(model) + ",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":" + quote(style) +
                "},{\"role\":\"assistant\",\"content\":" + quote(input) + "}],\"audio\":{\"format\":\"wav\",\"voice\":" + quote(voice) + "}}";
        }
        return "{\"model\":" + quote(model) + ",\"input\":" + quote(input) + ",\"voice\":" + quote(voice) + ",\"response_format\":\"mp3\",\"speed\":1.0" +
            (instructions.isEmpty() ? "" : ",\"instructions\":" + quote(instructions)) + "}";
    }
    String cacheKey(String rawText) { return NativeGuards.sha256(("speech-v1\n" + protocol + "\n" + endpoint() + "\n" + body(rawText)).getBytes(StandardCharsets.UTF_8)); }
    static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\\' || c == '"') out.append('\\').append(c);
            else if (c < 32) out.append(String.format(java.util.Locale.ROOT, "\\u%04x", (int)c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
    private static String cleanField(String value, int limit) {
        String result = value == null ? "" : value.trim();
        if (result.length() > limit || result.chars().anyMatch(c -> c < 32)) throw invalid("模型或音色名称格式无效。");
        return result;
    }
    private static IllegalArgumentException invalid(String message) { return new IllegalArgumentException(message); }
}
