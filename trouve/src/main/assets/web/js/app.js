/* Trouve ton IA — interface : écrans, navigation, recherche, favoris, comparateur, parcours, réglages. */
(function () {
  "use strict";

  const R = window.Recherche;
  const Store = window.Store;
  const native = window.TrouveNative || null;
  const $ = (sel, el) => (el || document).querySelector(sel);

  const DEPOT = "https://github.com/Idrissta/ia-video";
  const PRIX = {
    gratuit: { court: "Gratuit", long: "100 % gratuit", rang: 0 },
    freemium: { court: "Version gratuite", long: "Gratuit avec limites", rang: 1 },
    essai: { court: "Essai gratuit", long: "Essai gratuit puis payant", rang: 2 },
    payant: { court: "Payant", long: "Payant", rang: 3 },
  };
  const PLATS = {
    web: "Navigateur",
    android: "Android",
    ios: "iPhone / iPad",
    windows: "Windows",
    mac: "Mac",
    linux: "Linux",
    extension: "Extension navigateur",
  };
  const FILTRES = [
    { cle: "gratuit", nom: "100 % gratuit" },
    { cle: "freemium", nom: "Version gratuite" },
    { cle: "sanscompte", nom: "Sans compte" },
    { cle: "android", nom: "Android" },
    { cle: "fr", nom: "En français" },
    { cle: "libre", nom: "Open source" },
  ];
  const EXEMPLES = [
    "Enlever le fond d'une photo",
    "Créer une chanson",
    "Animer une photo en vidéo",
    "Réviser mes cours",
    "Traduire un document",
    "Créer un logo",
    "Voix off pour YouTube",
    "Faire un site sans coder",
    "Sous-titres automatiques",
    "Résoudre un exercice de maths",
    "IA gratuite sans compte",
    "Transcrire une réunion",
  ];

  const S = {
    cat: null,
    source: "integre",
    index: null,
    outils: new Map(),
    cats: new Map(),
    parcoursDe: new Map(),
    onglet: "accueil",
    pile: [],
    reglages: Store.reglages.lire(),
    kb: 0,
    majEnCours: false,
    majStatut: "",
  };

  /* ---------------------------------------------------------------- */
  /* Utilitaires                                                       */
  /* ---------------------------------------------------------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function pluriel(n, un, plusieurs) {
    return n + " " + (n > 1 ? plusieurs : un);
  }

  function haptic(kind) {
    try {
      if (native) native.haptic(kind || "tick");
    } catch (e) {
      /* ignore */
    }
  }

  function teinte(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return h;
  }

  function initiales(nom) {
    const m = nom.replace(/\(.*?\)/g, "").split(/[\s.\-]+/).filter(Boolean);
    const s = m.length > 1 && m[1][0] && /[A-Za-z0-9]/.test(m[1][0]) && m[0].length <= 8 ? m[0][0] + m[1][0] : m[0].slice(0, 2);
    return s.toUpperCase();
  }

  function hote(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  function dateFr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso || "";
    const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    return `${+m[3]} ${mois[+m[2] - 1]} ${m[1]}`;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("on"), 2600);
  }

  function ouvrirLien(url) {
    if (!/^https?:\/\//.test(url)) return;
    try {
      if (native && native.openUrl(url)) return;
    } catch (e) {
      /* repli navigateur */
    }
    window.open(url, "_blank", "noopener");
  }

  function partager(titre, texte) {
    try {
      if (native) return native.share(titre, texte);
    } catch (e) {
      /* repli */
    }
    if (navigator.share) {
      navigator.share({ title: titre, text: texte }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(texte).then(() => toast("Lien copié"), () => {});
    }
  }

  /* ---------------------------------------------------------------- */
  /* Icônes                                                            */
  /* ---------------------------------------------------------------- */

  const svg = (d, w) =>
    `<svg viewBox="0 0 24 24" width="${w || 22}" height="${w || 22}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    retour: svg('<path d="M15 5l-7 7 7 7"/>'),
    loupe: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    croix: svg('<path d="M6 6l12 12M18 6L6 18"/>', 20),
    coeur: svg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>', 21),
    comparer: svg('<path d="M7 4v16M17 4v16M3.5 8H10M14 16h6.5"/>', 21),
    partager: svg('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4"/>', 21),
    externe: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 19),
    fleche: svg('<path d="M9 5l7 7-7 7"/>', 18),
    horloge: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', 18),
    etincelle: svg('<path d="M12 3c.8 4.6 3.4 7.2 8 8-4.6.8-7.2 3.4-8 8-.8-4.6-3.4-7.2-8-8 4.6-.8 7.2-3.4 8-8z"/>', 18),
    drapeau: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', 18),
  };

  /* ---------------------------------------------------------------- */
  /* Morceaux d'interface                                              */
  /* ---------------------------------------------------------------- */

  function logo(o, classe) {
    const h = hote(o.url);
    const img = S.reglages.logos && h && h !== "github.com"
      ? `<img src="https://icons.duckduckgo.com/ip3/${esc(h)}.ico" alt="" loading="lazy" decoding="async" onerror="this.remove()" onload="if(this.naturalWidth<12)this.remove();else this.classList.add('ok')">`
      : "";
    return `<span class="logo ${classe || ""}" style="--h:${teinte(o.id)}" aria-hidden="true"><b>${esc(initiales(o.nom))}</b>${img}</span>`;
  }

  function badgePrix(o) {
    return `<span class="prix p-${o.prix}">${PRIX[o.prix].court}</span>`;
  }

  function puces(o) {
    const p = [];
    if (o.choix) p.push('<span class="puce choix">★ Coup de cœur</span>');
    if (o.sanscompte) p.push('<span class="puce">Sans compte</span>');
    if (o.plat.includes("android")) p.push('<span class="puce">Android</span>');
    if (o.libre) p.push('<span class="puce">Open source</span>');
    if (o.local) p.push('<span class="puce">Hors ligne</span>');
    return p.join("");
  }

  function boutonFav(o, grand) {
    const on = Store.favoris.a(o.id);
    return `<button type="button" class="fav${on ? " on" : ""}${grand ? " grand" : ""}" data-act="fav" data-id="${esc(o.id)}" aria-pressed="${on}" aria-label="${on ? "Retirer des favoris" : "Ajouter aux favoris"}">${I.coeur}${grand ? `<span>${on ? "Favori" : "Favoris"}</span>` : ""}</button>`;
  }

  function carte(o) {
    return `<article class="carte" data-act="outil" data-id="${esc(o.id)}" tabindex="0">
      ${logo(o)}
      <div class="carte-corps">
        <div class="carte-tete"><h3>${esc(o.nom)}</h3>${badgePrix(o)}</div>
        <p>${esc(o.resume)}</p>
        <div class="puces">${puces(o)}</div>
      </div>
      ${boutonFav(o)}
    </article>`;
  }

  function mini(o) {
    return `<button type="button" class="mini" data-act="outil" data-id="${esc(o.id)}">${logo(o, "petit")}<span>${esc(o.nom)}</span>${badgePrix(o)}</button>`;
  }

  function entete(titre, opts) {
    const o = opts || {};
    return `<header class="barre">
      ${o.retour === false ? "" : `<button type="button" class="icone" data-act="retour" aria-label="Retour">${I.retour}</button>`}
      <h1 class="barre-titre">${titre}</h1>
      ${o.droite || `<button type="button" class="icone" data-act="ouvrir-recherche" aria-label="Rechercher">${I.loupe}</button>`}
    </header>`;
  }

  function puceFiltres(f) {
    return `<div class="filtres" role="group" aria-label="Filtres">${FILTRES.map(
      (x) => `<button type="button" class="filtre${f[x.cle] ? " on" : ""}" data-act="filtre" data-cle="${x.cle}" aria-pressed="${!!f[x.cle]}">${x.nom}</button>`
    ).join("")}</div>`;
  }

  function selectTri(tri, avecPertinence) {
    const opts = (avecPertinence ? [["pertinence", "Pertinence"]] : [])
      .concat([["reco", "Recommandés"], ["gratuit", "Gratuits d'abord"], ["az", "De A à Z"]]);
    return `<label class="tri">Trier<select data-act="tri">${opts
      .map(([v, n]) => `<option value="${v}"${v === tri ? " selected" : ""}>${n}</option>`)
      .join("")}</select></label>`;
  }

  /* ---------------------------------------------------------------- */
  /* Données dérivées                                                  */
  /* ---------------------------------------------------------------- */

  function appliquerFiltres(liste, f) {
    return liste.filter((o) => {
      if (f.gratuit && o.prix !== "gratuit") return false;
      if (f.freemium && o.prix !== "gratuit" && o.prix !== "freemium") return false;
      if (f.sanscompte && !o.sanscompte) return false;
      if (f.android && !o.plat.includes("android")) return false;
      if (f.fr && !o.fr) return false;
      if (f.libre && !o.libre) return false;
      return true;
    });
  }

  // « Recommandés » : outils dont c'est la catégorie principale, coups de cœur en tête, puis ordre du catalogue.
  function trier(liste, tri, catId) {
    const ordre = new Map(S.cat.outils.map((o, i) => [o.id, i]));
    const principal = (o) => (catId && o.cat[0] === catId ? 1 : 0);
    const reco = (a, b) => principal(b) - principal(a) || (b.choix - a.choix) || ordre.get(a.id) - ordre.get(b.id);
    const l = liste.slice();
    if (tri === "az") l.sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
    else if (tri === "gratuit") l.sort((a, b) => PRIX[a.prix].rang - PRIX[b.prix].rang || reco(a, b));
    else if (tri === "reco") l.sort(reco);
    return l;
  }

  function outilsDe(type, id) {
    if (type === "cat") {
      // Outils dont c'est la catégorie principale d'abord, puis ceux qui la couvrent aussi.
      const l = S.cat.outils.filter((o) => o.cat.includes(id));
      return l.filter((o) => o.cat[0] === id).concat(l.filter((o) => o.cat[0] !== id));
    }
    const col = S.cat.collections.find((c) => c.id === id);
    return col ? R.filtrer(S.cat.outils, col.filtre) : [];
  }

  function alternatives(o) {
    const tags = new Set(o.tags.map(R.normaliser));
    return S.cat.outils
      .filter((x) => x.id !== o.id)
      .map((x) => {
        let s = 0;
        if (x.cat[0] === o.cat[0]) s += 4;
        for (const c of x.cat) if (o.cat.includes(c)) s += 1.5;
        for (const t of x.tags) if (tags.has(R.normaliser(t))) s += 1;
        if (x.choix) s += 0.5;
        return { x, s };
      })
      .filter((r) => r.s >= 5)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((r) => r.x);
  }

  function indexer(c, source) {
    S.cat = c;
    S.source = source;
    S.index = R.creerIndex(c);
    S.outils = new Map(c.outils.map((o) => [o.id, o]));
    S.cats = new Map(c.categories.map((x) => [x.id, x]));
    S.parcoursDe = new Map();
    for (const p of c.parcours) for (const e of p.etapes) for (const id of e.outils) {
      const l = S.parcoursDe.get(id) || [];
      if (!l.includes(p)) l.push(p);
      S.parcoursDe.set(id, l);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Écrans                                                            */
  /* ---------------------------------------------------------------- */

  const ECRANS = {};

  ECRANS.accueil = function () {
    const c = S.cat;
    const choix = trier(c.outils.filter((o) => o.choix), "reco").slice(0, 8);
    const vus = Store.vus.tous().map((id) => S.outils.get(id)).filter(Boolean).slice(0, 10);
    const dates = c.outils.map((o) => o.ajout).sort();
    const nouveaux = dates.length && dates[0] !== dates[dates.length - 1]
      ? c.outils.filter((o) => o.ajout === dates[dates.length - 1]).slice(0, 10)
      : [];
    const gratuits = c.outils.filter((o) => o.prix === "gratuit").length;
    return `<div class="accueil">
      <header class="hero">
        <div class="marque">
          <span class="marque-logo" aria-hidden="true">${svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/><path d="M10.5 7.2c.3 1.8 1.4 2.9 3.2 3.2-1.8.3-2.9 1.4-3.2 3.2-.3-1.8-1.4-2.9-3.2-3.2 1.8-.3 2.9-1.4 3.2-3.2z" fill="currentColor" stroke="none"/>', 26)}</span>
          <div>
            <h1>Trouve ton IA</h1>
            <p>${c.outils.length} IA expliquées en français · ${gratuits} entièrement gratuites</p>
          </div>
        </div>
        <button type="button" class="recherche-faux" data-act="ouvrir-recherche">
          ${I.loupe}<span id="ph">Que veux-tu faire ? « ${esc(EXEMPLES[0])} »</span>
        </button>
        <div class="defile exemples">${EXEMPLES.slice(0, 8).map((q) => `<button type="button" class="exemple" data-act="chercher" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      </header>

      ${vus.length ? `<section class="sec">
        <div class="sec-tete"><h2>Vus récemment</h2></div>
        <div class="defile vus">${vus.map((o) => `<button type="button" class="vu" data-act="outil" data-id="${esc(o.id)}">${logo(o)}<span>${esc(o.nom)}</span></button>`).join("")}</div>
      </section>` : ""}

      <section class="sec">
        <div class="sec-tete"><h2>Parcours pas à pas</h2><span class="sec-note bas">Les bons outils, dans le bon ordre</span></div>
        <div class="defile parcours-liste">${c.parcours.map((p) => `<button type="button" class="parcours-carte" data-act="parcours" data-id="${esc(p.id)}">
          <span class="parcours-icone">${esc(p.icone)}</span>
          <strong>${esc(p.titre)}</strong>
          <span>${esc(p.intro)}</span>
          <em>${pluriel(p.etapes.length, "étape", "étapes")}</em>
        </button>`).join("")}</div>
      </section>

      <section class="sec">
        <div class="sec-tete"><h2>Sélections</h2></div>
        <div class="collections">${c.collections.map((x) => `<button type="button" class="collection" data-act="col" data-id="${esc(x.id)}">
          <span>${esc(x.icone)}</span><strong>${esc(x.titre)}</strong><em>${R.filtrer(c.outils, x.filtre).length}</em>
        </button>`).join("")}</div>
      </section>

      <section class="sec">
        <div class="sec-tete"><h2>Catégories</h2><button type="button" class="lien" data-act="onglet" data-tab="explorer">Tout voir</button></div>
        <div class="grille-cats">${c.categories.slice(0, 8).map(tuileCat).join("")}</div>
      </section>

      ${nouveaux.length ? `<section class="sec">
        <div class="sec-tete"><h2>Nouveautés</h2><span class="sec-note bas">Ajoutées le ${esc(dateFr(dates[dates.length - 1]))}</span></div>
        <div class="liste">${nouveaux.map(carte).join("")}</div>
      </section>` : ""}

      <section class="sec">
        <div class="sec-tete"><h2>Nos coups de cœur</h2><button type="button" class="lien" data-act="col" data-id="choix">Tout voir</button></div>
        <div class="liste">${choix.map(carte).join("")}</div>
      </section>

      <p class="pied">Application gratuite, sans publicité ni compte. Prix indicatifs (catalogue du ${esc(dateFr(c.maj))}) : vérifie toujours sur le site officiel.</p>
    </div>`;
  };

  function tuileCat(x) {
    const n = S.cat.outils.filter((o) => o.cat.includes(x.id)).length;
    return `<button type="button" class="tuile" data-act="cat" data-id="${esc(x.id)}">
      <span class="tuile-icone">${esc(x.icone)}</span><strong>${esc(x.nom)}</strong><em>${n} IA</em>
    </button>`;
  }

  ECRANS.explorer = function () {
    const c = S.cat;
    return `${entete("Explorer", { retour: false })}
    <div class="page">
      <section class="sec">
        <div class="sec-tete"><h2>Toutes les catégories</h2><span class="sec-note">${c.categories.length}</span></div>
        <div class="grille-cats large">${c.categories.map((x) => {
          const n = c.outils.filter((o) => o.cat.includes(x.id)).length;
          return `<button type="button" class="tuile large" data-act="cat" data-id="${esc(x.id)}">
            <span class="tuile-icone">${esc(x.icone)}</span>
            <span class="tuile-texte"><strong>${esc(x.nom)}</strong><small>${esc(x.desc)}</small></span>
            <em>${n}</em>
          </button>`;
        }).join("")}</div>
      </section>
      <section class="sec">
        <div class="sec-tete"><h2>Sélections</h2></div>
        <div class="collections">${c.collections.map((x) => `<button type="button" class="collection" data-act="col" data-id="${esc(x.id)}">
          <span>${esc(x.icone)}</span><strong>${esc(x.titre)}</strong><em>${R.filtrer(c.outils, x.filtre).length}</em>
        </button>`).join("")}</div>
      </section>
      <section class="sec">
        <div class="sec-tete"><h2>Parcours</h2></div>
        <div class="liste-parcours">${c.parcours.map((p) => `<button type="button" class="ligne" data-act="parcours" data-id="${esc(p.id)}">
          <span class="ligne-icone">${esc(p.icone)}</span><span class="ligne-texte"><strong>${esc(p.titre)}</strong><small>${esc(p.intro)}</small></span>${I.fleche}
        </button>`).join("")}</div>
      </section>
    </div>`;
  };

  ECRANS.liste = function (p) {
    let titre;
    let desc;
    if (p.type === "cat") {
      const x = S.cats.get(p.id);
      if (!x) return ECRANS.introuvable();
      titre = `${esc(x.icone)} ${esc(x.nom)}`;
      desc = x.desc;
    } else {
      const x = S.cat.collections.find((c) => c.id === p.id);
      if (!x) return ECRANS.introuvable();
      titre = `${esc(x.icone)} ${esc(x.titre)}`;
      desc = x.desc;
    }
    p.f = p.f || {};
    p.tri = p.tri || "reco";
    return `${entete(titre)}
    <div class="page">
      <p class="intro">${esc(desc)}</p>
      ${puceFiltres(p.f)}
      <div id="res">${resultatsListe(p)}</div>
    </div>`;
  };

  function resultatsListe(p) {
    const base = outilsDe(p.type, p.id);
    const l = trier(appliquerFiltres(base, p.f), p.tri, p.type === "cat" ? p.id : null);
    return `<div class="compte"><span>${pluriel(l.length, "outil", "outils")}</span>${selectTri(p.tri)}</div>
      ${l.length ? `<div class="liste">${l.map(carte).join("")}</div>` : videFiltres()}`;
  }

  function videFiltres() {
    return `<div class="vide"><strong>Aucun outil avec ces filtres</strong><p>Retire un filtre pour voir plus de résultats.</p></div>`;
  }

  ECRANS.recherche = function (p) {
    p.f = p.f || {};
    p.tri = p.tri || "pertinence";
    return `<header class="barre recherche-barre">
      <button type="button" class="icone" data-act="retour" aria-label="Retour">${I.retour}</button>
      <label class="champ">${I.loupe}
        <input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="Décris ce que tu veux faire…" value="${esc(p.q || "")}" aria-label="Rechercher une IA">
        <button type="button" class="effacer" data-act="effacer-q" aria-label="Effacer"${p.q ? "" : " hidden"}>${I.croix}</button>
      </label>
    </header>
    <div class="page">
      ${puceFiltres(p.f)}
      <div id="res">${resultatsRecherche(p)}</div>
    </div>`;
  };

  function resultatsRecherche(p) {
    const q = (p.q || "").trim();
    if (!q) {
      const recents = Store.recherches.tous();
      return `${recents.length ? `<section class="sec">
          <div class="sec-tete"><h2>Recherches récentes</h2><button type="button" class="lien" data-act="vider-recents">Effacer</button></div>
          <div class="liste-recents">${recents.map((r) => `<button type="button" class="ligne petite" data-act="chercher" data-q="${esc(r)}">${I.horloge}<span class="ligne-texte">${esc(r)}</span></button>`).join("")}</div>
        </section>` : ""}
        <section class="sec">
          <div class="sec-tete"><h2>Idées de recherche</h2></div>
          <div class="nuage">${EXEMPLES.map((x) => `<button type="button" class="exemple" data-act="chercher" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>
        </section>
        <p class="astuce">${I.etincelle} Astuce : écris comme tu parles, par exemple « je veux faire une musique de rap gratuitement ».</p>`;
    }
    const r = R.chercher(S.index, q);
    const f = Object.assign({}, p.f);
    let l = appliquerFiltres(r.resultats.map((x) => x.outil), f);
    if (p.tri !== "pertinence") l = trier(l, p.tri);
    const plafond = p.plafond || 30;
    const cat = r.categorie ? S.cats.get(r.categorie) : null;
    const intentions = Object.keys(r.intentions).filter((k) => FILTRES.some((x) => x.cle === k) && !p.f[k]);
    const sugg = intentions.length
      ? `<div class="suggestion">Filtrer : ${intentions.map((k) => `<button type="button" class="filtre" data-act="filtre" data-cle="${k}">${FILTRES.find((x) => x.cle === k).nom}</button>`).join("")}</div>`
      : "";
    if (!l.length) {
      return `${sugg}<div class="vide"><strong>Aucune IA trouvée pour « ${esc(q)} »</strong>
        <p>${r.resultats.length ? "Retire un filtre pour voir les résultats." : "Essaie d'autres mots, ou décris simplement ce que tu veux obtenir."}</p>
        <div class="nuage">${EXEMPLES.slice(0, 6).map((x) => `<button type="button" class="exemple" data-act="chercher" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>
        <button type="button" class="bouton secondaire" data-act="proposer" data-q="${esc(q)}">${I.etincelle}<span>Proposer une IA à ajouter</span></button></div>`;
    }
    return `${sugg}${cat ? `<button type="button" class="ligne cat-sugg" data-act="cat" data-id="${esc(cat.id)}">
        <span class="ligne-icone">${esc(cat.icone)}</span><span class="ligne-texte"><small>Catégorie</small><strong>${esc(cat.nom)}</strong></span>${I.fleche}
      </button>` : ""}
      <div class="compte"><span>${pluriel(l.length, "résultat", "résultats")}</span>${selectTri(p.tri, true)}</div>
      <div class="liste">${l.slice(0, plafond).map(carte).join("")}</div>
      ${l.length > plafond ? `<button type="button" class="bouton secondaire plus" data-act="plus">Afficher ${Math.min(30, l.length - plafond)} de plus</button>` : ""}`;
  }

  ECRANS.outil = function (p) {
    const o = S.outils.get(p.id);
    if (!o) return ECRANS.introuvable();
    const cmp = Store.comparaison.a(o.id);
    const alt = alternatives(o);
    const parcours = S.parcoursDe.get(o.id) || [];
    const badges = [];
    if (o.fr) badges.push("🇫🇷 En français");
    if (o.sanscompte) badges.push("🚀 Sans compte");
    if (o.libre) badges.push("🔓 Open source");
    if (o.local) badges.push("🔒 Fonctionne hors ligne");
    return `${entete("", { droite: `<button type="button" class="icone" data-act="partager" data-id="${esc(o.id)}" aria-label="Partager">${I.partager}</button>` })}
    <div class="page fiche">
      <section class="fiche-tete">
        ${logo(o, "grand")}
        <div class="fiche-titre">
          <h1>${esc(o.nom)}</h1>
          <p>par ${esc(o.par)} · ${esc(hote(o.url))}</p>
          <div class="fiche-badges">${badgePrix(o)}${o.choix ? '<span class="puce choix">★ Coup de cœur</span>' : ""}</div>
        </div>
      </section>
      <p class="fiche-resume">${esc(o.resume)}</p>
      <button type="button" class="bouton principal" data-act="site" data-id="${esc(o.id)}">Ouvrir ${esc(o.nom)} ${I.externe}</button>
      <div class="fiche-actions">
        ${boutonFav(o, true)}
        <button type="button" class="action${cmp ? " on" : ""}" data-act="cmp" data-id="${esc(o.id)}" aria-pressed="${cmp}">${I.comparer}<span>${cmp ? "Comparé" : "Comparer"}</span></button>
        <button type="button" class="action" data-act="partager" data-id="${esc(o.id)}">${I.partager}<span>Partager</span></button>
      </div>

      <section class="bloc prix-bloc p-${o.prix}">
        <h2>${PRIX[o.prix].long}</h2>
        ${o.gratuit ? `<p><strong>Gratuit :</strong> ${esc(o.gratuit)}</p>` : ""}
        ${o.tarif ? `<p><strong>Tarif :</strong> ${esc(o.tarif)}</p>` : ""}
      </section>

      <section class="bloc">
        <h2>En bref</h2>
        <p>${esc(o.desc)}</p>
        ${badges.length ? `<div class="puces">${badges.map((b) => `<span class="puce">${esc(b)}</span>`).join("")}</div>` : ""}
      </section>

      <section class="duo">
        <div class="bloc plus-bloc"><h2>Points forts</h2><ul>${o.forts.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="bloc moins-bloc"><h2>À savoir</h2><ul>${o.limites.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </section>

      <section class="bloc">
        <h2>Disponible sur</h2>
        <div class="puces">${o.plat.map((x) => `<span class="puce plat">${esc(PLATS[x] || x)}</span>`).join("")}</div>
        <h2 class="h2-suite">Catégories</h2>
        <div class="puces">${o.cat.map((id) => S.cats.get(id)).filter(Boolean).map((x) => `<button type="button" class="puce lien-puce" data-act="cat" data-id="${esc(x.id)}">${esc(x.icone)} ${esc(x.nom)}</button>`).join("")}</div>
      </section>

      ${parcours.length ? `<section class="sec">
        <div class="sec-tete"><h2>Utilisé dans les parcours</h2></div>
        <div class="liste-parcours">${parcours.map((x) => `<button type="button" class="ligne" data-act="parcours" data-id="${esc(x.id)}"><span class="ligne-icone">${esc(x.icone)}</span><span class="ligne-texte"><strong>${esc(x.titre)}</strong></span>${I.fleche}</button>`).join("")}</div>
      </section>` : ""}

      ${alt.length ? `<section class="sec">
        <div class="sec-tete"><h2>Alternatives</h2></div>
        <div class="liste">${alt.map(carte).join("")}</div>
      </section>` : ""}

      <p class="pied">Informations du catalogue du ${esc(dateFr(S.cat.maj))}. Les prix et offres gratuites changent souvent : vérifie sur le site officiel.
        <button type="button" class="lien" data-act="signaler" data-id="${esc(o.id)}">${I.drapeau} Signaler une erreur</button></p>
    </div>`;
  };

  ECRANS.parcours = function (p) {
    const x = S.cat.parcours.find((y) => y.id === p.id);
    if (!x) return ECRANS.introuvable();
    return `${entete(`${esc(x.icone)} Parcours`)}
    <div class="page">
      <h1 class="grand-titre">${esc(x.titre)}</h1>
      <p class="intro">${esc(x.intro)}</p>
      <ol class="etapes">${x.etapes.map((e, i) => `<li class="etape">
        <span class="etape-num">${i + 1}</span>
        <div class="etape-corps">
          <h3>${esc(e.titre)}</h3>
          <p>${esc(e.texte)}</p>
          <div class="minis">${e.outils.map((id) => S.outils.get(id)).filter(Boolean).map(mini).join("")}</div>
        </div>
      </li>`).join("")}</ol>
    </div>`;
  };

  ECRANS.favoris = function () {
    const l = Store.favoris.tous().map((id) => S.outils.get(id)).filter(Boolean);
    return `${entete("Favoris", { retour: false })}
    <div class="page">
      ${l.length ? `<div class="compte"><span>${pluriel(l.length, "IA enregistrée", "IA enregistrées")}</span></div><div class="liste">${l.map(carte).join("")}</div>`
        : `<div class="vide grand-vide"><span class="vide-icone">${I.coeur}</span><strong>Aucun favori pour l'instant</strong>
          <p>Touche le cœur d'une IA pour la retrouver ici, même hors connexion.</p>
          <button type="button" class="bouton principal" data-act="col" data-id="choix">Voir nos coups de cœur</button></div>`}
    </div>`;
  };

  ECRANS.comparer = function () {
    const l = Store.comparaison.tous().map((id) => S.outils.get(id)).filter(Boolean);
    if (!l.length) {
      return `${entete("Comparer")}<div class="page"><div class="vide grand-vide"><span class="vide-icone">${I.comparer}</span>
        <strong>Rien à comparer</strong><p>Sur la fiche d'une IA, touche « Comparer » (jusqu'à ${Store.comparaison.MAX} outils).</p></div></div>`;
    }
    const lignes = [
      ["Prix", (o) => badgePrix(o)],
      ["Gratuit", (o) => esc(o.gratuit || "—")],
      ["Tarif", (o) => esc(o.tarif || "—")],
      ["Points forts", (o) => `<ul>${o.forts.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`],
      ["À savoir", (o) => `<ul>${o.limites.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`],
      ["Plateformes", (o) => esc(o.plat.map((x) => PLATS[x] || x).join(", "))],
      ["En français", (o) => (o.fr ? "Oui" : "Non")],
      ["Sans compte", (o) => (o.sanscompte ? "Oui" : "Non")],
      ["Open source", (o) => (o.libre ? "Oui" : "Non")],
      ["Hors ligne", (o) => (o.local ? "Oui" : "Non")],
    ];
    return `${entete("Comparer", { droite: `<button type="button" class="icone" data-act="vider-cmp" aria-label="Vider">${I.croix}</button>` })}
    <div class="page">
      <div class="comparatif" style="--n:${l.length}">
        <div class="cmp-tetes">${l.map((o) => `<div class="cmp-tete">
          <button type="button" class="cmp-retirer" data-act="retirer-cmp" data-id="${esc(o.id)}" aria-label="Retirer ${esc(o.nom)}">${I.croix}</button>
          <button type="button" class="cmp-outil" data-act="outil" data-id="${esc(o.id)}">${logo(o)}<strong>${esc(o.nom)}</strong></button>
        </div>`).join("")}</div>
        ${lignes.filter(([titre]) => titre !== "Tarif" || l.some((o) => o.tarif)).map(([titre, f]) => `<div class="cmp-ligne"><h3>${titre}</h3><div class="cmp-cellules">${l.map((o) => `<div class="cmp-cellule">${f(o)}</div>`).join("")}</div></div>`).join("")}
        <div class="cmp-cellules cmp-boutons">${l.map((o) => `<button type="button" class="bouton secondaire" data-act="site" data-id="${esc(o.id)}">Ouvrir ${I.externe}</button>`).join("")}</div>
      </div>
      ${l.length < Store.comparaison.MAX ? `<p class="astuce">Ajoute ${Store.comparaison.MAX - l.length === 1 ? "une autre IA" : "d'autres IA"} depuis leur fiche pour comparer.</p>` : ""}
    </div>`;
  };

  ECRANS.reglages = function () {
    const r = S.reglages;
    const c = S.cat;
    const verif = Store.derniereVerif();
    const version = native && native.appVersion ? safe(() => native.appVersion(), "") : "";
    return `${entete("Réglages", { retour: false })}
    <div class="page">
      <section class="bloc">
        <h2>Apparence</h2>
        <div class="segment" role="radiogroup" aria-label="Thème">${[["auto", "Auto"], ["sombre", "Sombre"], ["clair", "Clair"]]
          .map(([v, n]) => `<button type="button" role="radio" aria-checked="${r.theme === v}" class="${r.theme === v ? "on" : ""}" data-act="theme" data-v="${v}">${n}</button>`).join("")}</div>
        <label class="interrupteur"><span><strong>Logos des sites</strong><small>Télécharge le logo de chaque IA (sinon, initiales colorées).</small></span>
          <input type="checkbox" data-act="logos"${r.logos ? " checked" : ""}><i></i></label>
      </section>

      <section class="bloc">
        <h2>Catalogue</h2>
        <p><strong>${c.outils.length} IA</strong> · ${c.categories.length} catégories · ${c.parcours.length} parcours</p>
        <p>Version ${c.version} du ${esc(dateFr(c.maj))} · ${S.source === "enligne" ? "mise à jour en ligne" : "intégrée à l'appli"}</p>
        <label class="interrupteur"><span><strong>Mise à jour automatique</strong><small>Récupère les nouvelles IA ajoutées au catalogue, sans réinstaller l'appli.</small></span>
          <input type="checkbox" data-act="majauto"${r.majAuto ? " checked" : ""}><i></i></label>
        <button type="button" class="bouton secondaire" data-act="maj"${S.majEnCours ? " disabled" : ""}>${S.majEnCours ? "Vérification…" : "Vérifier maintenant"}</button>
        <p class="petit" id="maj-statut">${esc(S.majStatut || (verif ? "Dernière vérification : " + new Date(verif).toLocaleString("fr-FR") : ""))}</p>
      </section>

      <section class="bloc">
        <h2>Participer</h2>
        <button type="button" class="ligne" data-act="proposer">${I.etincelle}<span class="ligne-texte"><strong>Proposer une IA</strong><small>Une IA manque ? Suggère-la.</small></span>${I.fleche}</button>
        <button type="button" class="ligne" data-act="lien" data-url="${DEPOT}">${I.externe}<span class="ligne-texte"><strong>Code source</strong><small>Le projet est sur GitHub.</small></span>${I.fleche}</button>
      </section>

      <section class="bloc">
        <h2>À propos</h2>
        <p>Trouve ton IA est un catalogue indépendant, gratuit, sans publicité et sans compte. Tes favoris restent sur ton téléphone.</p>
        <p class="petit">Les descriptions, prix et offres gratuites sont indicatifs et peuvent changer à tout moment : vérifie toujours sur le site officiel avant de payer. Les noms et logos appartiennent à leurs propriétaires respectifs.</p>
        ${version ? `<p class="petit">Version de l'appli : ${esc(version)}</p>` : ""}
      </section>
    </div>`;
  };

  ECRANS.introuvable = function () {
    return `${entete("Introuvable")}<div class="page"><div class="vide"><strong>Cette page n'existe plus</strong><p>Le catalogue a peut-être été mis à jour.</p></div></div>`;
  };

  function safe(f, defaut) {
    try {
      return f();
    } catch (e) {
      return defaut;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Navigation                                                        */
  /* ---------------------------------------------------------------- */

  const view = $("#view");

  function actuel() {
    return S.pile[S.pile.length - 1];
  }

  function rendre(anim) {
    const e = actuel();
    view.innerHTML = ECRANS[e.ecran](e.p || {});
    view.dataset.ecran = e.ecran;
    document.body.dataset.ecran = e.ecran;
    for (const b of document.querySelectorAll(".tabbar .tab")) b.classList.toggle("on", b.dataset.tab === S.onglet);
    majTray();
    if (anim) {
      view.classList.remove("entre", "sort");
      void view.offsetWidth;
      view.classList.add(anim);
    }
    if (e.ecran === "recherche") brancherRecherche(e);
    retourNatif();
  }

  function aller(ecran, p) {
    const e = actuel();
    if (e) e.scroll = view.scrollTop;
    S.pile.push({ ecran, p: p || {} });
    rendre("entre");
    view.scrollTop = 0;
    if (ecran === "outil") Store.vus.ajouter(p.id);
  }

  function retour() {
    if (S.pile.length <= 1) return false;
    S.pile.pop();
    rendre("sort");
    const e = actuel();
    view.scrollTop = e.scroll || 0;
    return true;
  }

  function onglet(nom) {
    S.onglet = nom;
    S.pile = [{ ecran: nom, p: {} }];
    rendre("entre");
    view.scrollTop = 0;
  }

  function retourNatif() {
    const actif = S.pile.length > 1 || S.onglet !== "accueil";
    try {
      if (native) native.setBackEnabled(actif);
    } catch (e) {
      /* ignore */
    }
  }

  window.appBack = function () {
    if (retour()) return true;
    if (S.onglet !== "accueil") {
      onglet("accueil");
      return true;
    }
    return false;
  };

  /* ---------------------------------------------------------------- */
  /* Recherche en direct                                               */
  /* ---------------------------------------------------------------- */

  function brancherRecherche(e) {
    const champ = $("#q");
    if (!champ) return;
    let minuteur = 0;
    champ.addEventListener("input", () => {
      e.p.q = champ.value;
      e.p.plafond = 0;
      $(".effacer").hidden = !champ.value;
      clearTimeout(minuteur);
      minuteur = setTimeout(() => majResultats(), 90);
    });
    champ.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        Store.recherches.ajouter(champ.value);
        champ.blur();
      }
    });
    champ.addEventListener("blur", () => Store.recherches.ajouter(champ.value));
    if (!e.p.q) setTimeout(() => champ.focus(), 60);
  }

  function majResultats() {
    const e = actuel();
    const res = $("#res");
    if (!res) return;
    if (e.ecran === "recherche") res.innerHTML = resultatsRecherche(e.p);
    else if (e.ecran === "liste") res.innerHTML = resultatsListe(e.p);
    const barre = view.querySelector(".filtres");
    if (barre) barre.outerHTML = puceFiltres(e.p.f || {});
  }

  /* ---------------------------------------------------------------- */
  /* Comparaison (bandeau)                                             */
  /* ---------------------------------------------------------------- */

  function majTray() {
    const l = Store.comparaison.tous().map((id) => S.outils.get(id)).filter(Boolean);
    const tray = $("#tray");
    const cache = !l.length || actuel().ecran === "comparer" || actuel().ecran === "recherche";
    tray.hidden = cache;
    document.body.classList.toggle("avec-tray", !cache);
    if (cache) return;
    $("#tray-logos").innerHTML = l.map((o) => logo(o, "petit")).join("");
    $("#tray-go").textContent = `Comparer (${l.length})`;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  function lienProposer(q) {
    const titre = "Proposer une IA : " + (q || "");
    const corps = "Nom de l'IA :\nSite officiel :\nÀ quoi elle sert :\nGratuite / payante :\n\n(Envoyé depuis l'appli Trouve ton IA)";
    return `${DEPOT}/issues/new?title=${encodeURIComponent(titre)}&body=${encodeURIComponent(corps)}`;
  }

  function lienSignaler(o) {
    const titre = `Erreur sur la fiche ${o.nom}`;
    const corps = `Fiche : ${o.nom} (${o.id})\nCe qui est faux :\nLa bonne information (avec un lien si possible) :\n\n(Envoyé depuis l'appli Trouve ton IA)`;
    return `${DEPOT}/issues/new?title=${encodeURIComponent(titre)}&body=${encodeURIComponent(corps)}`;
  }

  function basculerFav(id, bouton) {
    const on = Store.favoris.basculer(id);
    haptic(on ? "confirm" : "tick");
    const e = actuel();
    if (e.ecran === "favoris") {
      const s = view.scrollTop;
      rendre();
      view.scrollTop = s;
      return;
    }
    for (const b of view.querySelectorAll(`.fav[data-id="${CSS.escape(id)}"]`)) {
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
      b.setAttribute("aria-label", on ? "Retirer des favoris" : "Ajouter aux favoris");
      const t = b.querySelector("span");
      if (t) t.textContent = on ? "Favori" : "Favoris";
    }
    if (bouton && on) {
      bouton.classList.remove("pop");
      void bouton.offsetWidth;
      bouton.classList.add("pop");
    }
    toast(on ? "Ajouté aux favoris" : "Retiré des favoris");
  }

  function basculerCmp(id) {
    const r = Store.comparaison.basculer(id);
    if (r === "plein") {
      haptic("long");
      toast(`${Store.comparaison.MAX} outils maximum : retire-en un pour comparer.`);
      return;
    }
    haptic("tick");
    const b = view.querySelector(`.action[data-act="cmp"][data-id="${CSS.escape(id)}"]`);
    if (b) {
      const on = r === "ajoute";
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
      b.querySelector("span").textContent = on ? "Comparé" : "Comparer";
    }
    majTray();
    toast(r === "ajoute" ? "Ajouté à la comparaison" : "Retiré de la comparaison");
  }

  async function verifierMaj(force) {
    if (S.majEnCours) return;
    S.majEnCours = true;
    if (force) {
      S.majStatut = "Vérification…";
      if (actuel().ecran === "reglages") rendre();
    }
    const r = await Store.verifierMaj(S.cat, force);
    S.majEnCours = false;
    if (r.statut === "maj") {
      indexer(r.catalogue, "enligne");
      S.majStatut = `Catalogue mis à jour : version ${r.catalogue.version}`;
      toast(r.nouveaux.length ? `Catalogue mis à jour : ${pluriel(r.nouveaux.length, "nouvelle IA", "nouvelles IA")}` : "Catalogue mis à jour");
      const s = view.scrollTop;
      rendre();
      view.scrollTop = s;
      return;
    }
    if (!force) return;
    S.majStatut = {
      ajour: "Ton catalogue est déjà à jour.",
      erreur: "Impossible de vérifier : vérifie ta connexion Internet.",
      invalide: "Le catalogue en ligne est illisible, réessaie plus tard.",
      recent: "",
    }[r.statut];
    if (actuel().ecran === "reglages") rendre();
  }

  view.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el || !view.contains(el)) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    const e = actuel();
    switch (act) {
      case "outil":
        if (ev.target.closest(".fav")) return;
        aller("outil", { id });
        break;
      case "cat":
        aller("liste", { type: "cat", id });
        break;
      case "col":
        aller("liste", { type: "col", id });
        break;
      case "parcours":
        aller("parcours", { id });
        break;
      case "retour":
        window.appBack();
        break;
      case "onglet":
        onglet(el.dataset.tab);
        break;
      case "ouvrir-recherche":
        aller("recherche", { q: "" });
        break;
      case "chercher":
        Store.recherches.ajouter(el.dataset.q);
        if (e.ecran === "recherche") {
          e.p.q = el.dataset.q;
          e.p.plafond = 0;
          $("#q").value = e.p.q;
          $(".effacer").hidden = false;
          majResultats();
          view.scrollTop = 0;
        } else aller("recherche", { q: el.dataset.q });
        break;
      case "effacer-q":
        e.p.q = "";
        $("#q").value = "";
        el.hidden = true;
        majResultats();
        $("#q").focus();
        break;
      case "vider-recents":
        Store.recherches.vider();
        majResultats();
        break;
      case "plus":
        e.p.plafond = (e.p.plafond || 30) + 30;
        majResultats();
        break;
      case "filtre": {
        const cle = el.dataset.cle;
        e.p.f = e.p.f || {};
        e.p.f[cle] = !e.p.f[cle];
        if (cle === "gratuit" && e.p.f.gratuit) e.p.f.freemium = false;
        if (cle === "freemium" && e.p.f.freemium) e.p.f.gratuit = false;
        haptic("tick");
        majResultats();
        break;
      }
      case "fav":
        ev.stopPropagation();
        basculerFav(id, el);
        break;
      case "cmp":
        basculerCmp(id);
        break;
      case "retirer-cmp":
        Store.comparaison.basculer(id);
        rendre();
        break;
      case "vider-cmp":
        Store.comparaison.vider();
        retour() || rendre();
        break;
      case "site": {
        const o = S.outils.get(id);
        if (o) ouvrirLien(o.url);
        break;
      }
      case "partager": {
        const o = S.outils.get(id);
        if (o) partager(o.nom, `${o.nom} — ${o.resume}\n${o.url}\n\nTrouvé avec l'appli Trouve ton IA`);
        break;
      }
      case "signaler": {
        const o = S.outils.get(id);
        if (o) ouvrirLien(lienSignaler(o));
        break;
      }
      case "proposer":
        ouvrirLien(lienProposer(el.dataset.q));
        break;
      case "lien":
        ouvrirLien(el.dataset.url);
        break;
      case "theme":
        S.reglages = Store.reglages.ecrire({ theme: el.dataset.v });
        appliquerTheme();
        rendre();
        break;
      case "maj":
        verifierMaj(true);
        break;
      default:
        break;
    }
  });

  view.addEventListener("change", (ev) => {
    const el = ev.target;
    const e = actuel();
    if (el.dataset.act === "tri") {
      e.p.tri = el.value;
      majResultats();
    } else if (el.dataset.act === "logos") {
      S.reglages = Store.reglages.ecrire({ logos: el.checked });
    } else if (el.dataset.act === "majauto") {
      S.reglages = Store.reglages.ecrire({ majAuto: el.checked });
      if (el.checked) verifierMaj(false);
    }
  });

  view.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || !ev.target.matches("article[data-act]")) return;
    ev.target.click();
  });

  for (const b of document.querySelectorAll(".tabbar .tab")) {
    b.addEventListener("click", () => {
      haptic("tick");
      if (S.onglet === b.dataset.tab && S.pile.length === 1) view.scrollTo({ top: 0, behavior: "smooth" });
      else onglet(b.dataset.tab);
    });
  }

  $("#tray-go").addEventListener("click", () => aller("comparer"));
  $("#tray-x").addEventListener("click", () => {
    Store.comparaison.vider();
    majTray();
    if (actuel().ecran === "outil") rendre();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") window.appBack();
  });

  /* ---------------------------------------------------------------- */
  /* Thème, encarts système                                            */
  /* ---------------------------------------------------------------- */

  function sombreSysteme() {
    if (native && native.isSystemDark) return safe(() => native.isSystemDark(), true);
    return !window.matchMedia || window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function appliquerTheme() {
    const t = S.reglages.theme;
    const sombre = t === "sombre" || (t === "auto" && sombreSysteme());
    document.documentElement.dataset.theme = sombre ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = sombre ? "#0a0b14" : "#f5f6fb";
    try {
      if (native) native.setSystemBars(sombre);
    } catch (e) {
      /* ignore */
    }
  }

  window.appSystemTheme = appliquerTheme;
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", appliquerTheme);
  }

  window.appInsets = function (t, r, b, l, kb) {
    const s = document.documentElement.style;
    s.setProperty("--st", t + "px");
    s.setProperty("--sr", r + "px");
    s.setProperty("--sb", b + "px");
    s.setProperty("--sl", l + "px");
    s.setProperty("--kb", (kb || 0) + "px");
    S.kb = kb || 0;
    document.body.classList.toggle("clavier", S.kb > 40);
  };

  /* ---------------------------------------------------------------- */
  /* Démarrage                                                         */
  /* ---------------------------------------------------------------- */

  let exemple = 0;
  setInterval(() => {
    const ph = $("#ph");
    if (!ph) return;
    exemple = (exemple + 1) % EXEMPLES.length;
    ph.classList.add("fondu");
    setTimeout(() => {
      ph.textContent = `Que veux-tu faire ? « ${EXEMPLES[exemple]} »`;
      ph.classList.remove("fondu");
    }, 220);
  }, 3800);

  async function demarrer() {
    appliquerTheme();
    if (native) {
      const ins = safe(() => JSON.parse(native.getInsets()), null);
      if (ins) window.appInsets(ins.top, ins.right, ins.bottom, ins.left, ins.kb);
    }
    try {
      const r = await Store.charger();
      indexer(r.catalogue, r.source);
    } catch (e) {
      view.innerHTML = `<div class="page"><div class="vide grand-vide"><strong>Le catalogue n'a pas pu être chargé</strong><p>Redémarre l'application.</p></div></div>`;
      return;
    }
    onglet("accueil");
    if (S.reglages.majAuto) setTimeout(() => verifierMaj(false), 1500);
  }

  demarrer();
})();
