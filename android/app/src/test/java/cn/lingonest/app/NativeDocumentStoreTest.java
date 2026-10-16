package cn.lingonest.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class NativeDocumentStoreTest {
    @Test public void namesAreStableAndCannotAddressTheLegacyDatabase() {
        String first = NativeDocumentStore.databaseName("lingonest.mode-settings.v1");
        assertEquals(first, NativeDocumentStore.databaseName("lingonest.mode-settings.v1"));
        assertTrue(first.matches("lingonest-document-[a-f0-9]{64}\\.db"));
        assertNotEquals("lingonest-state.db", first);
        assertNotEquals(first, NativeDocumentStore.databaseName("mode.other.v1"));
    }
    @Test public void rejectsInvalidDocumentKeys() {
        for (String key : new String[] { null, "", "../lingonest-state", "a/b", "a b", "a".repeat(161) }) {
            try { NativeDocumentStore.databaseName(key); fail("Invalid key accepted"); }
            catch (IllegalArgumentException expected) { }
        }
    }
}
