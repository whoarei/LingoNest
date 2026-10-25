package cn.lingonest.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

/** Small built-in samples exercise the same chat endpoint as course authoring. */
final class ContentModelProbe {
    static final class Failure extends IOException {
        Failure(String message) { super(message); }
    }

    static String prompt(String kind) {
        return "recognition".equals(kind)
            ? "识别图片中的英文与数字，只返回 JSON 对象，格式为 {\"text\":\"识别到的内容\"}，不要使用 Markdown。"
            : "这是课程生成模型的结构化输出测试。请只返回 JSON 对象 {\"status\":\"ok\"}，不要使用 Markdown 或添加其他文字。";
    }

    static String imageUrl() throws IOException {
        Bitmap bitmap = Bitmap.createBitmap(480, 160, Bitmap.Config.ARGB_8888);
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(Color.WHITE);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.BLACK);
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextSize(64);
            canvas.drawText("HELLO 123", 40, 105, paint);
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new IOException();
            return "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } finally { bitmap.recycle(); }
    }

    static void validate(String kind, String text) throws Failure {
        String invalidJson = "模型未返回有效的 JSON 对象，请使用支持结构化文本输出的模型后重试。";
        try {
            String json = text.trim();
            if (json.startsWith("```")) {
                int firstLine = json.indexOf('\n');
                if (firstLine < 0 || !json.endsWith("```")) throw new Failure(invalidJson);
                json = json.substring(firstLine + 1, json.length() - 3).trim();
            }
            JSONTokener parser = new JSONTokener(json);
            Object parsed = parser.nextValue();
            if (!(parsed instanceof JSONObject) || parser.nextClean() != 0) throw new Failure(invalidJson);
            JSONObject result = (JSONObject) parsed;
            if ("recognition".equals(kind)) {
                String recognized = result.getString("text").replaceAll("\\s+", "");
                if (!"HELLO123".equalsIgnoreCase(recognized))
                    throw new Failure("模型未能正确识别示例图片，请确认模型支持图片输入，或更换识别模型。");
            } else if (!"ok".equals(result.getString("status"))) throw new Failure(invalidJson);
        } catch (org.json.JSONException error) {
            throw new Failure(invalidJson);
        }
    }

    static String httpFailure(int status) {
        String reason;
        switch (status) {
            case 401: reason = "API Key 无效或已过期，请重新填写。"; break;
            case 403: reason = "当前 Key 没有访问权限，请检查模型授权或服务的访问限制。"; break;
            case 402: reason = "服务额度不足，请检查账户余额或套餐。"; break;
            case 404: reason = "接口或模型不存在，请检查服务地址和模型名称。"; break;
            case 400: case 422: reason = "服务不接受当前请求，请检查模型是否兼容 Chat Completions；文字识别还需支持图片输入。"; break;
            case 429: reason = "服务请求受限或额度不足，请检查配额并稍后重试。"; break;
            default:
                reason = status >= 500 ? "模型服务暂时不可用，请稍后重试。"
                    : status >= 300 && status < 400 ? "服务返回了重定向，请填写最终的 HTTPS 服务地址。"
                    : "请检查模型与服务配置后重试。";
        }
        return "内容服务请求失败（HTTP " + status + "）：" + reason;
    }
}
