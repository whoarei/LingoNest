package cn.lingonest.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteStatement;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Named document snapshot store. SQLite is private to the application; this database is NOT encrypted. */
final class NativeStateStore extends SQLiteOpenHelper {
    static final class State {
        final long revision;
        final String payload;
        State(long revision, String payload) { this.revision = revision; this.payload = payload; }
    }
    static final class StoreException extends Exception {
        final String code;
        StoreException(String code, String message) { super(message); this.code = code; }
    }

    NativeStateStore(Context context, String databaseName) {
        // Android's default corruption handler deletes the DB. Preserve evidence for recovery instead.
        super(context, databaseName, null, 1, database -> {
            if (database.isOpen()) database.close();
        });
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onConfigure(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
        db.execSQL("PRAGMA synchronous=FULL");
        // This PRAGMA returns a result row on Android SQLite, so execSQL is not valid here.
        try (Cursor timeout = db.rawQuery("PRAGMA busy_timeout=3000", null)) {
            if (!timeout.moveToFirst() || timeout.getInt(0) != 3000) {
                throw new IllegalStateException("数据库等待策略设置失败。");
            }
        }
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), " +
            "revision INTEGER NOT NULL CHECK(revision>=0), payload BLOB, sha256 TEXT)");
        db.execSQL("INSERT INTO app_state(id,revision,payload,sha256) VALUES(1,0,NULL,NULL)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("数据库需要显式迁移，不能删除后重建。");
    }

    synchronized State load() throws StoreException {
        SQLiteDatabase db = getReadableDatabase();
        db.beginTransactionNonExclusive();
        try {
            State result = readChecked(db);
            db.setTransactionSuccessful();
            return result;
        } finally { db.endTransaction(); }
    }

    synchronized long save(long expectedRevision, String payload) throws StoreException {
        byte[] bytes = checkedJson(payload, false);
        if (expectedRevision < 0 || expectedRevision >= NativeGuards.MAX_REVISION) {
            throw new StoreException("INVALID_ARGUMENT", "数据版本无效。");
        }
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            // Validate the existing snapshot even on writes. A save must never hide corruption.
            State current = readChecked(db);
            if (current.revision != expectedRevision) {
                throw new StoreException("REVISION_CONFLICT", "学习数据已更新，请重新载入后重试。");
            }
            try (SQLiteStatement statement = db.compileStatement(
                "UPDATE app_state SET revision=?,payload=?,sha256=? WHERE id=1 AND revision=?")) {
                statement.bindLong(1, expectedRevision + 1);
                statement.bindBlob(2, bytes);
                statement.bindString(3, NativeGuards.sha256(bytes));
                statement.bindLong(4, expectedRevision);
                if (statement.executeUpdateDelete() != 1) throw new StoreException("REVISION_CONFLICT", "学习数据已更新。");
            }
            db.setTransactionSuccessful();
            return expectedRevision + 1;
        } finally { db.endTransaction(); }
    }

    private State readChecked(SQLiteDatabase db) throws StoreException {
        long revision;
        int byteLength;
        String hash;
        boolean empty;
        try (Cursor cursor = db.rawQuery("SELECT revision,length(payload),sha256,payload IS NULL FROM app_state WHERE id=1", null)) {
            if (!cursor.moveToFirst()) throw corrupt();
            revision = cursor.getLong(0);
            byteLength = cursor.getInt(1);
            hash = cursor.getString(2);
            empty = cursor.getInt(3) == 1;
            if (revision < 0 || revision > NativeGuards.MAX_REVISION) throw corrupt();
        }
        if (empty) {
            if (revision != 0 || hash != null) throw corrupt();
            return new State(0, null);
        }
        if (byteLength <= 0 || byteLength > NativeGuards.MAX_STATE_BYTES || hash == null) throw corrupt();
        // CursorWindow is commonly smaller than 10 MB. Read the BLOB in bounded chunks.
        ByteArrayOutputStream output = new ByteArrayOutputStream(byteLength);
        for (int offset = 0; offset < byteLength; offset += 256 * 1024) {
            int count = Math.min(256 * 1024, byteLength - offset);
            try (Cursor cursor = db.rawQuery("SELECT substr(payload,?,?) FROM app_state WHERE id=1",
                new String[]{ Integer.toString(offset + 1), Integer.toString(count) })) {
                if (!cursor.moveToFirst()) throw corrupt();
                byte[] chunk = cursor.getBlob(0);
                if (chunk == null || chunk.length != count) throw corrupt();
                output.write(chunk, 0, chunk.length);
            }
        }
        byte[] bytes = output.toByteArray();
        if (!hash.equals(NativeGuards.sha256(bytes))) throw corrupt();
        try {
            String payload = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            checkedJson(payload, true);
            return new State(revision, payload);
        } catch (CharacterCodingException invalid) { throw corrupt(); }
    }

    private static byte[] checkedJson(String payload, boolean stored) throws StoreException {
        try {
            byte[] bytes = NativeGuards.payloadBytes(payload);
            JSONTokener parser = new JSONTokener(payload);
            if (!(parser.nextValue() instanceof JSONObject) || parser.nextClean() != 0) {
                throw new JSONException("Expected exactly one JSON object");
            }
            return bytes;
        } catch (IllegalArgumentException | JSONException invalid) {
            throw new StoreException(stored ? "STATE_CORRUPT" : "INVALID_ARGUMENT",
                stored ? "本地学习数据损坏，已保留原数据，请勿清除应用数据。" : "学习数据必须是 10 MB 以内的 JSON 对象。");
        }
    }

    private static StoreException corrupt() {
        return new StoreException("STATE_CORRUPT", "本地学习数据损坏，已保留原数据，请勿清除应用数据。");
    }
}
