package cn.lingonest.app;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Frozen course/text identity, independent of learner, credentials and playback speed. */
final class CourseAudioSpec {
    static final class Asset {
        final String id, text, textHash;
        Asset(String id, String text) {
            this.id = identifier(id);
            this.text = SpeechConfig.defaults().text(text);
            this.textHash = hash(this.text);
        }
    }
    final String courseId, courseVersion, title, digest;
    final List<Asset> assets;
    CourseAudioSpec(String courseId, String version, String title, List<Asset> assets) {
        this.courseId = identifier(courseId); this.courseVersion = identifier(version);
        if (title == null || title.isEmpty() || title.length() > 200) throw new IllegalArgumentException("课程标题无效。");
        this.title = title;
        if (assets == null || assets.isEmpty() || assets.size() > 512) throw new IllegalArgumentException("课程音频清单必须包含 1–512 项。");
        Set<String> ids = new HashSet<>(), texts = new HashSet<>();
        StringBuilder identity = new StringBuilder("course-audio-v1\n");
        field(identity, this.courseId); field(identity, this.courseVersion);
        for (Asset asset : assets) {
            if (!ids.add(asset.id) || !texts.add(asset.text)) throw new IllegalArgumentException("课程音频标识或文字重复。");
            field(identity, asset.id); field(identity, asset.text);
        }
        if (identity.length() > 512000) throw new IllegalArgumentException("课程音频文字清单过大。");
        this.assets = Collections.unmodifiableList(new ArrayList<>(assets)); digest = hash(identity.toString());
    }
    Asset asset(String id) {
        for (Asset asset : assets) if (asset.id.equals(id)) return asset;
        throw new IllegalArgumentException("该音频不在课程资源清单中。");
    }
    static String generation(SpeechConfig config) { return config.cacheKey("course-audio-generation-v1"); }
    static String hash(String value) { return NativeGuards.sha256(value.getBytes(StandardCharsets.UTF_8)); }
    private static void field(StringBuilder b, String value) { b.append(value.length()).append(':').append(value); }
    private static String identifier(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_.-]{1,128}")) throw new IllegalArgumentException("课程或资源标识无效。");
        return value;
    }
}
