package com.idrissta.craftapps;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.view.WindowInsets;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Coque native de Craft Apps : affiche la version web d'ArtCraft Launcher
 * (egui compilé en WebAssembly, dans assets/web) en plein écran.
 *
 * Les fichiers de l'appli sont servis depuis les assets sous une origine https
 * locale. Seuls api.github.com (versions des applis) et raw.githubusercontent.com
 * (captures d'écran) passent par le réseau ; tout autre lien, comme un
 * téléchargement ou une page GitHub, s'ouvre dans le navigateur du téléphone.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final String[] NETWORK_HOSTS = {"api.github.com", "raw.githubusercontent.com"};

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setBackgroundColor(getColor(R.color.page_bg));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // Réglages de l'appli (langue, vue, tri) gardés par egui dans localStorage.
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // egui gère lui-même le zoom et le défilement au doigt.
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        // egui ouvre les liens avec window.open(url, "_blank") : on les récupère dans onCreateWindow.
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new LinkCatcher());

        // Android 15 affiche l'appli bord à bord : le cadre laisse la place aux barres système et au
        // clavier (une WebView ne respecte pas son propre padding).
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.page_bg));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setOnApplyWindowInsetsListener((v, wi) -> {
            int t, r, b, l;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets i = wi.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                t = i.top;
                r = i.right;
                b = i.bottom;
                l = i.left;
            } else {
                t = wi.getSystemWindowInsetTop();
                r = wi.getSystemWindowInsetRight();
                b = wi.getSystemWindowInsetBottom();
                l = wi.getSystemWindowInsetLeft();
            }
            v.setPadding(l, t, r, b);
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : wi.consumeSystemWindowInsets();
        });

        setContentView(root);
        web.loadUrl(START_URL);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
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
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Liens externes                                                      */
    /* ------------------------------------------------------------------ */

    private void openOutside(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // aucun navigateur disponible
        }
    }

    /** Reçoit les window.open() d'egui dans une WebView jetable et ouvre l'adresse dans le navigateur. */
    private final class LinkCatcher extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            WebView popup = new WebView(MainActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    openOutside(request.getUrl());
                    v.destroy();
                    return true;
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Fichiers de l'appli                                                 */
    /* ------------------------------------------------------------------ */

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        // Indispensable : WebAssembly.instantiateStreaming refuse tout autre type.
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static boolean isNetworkHost(String host) {
        for (String h : NETWORK_HOSTS) {
            if (h.equals(host)) return true;
        }
        return false;
    }

    private static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, null, new ByteArrayInputStream(new byte[0]));
    }

    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost();
            // L'API GitHub et les captures : laissées au réseau (null = chargement normal).
            if (isNetworkHost(host)) return null;
            if (!HOST.equals(host)) return error(403, "Forbidden");
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
            openOutside(uri);
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Le moteur de rendu a été arrêté (manque de mémoire…) : on reconstruit l'activité.
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
}
