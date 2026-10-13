package cn.lingonest.app;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.Arrays;
import java.util.UUID;
import static org.junit.Assert.*;

/** Real SQLite checks in a unique test database; never opens the learner's production database. */
@RunWith(AndroidJUnit4.class)
public class NativeStateStoreTest {
    private Context context;
    private String databaseName;
    private NativeStateStore store;

    @Before public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        databaseName = "native-state-test-" + UUID.randomUUID() + ".db";
        store = new NativeStateStore(context, databaseName);
    }

    @After public void tearDown() {
        store.close();
        context.deleteDatabase(databaseName);
    }

    @Test public void snapshotSurvivesCloseAndReopen() throws Exception {
        assertNull(store.load().payload);
        assertEquals(1, store.save(0, "{\"events\":[{\"id\":\"first\"}]}"));
        store.close();
        store = new NativeStateStore(context, databaseName);
        assertEquals(1, store.load().revision);
        assertEquals("{\"events\":[{\"id\":\"first\"}]}", store.load().payload);
    }

    @Test public void staleWriterCannotOverwriteCommittedEvents() throws Exception {
        NativeStateStore other = new NativeStateStore(context, databaseName);
        try {
            assertEquals(0, other.load().revision);
            store.save(0, "{\"events\":[1]}");
            try { other.save(0, "{\"events\":[2]}"); fail("stale save accepted"); }
            catch (NativeStateStore.StoreException expected) { assertEquals("REVISION_CONFLICT", expected.code); }
            assertEquals("{\"events\":[1]}", store.load().payload);
            assertEquals(1, other.load().revision);
        } finally { other.close(); }
    }

    @Test public void payloadBeyondCursorWindowIsReadWithoutTruncation() throws Exception {
        char[] chars = new char[3 * 1024 * 1024];
        Arrays.fill(chars, 'x');
        String payload = "{\"text\":\"" + new String(chars) + "\"}";
        store.save(0, payload);
        assertEquals(payload, store.load().payload);
    }

    @Test public void corruptedSnapshotCannotBeLoadedOrSilentlyReplaced() throws Exception {
        store.save(0, "{\"events\":[1]}");
        store.close();
        try (SQLiteDatabase raw = context.openOrCreateDatabase(databaseName, Context.MODE_PRIVATE, null)) {
            raw.execSQL("UPDATE app_state SET sha256='tampered' WHERE id=1");
        }
        store = new NativeStateStore(context, databaseName);
        try { store.load(); fail("corruption hidden on read"); }
        catch (NativeStateStore.StoreException expected) { assertEquals("STATE_CORRUPT", expected.code); }
        try { store.save(1, "{}"); fail("corruption overwritten on write"); }
        catch (NativeStateStore.StoreException expected) { assertEquals("STATE_CORRUPT", expected.code); }
    }

    @Test public void trailingJsonOrArrayIsRejectedWithoutAdvancingRevision() throws Exception {
        for (String invalid : new String[]{ "{} trailing", "[]", "null" }) {
            try { store.save(0, invalid); fail("Invalid payload accepted"); }
            catch (NativeStateStore.StoreException expected) { assertEquals("INVALID_ARGUMENT", expected.code); }
        }
        assertEquals(0, store.load().revision);
        assertNull(store.load().payload);
    }
}
