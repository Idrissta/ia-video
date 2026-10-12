package com.idrissta.cinegenesis;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Log;
import android.util.Range;
import android.view.WindowManager;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;

/**
 * Montage natif du film : téléchargement des clips (cache local), assemblage
 * bout à bout avec Media3 Transformer, agrandissement GPU vers la 4K
 * ({@link UpscaleEffect}), encodage HEVC ou H.264 au débit demandé, puis
 * enregistrement dans la galerie (Films/CineGenesis).
 *
 * <p>Les méthodes publiques du paquet sont appelées sur le fil principal.
 * Chaque étape est signalée à la page par {@code deliver(id, json)} sous le
 * même identifiant, jusqu'à l'état final « done », « error » ou « cancelled ».
 */
@OptIn(markerClass = UnstableApi.class)
final class FilmExporter {

    private static final String TAG = "CineGenesis";
    /** Même code que MainActivity : la réponse déclenche cgPermission(ok) dans la page. */
    private static final int REQ_PERM = 42;
    /** Intervalle minimal entre deux événements, pour que la page lise chacun avant le suivant. */
    private static final long EVENT_GAP_MS = 180;
    private static final long POLL_MS = 500;
    private static final long DOWNLOAD_TICK_MS = 250;
    /** Taille maximale conservée dans le cache des clips. */
    private static final long CACHE_MAX_BYTES = 3L * 1024 * 1024 * 1024;
    private static final int UHD_LONG = 3840;
    private static final int UHD_SHORT = 2160;
    /** Fichiers utilisés par l'export en cours : jamais supprimés par le nettoyage du cache. */
    private static final Set<String> IN_USE = ConcurrentHashMap.newKeySet();
    private static volatile MediaCodecInfo[] encoderCache;
    private static volatile JSONObject deviceInfoCache;

    private final MainActivity act;
    private final ExecutorService io;
    private final Handler main;
    /** Export en cours (fil principal uniquement). */
    private Job job;

    FilmExporter(MainActivity act, ExecutorService io, Handler main) {
        this.act = act;
        this.io = io;
        this.main = main;
    }

    /* ------------------------------------------------------------------ */
    /* Modèle                                                              */
    /* ------------------------------------------------------------------ */

    /** Réglage d'encodage : type MIME, taille d'affichage et débit. */
    private static final class Plan {
        final String mime;
        final int width;
        final int height;
        final int bitrate;

        Plan(String mime, int width, int height, int bitrate) {
            this.mime = mime;
            this.width = width;
            this.height = height;
            this.bitrate = bitrate;
        }

        long area() {
            return (long) width * height;
        }

        String label() {
            return width + "×" + height + " " + (MimeTypes.VIDEO_H265.equals(mime) ? "HEVC" : "H.264");
        }
    }

    private static final class Job {
        final String id;
        final List<String> sources;
        final int width;
        final int height;
        final String codec;
        final int mbps;
        final float sharpen;
        final String fileName;
        final Map<String, HttpURLConnection> connections = new ConcurrentHashMap<>();
        final Set<String> files = ConcurrentHashMap.newKeySet();
        final ProgressHolder holder = new ProgressHolder();
        volatile boolean cancelled;

        // Fil principal uniquement.
        boolean finished;
        JSONObject pending;
        boolean flushQueued;
        long lastEmit;
        Runnable poller;
        Transformer transformer;
        int attempt;
        int lastProgress = -1;
        int planIndex;
        File out;

        // Écrits par la préparation (fil d'arrière-plan) avant le passage au fil principal.
        List<Uri> uris;
        List<Plan> plans;

