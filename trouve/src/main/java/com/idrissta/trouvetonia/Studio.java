package com.idrissta.trouvetonia;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Outils natifs du studio : appels aux générateurs gratuits (sans contrainte CORS), fichiers
 * temporaires servis à la page en même origine, voix off française, enregistrement dans la
 * galerie et partage. Chaque opération longue répond par {@link Reponse}.
 */
final class Studio {

    /** Réponse asynchrone transmise à la page : identifiant de la demande et objet JSON. */
    interface Reponse {
        void envoyer(int id, JSONObject resultat);
    }

    /** Services de génération gratuits joignables par le studio (suffixes de nom d'hôte). */
    private static final String[] HOTES = {
            "pollinations.ai", "aihorde.net", "hf.space", "huggingface.co",
            "r2.cloudflarestorage.com", "r2.dev",
    };
    private static final int MAX_TEXTE = 4 * 1024 * 1024;
    private static final long MAX_FICHIER = 200L * 1024 * 1024;
    private static final String ALBUM = "Trouve ton IA";

    private final Activity activite;
    private final Reponse reponse;
    private final File dossier;
    private final ExecutorService taches = Executors.newFixedThreadPool(4);
    private final Map<String, OutputStream> ecritures = new HashMap<>();

    private TextToSpeech tts;
    private int etatTts; // 0 : pas démarré, 1 : en cours, 2 : prêt, -1 : indisponible
    private final List<Runnable> enAttenteTts = new ArrayList<>();
    private final Map<String, Integer> voixEnCours = new HashMap<>();
    private final Map<String, String> nomsVoix = new HashMap<>();
    private Runnable enregistrementEnAttente;
    private int idEnAttente;

    Studio(Activity activite, Reponse reponse) {
        this.activite = activite;
        this.reponse = reponse;
        this.dossier = new File(activite.getCacheDir(), "studio");
        //noinspection ResultOfMethodCallIgnored
        dossier.mkdirs();
        taches.execute(this::nettoyer);
    }

    /* ------------------------------------------------------------------ */
    /* Réseau                                                              */
    /* ------------------------------------------------------------------ */

    static boolean hoteAutorise(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return false;
        String h = uri.getHost().toLowerCase(Locale.ROOT);
        for (String s : HOTES) if (h.equals(s) || h.endsWith("." + s)) return true;
        return false;
    }

