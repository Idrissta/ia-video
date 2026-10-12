package com.idrissta.novagraph;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.DisplayCutout;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Coque native de Nova Graph : affiche l'interface web embarquée (assets/web)
 * en plein écran et lui fournit vibrations, barres système, bouton retour
 * et enregistrement d'images.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int BG_DARK = 0xFF06070D;
    private static final int BG_LIGHT = 0xFFF3F4FA;

    private WebView web;
    private SharedPreferences prefs;
    private boolean pageReady;
    private boolean backEnabled;
    private OnBackInvokedCallback backCallback;
    /** Encarts système en dp : haut, droite, bas, gauche. */
    private final float[] insets = new float[4];

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("nova", MODE_PRIVATE);
        boolean dark = prefs.getBoolean("dark", true);

        Window window = getWindow();
        setupEdgeToEdge(window);

        web = new WebView(this);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new Bridge(), "NovaNative");
        web.setWebViewClient(new AssetClient());
        web.setOnApplyWindowInsetsListener((v, wi) -> {
            readInsets(wi);
            return wi;
        });

        setContentView(web);
        applyBars(dark);
        web.loadUrl(START_URL);
    }

    /* ------------------------------------------------------------------ */
    /* Fenêtre bord à bord                                                 */
    /* ------------------------------------------------------------------ */

    @SuppressWarnings("deprecation")
    private void setupEdgeToEdge(Window w) {
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
    }

    @SuppressWarnings("deprecation")
    private void applyBars(boolean dark) {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else {
            View decor = w.getDecorView();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            int flags = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(dark ? flags & ~light : flags | light);
        }
        int bg = dark ? BG_DARK : BG_LIGHT;
        w.getDecorView().setBackgroundColor(bg);
        web.setBackgroundColor(bg);
    }

    @SuppressWarnings("deprecation")
    private void readInsets(WindowInsets wi) {
        int t, r, b, l;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets i = wi.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            t = i.top;
            r = i.right;
            b = i.bottom;
            l = i.left;
        } else {
            t = wi.getSystemWindowInsetTop();
            r = wi.getSystemWindowInsetRight();
            b = wi.getSystemWindowInsetBottom();
            l = wi.getSystemWindowInsetLeft();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cut = wi.getDisplayCutout();
                if (cut != null) {
                    t = Math.max(t, cut.getSafeInsetTop());
                    r = Math.max(r, cut.getSafeInsetRight());
                    b = Math.max(b, cut.getSafeInsetBottom());
                    l = Math.max(l, cut.getSafeInsetLeft());
                }
            }
        }
        float d = getResources().getDisplayMetrics().density;
        insets[0] = t / d;
        insets[1] = r / d;
        insets[2] = b / d;
        insets[3] = l / d;
        pushInsets();
    }

    private String insetsArgs() {
        return String.format(Locale.US, "%.1f,%.1f,%.1f,%.1f", insets[0], insets[1], insets[2], insets[3]);
    }

    private void pushInsets() {
        if (pageReady) web.evaluateJavascript("window.novaInsets&&novaInsets(" + insetsArgs() + ")", null);
    }

    /* ------------------------------------------------------------------ */
    /* Bouton retour                                                       */
    /* ------------------------------------------------------------------ */

    private void updateBackCallback() {
        if (Build.VERSION.SDK_INT < 33) return;
        OnBackInvokedDispatcher dispatcher = getOnBackInvokedDispatcher();
        if (backEnabled && backCallback == null) {
            backCallback = () -> web.evaluateJavascript("window.novaBack&&novaBack()", null);
            dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        } else if (!backEnabled && backCallback != null) {
            dispatcher.unregisterOnBackInvokedCallback(backCallback);
            backCallback = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Utilisé avant Android 13 ; ensuite, OnBackInvokedCallback prend le relais.
        if (backEnabled && pageReady) {
            web.evaluateJavascript("window.novaBack&&novaBack()", result -> {
                if (!"true".equals(result)) super.onBackPressed();
            });
            return;
        }
        super.onBackPressed();
    }

    /* ------------------------------------------------------------------ */
    /* Cycle de vie                                                        */
    /* ------------------------------------------------------------------ */

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (pageReady) web.evaluateJavascript("window.novaSystemTheme&&novaSystemTheme()", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("NovaNative");
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Enregistrement / partage d'image                                    */
    /* ------------------------------------------------------------------ */

    private String saveImage(String base64, boolean share) {
        byte[] data;
        try {
            data = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return "error";
        }
        String name = "NovaGraph_" + System.currentTimeMillis() + ".png";
        Uri uri;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Nova Graph");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return "error";
                try (OutputStream os = cr.openOutputStream(uri)) {
                    if (os == null) return "error";
                    os.write(data);
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, values, null, null);
            } else {
                if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> requestPermissions(new String[] {Manifest.permission.WRITE_EXTERNAL_STORAGE}, 1));
                    return "permission";
                }
                Bitmap bmp = BitmapFactory.decodeByteArray(data, 0, data.length);
                if (bmp == null) return "error";
                @SuppressWarnings("deprecation")
                String url = MediaStore.Images.Media.insertImage(getContentResolver(), bmp, name, getString(R.string.app_name));
                if (url == null) return "error";
                uri = Uri.parse(url);
            }
        } catch (Exception e) {
            return "error";
        }
        if (share) {
            final Uri shared = uri;
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("image/png");
                send.putExtra(Intent.EXTRA_STREAM, shared);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivity(Intent.createChooser(send, getString(R.string.share_title)));
                } catch (Exception ignored) {
                    // aucune application de partage
                }
            });
        }
        return "ok";
    }

    /* ------------------------------------------------------------------ */
    /* Chargement des fichiers web depuis les assets                        */
    /* ------------------------------------------------------------------ */

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, null, new ByteArrayInputStream(new byte[0]));
    }

    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            // Application hors ligne : seuls les fichiers embarqués sont servis.
            if (!HOST.equals(uri.getHost())) return error(403, "Forbidden");
            String path = uri.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
            if (path.contains("..")) return error(404, "Not Found");
            try {
                InputStream in = getAssets().open("web" + path);
                String mime = mimeOf(path);
                boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("xml");
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers, in);
            } catch (IOException e) {
                return error(404, "Not Found");
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (HOST.equals(uri.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                // aucun navigateur disponible
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            pushInsets();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Le moteur de rendu a été arrêté : on reconstruit proprement l'activité.
            if (web == view) {
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
                web = null;
            }
            recreate();
            return true;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Pont JavaScript                                                     */
    /* ------------------------------------------------------------------ */

    private final class Bridge {
        @JavascriptInterface
        public void haptic(final String kind) {
            runOnUiThread(() -> {
                if (web == null) return;
                int c;
                switch (kind == null ? "" : kind) {
                    case "tick":
                        c = HapticFeedbackConstants.CLOCK_TICK;
                        break;
                    case "confirm":
                        c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
                        break;
                    case "reject":
                        c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
                        break;
                    case "long":
                        c = HapticFeedbackConstants.LONG_PRESS;
                        break;
                    default:
                        c = Build.VERSION.SDK_INT >= 27 ? HapticFeedbackConstants.KEYBOARD_PRESS : HapticFeedbackConstants.KEYBOARD_TAP;
                }
                web.performHapticFeedback(c);
            });
        }

        @JavascriptInterface
        public void setSystemBars(final boolean dark) {
            prefs.edit().putBoolean("dark", dark).apply();
            runOnUiThread(() -> {
                if (web != null) applyBars(dark);
            });
        }

        @JavascriptInterface
        public void setBackEnabled(final boolean enabled) {
            runOnUiThread(() -> {
                backEnabled = enabled;
                if (web != null) updateBackCallback();
            });
        }

        @JavascriptInterface
        public boolean isSystemDark() {
            int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return mode == Configuration.UI_MODE_NIGHT_YES;
        }

        @JavascriptInterface
        public String getInsets() {
            return String.format(Locale.US, "{\"top\":%.1f,\"right\":%.1f,\"bottom\":%.1f,\"left\":%.1f}",
                    insets[0], insets[1], insets[2], insets[3]);
        }

        @JavascriptInterface
        public String saveImage(String base64, boolean share) {
            return MainActivity.this.saveImage(base64, share);
        }
    }
}
