package com.idrissta.trouvetonia;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
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

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Coque native de Trouve ton IA : affiche l'interface web embarquée (assets/web)
 * en plein écran et lui fournit vibrations, barres système, bouton retour,
 * ouverture des sites (navigateur intégré ou navigateur du téléphone), partage et les outils
 * natifs du studio de création ({@link Studio}).
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    /** Seuls hôtes distants autorisés : catalogue à jour (dépôt GitHub) et logos des sites. */
    private static final String CATALOG_HOST = "raw.githubusercontent.com";
    private static final String CATALOG_PATH = "/Idrissta/ia-video/";
    private static final String ICON_HOST = "icons.duckduckgo.com";
    private static final int BG_DARK = 0xFF0A0B14;
    private static final int BG_LIGHT = 0xFFF5F6FB;

    private WebView web;
    private Studio studio;
    private SharedPreferences prefs;
    private boolean pageReady;
    private boolean backEnabled;
    private OnBackInvokedCallback backCallback;
    /** Encarts système en dp : haut, droite, bas, gauche, clavier. */
    private final float[] insets = new float[5];

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("trouve", MODE_PRIVATE);
        boolean dark = prefs.getBoolean("dark", true);

        Window window = getWindow();
        setupEdgeToEdge(window);
        studio = new Studio(this, this::repondre);

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
        // Le studio lit les clips générés et la bande-son pendant le montage, longtemps après le toucher.
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new Bridge(), "TrouveNative");
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
        int t, r, b, l, kb;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets i = wi.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            t = i.top;
            r = i.right;
            b = i.bottom;
            l = i.left;
            int ime = wi.getInsets(WindowInsets.Type.ime()).bottom;
            kb = ime > b ? ime - b : 0;
        } else {
            t = wi.getSystemWindowInsetTop();
            r = wi.getSystemWindowInsetRight();
            l = wi.getSystemWindowInsetLeft();
            // Avant Android 11, l'encart du bas inclut le clavier : la barre de navigation
            // seule correspond à l'encart « stable ».
            int all = wi.getSystemWindowInsetBottom();
            b = Math.min(all, wi.getStableInsetBottom());
            kb = all - b;
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
        insets[4] = Math.max(0, kb) / d;
        pushInsets();
    }

    private String insetsArgs() {
        return String.format(Locale.US, "%.1f,%.1f,%.1f,%.1f,%.1f",
                insets[0], insets[1], insets[2], insets[3], insets[4]);
    }

    private void pushInsets() {
        if (pageReady && web != null) web.evaluateJavascript("window.appInsets&&appInsets(" + insetsArgs() + ")", null);
    }

    /* ------------------------------------------------------------------ */
    /* Bouton retour                                                       */
    /* ------------------------------------------------------------------ */

    private void updateBackCallback() {
        if (Build.VERSION.SDK_INT < 33) return;
        OnBackInvokedDispatcher dispatcher = getOnBackInvokedDispatcher();
        if (backEnabled && backCallback == null) {
            backCallback = () -> {
                if (web != null) web.evaluateJavascript("window.appBack&&appBack()", null);
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
        // Utilisé avant Android 13 ; ensuite, OnBackInvokedCallback prend le relais.
        if (backEnabled && pageReady && web != null) {
            web.evaluateJavascript("window.appBack&&appBack()", result -> {
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
        if (pageReady && web != null) web.evaluateJavascript("window.appSystemTheme&&appSystemTheme()", null);
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
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 7 && studio != null) {
            studio.autorisation(grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
        }
    }

    /** Réponse d'une opération du studio : appelle window.natif(id, résultat) dans la page. */
    private void repondre(final int id, final JSONObject resultat) {
        runOnUiThread(() -> {
            if (web != null && pageReady) web.evaluateJavascript("window.natif&&natif(" + id + "," + resultat + ")", null);
        });
    }

    @Override
    protected void onDestroy() {
        if (studio != null) {
            studio.fin();
            studio = null;
        }
        if (web != null) {
            web.removeJavascriptInterface("TrouveNative");
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Liens externes et partage                                           */
    /* ------------------------------------------------------------------ */

    private static boolean isWebLink(Uri uri) {
        String scheme = uri.getScheme();
        return "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme);
    }

    private boolean openExternal(Uri uri) {
        if (uri == null || !isWebLink(uri)) return false;
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, uri);
            view.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(view);
            return true;
        } catch (Exception e) {
            return false; // aucun navigateur disponible
        }
    }

    /** Ouvre le site d'une IA dans le navigateur intégré à l'appli ({@link NavigateurActivity}). */
    private boolean openInApp(Uri uri, boolean dark) {
        if (uri == null || !isWebLink(uri)) return false;
        try {
            Intent nav = new Intent(this, NavigateurActivity.class);
            nav.putExtra(NavigateurActivity.EXTRA_URL, uri.toString());
            nav.putExtra(NavigateurActivity.EXTRA_SOMBRE, dark);
            startActivity(nav);
            return true;
        } catch (Exception e) {
            return openExternal(uri);
        }
    }

    private void shareText(String subject, String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        if (subject != null && !subject.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, subject);
        send.putExtra(Intent.EXTRA_TEXT, text);
        try {
            startActivity(Intent.createChooser(send, getString(R.string.share_title)));
        } catch (Exception ignored) {
            // aucune application de partage
        }
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
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".mp4")) return "video/mp4";
        if (p.endsWith(".webm")) return "video/webm";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }

    private static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, null, new ByteArrayInputStream(new byte[0]));
    }

    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost();
            String path = uri.getPath();
            if (!HOST.equals(host)) {
                // Réseau limité au catalogue publié dans le dépôt et aux logos : rien d'autre ne sort.
                boolean https = "https".equalsIgnoreCase(uri.getScheme());
                boolean catalog = CATALOG_HOST.equals(host) && path != null && path.startsWith(CATALOG_PATH);
                if (https && (catalog || ICON_HOST.equals(host))) return null;
                return error(403, "Forbidden");
            }
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
            if (path.contains("..")) return error(404, "Not Found");
            if (path.startsWith("/cache/")) {
                // Images, clips et voix du studio, servis en même origine (dessin sur canvas possible).
                File f = studio == null ? null : studio.fichier(path.substring(7));
                if (f == null || !f.isFile()) return error(404, "Not Found");
                try {
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    headers.put("Content-Length", String.valueOf(f.length()));
                    return new WebResourceResponse(mimeOf(path), null, 200, "OK", headers, new FileInputStream(f));
                } catch (IOException e) {
                    return error(404, "Not Found");
                }
            }
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
            openExternal(uri);
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
            return String.format(Locale.US, "{\"top\":%.1f,\"right\":%.1f,\"bottom\":%.1f,\"left\":%.1f,\"kb\":%.1f}",
                    insets[0], insets[1], insets[2], insets[3], insets[4]);
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean openUrl(final String url) {
            if (url == null) return false;
            final Uri uri = Uri.parse(url);
            if (!isWebLink(uri)) return false;
            runOnUiThread(() -> openExternal(uri));
            return true;
        }

        @JavascriptInterface
        public void share(final String subject, final String text) {
            if (text == null || text.isEmpty()) return;
            runOnUiThread(() -> shareText(subject, text));
        }

        @JavascriptInterface
        public boolean openInApp(final String url, final boolean dark) {
            if (url == null) return false;
            final Uri uri = Uri.parse(url);
            if (!isWebLink(uri)) return false;
            runOnUiThread(() -> MainActivity.this.openInApp(uri, dark));
            return true;
        }

        /* Studio de création */

        @JavascriptInterface
        public void requete(int id, String methode, String url, String corps, String entetes, int delai) {
            if (studio != null) studio.requete(id, methode, url, corps, entetes, delai);
        }

        @JavascriptInterface
        public void telecharger(int id, String url, String nom) {
            if (studio != null) studio.telecharger(id, url, nom);
        }

        @JavascriptInterface
        public boolean ecrire(String nom, String base64, boolean debut) {
            return studio != null && studio.ecrire(nom, base64, debut);
        }

        @JavascriptInterface
        public void enregistrer(int id, String nom, String type) {
            if (studio != null) runOnUiThread(() -> studio.enregistrer(id, nom, type));
        }

        @JavascriptInterface
        public void partagerFichier(String uri, String type, String texte) {
            runOnUiThread(() -> {
                if (studio != null) studio.partager(uri, type, texte);
            });
        }

        @JavascriptInterface
        public void ouvrirFichier(String uri, String type) {
            runOnUiThread(() -> {
                if (studio != null) studio.ouvrir(uri, type);
            });
        }

        @JavascriptInterface
        public void voix(int id, String texte, float vitesse, float hauteur, String nom) {
            if (studio != null) studio.voix(id, texte, vitesse, hauteur, nom);
        }

        @JavascriptInterface
        public void ecranAllume(final boolean allume) {
            runOnUiThread(() -> {
                if (allume) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }
}
