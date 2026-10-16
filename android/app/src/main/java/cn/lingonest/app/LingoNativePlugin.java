package cn.lingonest.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadataRetriever;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.core.content.ContextCompat;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;
import org.json.JSONArray;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.HashSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Narrow bridge: local learning/recordings and explicitly configured provider speech. */
@CapacitorPlugin(name = "LingoNative", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class LingoNativePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private NativeStateStore stateStore;
    private SpeechConfigStore speechConfigStore;
    private AiSpeechService aiSpeech;
    private AiSpeechService courseDownloader;
    private CourseAudioStore courseAudioStore;
    private final ExecutorService courseWorker = Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicInteger courseGeneration = new java.util.concurrent.atomic.AtomicInteger();
    private PluginCall pendingCourseCall;
    private final ExecutorService speechWorker = Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicInteger speechGeneration = new java.util.concurrent.atomic.AtomicInteger();
    private PluginCall pendingAiCall;
    private double deviceSpeechSpeed = 0.85;
    private boolean foreground = true;
    private boolean destroyed;
    private AudioManager audioManager;
    private AudioFocusRequest focus;
    private TextToSpeech tts;
    private boolean ttsReady;
    private PluginCall speechCall;
    private String speechText;
    private String utteranceId;
    private MediaPlayer player;
    private PluginCall playerCall;
    private MediaRecorder recorder;
    private File recordingTemp;
    private File recordingReady;
    private String recordingOwner;
    private String recordingError;
    private String recordingErrorCode;
    private long recordingDuration;
    private int recordingPeak;
    private int audibleFrames;
    private boolean permissionPending;
    private boolean permissionCancelled;
    private String permissionOwner;
    private int permissionOwnerGeneration;
    private final Set<String> deletingOwners = new HashSet<>();
    private final Map<String, Integer> ownerGenerations = new HashMap<>();
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> main.post(() -> {
        if (change < 0) {
            cancelAiSpeech();
            stopSpeechInternal("AUDIO_INTERRUPTED", "音频被其他应用中断。");
            stopPlayer(); finishRecording("audio_interrupted");
        }
    });
    private final Runnable recordingDeadline = () -> finishRecording("duration_limit");
    private final Runnable recordingMeter = new Runnable() {
        @Override public void run() {
            if (recorder == null) return;
            try {
                int amplitude = recorder.getMaxAmplitude();
                recordingPeak = Math.max(recordingPeak, amplitude);
                if (amplitude >= RecordingQuality.ENERGY_THRESHOLD) audibleFrames++;
                main.postDelayed(this, 100);
            } catch (RuntimeException interrupted) { finishRecording("audio_interrupted"); }
        }
    };
    private final Runnable speechDeadline = () -> {
        stopSpeechInternal("SPEECH_TIMEOUT", "离线语音未及时完成，请重试。");
    };
    private final BroadcastReceiver audioDisconnected = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            cancelAiSpeech();
            stopSpeechInternal("AUDIO_INTERRUPTED", "音频设备已断开。");
            stopPlayer();
            finishRecording("audio_interrupted");
        }
    };

    @Override public void load() {
        main.post(() -> getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (hasListeners("backButton")) notifyListeners("backButton", new JSObject());
                else {
                    setEnabled(false);
                    getActivity().getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        }));
        stateStore = new NativeStateStore(getContext().getApplicationContext());
        speechConfigStore = new SpeechConfigStore(getContext().getApplicationContext());
        try { aiSpeech = new AiSpeechService(getContext().getFilesDir()); } catch (IOException ignored) { /* Report through bridge, preserving learning state. */ }
        try { courseAudioStore = new CourseAudioStore(getContext().getFilesDir()); courseDownloader = new AiSpeechService(getContext().getFilesDir()); } catch (IOException ignored) { /* Existing learning remains available. */ }
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        ContextCompat.registerReceiver(getContext(), audioDisconnected,
            new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @PluginMethod public void loadState(PluginCall call) {
        storage.execute(() -> {
            try {
                NativeStateStore.State state = stateStore.load();
                JSObject result = new JSObject();
                result.put("revision", state.revision);
                result.put("payload", state.payload == null ? JSONObject.NULL : state.payload);
                call.resolve(result);
            } catch (Exception error) { rejectStorage(call, error); }
        });
    }

    @PluginMethod public void saveState(PluginCall call) {
        Object revisionValue = call.getData().opt("expectedRevision");
        String payload = call.getString("payload");
        if (!(revisionValue instanceof Number)) {
            call.reject("数据版本必须是整数。", "INVALID_ARGUMENT"); return;
        }
        double numericRevision = ((Number) revisionValue).doubleValue();
        if (!Double.isFinite(numericRevision) || numericRevision < 0 ||
            numericRevision >= NativeGuards.MAX_REVISION || numericRevision != Math.floor(numericRevision)) {
            call.reject("数据版本无效。", "INVALID_ARGUMENT"); return;
        }
        storage.execute(() -> {
            try {
                long revision = stateStore.save((long) numericRevision, payload);
                call.resolve(new JSObject().put("revision", revision));
            } catch (Exception error) { rejectStorage(call, error); }
        });
    }

    private void rejectStorage(PluginCall call, Exception error) {
        if (error instanceof NativeStateStore.StoreException) {
            NativeStateStore.StoreException failure = (NativeStateStore.StoreException) error;
            call.reject(failure.getMessage(), failure.code);
        } else if (error instanceof SQLiteDatabaseCorruptException) {
            call.reject("本地数据库损坏，已保留文件，请勿清除应用数据。", "STATE_CORRUPT");
        } else {
            // Do not log snapshot contents or include raw SQL/filesystem details in the bridge error.
            call.reject("本地数据读写失败，请检查设备剩余空间后重试。", "STORAGE_ERROR");
        }
    }

    @PluginMethod public void loadDocument(PluginCall call) {
        final String key = call.getString("key");
        try { NativeDocumentStore.databaseName(key); }
        catch (IllegalArgumentException invalid) { call.reject("文档标识无效。", "INVALID_ARGUMENT"); return; }
        storage.execute(() -> {
            try (NativeStateStore document = NativeDocumentStore.open(getContext().getApplicationContext(), key)) {
                NativeStateStore.State state = document.load();
                JSObject result = new JSObject();
                result.put("revision", state.revision);
                result.put("payload", state.payload == null ? JSONObject.NULL : state.payload);
                call.resolve(result);
            } catch (Exception failure) { rejectStorage(call, failure); }
        });
    }

    @PluginMethod public void saveDocument(PluginCall call) {
        final String key = call.getString("key");
        final String payload = call.getString("payload");
        try { NativeDocumentStore.databaseName(key); }
        catch (IllegalArgumentException invalid) { call.reject("文档标识无效。", "INVALID_ARGUMENT"); return; }
        Object input = call.getData().opt("expectedRevision");
        if (!(input instanceof Number)) { call.reject("数据版本必须是整数。", "INVALID_ARGUMENT"); return; }
        final double expected = ((Number) input).doubleValue();
        if (!Double.isFinite(expected) || expected < 0 || expected >= NativeGuards.MAX_REVISION || expected != Math.floor(expected)) {
            call.reject("数据版本无效。", "INVALID_ARGUMENT"); return;
        }
        storage.execute(() -> {
            try (NativeStateStore document = NativeDocumentStore.open(getContext().getApplicationContext(), key)) {
                long revision = document.save((long) expected, payload);
                call.resolve(new JSObject().put("revision", revision));
            } catch (Exception failure) { rejectStorage(call, failure); }
        });
    }

    @PluginMethod public void getSpeechConfig(PluginCall call) {
        storage.execute(() -> { try { call.resolve(SpeechConfigStore.publicConfig(speechConfigStore.load())); }
            catch (Exception invalid) { call.reject("语音配置无法读取，请在设置中清除后重新配置。", "SPEECH_CONFIG_UNREADABLE"); } });
    }
    @PluginMethod public void setSpeechConfig(PluginCall call) {
        main.post(() -> {
            if (pendingCourseCall != null) { call.reject("请先暂停课程音频生成，再修改配置。", "COURSE_AUDIO_BUSY"); return; }
            cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "语音设置已更新。"); stopPlayer();
            storage.execute(() -> { try { call.resolve(SpeechConfigStore.publicConfig(speechConfigStore.save(call.getData()))); }
                catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage(), "INVALID_ARGUMENT"); }
                catch (Exception failure) { call.reject("语音配置保存失败，请重试。", "SPEECH_CONFIG_ERROR"); } });
        });
    }
    @PluginMethod public void clearSpeechConfig(PluginCall call) {
        main.post(() -> {
            if (pendingCourseCall != null) { call.reject("请先暂停课程音频生成，再移除配置。", "COURSE_AUDIO_BUSY"); return; }
            cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "语音配置已清除。"); stopPlayer();
            storage.execute(() -> { try { speechConfigStore.clear(); call.resolve(SpeechConfigStore.publicConfig(SpeechConfig.defaults())); }
                catch (Exception failure) { call.reject("语音配置清除失败，请重试。", "SPEECH_CONFIG_ERROR"); } });
        });
    }
    @PluginMethod public void getSpeechCacheInfo(PluginCall call) {
        speechWorker.execute(() -> { try {
            if (aiSpeech == null) throw new IOException();
            long[] info = aiSpeech.info(); call.resolve(new JSObject().put("count", info[0]).put("bytes", info[1]));
        } catch (Exception failure) { call.reject("无法读取语音缓存。", "SPEECH_CACHE_ERROR"); } });
    }
    @PluginMethod public void clearSpeechCache(PluginCall call) {
        main.post(() -> {
            if (pendingCourseCall != null) { call.reject("请先暂停课程音频生成。", "COURSE_AUDIO_BUSY"); return; }
            cancelAiSpeech(); stopPlayer();
            speechWorker.execute(() -> { try { if (aiSpeech == null) throw new IOException(); aiSpeech.clear(); call.resolve(); }
                catch (Exception failure) { call.reject("语音缓存清理失败，请重试。", "SPEECH_CACHE_ERROR"); } });
        });
    }
    private CourseAudioSpec courseSpec(PluginCall call) {
        try {
            JSONObject input = call.getData().getJSONObject("course");
            JSONArray entries = input.getJSONArray("assets");
            if (entries.length() > 512) throw new IllegalArgumentException("课程音频清单过大。");
            List<CourseAudioSpec.Asset> assets = new ArrayList<>();
            for (int i = 0; i < entries.length(); i++) { JSONObject item = entries.getJSONObject(i); assets.add(new CourseAudioSpec.Asset(item.getString("id"), item.getString("text"))); }
            return new CourseAudioSpec(input.getString("courseId"), input.getString("courseVersion"), input.getString("title"), assets);
        } catch (IllegalArgumentException invalid) { throw invalid; }
        catch (Exception invalid) { throw new IllegalArgumentException("课程音频清单无效。"); }
    }
    private JSObject courseStatus(CourseAudioSpec spec) throws Exception {
        SpeechConfig config = null; try { config = speechConfigStore.load(); } catch (Exception ignored) { /* Reading course resources does not require decrypting a provider key. */ }
        CourseAudioStore.Status status = courseAudioStore.status(spec, config);
        JSObject result = new JSObject().put("total", status.total).put("ready", status.ready).put("bytes", status.bytes).put("complete", status.complete).put("voice", status.voice).put("model", status.model).put("matchesSettings", status.matchesSettings);
        result.put("pending", status.hasPending ? new JSObject().put("ready", status.pendingReady).put("total", status.total).put("voice", status.pendingVoice) : JSONObject.NULL);
        return result;
    }
    @PluginMethod public void getCourseAudio(PluginCall call) {
        final CourseAudioSpec spec; try { spec = courseSpec(call); } catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage(), "INVALID_ARGUMENT"); return; }
        storage.execute(() -> { try { call.resolve(courseStatus(spec)); }
            catch (Exception failure) { call.reject("课程音频无法读取，已保留文件，请勿清除应用数据。", "COURSE_AUDIO_ERROR"); } });
    }
    @PluginMethod public void playCourseAudio(PluginCall call) {
        final CourseAudioSpec spec; final CourseAudioSpec.Asset asset;
        try { spec = courseSpec(call); asset = spec.asset(call.getString("assetId")); call.getData().put("text", asset.text); }
        catch (Exception invalid) { call.reject("课程音频标识无效。", "INVALID_ARGUMENT"); return; }
        main.post(() -> {
            if (!foreground || destroyed) { call.reject("请回到应用后播放。", "APP_NOT_ACTIVE"); return; }
            if (recorder != null || permissionPending) { call.reject("请先结束录音。", "AUDIO_BUSY"); return; }
            cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "开始播放课程音频。"); stopPlayer();
            int generation = speechGeneration.get(); pendingAiCall = call;
            storage.execute(() -> {
                try {
                    File file = courseAudioStore.playable(spec, asset.id); boolean hasPack = courseAudioStore.hasSelection(spec);
                    SpeechConfig config; try { config = speechConfigStore.load(); } catch (Exception ignored) { config = SpeechConfig.defaults(); }
                    SpeechConfig playback = config;
                    main.post(() -> {
                        if (generation != speechGeneration.get() || pendingAiCall != call) return;
                        if (file != null) { pendingAiCall = null; playSpeechFile(file, call, false, playback.speed, "course"); }
                        else if (!hasPack && "device".equals(playback.mode)) speakDevice(call, generation, playback.speed);
                        else { pendingAiCall = null; call.reject("本段课程音频未就绪，请在家长空间的课程管理中生成或继续生成整课音频。学习时不会自动调用 API。", "COURSE_AUDIO_MISSING"); }
                    });
                } catch (Exception failure) { main.post(() -> { if (generation != speechGeneration.get() || pendingAiCall != call) return; pendingAiCall = null; call.reject("课程音频损坏或不可读取，请在课程管理中修复。", "COURSE_AUDIO_ERROR"); }); }
            });
        });
    }
    private void courseProgress(boolean generating, int completed, int total) {
        notifyListeners("courseAudioProgress", new JSObject().put("generating", generating).put("completed", completed).put("total", total));
    }
    private void cancelCourseGeneration() {
        courseGeneration.incrementAndGet(); if (courseDownloader != null) courseDownloader.cancel();
        if (pendingCourseCall != null) { pendingCourseCall.reject("课程音频生成已暂停，已完成部分保留。", "COURSE_AUDIO_CANCELLED"); pendingCourseCall = null; }
        courseProgress(false, 0, 0);
    }
    @PluginMethod public void cancelCourseAudioGeneration(PluginCall call) { main.post(() -> { cancelCourseGeneration(); call.resolve(); }); }
    @PluginMethod public void generateCourseAudio(PluginCall call) {
        final CourseAudioSpec spec; try { spec = courseSpec(call); } catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage(), "INVALID_ARGUMENT"); return; }
        main.post(() -> {
            if (!foreground || destroyed || recorder != null || permissionPending) { call.reject("请回到课程管理并结束录音后生成。", "AUDIO_BUSY"); return; }
            if (pendingCourseCall != null) { call.reject("课程音频正在生成。", "COURSE_AUDIO_BUSY"); return; }
            if (courseAudioStore == null || courseDownloader == null) { call.reject("课程音频存储不可用。", "COURSE_AUDIO_ERROR"); return; }
            cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "开始生成课程音频。"); stopPlayer();
            final int epoch = courseGeneration.incrementAndGet(); pendingCourseCall = call; courseProgress(true, 0, spec.assets.size());
            storage.execute(() -> {
                try {
                    SpeechConfig config = speechConfigStore.load();
                    if (!"ai".equals(config.mode)) throw new IllegalArgumentException("请先保存 AI 语音服务配置。");
                    courseWorker.execute(() -> {
                        int completed = 0;
                        try {
                            if (epoch != courseGeneration.get()) return;
                            String generation = courseAudioStore.begin(spec, config);
                            for (CourseAudioSpec.Asset asset : spec.assets) {
                                if (epoch != courseGeneration.get()) return;
                                if (courseAudioStore.existing(spec, generation, asset) == null) {
                                    File stage = courseAudioStore.stage(spec, generation);
                                    try {
                                        courseDownloader.downloadTo(config, asset.text, stage, () -> epoch != courseGeneration.get());
                                        if (epoch != courseGeneration.get()) return;
                                        courseAudioStore.commit(spec, generation, asset, stage);
                                    } finally { if (stage.exists()) stage.delete(); }
                                }
                                completed++; final int progress = completed;
                                main.post(() -> { if (epoch == courseGeneration.get() && pendingCourseCall == call) courseProgress(true, progress, spec.assets.size()); });
                            }
                            if (epoch != courseGeneration.get()) return;
                            courseAudioStore.finish(spec, generation);
                            JSObject result = courseStatus(spec);
                            main.post(() -> { if (epoch != courseGeneration.get() || pendingCourseCall != call) return; pendingCourseCall = null; courseProgress(false, spec.assets.size(), spec.assets.size()); call.resolve(result); });
                        } catch (Exception failure) { main.post(() -> rejectCourseGeneration(call, epoch, failure)); }
                    });
                } catch (Exception failure) { main.post(() -> rejectCourseGeneration(call, epoch, failure)); }
            });
        });
    }
    private void rejectCourseGeneration(PluginCall call, int epoch, Exception failure) {
        if (epoch != courseGeneration.get() || pendingCourseCall != call) return;
        pendingCourseCall = null; courseProgress(false, 0, 0);
        if (failure instanceof AiSpeechService.Failure) { AiSpeechService.Failure f = (AiSpeechService.Failure)failure; call.reject(f.getMessage(), f.code); }
        else if (failure instanceof IllegalArgumentException) call.reject(failure.getMessage(), "INVALID_ARGUMENT");
        else call.reject("课程音频生成未完成，已生成部分保留。请检查网络和存储空间后继续。", "COURSE_AUDIO_GENERATION_FAILED");
    }
    @PluginMethod public void clearCourseAudio(PluginCall call) {
        final CourseAudioSpec spec; try { spec = courseSpec(call); } catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage(), "INVALID_ARGUMENT"); return; }
        main.post(() -> {
            cancelCourseGeneration(); cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "本课音频已删除。"); stopPlayer();
            courseWorker.execute(() -> { try { courseAudioStore.clear(spec); call.resolve(courseStatus(spec)); }
                catch (Exception failure) { call.reject("课程音频删除未完成，请重试。", "COURSE_AUDIO_ERROR"); } });
        });
    }
    private void cancelAiSpeech() {
        speechGeneration.incrementAndGet();
        if (aiSpeech != null) aiSpeech.cancel();
        if (pendingAiCall != null) { pendingAiCall.reject("语音已停止。", "AUDIO_INTERRUPTED"); pendingAiCall = null; }
        notifyListeners("speechStatus", new JSObject().put("phase", "idle"));
    }
    @PluginMethod public void exitApp(PluginCall call) {
        main.post(() -> { getActivity().moveTaskToBack(true); call.resolve(); });
    }
    @PluginMethod public void deleteCourseResources(PluginCall call) {
        final CourseAudioSpec spec;
        final List<File> files = new ArrayList<>();
        try {
            spec = call.getData().has("course") ? courseSpec(call) : null;
            if (spec != null && !spec.courseId.matches("user\\.[a-f0-9]{32}")) throw new IllegalArgumentException("只能清理自建课程。");
            JSONArray images = call.getData().getJSONArray("images"), recordings = call.getData().getJSONArray("recordings");
            if (images.length() > 12 || recordings.length() > 100000) throw new IllegalArgumentException("课程资源清单过大。");
            for (int i = 0; i < images.length(); i++) files.add(NativeGuards.courseImageFile(getContext().getFilesDir(), images.getString(i)));
            for (int i = 0; i < recordings.length(); i++) files.add(NativeGuards.recordingFile(getContext().getFilesDir(), recordings.getString(i)));
        } catch (Exception invalid) { call.reject("课程资源删除清单无效。", "INVALID_ARGUMENT"); return; }
        main.post(() -> {
            cancelCourseGeneration(); cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "课程已删除。"); stopPlayer();
            courseWorker.execute(() -> {
                try {
                    if (spec != null) {
                        if (courseAudioStore == null) throw new IOException();
                        courseAudioStore.clear(spec);
                    }
                    for (File file : files) if (file.exists() && (!file.isFile() || !file.delete())) throw new IOException();
                    call.resolve();
                } catch (Exception failure) { call.reject("课程资源清理未完成，请重试。", "COURSE_CLEANUP_FAILED"); }
            });
        });
    }
    @PluginMethod public void speak(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty() || text.length() > 3000) { call.reject("朗读文字不能为空且不能超过 3000 字符。", "INVALID_ARGUMENT"); return; }
        main.post(() -> {
            if (pendingCourseCall != null) { call.reject("请先暂停课程音频生成，再试听新音色。", "COURSE_AUDIO_BUSY"); return; }
            if (!foreground || destroyed) { call.reject("请回到应用后播放。", "APP_NOT_ACTIVE"); return; }
            if (recorder != null || permissionPending) { call.reject("请先结束录音。", "AUDIO_BUSY"); return; }
            cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "已开始新的朗读。"); stopPlayer();
            final int generation = speechGeneration.get(); pendingAiCall = call;
            storage.execute(() -> {
                try {
                    SpeechConfig config = speechConfigStore.load();
                    main.post(() -> {
                        if (generation != speechGeneration.get() || pendingAiCall != call) return;
                        if ("device".equals(config.mode)) { speakDevice(call, generation, config.speed); return; }
                        if (aiSpeech == null) { pendingAiCall = null; call.reject("语音缓存不可用，请检查设备空间。", "SPEECH_CACHE_ERROR"); return; }
                        notifyListeners("speechStatus", new JSObject().put("phase", "generating").put("source", "ai"));
                        speechWorker.execute(() -> {
                            try {
                                AiSpeechService.Result result = aiSpeech.prepare(config, text, () -> generation != speechGeneration.get());
                                main.post(() -> {
                                    if (generation != speechGeneration.get() || pendingAiCall != call) return;
                                    pendingAiCall = null;
                                    if (!foreground || destroyed) { call.reject("请回到应用后播放。", "APP_NOT_ACTIVE"); return; }
                                    playSpeechFile(result.file, call, result.cached, config.speed);
                                });
                            } catch (Exception failure) { main.post(() -> {
                                if (generation != speechGeneration.get() || pendingAiCall != call) return;
                                pendingAiCall = null;
                                notifyListeners("speechStatus", new JSObject().put("phase", "idle"));
                                if (failure instanceof AiSpeechService.Failure) { AiSpeechService.Failure f = (AiSpeechService.Failure)failure; call.reject(f.getMessage(), f.code); }
                                else if (failure instanceof java.net.SocketTimeoutException) call.reject("语音生成超时，请稍后重试。", "SPEECH_TIMEOUT");
                                else call.reject("AI 语音生成失败，请检查网络与接口设置。", "SPEECH_NETWORK_ERROR");
                            }); }
                        });
                    });
                } catch (Exception failure) { main.post(() -> {
                    if (generation != speechGeneration.get() || pendingAiCall != call) return;
                    pendingAiCall = null; call.reject("语音配置无法读取，请在设置中重新配置。", "SPEECH_CONFIG_UNREADABLE");
                }); }
            });
        });
    }
    private void playSpeechFile(File file, PluginCall call, boolean cached, double speed) {
        playSpeechFile(file, call, cached, speed, "ai");
    }
    private void playSpeechFile(File file, PluginCall call, boolean cached, double speed, String source) {
        try {
            if (!requestFocus(false)) { call.reject("音频正被其他应用使用。", "AUDIO_FOCUS_DENIED"); return; }
            MediaPlayer next = new MediaPlayer(); player = next; playerCall = call;
            next.setAudioAttributes(audioAttributes(false)); next.setDataSource(file.getAbsolutePath());
            next.setOnPreparedListener(ready -> {
                if (player != ready) return;
                if (!foreground || destroyed) { stopPlayer(); return; }
                try { ready.setPlaybackParams(new android.media.PlaybackParams().setSpeed((float)speed).setPitch(1.0f)); ready.start(); notifyListeners("speechStatus", new JSObject().put("phase", "playing").put("source", source).put("cached", cached)); }
                catch (RuntimeException invalid) { PluginCall pending = playerCall; playerCall = null; stopPlayer(); if (pending != null) pending.reject("生成的语音无法播放。", "PLAYBACK_FAILED"); }
            });
            next.setOnCompletionListener(ended -> {
                if (player != ended) return;
                PluginCall completed = playerCall; playerCall = null; stopPlayer();
                notifyListeners("speechStatus", new JSObject().put("phase", "idle"));
                if (completed != null) completed.resolve(new JSObject().put("cached", cached).put("source", source));
            });
            next.setOnErrorListener((failed, what, extra) -> {
                if (player == failed) { PluginCall pending = playerCall; playerCall = null; stopPlayer(); if (pending != null) pending.reject("生成的语音无法播放。", "PLAYBACK_FAILED"); }
                return true;
            });
            next.prepareAsync();
        } catch (Exception failure) { if (playerCall == call) playerCall = null; stopPlayer(); call.reject("生成的语音无法播放。", "PLAYBACK_FAILED"); }
    }
    private void speakDevice(PluginCall call, int generation, double speed) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty() || text.length() > 3000) {
            call.reject("朗读文字不能为空且不能超过 3000 字符。", "INVALID_ARGUMENT"); return;
        }
        main.post(() -> {
            if (generation != speechGeneration.get() || pendingAiCall != call) return;
            pendingAiCall = null; deviceSpeechSpeed = speed;
            if (!foreground || destroyed) { call.reject("请回到应用后播放。", "APP_NOT_ACTIVE"); return; }
            if (recorder != null || permissionPending) { call.reject("请先结束录音。", "AUDIO_BUSY"); return; }
            stopPlayer();
            stopSpeechInternal("AUDIO_INTERRUPTED", "已开始新的朗读。");
            speechCall = call;
            notifyListeners("speechStatus", new JSObject().put("phase", "playing").put("source", "device"));
            speechText = text;
            if (ttsReady) { speakReady(); return; }
            main.postDelayed(speechDeadline, 10000);
            if (tts == null) {
                tts = new TextToSpeech(getContext().getApplicationContext(), status -> main.post(() -> {
                    if (destroyed) return;
                    ttsReady = status == TextToSpeech.SUCCESS;
                    if (!ttsReady) {
                        stopSpeechInternal("OFFLINE_VOICE_UNAVAILABLE", "系统离线语音引擎不可用，请安装英语离线语音后重试。");
                        if (tts != null) { tts.shutdown(); tts = null; }
                        return;
                    }
                    if (speechCall != null) speakReady();
                }));
            }
        });
    }

    private void speakReady() {
        if (speechCall == null || tts == null) return;
        main.removeCallbacks(speechDeadline);
        Set<Voice> available = tts.getVoices();
        List<Voice> offline = new ArrayList<>();
        if (available != null) for (Voice voice : available) {
            Set<String> features = voice.getFeatures();
            if ("en".equals(voice.getLocale().getLanguage()) && !voice.isNetworkConnectionRequired() &&
                (features == null || !features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))) offline.add(voice);
        }
        offline.sort(Comparator.comparing((Voice v) -> !"US".equals(v.getLocale().getCountry())).thenComparing(Voice::getName));
        if (offline.isEmpty() || tts.setVoice(offline.get(0)) != TextToSpeech.SUCCESS) {
            stopSpeechInternal("OFFLINE_VOICE_UNAVAILABLE", "缺少已安装的英语离线语音，请在系统语音设置下载后重试。应用不会改用网络语音。"); return;
        }
        if (!requestFocus(false)) { stopSpeechInternal("AUDIO_FOCUS_DENIED", "音频正被其他应用使用。"); return; }
        utteranceId = UUID.randomUUID().toString();
        String id = utteranceId;
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String ignored) {}
            @Override public void onDone(String ended) { main.post(() -> completeSpeech(ended, null)); }
            @Override public void onError(String ended) { main.post(() -> completeSpeech(ended, "离线朗读失败，请检查英语语音数据。")); }
            @Override public void onError(String ended, int errorCode) { onError(ended); }
            @Override public void onStop(String ended, boolean interrupted) { main.post(() -> completeSpeech(ended, "朗读已中断。")); }
        });
        Bundle params = new Bundle();
        params.putString(TextToSpeech.Engine.KEY_FEATURE_EMBEDDED_SYNTHESIS, "true");
        tts.setSpeechRate((float)deviceSpeechSpeed);
        if (tts.speak(speechText, TextToSpeech.QUEUE_FLUSH, params, id) != TextToSpeech.SUCCESS) {
            stopSpeechInternal("SPEECH_FAILED", "离线朗读失败。"); return;
        }
        main.postDelayed(speechDeadline, 180000);
    }

    private void completeSpeech(String id, String error) {
        if (id == null || !id.equals(utteranceId) || speechCall == null) return;
        PluginCall call = speechCall;
        speechCall = null; speechText = null; utteranceId = null;
        main.removeCallbacks(speechDeadline);
        abandonFocus();
        if (error == null) call.resolve(); else call.reject(error, "SPEECH_FAILED");
    }

    private void stopSpeechInternal(String code, String message) {
        PluginCall interrupted = speechCall;
        speechCall = null; speechText = null; utteranceId = null;
        main.removeCallbacks(speechDeadline);
        if (tts != null) tts.stop();
        if (interrupted != null) interrupted.reject(message, code);
        if (recorder == null && player == null) abandonFocus();
    }

    @PluginMethod public void stopSpeech(PluginCall call) {
        main.post(() -> { cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "朗读已停止。"); stopPlayer(); call.resolve(); });
    }

    @PluginMethod public void startRecording(PluginCall call) {
        try { NativeGuards.learnerId(call.getString("learnerId")); }
        catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage(), "INVALID_ARGUMENT"); return; }
        main.post(() -> {
            cancelCourseGeneration();
            cancelAiSpeech(); stopPlayer(); stopSpeechInternal("AUDIO_INTERRUPTED", "开始录音。");
            if (destroyed || !foreground) { call.reject("请回到应用后录音。", "APP_NOT_ACTIVE"); return; }
            if (recorder != null || recordingReady != null || recordingTemp != null || permissionPending) {
                call.reject("请先保存或取消当前录音。", "AUDIO_BUSY"); return;
            }
            if (deletingOwners.contains(call.getString("learnerId"))) {
                call.reject("该档案的录音仍在删除，请稍后重试。", "AUDIO_BUSY"); return;
            }
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                permissionPending = true;
                permissionCancelled = false;
                permissionOwner = call.getString("learnerId");
                permissionOwnerGeneration = ownerGenerations.getOrDefault(permissionOwner, 0);
                requestPermissionForAlias("microphone", call, "microphonePermissionResult");
            } else beginRecording(call);
        });
    }

    @PermissionCallback private void microphonePermissionResult(PluginCall call) {
        main.post(() -> {
            permissionPending = false;
            if (permissionCancelled) { call.reject("录音已取消。", "RECORDING_CANCELLED"); return; }
            if (deletingOwners.contains(permissionOwner) ||
                permissionOwnerGeneration != ownerGenerations.getOrDefault(permissionOwner, 0)) {
                call.reject("该档案已进入删除流程，录音已取消。", "RECORDING_CANCELLED"); return;
            }
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                call.reject("麦克风权限未允许，可继续其他文字练习。", "MICROPHONE_DENIED"); return;
            }
            if (!foreground || destroyed) { call.reject("请回到应用后重新开始录音。", "APP_NOT_ACTIVE"); return; }
            beginRecording(call);
        });
    }

    @SuppressWarnings("deprecation")
    private void beginRecording(PluginCall call) {
        stopSpeechInternal("AUDIO_INTERRUPTED", "开始录音，已停止示范朗读。");
        stopPlayer();
        recordingError = null;
        recordingErrorCode = null;
        recordingDuration = 0;
        recordingPeak = 0;
        audibleFrames = 0;
        try {
            recordingOwner = NativeGuards.learnerId(call.getString("learnerId"));
            File directory = NativeGuards.learnerDirectory(getContext().getFilesDir(), recordingOwner);
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException();
            recordingTemp = new File(directory, UUID.randomUUID() + ".pending");
            if (!requestFocus(true)) throw new IOException("音频正被其他应用使用。");
            MediaRecorder next = new MediaRecorder();
            recorder = next;
            next.setAudioSource(MediaRecorder.AudioSource.MIC);
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            next.setAudioChannels(1);
            next.setAudioSamplingRate(44100);
            next.setAudioEncodingBitRate(64000);
            next.setOutputFile(recordingTemp.getAbsolutePath());
            next.setMaxDuration(RecordingQuality.MAX_DURATION_MS);
            next.setOnInfoListener((source, what, extra) -> {
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) main.post(() -> {
                    if (recorder == source) finishRecording("duration_limit");
                });
            });
            next.setOnErrorListener((source, what, extra) -> main.post(() -> {
                if (recorder == source) finishRecording("audio_interrupted");
            }));
            next.prepare(); next.start();
            next.getMaxAmplitude(); // First call begins amplitude accumulation.
            main.postDelayed(recordingMeter, 100);
            main.postDelayed(recordingDeadline, RecordingQuality.MAX_DURATION_MS);
            call.resolve();
        } catch (Exception failure) {
            releaseRecorder();
            deletePendingQuietly();
            abandonFocus();
            call.reject("无法开始录音，请检查麦克风权限与设备存储空间。", "RECORDING_FAILED");
        }
    }

    /** Interrupted/limit/silent captures never receive a usable path or become pending learning evidence. */
    private void finishRecording(String reason) {
        if (recorder == null) return;
        main.removeCallbacks(recordingDeadline);
        try { recorder.stop(); } catch (RuntimeException ignored) { /* Auto-stop may already have fired; validate the container below. */ }
        releaseRecorder();
        abandonFocus();
        File source = recordingTemp;
        try {
            if (source == null || !source.isFile() || source.length() == 0) throw new IOException();
            MediaMetadataRetriever metadata = new MediaMetadataRetriever();
            try {
                metadata.setDataSource(source.getAbsolutePath());
                String duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                if (duration == null || Long.parseLong(duration) <= 0) throw new IOException();
                recordingDuration = Long.parseLong(duration);
            } finally { metadata.release(); }
            String qualityFailure = RecordingQuality.failureCode(recordingDuration, recordingPeak, audibleFrames, reason);
            if (qualityFailure != null) {
                recordingErrorCode = qualityFailure;
                throw new IOException();
            }
            File sealed = new File(source.getParentFile(), source.getName().replace(".pending", ".m4a"));
            if (!source.renameTo(sealed)) throw new IOException();
            recordingReady = sealed;
            recordingTemp = null;
            JSObject event = new JSObject();
            event.put("reason", reason); event.put("learnerId", recordingOwner);
            notifyListeners("recordingStopped", event);
        } catch (Exception invalid) {
            if (recordingErrorCode == null) {
                recordingErrorCode = "user".equals(reason) ? "RECORDING_INVALID" :
                    ("duration_limit".equals(reason) ? "RECORDING_TRUNCATED" : "RECORDING_INTERRUPTED");
            }
            recordingError = RecordingQuality.message(recordingErrorCode);
            deletePendingQuietly();
            notifyListeners("recordingStopped", new JSObject().put("reason", reason).put("errorCode", recordingErrorCode));
        }
    }

    @PluginMethod public void stopRecording(PluginCall call) {
        main.post(() -> {
            finishRecording("user");
            if (recordingReady == null) {
                call.reject(recordingError == null ? "没有可保存的录音。" : recordingError,
                    recordingErrorCode == null ? "NO_RECORDING" : recordingErrorCode); return;
            }
            String path = "recordings/" + recordingOwner + "/" + recordingReady.getName();
            recordingReady = null; recordingOwner = null;
            call.resolve(new JSObject().put("path", path).put("durationMs", recordingDuration).put("quality", "usable"));
        });
    }

    @PluginMethod public void cancelRecording(PluginCall call) {
        main.post(() -> {
            if (permissionPending) permissionCancelled = true;
            main.removeCallbacks(recordingDeadline);
            if (recorder != null) { try { recorder.stop(); } catch (RuntimeException ignored) {} releaseRecorder(); }
            boolean removed = deleteFile(recordingTemp) & deleteFile(recordingReady);
            if (removed) { recordingTemp = null; recordingReady = null; recordingOwner = null; recordingError = null; recordingErrorCode = null; }
            abandonFocus();
            if (removed) call.resolve(); else call.reject("临时录音清理失败，请重试。", "FILE_DELETE_FAILED");
        });
    }

    @PluginMethod public void playRecording(PluginCall call) {
        String path = call.getString("path");
        main.post(() -> {
            cancelAiSpeech();
            if (!foreground || destroyed) { call.reject("请回到应用后播放。", "APP_NOT_ACTIVE"); return; }
            if (recorder != null || permissionPending) { call.reject("请先结束录音。", "AUDIO_BUSY"); return; }
            try {
                File file = NativeGuards.recordingFile(getContext().getFilesDir(), path);
                if (!file.isFile()) { call.reject("录音不存在或已删除。", "RECORDING_NOT_FOUND"); return; }
                stopSpeechInternal("AUDIO_INTERRUPTED", "开始回放录音。"); stopPlayer();
                if (!requestFocus(false)) { call.reject("音频正被其他应用使用。", "AUDIO_FOCUS_DENIED"); return; }
                MediaPlayer next = new MediaPlayer();
                player = next;
                playerCall = call;
                next.setAudioAttributes(audioAttributes(false));
                next.setDataSource(file.getAbsolutePath());
                next.setOnPreparedListener(ready -> {
                    if (player != ready) return;
                    if (!foreground || destroyed) { stopPlayer(); return; }
                    try { ready.start(); }
                    catch (RuntimeException failure) {
                        PluginCall pending = playerCall;
                        playerCall = null;
                        stopPlayer();
                        if (pending != null) pending.reject("录音无法播放。", "PLAYBACK_FAILED");
                    }
                });
                next.setOnCompletionListener(ended -> {
                    if (player != ended) return;
                    // The UI unlocks human review only after this promise succeeds.
                    // Retain the call during playback so any interruption rejects it.
                    PluginCall completed = playerCall;
                    playerCall = null;
                    stopPlayer();
                    if (completed != null) completed.resolve();
                });
                next.setOnErrorListener((failed, what, extra) -> {
                    if (player == failed) {
                        PluginCall pending = playerCall;
                        playerCall = null;
                        stopPlayer();
                        if (pending != null) pending.reject("录音无法播放。", "PLAYBACK_FAILED");
                        else notifyListeners("audioError", new JSObject().put("code", "PLAYBACK_FAILED"));
                    }
                    return true;
                });
                next.prepareAsync();
            } catch (IllegalArgumentException invalid) {
                if (playerCall == call) { playerCall = null; stopPlayer(); }
                call.reject("录音路径无效。", "INVALID_ARGUMENT");
            } catch (Exception failure) {
                if (playerCall == call) playerCall = null;
                stopPlayer();
                call.reject("录音无法播放。", "PLAYBACK_FAILED");
            }
        });
    }

    @PluginMethod public void deleteRecordings(PluginCall call) {
        String owner = call.getString("learnerId");
        try { NativeGuards.learnerId(owner); }
        catch (IllegalArgumentException invalid) { call.reject(invalid.getMessage(), "INVALID_ARGUMENT"); return; }
        main.post(() -> {
            if (owner.equals(recordingOwner) && (recorder != null || recordingReady != null)) {
                call.reject("请先取消该档案的当前录音再删除。", "AUDIO_BUSY"); return;
            }
            stopPlayer();
            ownerGenerations.put(owner, ownerGenerations.getOrDefault(owner, 0) + 1);
            if (permissionPending && owner.equals(permissionOwner)) permissionCancelled = true;
            deletingOwners.add(owner);
            storage.execute(() -> {
                try {
                    File directory = NativeGuards.learnerDirectory(getContext().getFilesDir(), owner);
                    if (directory.exists()) {
                        File[] entries = directory.listFiles();
                        if (entries == null) throw new IOException();
                        // Never recurse: each profile directory owns only ordinary audio files.
                        for (File file : entries) {
                            if (!file.getCanonicalFile().equals(file.getAbsoluteFile()) || !file.isFile() || !file.delete()) throw new IOException();
                        }
                        if (!directory.delete()) throw new IOException();
                    }
                    main.post(() -> { deletingOwners.remove(owner); call.resolve(); });
                } catch (Exception failure) {
                    main.post(() -> call.reject("录音文件清理未完成，请重试；删除完成前不能为该档案录音。", "FILE_DELETE_FAILED"));
                }
            });
        });
    }

    @PluginMethod public void stopAudio(PluginCall call) {
        main.post(() -> { cancelAiSpeech(); stopSpeechInternal("AUDIO_INTERRUPTED", "音频已停止。"); stopPlayer(); finishRecording("user"); call.resolve(); });
    }

    private AudioAttributes audioAttributes(boolean recording) {
        return new AudioAttributes.Builder().setUsage(recording ? AudioAttributes.USAGE_VOICE_COMMUNICATION : AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    }

    @SuppressWarnings("deprecation")
    private boolean requestFocus(boolean recording) {
        abandonFocus();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focus = new AudioFocusRequest.Builder(recording ? AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE : AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(audioAttributes(recording)).setOnAudioFocusChangeListener(focusListener, main).build();
            return audioManager.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        return audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    @SuppressWarnings("deprecation")
    private void abandonFocus() {
        if (audioManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focus != null) audioManager.abandonAudioFocusRequest(focus);
            else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) audioManager.abandonAudioFocus(focusListener);
        }
        focus = null;
    }

    private void stopPlayer() {
        if (player != null) { player.release(); player = null; }
        if (playerCall != null) { playerCall.reject("播放已停止。", "AUDIO_INTERRUPTED"); playerCall = null; }
        if (recorder == null && speechCall == null) abandonFocus();
    }

    private void releaseRecorder() {
        main.removeCallbacks(recordingDeadline);
        main.removeCallbacks(recordingMeter);
        if (recorder != null) { recorder.release(); recorder = null; }
    }

    private boolean deleteFile(File file) { return file == null || !file.exists() || file.delete(); }

    private void deletePendingQuietly() {
        if (deleteFile(recordingTemp)) recordingTemp = null;
    }

    @Override protected void handleOnResume() { foreground = true; }
    @Override protected void handleOnPause() {
        foreground = false;
        cancelCourseGeneration();
        cancelAiSpeech();
        stopSpeechInternal("AUDIO_INTERRUPTED", "应用已进入后台。"); stopPlayer(); finishRecording("background");
    }
    @Override protected void handleOnDestroy() {
        destroyed = true;
        cancelCourseGeneration();
        cancelAiSpeech();
        stopSpeechInternal("AUDIO_INTERRUPTED", "应用已关闭。"); stopPlayer(); finishRecording("background");
        if (tts != null) { tts.shutdown(); tts = null; }
        getContext().unregisterReceiver(audioDisconnected);
        storage.execute(() -> stateStore.close());
        storage.shutdown();
        speechWorker.shutdown();
        courseWorker.shutdown();
    }
}
