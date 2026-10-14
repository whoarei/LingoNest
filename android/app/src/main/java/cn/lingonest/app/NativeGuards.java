package cn.lingonest.app;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.CharBuffer;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Pure checks shared by the bridge and host-side tests. No caller supplies an absolute path. */
final class NativeGuards {
    static final int MAX_STATE_BYTES = 10 * 1024 * 1024;
    static final long MAX_REVISION = 9007199254740991L;

    private NativeGuards() {}

    static String learnerId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{1,80}")) {
            throw new IllegalArgumentException("学习档案标识无效。");
        }
        return value;
    }

    static byte[] payloadBytes(String payload) {
        if (payload == null || payload.isEmpty() || payload.length() > MAX_STATE_BYTES) {
            throw new IllegalArgumentException("学习数据为空或超过 10 MB 上限。");
        }
        byte[] bytes;
        try {
            ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(payload));
            bytes = new byte[encoded.remaining()]; encoded.get(bytes);
        } catch (CharacterCodingException malformed) {
            throw new IllegalArgumentException("学习数据包含无效的 Unicode 字符。");
        }
        if (bytes.length > MAX_STATE_BYTES) throw new IllegalArgumentException("学习数据超过 10 MB 上限。");
        return bytes;
    }

    static File learnerDirectory(File filesDir, String learnerId) throws IOException {
        File root = new File(filesDir.getCanonicalFile(), "recordings");
        File directory = new File(root, learnerId(learnerId));
        // Reject aliases/symlinks as well as lexical traversal, including cross-profile aliases.
        if (!root.getAbsoluteFile().equals(root.getCanonicalFile()) ||
            !directory.getAbsoluteFile().equals(directory.getCanonicalFile())) {
            throw new IOException("录音目录无效。");
        }
        return directory;
    }

    static File recordingFile(File filesDir, String relativePath) throws IOException {
        if (relativePath == null || !relativePath.matches("recordings/[A-Za-z0-9_-]{1,80}/[A-Za-z0-9_-]{1,80}\\.m4a")) {
            throw new IllegalArgumentException("录音路径无效。");
        }
        String[] parts = relativePath.split("/");
        File file = new File(learnerDirectory(filesDir, parts[1]), parts[2]);
        if (!file.getAbsoluteFile().equals(file.getCanonicalFile())) throw new IOException("录音路径无效。");
        return file;
    }

    static String sha256(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder result = new StringBuilder(64);
            for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    static File courseImageFile(File filesDir, String path) throws IOException {
        if (path == null || !path.matches("course-images/[a-f0-9-]{36}\\.jpg"))
            throw new IllegalArgumentException("课程图片路径无效。");
        File root = new File(filesDir.getCanonicalFile(), "course-images");
        File file = new File(filesDir.getCanonicalFile(), path);
        if (!root.getAbsoluteFile().equals(root.getCanonicalFile()) || !file.getAbsoluteFile().equals(file.getCanonicalFile()) || !file.getParentFile().equals(root))
            throw new IOException("课程图片路径无效。");
        return file;
    }
}
