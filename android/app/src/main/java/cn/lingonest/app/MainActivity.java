package cn.lingonest.app;

import com.getcapacitor.BridgeActivity;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LingoNativePlugin.class);
        registerPlugin(CourseContentPlugin.class);
        super.onCreate(savedInstanceState);
        applyLegacyEmulatorRenderingWorkaround();
        // Android 15+ enforces edge-to-edge for current targets. Keep WebView controls clear of bars.
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets safe = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
    }

    private void applyLegacyEmulatorRenderingWorkaround() {
        // API 29 AOSP emulator + WebView 74 crashes in SkGlyph/Chrome_InProcGp while
        // rasterizing exercise text. Limit the software layer to that observed setup.
        // Software WebView drawing is deprecated; physical devices and newer providers
        // retain normal rendering. No emulator-wide graphics settings are changed.
        // https://developer.android.com/develop/ui/views/graphics/hardware-accel#view-level
        if (Build.VERSION.SDK_INT != Build.VERSION_CODES.Q ||
            !("ranchu".equals(Build.HARDWARE) || "goldfish".equals(Build.HARDWARE)) ||
            getBridge() == null || getBridge().getWebView() == null) return;
        PackageInfo provider = WebView.getCurrentWebViewPackage();
        if (provider != null && provider.versionName != null && provider.versionName.startsWith("74.")) {
            // onCreate has not returned, so the first window traversal has not drawn yet.
            getBridge().getWebView().setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        }
    }
}
