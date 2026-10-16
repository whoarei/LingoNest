package cn.lingonest.app;

import android.content.Context;
import java.nio.charset.StandardCharsets;

/** Independent JSON documents; never addresses the historical learning database. */
final class NativeDocumentStore {
    static String databaseName(String key) {
        if (key == null || !key.matches("[A-Za-z0-9_.:-]{1,160}"))
            throw new IllegalArgumentException("文档标识无效。");
        return "lingonest-document-" + NativeGuards.sha256(key.getBytes(StandardCharsets.UTF_8)) + ".db";
    }
    static NativeStateStore open(Context context, String key) {
        return new NativeStateStore(context, databaseName(key));
    }
}
