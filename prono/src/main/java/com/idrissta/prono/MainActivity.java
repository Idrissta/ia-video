package com.idrissta.prono;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
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
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Coque native de PronoFoot : affiche l'interface (assets/web) et relaie les
 * appels aux données de matchs (/net/?u=…) pour éviter les restrictions CORS.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int BG = 0xFF070B10;
    /** Seuls ces serveurs peuvent être interrogés par le relais. */
    private static final Set<String> API_HOSTS = new HashSet<>(Arrays.asList(
            "site.api.espn.com", "site.web.api.espn.com", "sports.core.api.espn.com"));
    /** Images chargées directement par la WebView (logos des équipes). */
    private static final Set<String> IMAGE_HOSTS = new HashSet<>(Arrays.asList("a.espncdn.com"));

    private WebView web;
    private boolean pageReady;
    private boolean backEnabled;
    private OnBackInvokedCallback backCallback;
    private final float[] insets = new float[2];

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        else setLegacyEdgeToEdge(w);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }

        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
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
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new Bridge(), "PronoNative");
        web.setWebViewClient(new Client());
        web.setOnApplyWindowInsetsListener((v, wi) -> {
            readInsets(wi);
            return wi;
        });
        setContentView(web);
        w.getDecorView().setBackgroundColor(BG);
        web.loadUrl(START_URL);
    }

    @SuppressWarnings("deprecation")
    private void setLegacyEdgeToEdge(Window w) {
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @SuppressWarnings("deprecation")
    private void readInsets(WindowInsets wi) {
        int top;
        int bottom;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets i = wi.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            top = i.top;
            bottom = i.bottom;
        } else {
            top = wi.getSystemWindowInsetTop();
            bottom = wi.getSystemWindowInsetBottom();
        }
        float d = getResources().getDisplayMetrics().density;
        insets[0] = top / d;
        insets[1] = bottom / d;
        pushInsets();
    }

    private void pushInsets() {
        if (pageReady && web != null) {
            web.evaluateJavascript(String.format(Locale.US, "window.pronoInsets&&pronoInsets(%.1f,%.1f)", insets[0], insets[1]), null);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Bouton retour : l'interface décide, sinon on quitte                  */
    /* ------------------------------------------------------------------ */

    private void handleBack() {
        if (web == null || !pageReady) {
            finish();
            return;
        }
        web.evaluateJavascript("window.pronoBack?pronoBack():false", result -> {
            // Écran principal : l'application passe en arrière-plan (comme le bouton d'accueil).
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }

    private void updateBackCallback() {
        if (Build.VERSION.SDK_INT < 33) return;
        OnBackInvokedDispatcher dispatcher = getOnBackInvokedDispatcher();
        if (backEnabled && backCallback == null) {
            backCallback = this::handleBack;
            dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        } else if (!backEnabled && backCallback != null) {
            dispatcher.unregisterOnBackInvokedCallback(backCallback);
            backCallback = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (backEnabled) {
            handleBack();
            return;
        }
        super.onBackPressed();
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
            web.removeJavascriptInterface("PronoNative");
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Fichiers de l'interface et relais réseau                              */
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

    private static boolean allowed(Uri u) {
        return u != null && "https".equals(u.getScheme()) && u.getHost() != null && API_HOSTS.contains(u.getHost());
    }

    /**
     * Appel réseau réel pour /net/?u=<url>, limité aux serveurs de données autorisés
     * (redirections suivies à la main et vérifiées elles aussi).
     */
    private WebResourceResponse relay(Uri request) {
        String target = request.getQueryParameter("u");
        if (target == null) return error(400, "Bad Request");
        if (!allowed(Uri.parse(target))) return error(403, "Forbidden");
        HttpURLConnection c = null;
        try {
            URL url = new URL(target);
            for (int hop = 0; hop < 5; hop++) {
                c = (HttpURLConnection) url.openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") PronoFoot/" + BuildConfig.VERSION_NAME);
                c.setRequestProperty("Accept", "application/json");
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = c.getHeaderField("Location");
                    c.disconnect();
                    if (loc == null) return error(502, "Bad Gateway");
                    url = new URL(url, loc);
                    if (!allowed(Uri.parse(url.toString()))) return error(403, "Forbidden");
                    continue;
                }
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in == null) in = new ByteArrayInputStream(new byte[0]);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                String reason = c.getResponseMessage();
                return new WebResourceResponse("application/json", "utf-8", code, reason == null || reason.isEmpty() ? "OK" : reason, headers, in);
            }
            return error(502, "Bad Gateway");
        } catch (IOException | RuntimeException e) {
            if (c != null) c.disconnect();
            return error(502, "Bad Gateway");
        }
    }

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost();
            if (host != null && IMAGE_HOSTS.contains(host)) return null;
            if (!HOST.equals(host)) return error(403, "Forbidden");
            String path = uri.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
            if (path.startsWith("/net/")) return relay(uri);
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
                if (web != null) web.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
            });
        }

        @JavascriptInterface
        public void setBackEnabled(final boolean enabled) {
            runOnUiThread(() -> {
                backEnabled = enabled;
                updateBackCallback();
            });
        }

        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                try {
                    startActivity(Intent.createChooser(send, getString(R.string.share_title)));
                } catch (Exception ignored) {
                    // aucune application de partage
                }
            });
        }

        @JavascriptInterface
        public String appVersion() {
            return BuildConfig.VERSION_NAME;
        }
    }
}