        Job(String id, List<String> sources, int width, int height, String codec, int mbps, float sharpen, String fileName) {
            this.id = id;
            this.sources = sources;
            this.width = width;
            this.height = height;
            this.codec = codec;
            this.mbps = mbps;
            this.sharpen = sharpen;
            this.fileName = fileName;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Commandes (fil principal)                                           */
    /* ------------------------------------------------------------------ */

    void start(String id, JSONObject req) {
        if (job != null && !job.finished) {
            act.deliver(id, error("Un export est déjà en cours"));
            return;
        }
        if (Build.VERSION.SDK_INT < 29
                && act.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            act.requestPermissions(new String[] {Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
            act.deliver(id, error("Autorisez l'accès au stockage pour enregistrer le film, puis relancez l'export."));
            return;
        }
        List<String> sources = readClips(req.optJSONArray("clips"));
        if (sources.isEmpty()) {
            act.deliver(id, error("Aucun clip vidéo à exporter."));
            return;
        }
        int w = req.optInt("width", 0);
        int h = req.optInt("height", 0);
        if (w < 64 || h < 64) {
            // Taille absente ou incohérente : 4K UHD paysage.
            w = UHD_LONG;
            h = UHD_SHORT;
        }
        w = evenSize(w);
        h = evenSize(h);
        int mbps = Math.max(2, Math.min(200, req.optInt("mbps", 60)));
        double sh = req.optDouble("sharpen", 0.35);
        if (Double.isNaN(sh)) sh = 0.35;
        if (sh > 1) sh /= 100; // valeur transmise en pourcentage
        float sharpen = (float) Math.max(0, Math.min(1, sh));
        Job j = new Job(id, sources, w, h, normalizeCodec(req.optString("codec", "auto")), mbps, sharpen,
                fileName(req.optString("name", "")));
        j.poller = () -> poll(j);
        job = j;
        keepScreenOn(true);
        emit(j, downloadEvent(0, 0, sources.size()));
        try {
            io.execute(() -> prepare(j));
        } catch (RejectedExecutionException e) {
            finish(j, error("Export impossible : application en cours de fermeture."));
        }
    }

    void cancel() {
        Job j = job;
        if (j == null || j.finished) return;
        j.cancelled = true;
        // Coupe les téléchargements en cours (hors du fil principal : fermeture réseau).
        List<HttpURLConnection> open = new ArrayList<>(j.connections.values());
        if (!open.isEmpty()) {
            new Thread(() -> {
                for (HttpURLConnection c : open) c.disconnect();
            }, "cg-export-cancel").start();
        }
        Transformer t = j.transformer;
        j.transformer = null;
        if (t != null) {
            try {
                t.cancel();
            } catch (RuntimeException e) {
                Log.w(TAG, "annulation du rendu", e);
            }
        }
        File out = j.out;
        finish(j, MainActivity.obj("state", "cancelled"));
        if (out != null) deleteQuietly(out);
    }

    /* ------------------------------------------------------------------ */
    /* Événements vers la page (fil principal)                             */
    /* ------------------------------------------------------------------ */

    /** Progression : les événements rapprochés sont fusionnés, seul le plus récent part. */
    private void emit(Job j, JSONObject ev) {
        if (j.finished) return;
        j.pending = ev;
        if (j.flushQueued) return;
        j.flushQueued = true;
        long wait = Math.max(0, j.lastEmit + EVENT_GAP_MS - SystemClock.uptimeMillis());
        main.postDelayed(() -> flush(j), wait);
    }

    private void flush(Job j) {
        j.flushQueued = false;
        if (j.finished || j.pending == null) return;
        JSONObject ev = j.pending;
        j.pending = null;
        j.lastEmit = SystemClock.uptimeMillis();
        act.deliver(j.id, ev);
    }

    /** Depuis un fil d'arrière-plan. */
    private void postEvent(Job j, JSONObject ev) {
        main.post(() -> emit(j, ev));
    }

    private void postFinish(Job j, JSONObject ev) {
        main.post(() -> finish(j, ev));
    }

    /** État final : toujours remis, aucun événement ne le suit. */
    private void finish(Job j, JSONObject ev) {
        if (j.finished) return;
        j.finished = true;
        j.pending = null;
        main.removeCallbacks(j.poller);
        if (job == j) job = null;
        IN_USE.removeAll(j.files);
        keepScreenOn(false);
        if ("error".equals(ev.optString("state"))) Log.w(TAG, "export : " + ev.optString("error"));
        act.deliver(j.id, ev);
    }

    private void keepScreenOn(boolean on) {
        try {
            if (on) act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (RuntimeException ignored) {
            // fenêtre déjà détruite
        }
    }

    private static JSONObject error(String message) {
        return MainActivity.obj("state", "error", "error", message);
    }

    private static JSONObject downloadEvent(double fraction, int index, int count) {
        int pct = (int) Math.round(Math.max(0, Math.min(1, fraction)) * 100);
        return MainActivity.obj("state", "download", "progress", pct, "index", index, "count", count);
    }

    private static JSONObject renderEvent(int progress, Plan p) {
        return MainActivity.obj("state", "render", "progress", progress, "width", p.width, "height", p.height, "codec", p.mime);
    }

    /* ------------------------------------------------------------------ */
    /* Préparation : téléchargements, vérification des clips, réglages     */
    /* ------------------------------------------------------------------ */

    private void prepare(Job j) {
        try {
            cleanDir(exportDir(act));
            int count = j.sources.size();
            List<Uri> uris = new ArrayList<>(count);
            for (int i = 0; i < count; i++) {
                checkCancelled(j);
                uris.add(resolve(j, i, count));
            }
            postEvent(j, downloadEvent(1, count - 1, count));
            long totalMs = 0;
            for (int i = 0; i < count; i++) {
                checkCancelled(j);
                totalMs += inspect(i, uris.get(i));
            }
            checkCancelled(j);
            List<Plan> plans = plans(j.width, j.height, j.codec, j.mbps);
            checkSpace(plans.get(0), totalMs);
            j.uris = uris;
            j.plans = plans;
            main.post(() -> render(j));
        } catch (Exception e) {
            if (j.cancelled) {
                // Fichiers marqués après l'annulation : libérés pour le nettoyage du cache.
                IN_USE.removeAll(j.files);
                return;
            }
            Log.w(TAG, "préparation de l'export", e);
            String msg = e.getMessage();
            postFinish(j, error(msg == null || msg.isEmpty() ? "Préparation de l'export impossible." : msg));
        }
    }

    private static void checkCancelled(Job j) throws InterruptedIOException {
        if (j.cancelled) throw new InterruptedIOException("annulé");
    }

    /** Renvoie l'URI locale du clip, en le téléchargeant dans le cache si besoin. */
    private Uri resolve(Job j, int index, int count) throws IOException {
        String src = j.sources.get(index);
        String lower = src.toLowerCase(Locale.ROOT);
        if (lower.startsWith("content:") || lower.startsWith("file:")) return Uri.parse(src);
        if (src.startsWith("/")) return Uri.fromFile(new File(src));
        if (!lower.startsWith("http://") && !lower.startsWith("https://") && !lower.startsWith("data:")) {
            throw new IOException("Clip " + (index + 1) + " : adresse non prise en charge.");
        }
        File dir = clipsDir(act);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cache des clips inaccessible.");
        File file = new File(dir, hash(src) + ".mp4");
        use(j, file);
        if (file.isFile() && file.length() > 0) {
            // Déjà téléchargé lors d'un export précédent.
            file.setLastModified(System.currentTimeMillis());
            postEvent(j, downloadEvent((index + 1) / (double) count, index, count));
            return Uri.fromFile(file);
        }
        File part = new File(dir, file.getName() + ".part");
        use(j, part);
        try {
            download(j, src, part, index, count);
        } catch (IOException e) {
            if (j.cancelled) throw e;
            throw new IOException(downloadError(index, count, e), e);
        }
        if (!part.renameTo(file)) {
            deleteQuietly(part);
            throw new IOException("Cache des clips inaccessible.");
        }
        postEvent(j, downloadEvent((index + 1) / (double) count, index, count));
        return Uri.fromFile(file);
    }

    private void download(Job j, String url, File part, int index, int count) throws IOException {
        String key = j.id + "#" + index;
        long received = 0;
        long total = -1;
        try (InputStream in = MainActivity.openStream(url, j.connections, key);
             OutputStream os = new FileOutputStream(part)) {
            HttpURLConnection c = j.connections.get(key);
            if (c != null) total = c.getContentLengthLong();
            byte[] buf = new byte[256 * 1024];
            long lastTick = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                checkCancelled(j);
                os.write(buf, 0, n);
                received += n;
                long now = SystemClock.uptimeMillis();
                if (now - lastTick >= DOWNLOAD_TICK_MS) {
                    lastTick = now;
                    double frac = total > 0 ? Math.min(1, (double) received / total) : 0;
                    postEvent(j, downloadEvent((index + frac) / count, index, count));
                }
            }
            checkCancelled(j);
            if (total > 0 && received < total) throw new IOException("transfert interrompu");
            if (received == 0) throw new IOException("fichier vide");
        } catch (IOException | RuntimeException e) {
            deleteQuietly(part);
            if (e instanceof IOException) throw (IOException) e;
            throw new IOException(e.getMessage(), e);
        } finally {
            HttpURLConnection c = j.connections.remove(key);
            if (c != null) c.disconnect();
        }
    }

    private static String downloadError(int index, int count, IOException e) {
        String base = "Téléchargement du clip " + (index + 1) + "/" + count + " impossible";
        String m = e.getMessage() == null ? "" : e.getMessage();
        if (m.startsWith("HTTP 4")) return base + " (" + m + ") : le lien a peut-être expiré, régénérez cette vidéo.";
        if (m.startsWith("HTTP 5")) return base + " (" + m + ") : serveur indisponible, réessayez plus tard.";
        if (e instanceof UnknownHostException || e instanceof ConnectException || e instanceof SocketTimeoutException) {
            return base + " : vérifiez votre connexion Internet.";
        }
        return base + (m.isEmpty() ? "." : " : " + m);
    }

    /** Vérifie qu'un clip contient bien une piste vidéo et renvoie sa durée (ms, 0 si inconnue). */
    private long inspect(int index, Uri uri) throws IOException {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            if ("file".equals(uri.getScheme())) mmr.setDataSource(uri.getPath());
            else mmr.setDataSource(act, uri);
            String hasVideo = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO);
            String width = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            if (!"yes".equals(hasVideo) && width == null) throw new IOException("aucune piste vidéo");
            return Math.max(0, parseLong(mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)));
        } catch (IOException | RuntimeException e) {
            // Fichier du cache corrompu (page d'erreur, transfert tronqué) : oublié pour le prochain essai.
            if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
                File f = new File(uri.getPath());
                File parent = f.getParentFile();
                if (parent != null && parent.equals(clipsDir(act))) deleteQuietly(f);
            }
            throw new IOException("Le clip " + (index + 1) + " est illisible ou ne contient pas de vidéo.", e);
        } finally {
            releaseQuietly(mmr);
        }
    }

