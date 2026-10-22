/* Trouve ton IA — accès aux outils natifs du téléphone pour le studio (réseau sans CORS,
 * fichiers temporaires, voix off, galerie, partage), avec des équivalents navigateur pour
 * le développement et les tests. Toutes les opérations longues renvoient une promesse. */
(function () {
  "use strict";

  const N = window.TrouveNative || null;
  const attente = new Map();
  let suivant = 1;

  // Réponse d'une opération native : appelée par MainActivity avec l'identifiant de la demande.
  window.natif = function (id, r) {
    const f = attente.get(id);
    if (!f) return;
    attente.delete(id);
    f(r || { code: 0, erreur: "réponse vide" });
  };

  function demande(lancer) {
    return new Promise((resoudre) => {
      const id = suivant++;
      attente.set(id, resoudre);
      try {
        lancer(id);
      } catch (e) {
        attente.delete(id);
        resoudre({ code: 0, erreur: String(e && e.message) });
      }
    });
  }

  function aOui(f) {
    try {
      return !!(N && typeof N[f] === "function");
    } catch (e) {
      return false;
    }
  }

  /** Requête texte : { methode, url, corps, entetes, delai } → { code, texte, type, retry }. */
  async function requete(o) {
    const corps = o.corps == null ? "" : typeof o.corps === "string" ? o.corps : JSON.stringify(o.corps);
    if (aOui("requete")) {
      return demande((id) => N.requete(id, o.methode || "GET", o.url, corps, o.entetes ? JSON.stringify(o.entetes) : "", o.delai || 60000));
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), o.delai || 60000);
    try {
      const h = Object.assign(corps ? { "content-type": "application/json" } : {}, o.entetes || {});
      const r = await fetch(o.url, { method: o.methode || "GET", body: corps || undefined, headers: h, signal: ctrl.signal });
      return { code: r.status, texte: await r.text(), type: r.headers.get("content-type") || "", retry: r.headers.get("retry-after") };
    } catch (e) {
      return { code: 0, erreur: e.name === "AbortError" ? "délai dépassé" : e.message };
    } finally {
      clearTimeout(t);
    }
  }

  /** Télécharge une image ou un clip généré : { code, chemin } où chemin se lit en même origine. */
  async function telecharger(url, nom) {
    if (aOui("telecharger")) return demande((id) => N.telecharger(id, url, nom));
    try {
      const r = await fetch(url);
      if (!r.ok) return { code: r.status, texte: await r.text(), retry: r.headers.get("retry-after") };
      const b = await r.blob();
      return { code: 200, chemin: URL.createObjectURL(b), type: b.type, octets: b.size };
    } catch (e) {
      return { code: 0, erreur: e.message };
    }
  }

  /** Voix off française en fichier WAV (synthèse vocale d'Android). */
  function voix(texte, o) {
    const opts = o || {};
    if (!aOui("voix")) return Promise.resolve({ code: 0, erreur: "voix indisponible ici" });
    return demande((id) => N.voix(id, texte, opts.vitesse || 1, opts.hauteur || 1, `voix-${id}-${Date.now().toString(36)}.wav`));
  }

  function enBase64(b) {
    return new Promise((resoudre, rejeter) => {
      const r = new FileReader();
      r.onload = () => resoudre(String(r.result).split(",")[1] || "");
      r.onerror = () => rejeter(r.error);
      r.readAsDataURL(b);
    });
  }

  function telechargerNavigateur(url, nom) {
    const a = document.createElement("a");
    a.href = url;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Enregistre un fichier créé (vidéo montée) dans la galerie : { code, uri }. */
  async function enregistrer(blob, nom, type) {
    if (!aOui("ecrire")) {
      telechargerNavigateur(URL.createObjectURL(blob), nom);
      return { code: 200, uri: "", navigateur: true };
    }
    const T = 512 * 1024;
    for (let i = 0; i < Math.max(blob.size, 1); i += T) {
      const b64 = await enBase64(blob.slice(i, i + T));
      if (!N.ecrire(nom, b64, i === 0)) return { code: 0, erreur: "écriture impossible" };
    }
    return demande((id) => N.enregistrer(id, nom, type));
  }

  /** Enregistre dans la galerie un fichier déjà dans le cache (image générée). */
  async function enregistrerCache(chemin, nom, type) {
    if (!aOui("enregistrer") || !chemin.startsWith("/cache/")) {
      telechargerNavigateur(chemin, nom);
      return { code: 200, uri: "", navigateur: true };
    }
    return demande((id) => N.enregistrer(id, chemin.slice(7), type));
  }

  function partager(uri, type, texte) {
    if (aOui("partagerFichier") && uri) N.partagerFichier(uri, type, texte || "");
  }

  function ouvrir(uri, type) {
    if (aOui("ouvrirFichier") && uri) N.ouvrirFichier(uri, type);
  }

  function ecranAllume(oui) {
    if (aOui("ecranAllume")) N.ecranAllume(!!oui);
  }

  /** Ouvre un site d'IA dans un onglet intégré à l'appli (ou, à défaut, le navigateur). */
  function ouvrirDansAppli(url, sombre) {
    if (aOui("openInApp")) return N.openInApp(url, !!sombre);
    if (aOui("openUrl")) return N.openUrl(url);
    window.open(url, "_blank", "noopener");
    return true;
  }

  window.Natif = {
    dispo: !!N,
    voixDispo: aOui("voix"),
    requete,
    telecharger,
    voix,
    enregistrer,
    enregistrerCache,
    partager,
    ouvrir,
    ecranAllume,
    ouvrirDansAppli,
  };
})();
