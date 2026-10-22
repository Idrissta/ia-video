package com.idrissta.trouvetonia;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Navigateur intégré : le site d'une IA s'ouvre dans l'appli, avec une barre pour fermer,
 * recharger ou continuer dans le navigateur. Les connexions restent enregistrées (cookies),
 * on peut envoyer une photo au site et télécharger ses créations.
 */
public class NavigateurActivity extends Activity {

    static final String EXTRA_URL = "url";
    static final String EXTRA_SOMBRE = "sombre";
    private static final int CHOIX_FICHIER = 41;
    private static final int AUTORISATION_STOCKAGE = 42;
    private static final String ALBUM = "Trouve ton IA";
    private static final long MAX_FICHIER = 300L * 1024 * 1024;

    private WebView web;
    private FrameLayout racine;
    private TextView titre;
    private TextView adresse;
    private ProgressBar progres;
    private ValueCallback<Uri[]> choixFichier;
    private View pleinEcran;
    private WebChromeClient.CustomViewCallback finPleinEcran;
    private OnBackInvokedCallback retourCallback;
    private Runnable enAttenteAutorisation;
    private AlertDialog dialogueGoogle;
    /** Moment du dernier téléchargement de fichier créé dans la page (blob:), seul cas où le pont accepte un fichier. */
    private volatile long blobDemande;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra(EXTRA_URL);
        boolean sombre = getIntent().getBooleanExtra(EXTRA_SOMBRE, true);
        if (url == null || !estWeb(Uri.parse(url))) {
            finish();
            return;
        }
        int fond = sombre ? 0xFF0A0B14 : 0xFFF5F6FB;
        int surface = sombre ? 0xFF14152A : 0xFFFFFFFF;
        int texte = sombre ? 0xFFEEF0FF : 0xFF15163A;
        int texte2 = sombre ? 0xFF9A9DC4 : 0xFF5B5E85;
        barresSysteme(sombre);

        racine = new FrameLayout(this);
        racine.setBackgroundColor(surface);
        LinearLayout colonne = new LinearLayout(this);
        colonne.setOrientation(LinearLayout.VERTICAL);

        LinearLayout barre = new LinearLayout(this);
        barre.setOrientation(LinearLayout.HORIZONTAL);
        barre.setGravity(Gravity.CENTER_VERTICAL);
        barre.setBackgroundColor(surface);
        barre.setPadding(dp(4), 0, dp(4), 0);

        ImageButton fermer = bouton(R.drawable.ic_nav_fermer, "Fermer et revenir à l'appli", texte);
        fermer.setOnClickListener(v -> finish());
        barre.addView(fermer);

