/* Trouve ton IA — stockage local (favoris, réglages…) et catalogue (intégré ou mis à jour en ligne). */
(function (root) {
  "use strict";

  const CLE = "trouve.";
  // Catalogue publié dans le dépôt : le modifier met à jour l'appli sans la réinstaller.
  const URL_DISTANTE = "https://raw.githubusercontent.com/Idrissta/ia-video/master/trouve/src/main/assets/web/data/catalogue.json";
  const DELAI_VERIF = 12 * 3600 * 1000;
  const PRIX = ["gratuit", "freemium", "essai", "payant", "nc"];
  const VITESSES = ["rapide", "moyenne", "lente"];

  function lire(k, defaut) {
    try {
      const v = localStorage.getItem(CLE + k);
      return v == null ? defaut : JSON.parse(v);
    } catch (e) {
      return defaut;
    }
  }

  function ecrire(k, v) {
    try {
      localStorage.setItem(CLE + k, JSON.stringify(v));
      return true;
    } catch (e) {
      return false;
    }
  }

  function effacer(k) {
    try {
      localStorage.removeItem(CLE + k);
    } catch (e) {
      /* stockage indisponible */
    }
  }

  function liste(k) {
    const v = lire(k, []);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  }

  /* ---------------------------------------------------------------- */
  /* Favoris, comparaison, historique                                  */
  /* ---------------------------------------------------------------- */

  const favoris = {
    tous: () => liste("favoris"),
    a: (id) => liste("favoris").includes(id),
    basculer(id) {
      const l = liste("favoris");
      const i = l.indexOf(id);
      if (i >= 0) l.splice(i, 1);
      else l.unshift(id);
      ecrire("favoris", l);
      return i < 0;
    },
  };

  const comparaison = {
    MAX: 3,
    tous: () => liste("comparer"),
    a: (id) => liste("comparer").includes(id),
    basculer(id) {
      const l = liste("comparer");
      const i = l.indexOf(id);
      if (i >= 0) {
        l.splice(i, 1);
        ecrire("comparer", l);
        return "retire";
      }
      if (l.length >= comparaison.MAX) return "plein";
      l.push(id);
      ecrire("comparer", l);
      return "ajoute";
    },
    vider: () => effacer("comparer"),
  };

  const vus = {
    tous: () => liste("vus"),
    ajouter(id) {
      const l = liste("vus").filter((x) => x !== id);
      l.unshift(id);
      ecrire("vus", l.slice(0, 12));
    },
  };

  const recherches = {
    tous: () => liste("recherches"),
    ajouter(q) {
      const t = String(q || "").trim();
      if (t.length < 2) return;
      const n = t.toLowerCase();
      const l = liste("recherches").filter((x) => x.toLowerCase() !== n);
      l.unshift(t);
      ecrire("recherches", l.slice(0, 8));
    },
    vider: () => effacer("recherches"),
  };

  const reglages = {
    lire() {
      const r = lire("reglages", {});
      return {
        theme: ["auto", "sombre", "clair"].includes(r.theme) ? r.theme : "auto",
        logos: r.logos !== false,
        majAuto: r.majAuto !== false,
      };
    },
    ecrire(patch) {
      const r = Object.assign(reglages.lire(), patch);
      ecrire("reglages", r);
      return r;
    },
  };

  /* ---------------------------------------------------------------- */
  /* Catalogue                                                         */
  /* ---------------------------------------------------------------- */

  const texte = (v) => (typeof v === "string" ? v : "");
  const textes = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);

  // Fiche technique d'un générateur vidéo (facultative).
  function video(v) {
    if (!v || typeof v !== "object") return null;
    return {
      q: Number.isInteger(v.q) && v.q >= 1 && v.q <= 5 ? v.q : 0,
      v: VITESSES.includes(v.v) ? v.v : "",
      res: texte(v.res),
      duree: texte(v.duree),
      son: v.son === true,
      img: v.img === true,
      txt: v.txt !== false,
    };
  }

  // Contrôle et nettoie un catalogue (intégré ou téléchargé). Renvoie null s'il est inutilisable.
  function valider(c) {
    if (!c || c.format !== 1 || !Number.isInteger(c.version) || !Array.isArray(c.outils) || !Array.isArray(c.categories)) return null;
    const categories = c.categories
      .filter((x) => x && typeof x.id === "string" && typeof x.nom === "string")
      .map((x) => ({ id: x.id, nom: x.nom, icone: texte(x.icone) || "•", desc: texte(x.desc), mots: textes(x.mots) }));
    const catIds = new Set(categories.map((x) => x.id));
    const ids = new Set();
    const outils = [];
    for (const o of c.outils) {
      if (!o || typeof o.id !== "string" || ids.has(o.id)) continue;
      if (typeof o.nom !== "string" || typeof o.url !== "string" || !/^https:\/\/[^\s]+$/.test(o.url)) continue;
      const cat = textes(o.cat).filter((x) => catIds.has(x));
      if (!cat.length || !PRIX.includes(o.prix)) continue;
      ids.add(o.id);
      outils.push({
        id: o.id,
        nom: o.nom,
        par: texte(o.par),
        url: o.url,
        cat,
        prix: o.prix,
        tarif: texte(o.tarif),
        gratuit: texte(o.gratuit),
        resume: texte(o.resume),
        desc: texte(o.desc),
        forts: textes(o.forts),
        limites: textes(o.limites),
        tags: textes(o.tags),
        plat: textes(o.plat),
        fr: o.fr === true,
        sanscompte: o.sanscompte === true,
        libre: o.libre === true,
        local: o.local === true,
        choix: o.choix === true,
        ajout: /^\d{4}-\d{2}-\d{2}$/.test(o.ajout || "") ? o.ajout : texte(c.maj),
        video: video(o.video),
      });
    }
    if (outils.length < 50) return null;
    const parcours = (Array.isArray(c.parcours) ? c.parcours : [])
      .filter((p) => p && typeof p.id === "string" && typeof p.titre === "string" && Array.isArray(p.etapes))
      .map((p) => ({
        id: p.id,
        titre: p.titre,
        icone: texte(p.icone) || "•",
        intro: texte(p.intro),
        etapes: p.etapes
          .filter((e) => e && typeof e.titre === "string")
          .map((e) => ({ titre: e.titre, texte: texte(e.texte), outils: textes(e.outils).filter((id) => ids.has(id)) })),
      }));
    const collections = (Array.isArray(c.collections) ? c.collections : [])
      .filter((x) => x && typeof x.id === "string" && typeof x.titre === "string" && x.filtre && typeof x.filtre === "object")
      .map((x) => ({ id: x.id, titre: x.titre, icone: texte(x.icone) || "•", desc: texte(x.desc), filtre: x.filtre, type: x.type === "profil" ? "profil" : "selection" }));
    return { format: 1, version: c.version, maj: texte(c.maj), categories, collections, parcours, outils };
  }

  async function chargerIntegre() {
    const r = await fetch("data/catalogue.json", { cache: "no-store" });
    if (!r.ok) throw new Error("catalogue introuvable");
    return valider(await r.json());
  }

  // Catalogue le plus récent disponible : celui téléchargé s'il est plus récent que celui de l'appli.
  async function charger() {
    const integre = await chargerIntegre();
    const stocke = valider(lire("catalogue", null));
    if (stocke && (!integre || stocke.version > integre.version)) return { catalogue: stocke, source: "enligne" };
    if (!integre) throw new Error("catalogue invalide");
    if (stocke) effacer("catalogue"); // l'appli a été mise à jour avec un catalogue plus récent
    return { catalogue: integre, source: "integre" };
  }

  async function verifierMaj(actuel, force) {
    if (!force && Date.now() - lire("verif", 0) < DELAI_VERIF) return { statut: "recent" };
    let ctrl = null;
    let minuteur = 0;
    try {
      if (typeof AbortController !== "undefined") {
        ctrl = new AbortController();
        minuteur = setTimeout(() => ctrl.abort(), 12000);
      }
      const r = await fetch(URL_DISTANTE + "?t=" + Date.now(), { cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
      if (!r.ok) return { statut: "erreur" };
      const c = valider(await r.json());
      ecrire("verif", Date.now());
      if (!c) return { statut: "invalide" };
      if (c.version <= actuel.version) return { statut: "ajour" };
      ecrire("catalogue", c);
      const avant = new Set(actuel.outils.map((o) => o.id));
      return { statut: "maj", catalogue: c, nouveaux: c.outils.filter((o) => !avant.has(o.id)) };
    } catch (e) {
      return { statut: "erreur" };
    } finally {
      clearTimeout(minuteur);
    }
  }

  function derniereVerif() {
    return lire("verif", 0);
  }

  root.Store = { favoris, comparaison, vus, recherches, reglages, valider, charger, verifierMaj, derniereVerif, URL_DISTANTE };
})(typeof self !== "undefined" ? self : this);