    /** Refuse de lancer un rendu de plusieurs minutes qui échouerait faute de place. */
    private void checkSpace(Plan p, long totalMs) throws IOException {
        if (totalMs <= 0) return;
        long estimate = (long) (p.bitrate / 8.0 * (totalMs / 1000.0) * 1.1) + 48L * 1024 * 1024;
        // Fichier temporaire + copie dans la galerie (même partition le plus souvent).
        long need = estimate * 2;
        long free = act.getCacheDir().getUsableSpace();
        if (free > 0 && free < need) {
            throw new IOException("Espace de stockage insuffisant : environ " + fmtBytes(need)
                    + " nécessaires, " + fmtBytes(free) + " disponibles.");
        }
    }

    /* ------------------------------------------------------------------ */
    /* Rendu Media3 (fil principal)                                        */
    /* ------------------------------------------------------------------ */

    private void render(Job j) {
        if (j.finished || j.cancelled) return;
        Plan p = j.plans.get(j.planIndex);
        File dir = exportDir(act);
        if (!dir.isDirectory() && !dir.mkdirs()) {
            finish(j, error("Dossier temporaire inaccessible."));
            return;
        }
        File out = new File(dir, "film_" + System.currentTimeMillis() + ".mp4");
        j.out = out;
        use(j, out);
        final int attempt = ++j.attempt;

        List<EditedMediaItem> items = new ArrayList<>(j.uris.size());
        for (Uri uri : j.uris) {
            items.add(new EditedMediaItem.Builder(MediaItem.fromUri(uri))
                    .setEffects(new Effects(Collections.emptyList(),
                            Collections.singletonList(new UpscaleEffect(p.width, p.height, j.sharpen))))
                    .build());
        }
        Composition composition = new Composition.Builder(new EditedMediaItemSequence.Builder(items).build())
                // Piste audio garantie : silence pour les clips muets.
                .experimentalSetForceAudioTrack(true)
                // Clips HDR éventuels ramenés en SDR pour pouvoir les enchaîner avec les autres.
                .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
                .build();
        try {
            Transformer t = new Transformer.Builder(act)
                    .setVideoMimeType(p.mime)
                    .setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .setEncoderFactory(new DefaultEncoderFactory.Builder(act)
                            .setRequestedVideoEncoderSettings(new VideoEncoderSettings.Builder().setBitrate(p.bitrate).build())
                            .setEnableFallback(true)
                            .build())
                    .addListener(new Transformer.Listener() {
                        @Override
                        public void onCompleted(Composition c, ExportResult result) {
                            if (j.attempt == attempt) completed(j, result);
                        }

                        @Override
                        public void onError(Composition c, ExportResult result, ExportException e) {
                            if (j.attempt == attempt) failed(j, e);
                        }
                    })
                    .build();
            j.transformer = t;
            j.lastProgress = 0;
            emit(j, renderEvent(0, p));
            t.start(composition, out.getAbsolutePath());
        } catch (RuntimeException e) {
            Log.w(TAG, "démarrage du rendu", e);
            j.transformer = null;
            deleteQuietly(out);
            finish(j, error("Impossible de démarrer le rendu : " + e.getMessage()));
            return;
        }
        main.removeCallbacks(j.poller);
        main.postDelayed(j.poller, POLL_MS);
    }