        LinearLayout textes = new LinearLayout(this);
        textes.setOrientation(LinearLayout.VERTICAL);
        textes.setPadding(dp(6), 0, dp(6), 0);
        titre = new TextView(this);
        titre.setTextColor(texte);
        titre.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15.5f);
        titre.setTypeface(Typeface.DEFAULT_BOLD);
        titre.setSingleLine(true);
        titre.setEllipsize(TextUtils.TruncateAt.END);
        adresse = new TextView(this);
        adresse.setTextColor(texte2);
        adresse.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f);
        adresse.setSingleLine(true);
        adresse.setEllipsize(TextUtils.TruncateAt.END);
        textes.addView(titre);
        textes.addView(adresse);
        barre.addView(textes, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        ImageButton recharger = bouton(R.drawable.ic_nav_recharger, "Recharger", texte);
        recharger.setOnClickListener(v -> web.reload());
        barre.addView(recharger);
        ImageButton dehors = bouton(R.drawable.ic_nav_externe, "Ouvrir dans le navigateur", texte);
        dehors.setOnClickListener(v -> ouvrirDehors(web.getUrl()));
        barre.addView(dehors);
        colonne.addView(barre, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        progres = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progres.setMax(100);
        progres.setIndeterminate(false);
        progres.setProgressTintList(ColorStateList.valueOf(0xFF8B7BFF));
        progres.setProgressBackgroundTintList(ColorStateList.valueOf(fond));
        colonne.addView(progres, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        web = new WebView(this);
        web.setBackgroundColor(fond);
        colonne.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        racine.addView(colonne);
        setContentView(racine);
        racine.setOnApplyWindowInsetsListener(this::encarts);

        configurer();
        titre.setText(hote(url));
        adresse.setText(hote(url));
        web.loadUrl(url);
        brancherRetour();
    }

    /* ------------------------------------------------------------------ */
    /* Fenêtre                                                             */
    /* ------------------------------------------------------------------ */

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private ImageButton bouton(int icone, String description, int couleur) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(icone);
        b.setImageTintList(ColorStateList.valueOf(couleur));
        b.setContentDescription(description);
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true);
        b.setBackgroundResource(tv.resourceId);
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(48)));
        return b;
    }

    @SuppressWarnings("deprecation")
    private void barresSysteme(boolean sombre) {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(sombre ? 0 : mask, mask);
            }
        } else {
            int f = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (!sombre) f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            w.getDecorView().setSystemUiVisibility(f);
        }
    }

    // Laisse la place aux barres système et au clavier.
    @SuppressWarnings("deprecation")
    private WindowInsets encarts(View v, WindowInsets wi) {
        int l, t, r, b;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets i = wi.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets k = wi.getInsets(WindowInsets.Type.ime());
            l = i.left;
            t = i.top;
            r = i.right;
            b = Math.max(i.bottom, k.bottom);
        } else {
            l = wi.getSystemWindowInsetLeft();
            t = wi.getSystemWindowInsetTop();
            r = wi.getSystemWindowInsetRight();
            b = wi.getSystemWindowInsetBottom();
        }
        v.setPadding(l, t, r, b);
        return wi;
    }

    private static boolean estWeb(Uri u) {
        return u != null && ("https".equalsIgnoreCase(u.getScheme()) || "http".equalsIgnoreCase(u.getScheme()));
    }

    private static String hote(String url) {
        if (url == null) return "";
        String h = Uri.parse(url).getHost();
        if (h == null) return url;
        return h.startsWith("www.") ? h.substring(4) : h;
    }

    /* ------------------------------------------------------------------ */
    /* WebView                                                             */
    /* ------------------------------------------------------------------ */

    private void configurer() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Les liens « nouvel onglet » s'ouvrent dans la même page.
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(this::telecharger);
        web.addJavascriptInterface(new Pont(), "TrouveTelechargement");
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (estWeb(u)) {
                if (req.isForMainFrame() && "accounts.google.com".equalsIgnoreCase(u.getHost())) {
                    proposerChrome();
                    return true;
                }
                return false;
            }
            if (!req.isForMainFrame()) return true;
            // Liens vers une autre appli (intent:, market:, mailto:…) : seulement après un toucher.
            if (req.hasGesture()) ouvrirAutreAppli(u.toString());
            else {
                String repli = repli(u.toString());
                if (repli != null) view.loadUrl(repli);
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            adresse.setText(hote(url));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            adresse.setText(hote(url));
            CookieManager.getInstance().flush();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (web == view) {
                racine.removeAllViews();
                view.destroy();
                web = null;
            }
            finish();
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            progres.setProgress(p);
            progres.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE);
        }

        @Override
        public void onReceivedTitle(WebView view, String t) {
            titre.setText(t == null || t.trim().isEmpty() ? hote(view.getUrl()) : t);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> retour, FileChooserParams params) {
            if (choixFichier != null) choixFichier.onReceiveValue(null);
            choixFichier = retour;
            try {
                Intent i = params.createIntent();
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                startActivityForResult(Intent.createChooser(i, "Choisir un fichier"), CHOIX_FICHIER);
                return true;
            } catch (Exception e) {
                choixFichier = null;
                return false;
            }
        }

        @Override
        public void onShowCustomView(View vue, CustomViewCallback fin) {
            if (pleinEcran != null) {
                fin.onCustomViewHidden();
                return;
            }
            pleinEcran = vue;
            finPleinEcran = fin;
            vue.setBackgroundColor(0xFF000000);
            racine.addView(vue, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        @Override
        public void onHideCustomView() {
            quitterPleinEcran();
        }

        @Override
        public void onPermissionRequest(PermissionRequest r) {
            // Caméra et micro ne sont pas accessibles aux sites.
            r.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
            cb.invoke(origin, false, false);
        }
    }

    private void quitterPleinEcran() {
        if (pleinEcran == null) return;
        racine.removeView(pleinEcran);
        pleinEcran = null;
        if (finPleinEcran != null) finPleinEcran.onCustomViewHidden();
        finPleinEcran = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != CHOIX_FICHIER || choixFichier == null) return;
        Uri[] res = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                List<Uri> l = new ArrayList<>();
                for (int i = 0; i < data.getClipData().getItemCount(); i++) l.add(data.getClipData().getItemAt(i).getUri());
                res = l.toArray(new Uri[0]);
            } else {
                res = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
        }
        choixFichier.onReceiveValue(res);
        choixFichier = null;
    }

    /* ------------------------------------------------------------------ */
    /* Liens vers l'extérieur                                              */
    /* ------------------------------------------------------------------ */

    private void ouvrirDehors(String url) {
        if (url == null || !estWeb(Uri.parse(url))) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Aucun navigateur installé", Toast.LENGTH_SHORT).show();
        }
    }

    // Google n'autorise pas la connexion à un compte Google dans le navigateur d'une autre appli.
    private void proposerChrome() {
        if (dialogueGoogle != null && dialogueGoogle.isShowing()) return;
        dialogueGoogle = new AlertDialog.Builder(this)
                .setTitle("Connexion avec Google")
                .setMessage("Google n'autorise pas la connexion à un compte Google à l'intérieur d'une autre appli.\n\n"
                        + "Choisis plutôt « Continuer avec un e-mail » sur ce site : tu resteras connecté dans l'appli.\n\n"
                        + "Ou continue dans ton navigateur, puis reviens ensuite à l'appli.")
                .setPositiveButton("Utiliser un e-mail", null)
                .setNegativeButton("Ouvrir le navigateur", (d, w) -> ouvrirDehors(web.getUrl()))
                .create();
        dialogueGoogle.show();
    }

    private void ouvrirAutreAppli(String url) {
        try {
            Intent i;
            if (url.startsWith("intent:")) {
                i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } else {
                i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            }
            startActivity(i);
        } catch (Exception e) {
            String r = repli(url);
            if (r != null) web.loadUrl(r);
        }
    }

    private static String repli(String url) {
        if (!url.startsWith("intent:")) return null;
        try {
            String r = Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url");
            return r != null && estWeb(Uri.parse(r)) ? r : null;
        } catch (Exception e) {
            return null;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Téléchargements                                                     */
    /* ------------------------------------------------------------------ */

    private boolean stockageAutorise(Runnable ensuite) {
        if (Build.VERSION.SDK_INT >= 29
                || checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
            return true;
        }
        enAttenteAutorisation = ensuite;
        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, AUTORISATION_STOCKAGE);
        return false;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != AUTORISATION_STOCKAGE) return;
        Runnable r = enAttenteAutorisation;
        enAttenteAutorisation = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED && r != null) r.run();
        else Toast.makeText(this, "Sans autorisation, le fichier ne peut pas être enregistré", Toast.LENGTH_LONG).show();
    }

    private void telecharger(String url, String agent, String disposition, String mime, long taille) {
        if (url == null) return;
        String nom = URLUtil.guessFileName(url, disposition, mime);
        if (url.startsWith("blob:")) {
            // Fichier fabriqué par la page : la page le relit et le transmet en base64.
            blobDemande = SystemClock.elapsedRealtime();
            String js = "(function(){fetch(" + JSONObject.quote(url) + ").then(function(r){return r.blob()}).then(function(b){"
                    + "var f=new FileReader();f.onload=function(){TrouveTelechargement.fichier(f.result," + JSONObject.quote(nom) + ",b.type||"
                    + JSONObject.quote(mime == null ? "" : mime) + ")};f.readAsDataURL(b)}).catch(function(){TrouveTelechargement.echec()})})()";
            web.evaluateJavascript(js, null);
            Toast.makeText(this, "Téléchargement…", Toast.LENGTH_SHORT).show();
            return;
        }
        if (url.startsWith("data:")) {
            blobDemande = SystemClock.elapsedRealtime();
            new Pont().fichier(url, nom, mime);
            return;
        }
        if (!estWeb(Uri.parse(url))) return;
        if (!stockageAutorise(() -> telecharger(url, agent, disposition, mime, taille))) return;
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            if (mime != null) r.setMimeType(mime);
            String c = CookieManager.getInstance().getCookie(url);
            if (c != null) r.addRequestHeader("Cookie", c);
            if (agent != null) r.addRequestHeader("User-Agent", agent);
            r.setTitle(nom);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, ALBUM + "/" + nom);
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            dm.enqueue(r);
            Toast.makeText(this, "Téléchargement de « " + nom + " » dans Téléchargements › " + ALBUM, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Téléchargement impossible", Toast.LENGTH_SHORT).show();
        }
    }

    /** Reçoit les fichiers fabriqués par la page (blob: ou data:) après une demande de téléchargement. */
    private final class Pont {
        @JavascriptInterface
        public void fichier(final String dataUrl, final String nom, final String type) {
            // N'accepte un fichier que juste après un téléchargement demandé par l'utilisateur.
            if (blobDemande == 0 || SystemClock.elapsedRealtime() - blobDemande > 60000) return;
            blobDemande = 0;
            int virgule = dataUrl == null ? -1 : dataUrl.indexOf(',');
            if (virgule < 0 || !dataUrl.substring(0, virgule).contains(";base64")) {
                message("Téléchargement impossible");
                return;
            }
            try {
                byte[] octets = Base64.decode(dataUrl.substring(virgule + 1), Base64.DEFAULT);
                if (octets.length > MAX_FICHIER) throw new IOException("trop gros");
                String m = type == null || type.isEmpty() ? "application/octet-stream" : type;
                String n = URLUtil.guessFileName("x/" + (nom == null ? "fichier" : nom), null, m).replaceAll("[^A-Za-z0-9._ -]", "_");
                runOnUiThread(() -> {
                    if (stockageAutorise(() -> enregistrer(octets, n, m))) enregistrer(octets, n, m);
                });
            } catch (Exception e) {
                message("Téléchargement impossible");
            }
        }

        @JavascriptInterface
        public void echec() {
            message("Ce fichier ne peut pas être téléchargé dans l'appli : utilise le bouton « Ouvrir dans le navigateur ».");
        }
    }

    private void message(String m) {
        runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show());
    }

    @SuppressWarnings("deprecation")
    private void enregistrer(byte[] octets, String nom, String type) {
        new Thread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, nom);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + ALBUM);
                    Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("stockage indisponible");
                    try (OutputStream o = cr.openOutputStream(uri)) {
                        if (o == null) throw new IOException("stockage indisponible");
                        o.write(octets);
                    }
                } else {
                    File dossier = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), ALBUM);
                    if (!dossier.isDirectory() && !dossier.mkdirs()) throw new IOException("dossier impossible à créer");
                    try (OutputStream o = new FileOutputStream(new File(dossier, nom))) {
                        o.write(octets);
                    }
                }
                message("Enregistré dans Téléchargements › " + ALBUM + " : " + nom);
            } catch (Exception e) {
                message("Enregistrement impossible");
            }
        }).start();
    }

    /* ------------------------------------------------------------------ */
    /* Retour et cycle de vie                                              */
    /* ------------------------------------------------------------------ */

    private boolean reculer() {
        if (pleinEcran != null) {
            quitterPleinEcran();
            return true;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return false;
    }

    private void brancherRetour() {
        if (Build.VERSION.SDK_INT < 33) return;
        retourCallback = () -> {
            if (!reculer()) finish();
        };
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, retourCallback);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (!reculer()) super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (retourCallback != null && Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(retourCallback);
        }
        if (choixFichier != null) {
            choixFichier.onReceiveValue(null);
            choixFichier = null;
        }
        if (web != null) {
            web.removeJavascriptInterface("TrouveTelechargement");
            racine.removeAllViews();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
