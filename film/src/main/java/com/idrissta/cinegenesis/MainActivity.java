package com.idrissta.cinegenesis;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.view.DisplayCutout;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Coque native de CINÉ-GENESIS : affiche l'interface web embarquée (assets/web)
 * en plein écran et lui fournit un accès réseau sans restriction CORS, la
 * sélection de photos, l'enregistrement dans la galerie, la synthèse vocale
 * et le montage du film en 4K (Media3).
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final String UA = "CineGenesis/2 (Android)";
    private static final int BG = 0xFF050508;
    private static final int REQ_FILE = 41;
    private static final int REQ_PERM = 42;

    private WebView web;
    private FrameLayout root;
    private boolean pageReady;
    /** Encarts système en dp : haut, droite, bas, gauche, clavier. */
    private final float[] insets = new float[5];
    private ValueCallback<Uri[]> fileCallback;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private OnBackInvokedCallback backCallback;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newFixedThreadPool(6);
    /** Réponses en attente de lecture par JavaScript (identifiant → JSON). */
    private final Map<String, String> results = new ConcurrentHashMap<>();
    private final Map<String, HttpURLConnection> running = new ConcurrentHashMap<>();

    private TextToSpeech tts;
    private boolean ttsReady;
    private String pendingSpeech;
    private String pendingLang;
    private FilmExporter exporter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        setupEdgeToEdge(window);
        window.getDecorView().setBackgroundColor(BG);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new Bridge(), "CGNative");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new Chrome());
        web.setOnApplyWindowInsetsListener((v, wi) -> {
            readInsets(wi);
            return wi;
        });

        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        exporter = new FilmExporter(this, io, main);
        registerBack();
        web.loadUrl(START_URL);
    }

    /* ------------------------------------------------------------------ */
    /* Fenêtre bord à bord et encarts système                              */
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
    private void readInsets(WindowInsets wi) {
        int t, r, b, l, kb;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets i = wi.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets ime = wi.getInsets(WindowInsets.Type.ime());
            t = i.top;
            r = i.right;
            b = i.bottom;
            l = i.left;
            kb = Math.max(0, ime.bottom - i.bottom);
        } else {
            t = wi.getSystemWindowInsetTop();
            r = wi.getSystemWindowInsetRight();
            l = wi.getSystemWindowInsetLeft();
            int stable = wi.getStableInsetBottom();
            b = Math.min(wi.getSystemWindowInsetBottom(), stable);
            kb = Math.max(0, wi.getSystemWindowInsetBottom() - stable);
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cut = wi.getDisplayCutout();
                if (cut != null) {
                    t = Math.max(t, cut.getSafeInsetTop());
                    r = Math.max(r, cut.getSafeInsetRight());
                    l = Math.max(l, cut.getSafeInsetLeft());
                }
            }
        }
        float d = getResources().getDisplayMetrics().density;
        insets[0] = t / d;
        insets[1] = r / d;
        insets[2] = b / d;
        insets[3] = l / d;
        insets[4] = kb / d;
        pushInsets();
    }

    private String insetsJson() {
        return String.format(Locale.US, "{\"top\":%.1f,\"right\":%.1f,\"bottom\":%.1f,\"left\":%.1f,\"kb\":%.1f}",
                insets[0], insets[1], insets[2], insets[3], insets[4]);
    }

    private void pushInsets() {
        js("window.cgInsets&&cgInsets(" + insetsJson() + ")");
    }

    /** Exécute du JavaScript dans la page (depuis n'importe quel fil). */
    void js(final String code) {
        main.post(() -> {
            if (web != null && pageReady) web.evaluateJavascript(code, null);
        });
    }

    /** Dépose un résultat et prévient la page, qui le lit avec CGNative.take(id). */
    void deliver(String id, JSONObject result) {
        if (id == null || id.isEmpty()) return;
        results.put(id, result.toString());
        js("window.__cg&&__cg('" + id.replaceAll("[^A-Za-z0-9_-]", "") + "')");
    }

    static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
        } catch (JSONException ignored) {
            // clés toujours valides
        }
        return o;
    }

    /* ------------------------------------------------------------------ */
    /* Bouton retour                                                       */
    /* ------------------------------------------------------------------ */

    private void registerBack() {
        if (Build.VERSION.SDK_INT < 33) return;
        backCallback = this::handleBack;
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
    }

    private void handleBack() {
        if (customView != null) {
            hideCustomView();
            return;
        }
        if (web == null || !pageReady) {
            moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript("window.cgBack?cgBack():false", result -> {
            // Rien à fermer : on passe l'application en arrière-plan sans la tuer,
            // pour que les générations en cours continuent.
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    /* ------------------------------------------------------------------ */
    /* Cycle de vie                                                        */
    /* ------------------------------------------------------------------ */

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            js("window.cgResume&&cgResume()");
        }
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (exporter != null) exporter.cancel();
        if (tts != null) {
            tts.shutdown();
            tts = null;
        }
        for (HttpURLConnection c : running.values()) c.disconnect();
        io.shutdownNow();
        if (web != null) {
            web.removeJavascriptInterface("CGNative");
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Sélection de fichiers (photos de référence, import de projet)       */
    /* ------------------------------------------------------------------ */

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback == null) return;
            Uri[] picked = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                    int n = data.getClipData().getItemCount();
                    picked = new Uri[n];
                    for (int i = 0; i < n; i++) picked[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    picked = new Uri[] {data.getData()};
                }
            }
            fileCallback.onReceiveValue(picked);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERM) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            js("window.cgPermission&&cgPermission(" + ok + ")");
        }
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        web.setVisibility(View.VISIBLE);
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
    }

    private final class Chrome extends WebChromeClient {
        @Override
        @SuppressWarnings("deprecation")
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent;
            try {
                intent = params.createIntent();
            } catch (Exception e) {
                intent = new Intent(Intent.ACTION_GET_CONTENT).setType("*/*");
            }
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(Intent.createChooser(intent, getString(R.string.pick_image)), REQ_FILE);
            } catch (Exception e) {
                fileCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customCallback = callback;
            view.setBackgroundColor(Color.BLACK);
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.INVISIBLE);
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
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
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
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
            // Les images et vidéos générées (CDN https) sont chargées normalement.
            if (!HOST.equals(uri.getHost())) return null;
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
            // Le moteur de rendu a été arrêté (mémoire) : on reconstruit l'activité.
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

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // aucune application pour ouvrir ce lien
        }
    }

    /* ------------------------------------------------------------------ */
    /* Réseau                                                              */
    /* ------------------------------------------------------------------ */

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    /** Ouvre une URL http(s) ou data: et renvoie son contenu. */
    static InputStream openStream(String url, Map<String, HttpURLConnection> track, String id) throws IOException {
        if (url.startsWith("data:")) {
            int comma = url.indexOf(',');
            if (comma < 0) throw new IOException("data URI invalide");
            byte[] bytes = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
            return new ByteArrayInputStream(bytes);
        }
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(30000);
        c.setReadTimeout(120000);
        c.setRequestProperty("User-Agent", UA);
        if (track != null && id != null) track.put(id, c);
        int code = c.getResponseCode();
        if (code >= 400) {
            c.disconnect();
            throw new IOException("HTTP " + code);
        }
        return c.getInputStream();
    }

    private void http(String id, String method, String url, String headersJson, String body, String mode) {
        io.execute(() -> {
            JSONObject res = new JSONObject();
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                running.put(id, c);
                c.setConnectTimeout(30000);
                c.setReadTimeout(300000);
                c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
                c.setRequestProperty("User-Agent", UA);
                if (headersJson != null && !headersJson.isEmpty()) {
                    JSONObject h = new JSONObject(headersJson);
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                        String k = it.next();
                        c.setRequestProperty(k, h.getString(k));
                    }
                }
                if (body != null && !"GET".equals(method)) {
                    byte[] b = body.getBytes(StandardCharsets.UTF_8);
                    c.setDoOutput(true);
                    c.setFixedLengthStreamingMode(b.length);
                    try (OutputStream os = c.getOutputStream()) {
                        os.write(b);
                    }
                }
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                byte[] data = in == null ? new byte[0] : readAll(in);
                res.put("status", code);
                JSONObject rh = new JSONObject();
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                    if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty()) {
                        rh.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue().get(0));
                    }
                }
                res.put("headers", rh);
                if ("base64".equals(mode)) {
                    res.put("body", Base64.encodeToString(data, Base64.NO_WRAP));
                    res.put("type", String.valueOf(c.getContentType()));
                } else {
                    res.put("body", new String(data, StandardCharsets.UTF_8));
                }
            } catch (Exception e) {
                res = obj("status", 0, "error", String.valueOf(e.getMessage()));
            } finally {
                running.remove(id);
                if (c != null) c.disconnect();
            }
            deliver(id, res);
        });
    }

    /** Télécharge une image et la renvoie en data URI JPEG réduite (miniatures, références). */
    private void imageData(String id, String url, int maxSide) {
        io.execute(() -> {
            JSONObject res;
            try (InputStream in = openStream(url, running, id)) {
                byte[] data = readAll(in);
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(data, 0, data.length, o);
                if (o.outWidth <= 0) throw new IOException("image illisible");
                int w = o.outWidth, h = o.outHeight, sample = 1;
                while (Math.max(w, h) / (sample * 2) >= maxSide) sample *= 2;
                BitmapFactory.Options d = new BitmapFactory.Options();
                d.inSampleSize = sample;
                Bitmap bmp = BitmapFactory.decodeByteArray(data, 0, data.length, d);
                if (bmp == null) throw new IOException("image illisible");
                float scale = Math.min(1f, (float) maxSide / Math.max(bmp.getWidth(), bmp.getHeight()));
                if (scale < 1f) {
                    Bitmap s = Bitmap.createScaledBitmap(bmp, Math.round(bmp.getWidth() * scale), Math.round(bmp.getHeight() * scale), true);
                    if (s != bmp) bmp.recycle();
                    bmp = s;
                }
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.JPEG, 90, bos);
                bmp.recycle();
                res = obj("status", 200, "body", "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP),
                        "w", w, "h", h);
            } catch (Exception e) {
                res = obj("status", 0, "error", String.valueOf(e.getMessage()));
            } finally {
                running.remove(id);
            }
            deliver(id, res);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Galerie : enregistrement, partage, ouverture                        */
    /* ------------------------------------------------------------------ */

    private boolean needsLegacyPermission() {
        return Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED;
    }

    private void askLegacyPermission() {
        main.post(() -> requestPermissions(new String[] {Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM));
    }

    static String guessExt(String kind, String mime) {
        if ("video".equals(kind)) return ".mp4";
        if (mime != null && mime.contains("png")) return ".png";
        if (mime != null && mime.contains("webp")) return ".webp";
        return ".jpg";
    }

    /**
     * Copie un flux dans la galerie (Images ou Films, dossier « CineGenesis »)
     * et renvoie l'URI content:// créée.
     */
    @SuppressWarnings("deprecation")
    Uri publish(InputStream in, String kind, String name, String mime) throws IOException {
        ContentResolver cr = getContentResolver();
        boolean video = "video".equals(kind);
        boolean doc = "doc".equals(kind);
        String dir = video ? Environment.DIRECTORY_MOVIES : doc ? Environment.DIRECTORY_DOWNLOADS : Environment.DIRECTORY_PICTURES;
        if (Build.VERSION.SDK_INT >= 29) {
            Uri collection = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    : doc ? MediaStore.Downloads.EXTERNAL_CONTENT_URI
                    : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, dir + "/CineGenesis");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = cr.insert(collection, v);
            if (uri == null) throw new IOException("insertion refusée");
            try (OutputStream os = cr.openOutputStream(uri)) {
                if (os == null) throw new IOException("écriture impossible");
                copy(in, os);
            } catch (IOException e) {
                cr.delete(uri, null, null);
                throw e;
            }
            v.clear();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, v, null, null);
            return uri;
        }
        File folder = new File(Environment.getExternalStoragePublicDirectory(dir), "CineGenesis");
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("dossier inaccessible");
        File out = new File(folder, name);
        try (OutputStream os = new FileOutputStream(out)) {
            copy(in, os);
        }
        if (doc) return Uri.fromFile(out);
        Uri collection = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DATA, out.getAbsolutePath());
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        Uri uri = cr.insert(collection, v);
        return uri != null ? uri : Uri.fromFile(out);
    }

    static void copy(InputStream in, OutputStream os) throws IOException {
        byte[] buf = new byte[256 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
    }

    private void saveMedia(String id, String url, String kind, String name, boolean share) {
        if (needsLegacyPermission()) {
            askLegacyPermission();
            deliver(id, obj("status", 0, "error", "permission"));
            return;
        }
        io.execute(() -> {
            JSONObject res;
            try {
                String mime;
                if (url.startsWith("data:")) {
                    int semi = url.indexOf(';');
                    mime = semi > 5 ? url.substring(5, semi) : "image/jpeg";
                } else if ("video".equals(kind)) {
                    mime = "video/mp4";
                } else {
                    String p = url.toLowerCase(Locale.ROOT);
                    mime = p.contains(".png") ? "image/png" : p.contains(".webp") ? "image/webp" : "image/jpeg";
                }
                String file = (name == null || name.isEmpty() ? "CineGenesis_" + System.currentTimeMillis() : name)
                        .replaceAll("[\\\\/:*?\"<>|]", "_") + guessExt(kind, mime);
                Uri uri;
                if (url.startsWith("content:") || url.startsWith("file:")) {
                    try (InputStream in = getContentResolver().openInputStream(Uri.parse(url))) {
                        if (in == null) throw new IOException("lecture impossible");
                        uri = publish(in, kind, file, mime);
                    }
                } else {
                    try (InputStream in = openStream(url, running, id)) {
                        uri = publish(in, kind, file, mime);
                    }
                }
                if (share) share(uri, mime);
                res = obj("status", 200, "uri", uri.toString(), "name", file);
            } catch (Exception e) {
                res = obj("status", 0, "error", String.valueOf(e.getMessage()));
            } finally {
                running.remove(id);
            }
            deliver(id, res);
        });
    }

    private void saveText(String id, String name, String mime, String text) {
        if (needsLegacyPermission()) {
            askLegacyPermission();
            deliver(id, obj("status", 0, "error", "permission"));
            return;
        }
        io.execute(() -> {
            JSONObject res;
            try {
                Uri uri = publish(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), "doc",
                        name.replaceAll("[\\\\/:*?\"<>|]", "_"), mime);
                res = obj("status", 200, "uri", uri.toString());
            } catch (Exception e) {
                res = obj("status", 0, "error", String.valueOf(e.getMessage()));
            }
            deliver(id, res);
        });
    }

    void share(Uri uri, String mime) {
        main.post(() -> {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                startActivity(Intent.createChooser(send, getString(R.string.share_title)));
            } catch (Exception ignored) {
                // aucune application de partage
            }
        });
    }

    private void openUri(String uri, String mime) {
        main.post(() -> {
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(Uri.parse(uri), mime);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                startActivity(view);
            } catch (Exception ignored) {
                // aucun lecteur disponible
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Synthèse vocale (animatic)                                          */
    /* ------------------------------------------------------------------ */

    private void speak(String text, String lang) {
        main.post(() -> {
            if (tts == null) {
                pendingSpeech = text;
                pendingLang = lang;
                tts = new TextToSpeech(this, status -> {
                    ttsReady = status == TextToSpeech.SUCCESS;
                    if (ttsReady && pendingSpeech != null) say(pendingSpeech, pendingLang);
                    pendingSpeech = null;
                });
                return;
            }
            if (ttsReady) say(text, lang);
        });
    }

    private void say(String text, String lang) {
        try {
            tts.setLanguage(Locale.forLanguageTag(lang == null || lang.isEmpty() ? "fr-FR" : lang));
        } catch (Exception ignored) {
            // langue indisponible : voix par défaut
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "cg");
    }

    /* ------------------------------------------------------------------ */
    /* Pont JavaScript                                                     */
    /* ------------------------------------------------------------------ */

    private final class Bridge {
        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }

        @JavascriptInterface
        public String getInsets() {
            return insetsJson();
        }

        @JavascriptInterface
        public String take(String id) {
            String r = results.remove(id);
            return r == null ? "{\"status\":0,\"error\":\"réponse perdue\"}" : r;
        }

        @JavascriptInterface
        public void http(String id, String method, String url, String headers, String body, String mode) {
            MainActivity.this.http(id, method, url, headers, body, mode);
        }

        @JavascriptInterface
        public void abort(String id) {
            HttpURLConnection c = running.remove(id);
            if (c != null) io.execute(c::disconnect);
        }

        @JavascriptInterface
        public void imageData(String id, String url, int maxSide) {
            MainActivity.this.imageData(id, url, Math.max(64, Math.min(maxSide, 4096)));
        }

        @JavascriptInterface
        public void saveMedia(String id, String url, String kind, String name, boolean share) {
            MainActivity.this.saveMedia(id, url, kind, name, share);
        }

        @JavascriptInterface
        public void saveText(String id, String name, String mime, String text) {
            MainActivity.this.saveText(id, name, mime, text);
        }

        @JavascriptInterface
        public void openUri(String uri, String mime) {
            MainActivity.this.openUri(uri, mime);
        }

        @JavascriptInterface
        public void shareUri(String uri, String mime) {
            share(Uri.parse(uri), mime);
        }

        @JavascriptInterface
        public void openUrl(String url) {
            main.post(() -> openExternal(Uri.parse(url)));
        }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            main.post(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void speak(String text, String lang) {
            MainActivity.this.speak(text, lang);
        }

        @JavascriptInterface
        public void stopSpeak() {
            main.post(() -> {
                if (tts != null) tts.stop();
            });
        }

        @JavascriptInterface
        public void haptic(String kind) {
            main.post(() -> {
                if (web == null) return;
                int c;
                switch (kind == null ? "" : kind) {
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
                        c = HapticFeedbackConstants.KEYBOARD_TAP;
                }
                web.performHapticFeedback(c);
            });
        }

        @JavascriptInterface
        public String deviceInfo() {
            return FilmExporter.deviceInfo().toString();
        }

        @JavascriptInterface
        public void exportFilm(String id, String request) {
            main.post(() -> {
                try {
                    exporter.start(id, new JSONObject(request));
                } catch (JSONException e) {
                    deliver(id, obj("state", "error", "error", "requête invalide"));
                }
            });
        }

        @JavascriptInterface
        public void cancelExport() {
            main.post(() -> exporter.cancel());
        }

        @JavascriptInterface
        public void clearCache() {
            io.execute(() -> FilmExporter.clearClips(MainActivity.this));
        }
    }

    /* Utilisé par l'export : lecture d'un fichier local. */
    static InputStream fileStream(File f) throws IOException {
        return new FileInputStream(f);
    }
}
