package cn.lingonest.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** Real plugin/JSON/image handling with an isolated encrypted config and a fake HTTP transport. */
public class ContentModelTest {
    private Context context;
    private String name;
    private SpeechConfigStore config;
    private final List<CourseContentPlugin> plugins = new ArrayList<>();

    @Before public void before() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        name = "content-model-test-" + UUID.randomUUID();
        config = new SpeechConfigStore(context, name, name);
        config.save(new JSONObject().put("mode", "ai").put("protocol", "openai-speech")
            .put("baseUrl", "https://content.example.com/v1").put("model", "test-model")
            .put("voice", "alloy").put("apiKey", "fake-test-key"));
    }

    @After public void after() throws Exception {
        for (CourseContentPlugin plugin : plugins) plugin.handleOnDestroy();
        context.deleteSharedPreferences(name);
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null); keys.deleteEntry(name);
    }

    private static final class Result extends PluginCall {
        final CountDownLatch done = new CountDownLatch(1);
        String failure, code;
        JSObject value;
        Result(String kind) { super(null, "CourseContent", "test", "testConfig", new JSObject().put("kind", kind)); }
        @Override public void resolve() { done.countDown(); }
        @Override public void resolve(JSObject data) { value = data; done.countDown(); }
        @Override public void reject(String message, String code) { failure = message; this.code = code; done.countDown(); }
        Result await() throws Exception { assertTrue("Request timed out", done.await(10, TimeUnit.SECONDS)); return this; }
    }

    private static final class Connection extends HttpURLConnection {
        final ByteArrayOutputStream sent = new ByteArrayOutputStream();
        final int status;
        final String response;
        IOException failure;
        Connection(int status, String text) throws Exception {
            super(new URL("https://content.example.com/v1/chat/completions"));
            this.status = status;
            response = new JSONObject().put("choices", new JSONArray().put(new JSONObject()
                .put("message", new JSONObject().put("content", text)))).toString();
        }
        @Override public void connect() { }
        @Override public void disconnect() { }
        @Override public boolean usingProxy() { return false; }
        @Override public OutputStream getOutputStream() throws IOException { if (failure != null) throw failure; return sent; }
        @Override public int getResponseCode() { return status; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(response.getBytes(StandardCharsets.UTF_8)); }
        JSONObject body() throws Exception { return new JSONObject(new String(sent.toByteArray(), StandardCharsets.UTF_8)); }
    }

    private CourseContentPlugin plugin(Connection connection) {
        CourseContentPlugin plugin = new CourseContentPlugin() {
            @Override SpeechConfigStore store(String kind) {
                if (!"generation".equals(kind) && !"recognition".equals(kind)) throw new IllegalArgumentException();
                return config;
            }
            @Override HttpURLConnection openConnection(URL url) {
                assertEquals("https://content.example.com/v1/chat/completions", url.toString());
                return connection;
            }
        };
        plugins.add(plugin);
        return plugin;
    }

    private Result test(Connection connection, String kind) throws Exception {
        Result result = new Result(kind);
        plugin(connection).testConfig(result);
        return result.await();
    }

    @Test public void generationTestUsesTheCourseEndpointAndChecksStructuredOutput() throws Exception {
        Connection connection = new Connection(200, "```json\n{\"status\":\"ok\"}\n```");
        assertNull(test(connection, "generation").failure);
        JSONObject body = connection.body();
        assertEquals("test-model", body.getString("model"));
        assertFalse(body.getBoolean("stream"));
        assertTrue(body.getJSONArray("messages").getJSONObject(0).getString("content").contains("JSON"));
        assertEquals("Bearer fake-test-key", connection.getRequestProperty("Authorization"));
        assertFalse(connection.getInstanceFollowRedirects());
        assertNull(test(new Connection(200, "{\"status\":\"ok\"}"), "generation").value);
        assertTrue(test(new Connection(200, "hello"), "generation").failure.contains("JSON"));
        assertTrue(test(new Connection(200, "{\"status\":\"wrong\"}"), "generation").failure.contains("JSON"));
        assertTrue(test(new Connection(200, "{\"status\":\"ok\"} trailing text"), "generation").failure.contains("JSON"));
        assertTrue(test(new Connection(200, "  "), "generation").failure.contains("内容为空"));
    }

    @Test public void recognitionTestActuallySendsAnImageAndChecksItsText() throws Exception {
        Connection connection = new Connection(200, "{\"text\":\"HELLO 123\"}");
        assertNull(test(connection, "recognition").failure);
        JSONArray content = connection.body().getJSONArray("messages").getJSONObject(0).getJSONArray("content");
        assertFalse(content.getJSONObject(0).getString("text").contains("HELLO"));
        String image = content.getJSONObject(1).getJSONObject("image_url").getString("url");
        byte[] bytes = Base64.decode(image.substring(image.indexOf(',') + 1), Base64.NO_WRAP);
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        assertNotNull(bitmap);
        assertEquals(480, bitmap.getWidth());
        bitmap.recycle();
        assertTrue(test(new Connection(200, "{\"text\":\"wrong\"}"), "recognition").failure.contains("支持图片输入"));
    }

    @Test public void httpFailuresAndTimeoutsAreActionableAndNeverIncludeServiceOutput() throws Exception {
        int[] statuses = {401, 403, 402, 404, 400, 422, 429, 503, 302};
        String[] reasons = {"API Key", "访问权限", "额度不足", "接口或模型不存在", "请求", "请求", "配额", "暂时不可用", "重定向"};
        for (int i = 0; i < statuses.length; i++) {
            Result result = test(new Connection(statuses[i], "private-provider-output"), "generation");
            assertEquals("CONTENT_REQUEST_FAILED", result.code);
            assertTrue(result.failure, result.failure.contains("HTTP " + statuses[i]));
            assertTrue(result.failure, result.failure.contains(reasons[i]));
            assertFalse(result.failure.contains("private-provider-output"));
        }
        Connection timeout = new Connection(200, "");
        timeout.failure = new SocketTimeoutException("private-provider-output");
        assertEquals("模型请求超时，请检查网络或稍后重试。", test(timeout, "generation").failure);
    }

    @Test public void regularCourseRequestsShareTheSameTransportAndMissingConfigFailsLocally() throws Exception {
        Connection connection = new Connection(200, "course content");
        Result result = new Result("generation");
        result.getData().put("prompt", "regular course prompt");
        plugin(connection).request(result);
        assertEquals("course content", result.await().value.getString("text"));
        assertEquals("regular course prompt", connection.body().getJSONArray("messages").getJSONObject(0).getString("content"));
        config.clear();
        Connection unused = new Connection(200, "");
        assertEquals("CONTENT_CONFIG_REQUIRED", test(unused, "generation").code);
        assertEquals(0, unused.sent.size());
    }
}
