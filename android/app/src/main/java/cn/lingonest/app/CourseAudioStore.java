package cn.lingonest.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Properties;
import java.util.TreeSet;
import java.util.UUID;

/** Course-owned permanent files. Two checksummed index slots survive interrupted writes. No LRU. */
final class CourseAudioStore {
    static final int MAX_FILE_BYTES = 16 * 1024 * 1024;
    static final class Status {
        int ready, total, pendingReady; long bytes;
        String voice = "", model = "", generation = "", pendingVoice = "";
        boolean complete, matchesSettings, hasPending;
    }
    private final File root;
    CourseAudioStore(File filesDir) throws IOException {
        root = directory(new File(filesDir.getCanonicalFile(), "course-audio"));
    }
    private static File directory(File file) throws IOException {
        if (!file.getCanonicalFile().equals(file.getAbsoluteFile()) || (!file.isDirectory() && !file.mkdirs())) throw new IOException("课程音频目录不可用。");
        return file;
    }
    private File course(CourseAudioSpec spec) throws IOException { return directory(new File(root, spec.digest)); }
    private File set(CourseAudioSpec spec, String generation) throws IOException {
        if (generation == null || !generation.matches("[a-f0-9]{64}")) throw new IOException("课程音频版本无效。");
        return directory(new File(directory(new File(course(spec), "sets")), generation));
    }
    synchronized boolean hasSelection(CourseAudioSpec spec) throws IOException { return read(course(spec), "selection") != null; }
    synchronized String begin(CourseAudioSpec spec, SpeechConfig config) throws IOException {
        String generation = CourseAudioSpec.generation(config);
        Properties index = read(set(spec, generation), "index");
        if (index == null) {
            index = new Properties(); index.setProperty("spec", spec.digest); index.setProperty("generation", generation);
            index.setProperty("courseId", spec.courseId); index.setProperty("courseVersion", spec.courseVersion);
            index.setProperty("protocol", config.protocol); index.setProperty("baseUrl", config.baseUrl);
            index.setProperty("model", config.model); index.setProperty("voice", config.voice); index.setProperty("instructions", config.instructions);
            for (CourseAudioSpec.Asset asset : spec.assets) index.setProperty("text." + asset.id, asset.textHash);
            write(set(spec, generation), "index", index);
        }
        validateIndex(spec, generation, index);
        Properties selection = read(course(spec), "selection"); if (selection == null) selection = new Properties();
        selection.setProperty("draft", generation); write(course(spec), "selection", selection);
        return generation;
    }
    private static void validateIndex(CourseAudioSpec spec, String generation, Properties index) throws IOException {
        if (index == null || !spec.digest.equals(index.getProperty("spec")) || !generation.equals(index.getProperty("generation"))) throw new IOException("课程音频清单与课程不一致。");
        for (CourseAudioSpec.Asset asset : spec.assets) if (!asset.textHash.equals(index.getProperty("text." + asset.id))) throw new IOException("课程音频原文发生变化。");
    }
    synchronized File existing(CourseAudioSpec spec, String generation, CourseAudioSpec.Asset asset) throws IOException {
        Properties index = read(set(spec, generation), "index"); validateIndex(spec, generation, index);
        return validFile(set(spec, generation), index, asset);
    }
    private static File validFile(File folder, Properties index, CourseAudioSpec.Asset asset) throws IOException {
        String record = index.getProperty("ready." + asset.id);
        if (record == null || !record.matches("[a-f0-9]{64}:[0-9]{1,9}")) return null;
        File file = new File(folder, asset.textHash + ".audio");
        if (!file.getCanonicalFile().equals(file.getAbsoluteFile())) throw new IOException("课程音频路径无效。");
        String[] parts = record.split(":"); long size = Long.parseLong(parts[1]);
        if (size <= 0 || size > MAX_FILE_BYTES || !file.isFile() || file.length() != size || !fileHash(file).equals(parts[0])) return null;
        return file;
    }
    synchronized File stage(CourseAudioSpec spec, String generation) throws IOException { return new File(set(spec, generation), UUID.randomUUID() + ".part"); }
    synchronized void commit(CourseAudioSpec spec, String generation, CourseAudioSpec.Asset asset, File prepared) throws IOException {
        File folder = set(spec, generation);
        if (!prepared.getCanonicalFile().equals(prepared.getAbsoluteFile()) || !prepared.getParentFile().equals(folder) || !prepared.getName().matches("[a-f0-9-]{36}\\.part") || !prepared.isFile() || prepared.length() <= 0 || prepared.length() > MAX_FILE_BYTES) throw new IOException("课程音频暂存文件无效。");
        Properties index = read(folder, "index"); validateIndex(spec, generation, index);
        String checksum = fileHash(prepared); long size = prepared.length();
        File target = new File(folder, asset.textHash + ".audio");
        if (!target.getCanonicalFile().equals(target.getAbsoluteFile())) throw new IOException("课程音频路径无效。");
        // Valid published assets are immutable; repair only absent/corrupt files.
        if (validFile(folder, index, asset) == null) {
            if (target.exists() && !target.delete()) throw new IOException("损坏课程音频无法替换。");
            if (!prepared.renameTo(target)) throw new IOException("课程音频保存失败。");
            index.setProperty("ready." + asset.id, checksum + ":" + size); write(folder, "index", index);
        }
        if (prepared.exists() && !prepared.delete()) throw new IOException("课程音频暂存清理失败。");
    }
    synchronized void finish(CourseAudioSpec spec, String generation) throws IOException {
        for (CourseAudioSpec.Asset asset : spec.assets) if (existing(spec, generation, asset) == null) throw new IOException("整课音频尚未完整，已完成部分已保留。");
        Properties selection = read(course(spec), "selection"); if (selection == null) selection = new Properties();
        selection.setProperty("active", generation); selection.remove("draft"); write(course(spec), "selection", selection);
    }
    synchronized File playable(CourseAudioSpec spec, String assetId) throws IOException {
        Properties selection = read(course(spec), "selection"); if (selection == null) return null;
        String generation = selection.getProperty("active", selection.getProperty("draft", ""));
        return generation.isEmpty() ? null : existing(spec, generation, spec.asset(assetId));
    }
    synchronized Status status(CourseAudioSpec spec, SpeechConfig settings) throws IOException {
        Status result = new Status(); result.total = spec.assets.size();
        Properties selection = read(course(spec), "selection"); if (selection == null) return result;
        String generation = selection.getProperty("active", selection.getProperty("draft", ""));
        if (!generation.isEmpty()) {
            Properties index = read(set(spec, generation), "index"); validateIndex(spec, generation, index);
            result.generation = generation; result.voice = index.getProperty("voice", ""); result.model = index.getProperty("model", "");
            for (CourseAudioSpec.Asset asset : spec.assets) { File file = validFile(set(spec, generation), index, asset); if (file != null) { result.ready++; result.bytes += file.length(); } }
            result.complete = result.ready == result.total;
            result.matchesSettings = settings != null && generation.equals(CourseAudioSpec.generation(settings));
        }
        String draft = selection.getProperty("draft", "");
        if (!draft.isEmpty() && !draft.equals(generation)) {
            result.hasPending = true; Properties index = read(set(spec, draft), "index"); validateIndex(spec, draft, index);
            result.pendingVoice = index.getProperty("voice", "");
            for (CourseAudioSpec.Asset asset : spec.assets) if (validFile(set(spec, draft), index, asset) != null) result.pendingReady++;
        }
        return result;
    }
    static void copy(InputStream source, File target) throws IOException {
        try (InputStream in = source; FileOutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192]; int size, total = 0;
            while ((size = in.read(buffer)) != -1) { total += size; if (total > MAX_FILE_BYTES) throw new IOException("课程单段音频超过容量限制。"); out.write(buffer, 0, size); }
            out.getFD().sync();
        }
    }
    synchronized void clear(CourseAudioSpec spec) throws IOException {
        File target = new File(root, spec.digest).getCanonicalFile();
        if (!target.getParentFile().equals(root.getCanonicalFile()) || !target.getName().matches("[a-f0-9]{64}")) throw new IOException("课程音频删除路径无效。");
        deleteOwned(target, root.getCanonicalFile());
    }
    private static void deleteOwned(File file, File owner) throws IOException {
        if (!file.getCanonicalFile().equals(file.getAbsoluteFile()) || !file.getCanonicalPath().startsWith(owner.getCanonicalPath() + File.separator)) throw new IOException("课程音频删除路径无效。");
        if (!file.exists()) return;
        if (file.isDirectory()) { File[] children = file.listFiles(); if (children == null) throw new IOException("课程音频目录不可读取。"); for (File child : children) deleteOwned(child, owner); }
        if (!file.delete()) throw new IOException("课程音频删除未完成。");
    }
    static String fileHash(File file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new FileInputStream(file)) { byte[] buffer = new byte[8192]; int n; while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n); }
            StringBuilder out = new StringBuilder(); for (byte b : digest.digest()) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return out.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IOException(impossible); }
    }
    private static String checksum(Properties properties) {
        StringBuilder canonical = new StringBuilder();
        for (String key : new TreeSet<>(properties.stringPropertyNames())) if (!"checksum".equals(key)) { String value = properties.getProperty(key); canonical.append(key.length()).append(':').append(key).append(value.length()).append(':').append(value); }
        return CourseAudioSpec.hash(canonical.toString());
    }
    private static Properties read(File directory, String name) throws IOException {
        Properties selected = null; long revision = -1; boolean existed = false;
        for (int slot = 0; slot < 2; slot++) {
            File file = new File(directory, name + "." + slot + ".properties");
            if (!file.exists()) continue; existed = true;
            if (!file.getCanonicalFile().equals(file.getAbsoluteFile())) throw new IOException("课程音频清单路径无效。");
            try {
                if (!file.isFile() || file.length() > 1024 * 1024) continue;
                Properties p = new Properties(); try (InputStreamReader in = new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)) { p.load(in); }
                long r = Long.parseLong(p.getProperty("revision", "-1"));
                if (r >= 0 && r < NativeGuards.MAX_REVISION && "1".equals(p.getProperty("format")) && checksum(p).equals(p.getProperty("checksum")) && r > revision) { selected = p; revision = r; }
            } catch (IllegalArgumentException invalid) { /* An interrupted newer slot must not hide the previous durable index. */ }
        }
        if (selected == null && existed) throw new IOException("课程音频清单损坏，文件已保留。");
        return selected;
    }
    private static void write(File folder, String name, Properties value) throws IOException {
        Properties previous = read(folder, name);
        long revision = previous == null ? 1 : Long.parseLong(previous.getProperty("revision")) + 1;
        if (revision >= NativeGuards.MAX_REVISION) throw new IOException("课程音频清单版本超限。");
        value.setProperty("format", "1"); value.setProperty("revision", Long.toString(revision)); value.setProperty("checksum", checksum(value));
        File target = new File(folder, name + "." + (revision % 2) + ".properties");
        if (!target.getCanonicalFile().equals(target.getAbsoluteFile())) throw new IOException("课程音频清单路径无效。");
        try (FileOutputStream out = new FileOutputStream(target)) { OutputStreamWriter writer = new OutputStreamWriter(out, StandardCharsets.UTF_8); value.store(writer, null); writer.flush(); out.getFD().sync(); }
    }
}