    private HttpURLConnection ouvrir(String url, String methode, String entetes, int delaiLecture) throws IOException, JSONException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(methode);
        c.setConnectTimeout(20000);
        c.setReadTimeout(delaiLecture);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "TrouveTonIA/1.0 (Android; github.com/Idrissta/ia-video)");
        if (entetes != null && !entetes.isEmpty()) {
            JSONObject h = new JSONObject(entetes);
            Iterator<String> it = h.keys();
            while (it.hasNext()) {
                String k = it.next();
                c.setRequestProperty(k, h.getString(k));
            }
        }
        return c;
    }

    private static JSONObject erreur(String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("code", 0);
            o.put("erreur", message == null ? "erreur" : message);
        } catch (JSONException ignored) {
            // impossible
        }
        return o;
    }

    /** Requête texte (JSON, flux d'événements Gradio…) : renvoie code, texte et quelques en-têtes. */
    void requete(final int id, final String methode, final String url, final String corps, final String entetes, final int delai) {
        if (!hoteAutorise(Uri.parse(url))) {
            reponse.envoyer(id, erreur("hôte non autorisé"));
            return;
        }
        taches.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = ouvrir(url, methode == null ? "GET" : methode, entetes, Math.max(10000, Math.min(delai, 900000)));
                if (corps != null && !corps.isEmpty()) {
                    c.setDoOutput(true);
                    if (c.getRequestProperty("Content-Type") == null) c.setRequestProperty("Content-Type", "application/json");
                    byte[] b = corps.getBytes(StandardCharsets.UTF_8);
                    c.setFixedLengthStreamingMode(b.length);
                    try (OutputStream o = c.getOutputStream()) {
                        o.write(b);
                    }
                }
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                String texte = in == null ? "" : lireTexte(in);
                JSONObject r = new JSONObject();
                r.put("code", code);
                r.put("texte", texte);
                r.put("type", c.getContentType());
                String retry = c.getHeaderField("Retry-After");
                if (retry != null) r.put("retry", retry);
                reponse.envoyer(id, r);
            } catch (Exception e) {
                reponse.envoyer(id, erreur(e.getClass().getSimpleName() + ": " + e.getMessage()));
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    private static String lireTexte(InputStream in) throws IOException {
        try (InputStream i = in) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = i.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_TEXTE) break;
            }
            return out.toString("UTF-8");
        }
    }

    /** Télécharge une image ou une vidéo générée dans le cache ; la page la lit ensuite via /cache/nom. */
    void telecharger(final int id, final String url, final String nom) {
        final File f = fichier(nom);
        if (f == null || !hoteAutorise(Uri.parse(url))) {
            reponse.envoyer(id, erreur("téléchargement refusé"));
            return;
        }
        taches.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = ouvrir(url, "GET", null, 180000);
                int code = c.getResponseCode();
                JSONObject r = new JSONObject();
                r.put("code", code);
                r.put("type", c.getContentType());
                String retry = c.getHeaderField("Retry-After");
                if (retry != null) r.put("retry", retry);
                if (code >= 400) {
                    InputStream e = c.getErrorStream();
                    r.put("texte", e == null ? "" : lireTexte(e));
                    reponse.envoyer(id, r);
                    return;
                }
                long total = 0;
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(f)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        total += n;
                        if (total > MAX_FICHIER) throw new IOException("fichier trop gros");
                    }
                }
                r.put("chemin", "/cache/" + f.getName());
                r.put("octets", total);
                reponse.envoyer(id, r);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                reponse.envoyer(id, erreur(e.getClass().getSimpleName() + ": " + e.getMessage()));
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Fichiers du cache (servis à la page en même origine)                */
    /* ------------------------------------------------------------------ */

    /** Fichier du cache pour un nom simple (lettres, chiffres, tirets, points), sinon null. */
    File fichier(String nom) {
        if (nom == null || !nom.matches("[A-Za-z0-9._-]{1,80}") || nom.startsWith(".")) return null;
        return new File(dossier, nom);
    }

    /** Supprime les fichiers de plus de deux jours (créations abandonnées). */
    private void nettoyer() {
        File[] l = dossier.listFiles();
        if (l == null) return;
        long limite = System.currentTimeMillis() - 2L * 24 * 3600 * 1000;
        for (File f : l) {
            //noinspection ResultOfMethodCallIgnored
            if (f.lastModified() < limite) f.delete();
        }
    }

    /** Reçoit un fichier de la page par morceaux en base64 (vidéo montée, image). */
    synchronized boolean ecrire(String nom, String base64, boolean debut) {
        File f = fichier(nom);
        if (f == null) return false;
        try {
            OutputStream o = ecritures.get(nom);
            if (debut || o == null) {
                if (o != null) o.close();
                o = new FileOutputStream(f, false);
                ecritures.put(nom, o);
            }
            if (base64 != null && !base64.isEmpty()) o.write(Base64.decode(base64, Base64.DEFAULT));
            if (f.length() > MAX_FICHIER) throw new IOException("fichier trop gros");
            return true;
        } catch (Exception e) {
            fermer(nom);
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            return false;
        }
    }

    private synchronized void fermer(String nom) {
        OutputStream o = ecritures.remove(nom);
        if (o == null) return;
        try {
            o.close();
        } catch (IOException ignored) {
            // déjà fermé
        }
    }

    /* ------------------------------------------------------------------ */
    /* Galerie et partage                                                  */
    /* ------------------------------------------------------------------ */

    /** Copie un fichier du cache dans la galerie (Films ou Images / Trouve ton IA). */
    void enregistrer(final int id, final String nom, final String type) {
        fermer(nom);
        final File f = fichier(nom);
        if (f == null || !f.exists()) {
            reponse.envoyer(id, erreur("fichier introuvable"));
            return;
        }
        final boolean video = type != null && type.startsWith("video/");
        if (Build.VERSION.SDK_INT < 29
                && activite.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            // Android 8 et 9 : il faut l'autorisation d'écrire dans le stockage partagé.
            enregistrementEnAttente = () -> enregistrer(id, nom, type);
            idEnAttente = id;
            activite.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 7);
            return;
        }
        taches.execute(() -> {
            try {
                Uri uri = Build.VERSION.SDK_INT >= 29 ? copierMediaStore(f, type, video) : copierPublic(f, type, video);
                JSONObject r = new JSONObject();
                r.put("code", 200);
                r.put("uri", uri == null ? "" : uri.toString());
                reponse.envoyer(id, r);
            } catch (Exception e) {
                reponse.envoyer(id, erreur(e.getMessage()));
            }
        });
    }

    void autorisation(boolean accordee) {
        Runnable r = enregistrementEnAttente;
        enregistrementEnAttente = null;
        if (r != null && accordee) r.run();
        else if (r != null) reponse.envoyer(idEnAttente, erreur("autorisation refusée"));
    }

    private Uri copierMediaStore(File f, String type, boolean video) throws IOException {
        ContentResolver cr = activite.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, f.getName());
        v.put(MediaStore.MediaColumns.MIME_TYPE, type);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/" + ALBUM);
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri collection = video
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri uri = cr.insert(collection, v);
        if (uri == null) throw new IOException("galerie indisponible");
        try (InputStream in = new FileInputStream(f); OutputStream out = cr.openOutputStream(uri)) {
            if (out == null) throw new IOException("galerie indisponible");
            copier(in, out);
        } catch (IOException e) {
            cr.delete(uri, null, null);
            throw e;
        }
        v.clear();
        v.put(MediaStore.MediaColumns.IS_PENDING, 0);
        cr.update(uri, v, null, null);
        return uri;
    }

    @SuppressWarnings("deprecation")
    private Uri copierPublic(File f, String type, boolean video) throws Exception {
        File base = Environment.getExternalStoragePublicDirectory(video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES);
        File album = new File(base, ALBUM);
        if (!album.isDirectory() && !album.mkdirs()) throw new IOException("dossier impossible à créer");
        File dest = new File(album, f.getName());
        try (InputStream in = new FileInputStream(f); OutputStream out = new FileOutputStream(dest)) {
            copier(in, out);
        }
        final Uri[] res = new Uri[1];
        final Object verrou = new Object();
        MediaScannerConnection.scanFile(activite, new String[]{dest.getAbsolutePath()}, new String[]{type}, (p, uri) -> {
            synchronized (verrou) {
                res[0] = uri;
                verrou.notifyAll();
            }
        });
        synchronized (verrou) {
            if (res[0] == null) verrou.wait(8000);
        }
        return res[0];
    }

    private static void copier(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    static boolean uriMedia(Uri uri) {
        return uri != null && "content".equals(uri.getScheme()) && "media".equals(uri.getAuthority());
    }

    void partager(String uri, String type, String texte) {
        Uri u = Uri.parse(uri);
        if (!uriMedia(u)) return;
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(type == null ? "video/*" : type);
        send.putExtra(Intent.EXTRA_STREAM, u);
        if (texte != null && !texte.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, texte);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activite.startActivity(Intent.createChooser(send, activite.getString(R.string.share_title)));
        } catch (Exception ignored) {
            // aucune application de partage
        }
    }

    void ouvrir(String uri, String type) {
        Uri u = Uri.parse(uri);
        if (!uriMedia(u)) return;
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(u, type == null ? "video/*" : type);
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activite.startActivity(view);
        } catch (Exception ignored) {
            // aucun lecteur
        }
    }

    /* ------------------------------------------------------------------ */
    /* Voix off (synthèse vocale d'Android, en français)                   */
    /* ------------------------------------------------------------------ */

    void voix(final int id, final String texte, final float vitesse, final float hauteur, final String nom) {
        final File f = fichier(nom);
        if (f == null || texte == null || texte.trim().isEmpty()) {
            reponse.envoyer(id, erreur("texte vide"));
            return;
        }
        activite.runOnUiThread(() -> {
            Runnable parler = () -> {
                if (etatTts < 0) {
                    reponse.envoyer(id, erreur("voix indisponible"));
                    return;
                }
                tts.setSpeechRate(Math.max(0.5f, Math.min(vitesse, 2f)));
                tts.setPitch(Math.max(0.5f, Math.min(hauteur, 2f)));
                String uid = "v" + id;
                voixEnCours.put(uid, id);
                nomsVoix.put(uid, f.getName());
                Bundle p = new Bundle();
                p.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, uid);
                int r = tts.synthesizeToFile(texte, p, f, uid);
                if (r != TextToSpeech.SUCCESS) {
                    voixEnCours.remove(uid);
                    nomsVoix.remove(uid);
                    reponse.envoyer(id, erreur("synthèse refusée"));
                }
            };
            if (etatTts == 2 || etatTts < 0) {
                parler.run();
                return;
            }
            enAttenteTts.add(parler);
            if (etatTts == 0) demarrerTts();
        });
    }

    private void demarrerTts() {
        etatTts = 1;
        tts = new TextToSpeech(activite, statut -> activite.runOnUiThread(() -> {
            if (statut == TextToSpeech.SUCCESS) {
                int l = tts.setLanguage(Locale.FRANCE);
                etatTts = (l == TextToSpeech.LANG_MISSING_DATA || l == TextToSpeech.LANG_NOT_SUPPORTED) ? -1 : 2;
            } else {
                etatTts = -1;
            }
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String uid) {
                    // rien
                }

                @Override
                public void onDone(String uid) {
                    finVoix(uid, true);
                }

                @Override
                @SuppressWarnings("deprecation")
                public void onError(String uid) {
                    finVoix(uid, false);
                }
            });
            for (Runnable r : enAttenteTts) r.run();
            enAttenteTts.clear();
        }));
    }

    private void finVoix(String uid, boolean ok) {
        activite.runOnUiThread(() -> {
            Integer id = voixEnCours.remove(uid);
            String nom = nomsVoix.remove(uid);
            if (id == null) return;
            if (!ok) {
                reponse.envoyer(id, erreur("synthèse échouée"));
                return;
            }
            JSONObject r = new JSONObject();
            try {
                r.put("code", 200);
                r.put("chemin", "/cache/" + nom);
            } catch (JSONException ignored) {
                // impossible
            }
            reponse.envoyer(id, r);
        });
    }

    void fin() {
        taches.shutdownNow();
        if (tts != null) {
            tts.shutdown();
            tts = null;
        }
        for (String nom : new ArrayList<>(ecritures.keySet())) fermer(nom);
    }
}