    private void poll(Job j) {
        Transformer t = j.transformer;
        if (j.finished || t == null) return;
        try {
            if (t.getProgress(j.holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                int pct = Math.max(0, Math.min(99, j.holder.progress));
                if (pct != j.lastProgress) {
                    j.lastProgress = pct;
                    emit(j, renderEvent(pct, j.plans.get(j.planIndex)));
                }
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "progression du rendu", e);
        }
        main.postDelayed(j.poller, POLL_MS);
    }

    private void completed(Job j, ExportResult result) {
        main.removeCallbacks(j.poller);
        j.transformer = null;
        File out = j.out;
        if (j.finished) {
            deleteQuietly(out);
            return;
        }
        Plan p = j.plans.get(j.planIndex);
        emit(j, MainActivity.obj("state", "save", "progress", 100));
        long durationMs = result.durationMs;
        try {
            io.execute(() -> save(j, p, out, durationMs));
        } catch (RejectedExecutionException e) {
            deleteQuietly(out);
            finish(j, error("Enregistrement impossible : application en cours de fermeture."));
        }
    }

    private void failed(Job j, ExportException e) {
        main.removeCallbacks(j.poller);
        j.transformer = null;
        deleteQuietly(j.out);
        if (j.finished) return;
        Log.w(TAG, "rendu " + j.plans.get(j.planIndex).label(), e);
        int next = nextPlan(j, e.errorCode);
        if (next >= 0) {
            // L'appareil refuse ce réglage : nouvel essai, plus léger.
            j.planIndex = next;
            Plan p = j.plans.get(next);
            JSONObject ev = renderEvent(0, p);
            try {
                ev.put("retry", true);
                ev.put("note", "Nouvel essai en " + p.label() + " : l'appareil a refusé le réglage précédent.");
            } catch (JSONException ignored) {
                // clés valides
            }
            emit(j, ev);
            main.postDelayed(() -> render(j), 400);
            return;
        }
        finish(j, error(describe(e)));
    }

    /** Réglage suivant à essayer après un échec, ou -1. */
    private static int nextPlan(Job j, int code) {
        boolean encoder = code == ExportException.ERROR_CODE_ENCODER_INIT_FAILED
                || code == ExportException.ERROR_CODE_ENCODING_FAILED
                || code == ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED;
        // Mémoire GPU ou ressources de décodage saturées : seule une taille inférieure peut aider.
        boolean resources = code == ExportException.ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED
                || code == ExportException.ERROR_CODE_DECODER_INIT_FAILED;
        if (!encoder && !resources) return -1;
        Plan cur = j.plans.get(j.planIndex);
        for (int i = j.planIndex + 1; i < j.plans.size(); i++) {
            if (encoder || j.plans.get(i).area() < cur.area()) return i;
        }
        return -1;
    }

    private static String describe(ExportException e) {
        int code = e.errorCode;
        String what;
        if (code >= 2000 && code < 3000) {
            what = "Lecture d'un clip impossible";
        } else if (code == ExportException.ERROR_CODE_DECODER_INIT_FAILED
                || code == ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED) {
            what = "Un clip utilise un format vidéo que cet appareil ne sait pas décoder";
        } else if (code == ExportException.ERROR_CODE_DECODING_FAILED) {
            what = "Le décodage d'un clip a échoué";
        } else if (code == ExportException.ERROR_CODE_ENCODER_INIT_FAILED
                || code == ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED) {
            what = "L'encodeur vidéo de l'appareil refuse ce format";
        } else if (code == ExportException.ERROR_CODE_ENCODING_FAILED) {
            what = "L'encodage vidéo a échoué";
        } else if (code == ExportException.ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED) {
            what = "Le traitement GPU (agrandissement 4K) a échoué";
        } else if (code == ExportException.ERROR_CODE_AUDIO_PROCESSING_FAILED) {
            what = "Le traitement du son a échoué";
        } else if (code >= 7000 && code < 8000) {
            what = "L'écriture du fichier MP4 a échoué";
        } else {
            what = "Le rendu a échoué";
        }
        return what + " (" + e.getErrorCodeName() + ").";
    }

    /* ------------------------------------------------------------------ */
    /* Enregistrement dans la galerie (fil d'arrière-plan)                 */
    /* ------------------------------------------------------------------ */

    private void save(Job j, Plan p, File out, long resultDurationMs) {
        try {
            long bytes = out.length();
            if (bytes <= 0) throw new IOException("fichier produit vide");
            long[] info = probe(out);
            String mime = probeMime(out, p.mime);
            int width = info != null && info[0] > 0 ? (int) info[0] : p.width;
            int height = info != null && info[1] > 0 ? (int) info[1] : p.height;
            long durationMs = info != null && info[2] > 0 ? info[2] : resultDurationMs;
            if (j.cancelled) return;
            Uri uri;
            try (InputStream in = new FileInputStream(out)) {
                uri = act.publish(in, "video", j.fileName, MimeTypes.VIDEO_MP4);
            }
            if (j.cancelled) {
                removeQuietly(uri);
                return;
            }
            JSONObject done = MainActivity.obj("state", "done", "uri", uri.toString(), "width", width, "height", height,
                    "durationMs", durationMs, "bytes", bytes, "codec", mime, "name", displayName(uri, j.fileName));
            postFinish(j, done);
        } catch (Exception e) {
            if (j.cancelled) return;
            Log.w(TAG, "enregistrement du film", e);
            postFinish(j, error("Enregistrement dans la galerie impossible : " + e.getMessage()));
        } finally {
            deleteQuietly(out);
            trimCache(clipsDir(act));
        }
    }

    private void removeQuietly(Uri uri) {
        try {
            if ("content".equals(uri.getScheme())) act.getContentResolver().delete(uri, null, null);
            else if ("file".equals(uri.getScheme()) && uri.getPath() != null) deleteQuietly(new File(uri.getPath()));
        } catch (RuntimeException ignored) {
            // déjà supprimé
        }
    }

    private String displayName(Uri uri, String fallback) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = act.getContentResolver().query(uri, new String[] {MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    String name = c.getString(0);
                    if (name != null && !name.isEmpty()) return name;
                }
            } catch (RuntimeException ignored) {
                // nom déclaré conservé
            }
        } else if (uri.getLastPathSegment() != null) {
            return uri.getLastPathSegment();
        }
        return fallback;
    }

    /** Largeur et hauteur d'affichage (rotation appliquée) et durée en ms du fichier produit. */
    private static long[] probe(File f) {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(f.getAbsolutePath());
            long w = parseLong(mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            long h = parseLong(mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            long rotation = parseLong(mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
            long d = parseLong(mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            // Les films en portrait sont encodés couchés avec une rotation de 90° dans les métadonnées.
            if (Math.abs(rotation) % 180 == 90) {
                long tmp = w;
                w = h;
                h = tmp;
            }
            return new long[] {w, h, d};
        } catch (RuntimeException e) {
            return null;
        } finally {
            releaseQuietly(mmr);
        }
    }

    private static String probeMime(File f, String fallback) {
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(f.getAbsolutePath());
            for (int i = 0; i < ex.getTrackCount(); i++) {
                String mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) return mime;
            }
        } catch (IOException | RuntimeException ignored) {
            // type demandé conservé
        } finally {
            ex.release();
        }
        return fallback;
    }

    private static void releaseQuietly(MediaMetadataRetriever mmr) {
        try {
            mmr.release();
        } catch (Exception ignored) {
            // déjà libéré
        }
    }

    /* ------------------------------------------------------------------ */
    /* Choix du codec, de la taille et du débit                            */
    /* ------------------------------------------------------------------ */

    /**
     * Réglages possibles par ordre de préférence : taille demandée puis
     * équivalents 1440p et 1080p (même format), HEVC avant H.264 sauf si
     * H.264 est imposé. Seuls les réglages qu'un encodeur déclare savoir
     * produire sont retenus.
     */
    private static List<Plan> plans(int width, int height, String codec, int mbps) {
        List<int[]> sizes = new ArrayList<>();
        sizes.add(new int[] {width, height});
        int shortSide = Math.min(width, height);
        for (int target : new int[] {1440, 1080}) {
            if (target < shortSide) {
                double k = (double) target / shortSide;
                sizes.add(new int[] {evenSize((int) Math.round(width * k)), evenSize((int) Math.round(height * k))});
            }
        }
        List<String> mimes = "avc".equals(codec)
                ? Collections.singletonList(MimeTypes.VIDEO_H264)
                : Arrays.asList(MimeTypes.VIDEO_H265, MimeTypes.VIDEO_H264);
        MediaCodecInfo[] encoders = encoders();
        long requested = (long) mbps * 1_000_000L;
        double requestedArea = (double) width * height;
        List<Plan> plans = new ArrayList<>();
        for (int[] s : sizes) {
            // Débit proportionnel à la surface pour les tailles de repli.
            long target = s[0] == width && s[1] == height ? requested
                    : Math.max(12_000_000L, Math.round(requested * (s[0] * (double) s[1]) / requestedArea));
            for (String mime : mimes) {
                MediaCodecInfo.VideoCapabilities caps = capabilities(encoders, mime, s[0], s[1]);
                if (caps == null) continue;
                Range<Integer> range = caps.getBitrateRange();
                int bitrate = (int) Math.max(range.getLower(), Math.min(range.getUpper(), target));
                plans.add(new Plan(mime, s[0], s[1], bitrate));
            }
        }
        if (plans.isEmpty()) {
            // Aucun encodeur ne déclare ces tailles : Media3 cherchera le réglage le plus proche.
            int[] s = sizes.get(sizes.size() - 1);
            plans.add(new Plan(mimes.get(mimes.size() - 1), s[0], s[1], (int) Math.min(Integer.MAX_VALUE, requested)));
        }
        return plans;
    }

    private static MediaCodecInfo[] encoders() {
        MediaCodecInfo[] list = encoderCache;
        if (list != null) return list;
        List<MediaCodecInfo> found = new ArrayList<>();
        try {
            for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
                if (info.isEncoder()) found.add(info);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "liste des encodeurs", e);
        }
        list = found.toArray(new MediaCodecInfo[0]);
        encoderCache = list;
        return list;
    }

    /**
     * Capacités du meilleur encodeur (matériel de préférence) acceptant cette
     * taille, ou null. Media3 encode les vidéos portrait couchées puis ajoute
     * une rotation : la taille est donc testée en paysage.
     */
    private static MediaCodecInfo.VideoCapabilities capabilities(MediaCodecInfo[] encoders, String mime, int width, int height) {
        MediaCodecInfo.VideoCapabilities best = null;
        boolean bestHardware = false;
        int w = Math.max(width, height);
        int h = Math.min(width, height);
        for (MediaCodecInfo info : encoders) {
            if (!supportsType(info, mime)) continue;
            MediaCodecInfo.VideoCapabilities caps;
            try {
                caps = info.getCapabilitiesForType(mime).getVideoCapabilities();
            } catch (RuntimeException e) {
                continue;
            }
            if (caps == null || !caps.isSizeSupported(w, h)) continue;
            boolean hardware = isHardware(info);
            if (best == null || (hardware && !bestHardware)) {
                best = caps;
                bestHardware = hardware;
            }
        }
        return best;
    }

    private static boolean supportsType(MediaCodecInfo info, String mime) {
        for (String type : info.getSupportedTypes()) {
            if (type.equalsIgnoreCase(mime)) return true;
        }
        return false;
    }

    private static boolean isHardware(MediaCodecInfo info) {
        if (Build.VERSION.SDK_INT >= 29) return info.isHardwareAccelerated();
        String name = info.getName().toLowerCase(Locale.ROOT);
        return !(name.startsWith("omx.google.") || name.startsWith("c2.android.") || name.startsWith("omx.ffmpeg.")
                || name.contains(".sw."));
    }

    /** Plus grande taille standard (paysage) qu'un encodeur sait produire, ou "" si aucune. */
    private static String maxSize(MediaCodecInfo[] encoders, String mime) {
        int[][] candidates = {{7680, 4320}, {4096, 2160}, {3840, 2160}, {2560, 1440}, {1920, 1080}, {1280, 720}, {640, 360}};
        for (int[] s : candidates) {
            if (capabilities(encoders, mime, s[0], s[1]) != null) return s[0] + "x" + s[1];
        }
        return "";
    }

    /** Capacités de l'appareil pour la page (Réglages, étape Montage). */
    static JSONObject deviceInfo() {
        JSONObject info = deviceInfoCache;
        if (info == null) {
            MediaCodecInfo[] enc = encoders();
            info = MainActivity.obj(
                    "sdk", Build.VERSION.SDK_INT,
                    "model", deviceModel(),
                    "hevc4k", capabilities(enc, MimeTypes.VIDEO_H265, UHD_LONG, UHD_SHORT) != null,
                    "avc4k", capabilities(enc, MimeTypes.VIDEO_H264, UHD_LONG, UHD_SHORT) != null,
                    "hevcMax", maxSize(enc, MimeTypes.VIDEO_H265),
                    "avcMax", maxSize(enc, MimeTypes.VIDEO_H264));
            deviceInfoCache = info;
        }
        try {
            return new JSONObject(info.toString());
        } catch (JSONException e) {
            return info;
        }
    }

    private static String deviceModel() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        if (maker.isEmpty() || model.toLowerCase(Locale.ROOT).startsWith(maker.toLowerCase(Locale.ROOT))) return model;
        return Character.toUpperCase(maker.charAt(0)) + maker.substring(1) + " " + model;
    }

    /* ------------------------------------------------------------------ */
    /* Cache et fichiers                                                   */
    /* ------------------------------------------------------------------ */

    /** Vide le cache des clips téléchargés (fichiers de l'export en cours préservés). */
    static void clearClips(Context ctx) {
        cleanDir(clipsDir(ctx));
        cleanDir(exportDir(ctx));
    }

    private static File clipsDir(Context ctx) {
        return new File(ctx.getCacheDir(), "clips");
    }

    private static File exportDir(Context ctx) {
        return new File(ctx.getCacheDir(), "export");
    }

    private static void use(Job j, File f) {
        String path = f.getAbsolutePath();
        j.files.add(path);
        IN_USE.add(path);
    }

    private static void cleanDir(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isFile() && !IN_USE.contains(f.getAbsolutePath())) deleteQuietly(f);
        }
    }

    /** Supprime les clips les plus anciens au-delà de la taille maximale du cache. */
    private static void trimCache(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        long total = 0;
        long[][] entries = new long[files.length][];
        for (int i = 0; i < files.length; i++) {
            long len = files[i].length();
            total += len;
            entries[i] = new long[] {files[i].lastModified(), len, i};
        }
        if (total <= CACHE_MAX_BYTES) return;
        Arrays.sort(entries, (a, b) -> Long.compare(a[0], b[0]));
        for (long[] e : entries) {
            if (total <= CACHE_MAX_BYTES) break;
            File f = files[(int) e[2]];
            if (IN_USE.contains(f.getAbsolutePath())) continue;
            if (f.delete()) total -= e[1];
        }
    }

    private static void deleteQuietly(File f) {
        if (f != null && f.exists() && !f.delete()) Log.w(TAG, "suppression impossible : " + f.getName());
    }

    /* ------------------------------------------------------------------ */
    /* Utilitaires                                                         */
    /* ------------------------------------------------------------------ */

    private static List<String> readClips(JSONArray arr) {
        List<String> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            Object o = arr.opt(i);
            String s = null;
            if (o instanceof String) {
                s = (String) o;
            } else if (o instanceof JSONObject) {
                JSONObject c = (JSONObject) o;
                s = c.optString("url", c.optString("uri", ""));
            }
            if (s != null && !s.trim().isEmpty() && !"null".equals(s.trim())) out.add(s.trim());
        }
        return out;
    }

    private static String normalizeCodec(String codec) {
        String c = codec == null ? "" : codec.toLowerCase(Locale.ROOT);
        if (c.contains("hevc") || c.contains("265")) return "hevc";
        if (c.contains("avc") || c.contains("264")) return "avc";
        return "auto";
    }

    /** Dimension paire comprise entre 2 et 8192 pixels. */
    private static int evenSize(int v) {
        return Math.max(2, Math.min(8192, v)) & ~1;
    }

    /** Nom de fichier sûr pour la galerie, toujours en .mp4. */
    private static String fileName(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.toLowerCase(Locale.ROOT).endsWith(".mp4")) s = s.substring(0, s.length() - 4);
        s = s.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").replaceAll("\\s+", " ").trim();
        while (s.startsWith(".")) s = s.substring(1);
        if (s.length() > 80) s = s.substring(0, 80).trim();
        if (s.isEmpty()) s = "CineGenesis_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        return s + ".mp4";
    }

    private static String hash(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            return Integer.toHexString(s.hashCode()) + "_" + s.length();
        }
    }

    private static long parseLong(String s) {
        if (s == null) return 0;
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String fmtBytes(long b) {
        if (b >= 1024L * 1024 * 1024) return String.format(Locale.FRANCE, "%.1f Go", b / (1024.0 * 1024 * 1024));
        return String.format(Locale.FRANCE, "%d Mo", b / (1024 * 1024));
    }
}
