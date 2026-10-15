package cn.lingonest.app;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.system.Os;
import androidx.activity.result.ActivityResult;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** Isolated private files only; no saved courses, model keys or network requests. */
public class CourseContentIntegrationTest {
    private File sandbox, files, alias;
    private Context context;
    private final List<CourseContentPlugin> plugins = new ArrayList<>();

    @Before public void before() throws Exception {
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        sandbox = new File(target.getCacheDir(), "course-images-test-" + UUID.randomUUID());
        files = new File(sandbox, "real-files");
        assertTrue(files.mkdirs());
        alias = new File(sandbox, "files");
        Os.symlink(files.getAbsolutePath(), alias.getAbsolutePath());
        context = new ContextWrapper(target) {
            @Override public File getFilesDir() { return alias; }
        };
    }

    @After public void after() throws Exception {
        for (CourseContentPlugin plugin : plugins) plugin.handleOnDestroy();
        if (alias != null) alias.delete();
        remove(sandbox);
    }

    private void remove(File file) {
        if (file == null) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        file.delete();
    }

    private CourseContentPlugin plugin() {
        CourseContentPlugin plugin = new CourseContentPlugin() {
            @Override public Context getContext() { return context; }
        };
        plugins.add(plugin);
        return plugin;
    }

    private static final class ResultCall extends PluginCall {
        private final CountDownLatch done = new CountDownLatch(1);
        private JSObject value;
        private String failure;
        ResultCall(JSObject data) { super(null, "CourseContent", "test", "test", data); }
        @Override public void resolve(JSObject data) { value = data; done.countDown(); }
        @Override public void reject(String message, String code) { failure = code + ": " + message; done.countDown(); }
        JSObject await() throws Exception {
            assertTrue("Plugin callback timed out", done.await(10, TimeUnit.SECONDS));
            assertNull(failure, failure);
            assertNotNull(value);
            return value;
        }
    }

    @Test public void importedImageCanBePreviewedAndReopenedThroughAnAppDirectoryAlias() throws Exception {
        File source = new File(sandbox, "gallery.jpg");
        Bitmap bitmap = Bitmap.createBitmap(64, 96, Bitmap.Config.ARGB_8888);
        try (FileOutputStream output = new FileOutputStream(source)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output));
        } finally { bitmap.recycle(); }

        CourseContentPlugin plugin = plugin();
        ResultCall picked = new ResultCall(new JSObject());
        Method callback = CourseContentPlugin.class.getDeclaredMethod("imageResult", PluginCall.class, ActivityResult.class);
        callback.setAccessible(true);
        callback.invoke(plugin, picked, new ActivityResult(Activity.RESULT_OK, new Intent().setData(Uri.fromFile(source))));
        String path = picked.await().getString("path");
        assertNotNull(path);
        // The old check rejected every image when a trusted parent was an alias.
        File aliasedImage = new File(alias, path);
        assertNotEquals(aliasedImage.getAbsoluteFile(), aliasedImage.getCanonicalFile());
        for (CourseContentPlugin reader : new CourseContentPlugin[]{plugin, plugin()}) {
            ResultCall preview = new ResultCall(new JSObject().put("path", path));
            reader.imageUrl(preview);
            File image = new File(Uri.parse(preview.await().getString("url")).getPath());
            assertEquals(aliasedImage.getCanonicalFile(), image);
            Bitmap decoded = BitmapFactory.decodeFile(image.getPath());
            assertNotNull(decoded);
            assertEquals(64, decoded.getWidth());
            assertEquals(96, decoded.getHeight());
            decoded.recycle();
        }
        ResultCall missing = new ResultCall(new JSObject().put("path", "course-images/00000000-0000-4000-a000-000000000000.jpg"));
        plugin.imageUrl(missing);
        assertTrue(missing.done.await(10, TimeUnit.SECONDS));
        assertTrue(missing.failure.startsWith("IMAGE_READ_FAILED:"));
    }

    @Test public void imageAndDirectorySymlinksInsideTheTrustedRootAreStillRejected() throws Exception {
        String path = "course-images/12345678-1234-1234-1234-123456789abc.jpg";
        File outside = new File(sandbox, "outside");
        assertTrue(outside.mkdirs());
        File target = new File(outside, "12345678-1234-1234-1234-123456789abc.jpg");
        assertTrue(target.createNewFile());
        File images = new File(files, "course-images");
        Os.symlink(outside.getPath(), images.getPath());
        try { assertRejected(path); } finally { assertTrue(images.delete()); }
        assertTrue(images.mkdir());
        File linked = new File(files, path);
        Os.symlink(target.getPath(), linked.getPath());
        try { assertRejected(path); } finally { assertTrue(linked.delete()); }
    }

    private void assertRejected(String path) throws Exception {
        try { NativeGuards.courseImageFile(alias, path); fail("Image alias was accepted"); }
        catch (IOException expected) { }
    }
}
