package com.idrissta.velochampion;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Coque native de Vélo Champion : affiche le jeu embarqué (assets/web) en plein
 * écran paysage et lui fournit vibrations, bouton retour, écran toujours allumé
 * et achats Google Play.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int BG = 0xFF05070F;

    private WebView web;
    private Billing billing;
    private boolean pageReady;
    private boolean backEnabled;
    private OnBackInvokedCallback backCallback;
    /** Zones à éviter (encoche…) en dp : haut, droite, bas, gauche. */
    private final float[] insets = new float[4];

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        setupFullscreen(window);

        web = new WebView(this);
        web.setBackgroundColor(BG);
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
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new Bridge(), "VeloNative");
        web.setWebViewClient(new AssetClient());
        web.setOnApplyWindowInsetsListener((v, wi) -> {
            readInsets(wi);
            return wi;
        });

        setContentView(web);
        window.getDecorView().setBackgroundColor(BG);
        hideSystemBars();
        web.loadUrl(START_URL);
    }

    /* ------------------------------------------------------------------ */
    /* Plein écran immersif                                                */
    /* ------------------------------------------------------------------ */

    @SuppressWarnings("deprecation")
    private void setupFullscreen(Window w) {
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
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
    private void hideSystemBars() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void readInsets(WindowInsets wi) {
        int t = 0, r = 0, b = 0, l = 0;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets i = wi.getInsets(WindowInsets.Type.displayCutout());
            t = i.top;
            r = i.right;
            b = i.bottom;
            l = i.left;
        } else if (Build.VERSION.SDK_INT >= 28) {
            DisplayCutout cut = wi.getDisplayCutout();
            if (cut != null) {
                t = cut.getSafeInsetTop();
                r = cut.getSafeInsetRight();
                b = cut.getSafeInsetBottom();
                l = cut.getSafeInsetLeft();
            }
        }
        float d = getResources().getDisplayMetrics().density;
        insets[0] = t / d;
        insets[1] = r / d;
        insets[2] = b / d;
        insets[3] = l / d;
        pushInsets();
    }

    private void pushInsets() {
        if (!pageReady || web == null) return;
        web.evaluateJavascript(String.format(Locale.US, "window.veloInsets&&veloInsets(%.1f,%.1f,%.1f,%.1f)",
                insets[0], insets[1], insets[2], insets[3]), null);
    }

    /* ------------------------------------------------------------------ */
    /* Bouton retour                                                       */
    /* ------------------------------------------------------------------ */

    private void updateBackCallback() {
        if (Build.VERSION.SDK_INT < 33) return;
        OnBackInvokedDispatcher dispatcher = getOnBackInvokedDispatcher();
        if (backEnabled && backCallback == null) {
            backCallback = () -> {
                if (web != null) web.evaluateJavascript("window.veloBack&&veloBack()", null);
            };
            dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        } else if (!backEnabled && backCallback != null) {
            dispatcher.unregisterOnBackInvokedCallback(backCallback);
            backCallback = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Avant Android 13 ; ensuite, OnBackInvokedCallback prend le relais.
        if (backEnabled && pageReady && web != null) {
            web.evaluateJavascript("window.veloBack&&veloBack()", result -> {
                if (!"true".equals(result)) MainActivity.super.onBackPressed();
            });
            return;
        }
        super.onBackPressed();
    }

    /* ------------------------------------------------------------------ */
    /* Cycle de vie                                                        */
    /* ------------------------------------------------------------------ */

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        hideSystemBars();
        if (billing != null) billing.queryPurchases();
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.veloPause&&veloPause()", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (billing != null) billing.end();
        if (web != null) {
            web.removeJavascriptInterface("VeloNative");
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private void sendStoreEvent(JSONObject event) {
        if (web == null) return;
        web.evaluateJavascript("window.veloStoreEvent&&veloStoreEvent(" + JSONObject.quote(event.toString()) + ")", null);
    }

    /* ------------------------------------------------------------------ */
    /* Chargement des fichiers du jeu depuis les assets                     */
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
            // Jeu hors ligne : seuls les fichiers embarqués sont servis.
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
                    case "heavy":
                        c = HapticFeedbackConstants.LONG_PRESS;
                        break;
                    case "confirm":
                        c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
                        break;
                    case "reject":
                        c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
                        break;
                    default:
                        c = HapticFeedbackConstants.CLOCK_TICK;
                }
                web.performHapticFeedback(c);
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
        public void keepAwake(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public String appVersion() {
            return BuildConfig.VERSION_NAME;
        }

        /** "play" : vrais paiements Google Play ; "test" : achats simulés (version de test). */
        @JavascriptInterface
        public String storeMode() {
            return BuildConfig.DEBUG ? "test" : "play";
        }

        @JavascriptInterface
        public void storeConnect(final String idsJson) {
            final List<String> ids = new ArrayList<>();
            try {
                JSONArray a = new JSONArray(idsJson);
                for (int i = 0; i < a.length(); i++) ids.add(a.getString(i));
            } catch (JSONException ignored) {
                // liste vide : la boutique restera indisponible
            }
            runOnUiThread(() -> {
                if (billing == null) billing = new Billing(MainActivity.this, MainActivity.this::sendStoreEvent);
                billing.connect(ids);
            });
        }

        @JavascriptInterface
        public void storeBuy(final String productId) {
            runOnUiThread(() -> {
                if (billing != null) billing.buy(productId);
            });
        }

        @JavascriptInterface
        public void storeRestore() {
            runOnUiThread(() -> {
                if (billing != null) billing.queryPurchases();
            });
        }
    }
}
