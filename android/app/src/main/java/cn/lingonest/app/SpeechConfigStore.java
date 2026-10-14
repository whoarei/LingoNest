package cn.lingonest.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import com.getcapacitor.JSObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** API credentials stay encrypted on this device and are never returned through the JS bridge. */
final class SpeechConfigStore {
    private final SharedPreferences preferences;
    private final String alias;
    SpeechConfigStore(Context context) { this(context, "lingonest-speech", "lingonest.speech.config.v1"); }
    SpeechConfigStore(Context context, String preferenceName, String keyAlias) {
        preferences = context.getSharedPreferences(preferenceName, Context.MODE_PRIVATE); alias = keyAlias;
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    synchronized SpeechConfig load() throws Exception {
        String encoded = preferences.getString("encrypted", null);
        if (encoded == null) return SpeechConfig.defaults();
        JSONObject envelope = new JSONObject(encoded);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
        cipher.updateAAD("lingonest-speech-v1".getBytes(StandardCharsets.UTF_8));
        JSONObject data = new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
        return new SpeechConfig(data.getString("mode"), data.getString("protocol"), data.getString("baseUrl"), data.getString("model"), data.getString("voice"), data.getDouble("speed"), data.getString("instructions"), data.getString("apiKey"));
    }
    synchronized SpeechConfig save(JSONObject input) throws Exception {
        SpeechConfig previous = load();
        String supplied = input.optString("apiKey", "").trim();
        String base = input.optString("baseUrl", "").trim();
        if (supplied.isEmpty() && !previous.apiKey.isEmpty() && !SpeechConfig.origin(base).equals(SpeechConfig.origin(previous.baseUrl)))
            throw new IllegalArgumentException("更换服务域名后，请重新填写该服务的 API Key。");
        SpeechConfig next = new SpeechConfig(input.optString("mode", "device"), input.optString("protocol", "openai-speech"), base,
            input.optString("model", ""), input.optString("voice", ""), input.optDouble("speed", 0.9), input.optString("instructions", ""), supplied.isEmpty() ? previous.apiKey : supplied);
        JSONObject data = new JSONObject();
        data.put("mode", next.mode); data.put("protocol", next.protocol); data.put("baseUrl", next.baseUrl); data.put("model", next.model);
        data.put("voice", next.voice); data.put("speed", next.speed); data.put("instructions", next.instructions); data.put("apiKey", next.apiKey);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD("lingonest-speech-v1".getBytes(StandardCharsets.UTF_8));
        JSONObject envelope = new JSONObject();
        envelope.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        envelope.put("data", Base64.encodeToString(cipher.doFinal(data.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        if (!preferences.edit().putString("encrypted", envelope.toString()).commit()) throw new java.io.IOException("语音配置保存失败。");
        return next;
    }
    synchronized void clear() throws Exception { if (!preferences.edit().clear().commit()) throw new java.io.IOException("语音配置清理失败。"); }
    static JSObject publicConfig(SpeechConfig config) {
        JSObject result = new JSObject();
        result.put("mode", config.mode); result.put("protocol", config.protocol); result.put("baseUrl", config.baseUrl);
        result.put("model", config.model); result.put("voice", config.voice); result.put("speed", config.speed);
        result.put("instructions", config.instructions); result.put("hasKey", !config.apiKey.isEmpty());
        return result;
    }
}
