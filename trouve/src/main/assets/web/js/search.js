/* Trouve ton IA — moteur de recherche en français (hors ligne).
 *
 * Comprend les phrases naturelles (« je veux enlever le fond d'une photo »),
 * ignore accents, pluriels et mots vides, connaît les synonymes courants et
 * tolère les fautes de frappe (« chatgtp », « mid journey »).
 * Utilisable dans le navigateur (window.Recherche) et dans Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Recherche = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- */
  /* Normalisation                                                     */
  /* ---------------------------------------------------------------- */

  function normaliser(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // Mots sans intérêt pour la recherche (après normalisation).
  const VIDES = new Set((
    "a au aux avec ce ces cet cette c d de des du elle en est et etre il ils j je l la le les leur lui m ma me mes moi mon " +
    "n ne nous on ou par pas pour qu que quel quelle quels quelles qui quoi s sa se ses sur t ta te tes toi ton tu un une " +
    "vos votre vous y dans comme comment faire fais fait veux voudrais aimerais souhaite souhaiterais peux peut pouvoir " +
    "besoin cherche chercher recherche trouver trouve ia ai intelligence artificielle outil outils logiciel truc chose " +
    "meilleur meilleure meilleurs meilleures bon bonne bien super top tres plus genre svp stp merci aider aide moyen " +
    "permet permettre utiliser util quelque quelqu tout tous toute toutes mais donc car alors aussi encore deja the of to and for"
  ).split(" "));

  // Terminaisons retirées pour rapprocher les formes d'un même mot (vidéos → vidéo, animer → anim…).
  const FINS = [
    "issements", "issement", "ations", "ation", "itions", "ition", "ements", "ement", "euses", "euse", "eurs", "eur",
    "trices", "trice", "ions", "ion", "ers", "er", "ez", "ees", "ee", "es", "e", "s", "x",
  ];

  function racine(mot) {
    if (mot.length <= 3 || /^\d/.test(mot)) return mot;
    for (const fin of FINS) {
      if (!mot.endsWith(fin)) continue;
      const reste = mot.length - fin.length;
      if (reste >= (fin.length === 1 && fin !== "e" ? 3 : 4)) return mot.slice(0, reste);
    }
    return mot;
  }

  function mots(s) {
    const n = normaliser(s);
    return n ? n.split(" ") : [];
  }

  /* ---------------------------------------------------------------- */
  /* Synonymes et intentions                                           */
  /* ---------------------------------------------------------------- */

  // Chaque groupe relie des mots qui désignent le même besoin.
  const GROUPES = [
    ["photo", "image", "illustration", "dessin", "picture"],
    ["video", "film", "clip", "vid"],
    ["musique", "chanson", "son", "morceau", "zik", "music", "song"],
    ["instru", "instrumental", "beat", "prod"],
    ["traduire", "traduction", "traducteur", "translate"],
    ["corriger", "correction", "correcteur", "faute", "orthographe", "grammaire"],
    ["reformuler", "paraphraser", "reecrire"],
    ["resumer", "resume", "synthese", "synthetiser"],
    ["devoir", "exercice", "homework"],
    ["math", "maths", "mathematique", "mathematiques"],
    ["reviser", "revision", "etudier", "apprendre"],
    ["presentation", "diaporama", "powerpoint", "ppt", "slide", "slides", "diapo", "expose"],
    ["site", "web", "landing"],
    ["appli", "application", "app", "apps"],
    ["code", "coder", "programmer", "programmation", "developper", "dev"],
    ["voix", "vocal", "tts", "narration"],
    ["lire", "lecture", "lecteur", "ecouter"],
    ["transcrire", "transcription", "retranscrire", "dictee", "dicter"],
    ["sous", "soustitre", "soustitres", "subtitle", "caption", "captions"],
    ["enlever", "supprimer", "effacer", "retirer", "gomme", "gommer"],
    ["fond", "arriere", "background"],
    ["detourer", "detourage", "detoure"],
    ["agrandir", "upscale", "upscaler", "hd", "4k", "resolution", "qualite"],
    ["ameliorer", "nettete", "flou"],
    ["restaurer", "ancienne", "vieille", "abimee", "coloriser"],
    ["animer", "animation", "anime"],
    ["generer", "creer", "creation", "fabriquer", "produire"],
    ["tiktok", "reels", "reel", "shorts", "short"],
    ["pub", "publicite", "ads", "annonce"],
    ["post", "publication", "reseaux", "sociaux", "instagram", "facebook", "linkedin"],
    ["logo", "marque", "branding", "identite"],
    ["cv", "curriculum"],
    ["entretien", "embauche", "interview"],
    ["emploi", "job", "travail", "boulot", "stage", "alternance"],
    ["reunion", "visio", "zoom", "teams", "meet"],
    ["telephone", "portable", "mobile", "smartphone", "android"],
    ["ordinateur", "pc", "windows", "mac", "linux"],
    ["local", "hors", "offline", "prive", "confidentiel"],
    ["libre", "opensource", "open"],
    ["chatbot", "assistant", "discuter", "discussion", "parler"],
    ["question", "repondre", "reponse", "demander"],
    ["mail", "email", "courriel", "mails"],
    ["excel", "tableur", "tableau", "sheets", "donnees"],
    ["jeu", "jeux", "game", "gaming"],
    ["deco", "decoration", "interieur", "maison"],
    ["detecter", "detecteur", "detection", "plagiat"],
    ["separer", "isoler", "stems", "karaoke", "acapella"],
    ["chanter", "chant", "chanteur", "chanteuse"],
    ["paroles", "lyrics"],
    ["vendre", "vente", "boutique", "ecommerce", "vinted", "leboncoin"],
    ["affiche", "flyer", "poster", "miniature"],
    ["avatar", "clone", "presentateur", "double"],
    ["podcast", "emission"],
    ["anglais", "english"],
  ];

  // Noms courants mal orthographiés ou découpés.
  const ALIAS = {
    chatgpt: ["chatgpt", "chat gpt", "gpt", "openai"],
    claude: ["anthropic"],
    gemini: ["bard", "google ia"],
    lechat: ["mistral", "le chat"],
    midjourney: ["mid journey", "midjourney"],
    elevenlabs: ["eleven labs", "11labs"],
    capcut: ["cap cut"],
    ghcopilot: ["github copilot"],
    deepl: ["deep l"],
  };

  const SYN = new Map();
  for (const g of GROUPES) {
    const rac = [...new Set(g.flatMap((w) => mots(w)).map(racine))];
    for (const r of rac) {
      const prev = SYN.get(r) || new Set();
      rac.forEach((x) => x !== r && prev.add(x));
      SYN.set(r, prev);
    }
  }

  // Intentions repérées dans la phrase : elles orientent le classement.
  const INTENTIONS = [
    { cle: "gratuit", motifs: ["gratuit", "gratuite", "gratuits", "gratuites", "gratuitement", "free", "sans payer", "pas cher", "0 euro"] },
    { cle: "sanscompte", motifs: ["sans compte", "sans inscription", "sans s inscrire", "sans login", "anonyme"] },
    { cle: "android", motifs: ["android", "telephone", "portable", "smartphone", "mobile", "appli mobile"] },
    { cle: "fr", motifs: ["francais", "en francais", "french"] },
    { cle: "local", motifs: ["hors ligne", "sans internet", "offline", "en local", "sur mon pc", "sur mon ordinateur", "prive", "confidentiel"] },
    { cle: "libre", motifs: ["open source", "opensource", "libre"] },
  ];

  function intentions(texte) {
    return detecter(texte).intentions;
  }

  // Intentions trouvées et mots qui les expriment (ces mots pèsent ensuite moins dans la recherche).
  function detecter(texte) {
    const n = " " + normaliser(texte) + " ";
    const out = {};
    const motsIntention = new Set();
    for (const it of INTENTIONS) {
      for (const m of it.motifs) {
        if (!n.includes(" " + m + " ")) continue;
        out[it.cle] = true;
        m.split(" ").forEach((w) => motsIntention.add(w));
      }
    }
    return { intentions: out, mots: motsIntention };
  }

  // Verbes trop généraux pour départager les outils (« créer une chanson » : c'est « chanson » qui compte).
  const GENERIQUES = new Set(["creer", "cree", "generer", "genere", "fabriquer", "produire", "realiser", "obtenir", "avoir", "mettre"].map(racine));

  /* ---------------------------------------------------------------- */
  /* Distance de frappe (Damerau-Levenshtein restreinte)               */
  /* ---------------------------------------------------------------- */

  function distance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const la = a.length;
    const lb = b.length;
    let prev2 = null;
    let prev = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      const cur = new Array(lb + 1);
      cur[0] = i;
      let best = cur[0];
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[lb];
  }

  /* ---------------------------------------------------------------- */
  /* Index                                                             */
  /* ---------------------------------------------------------------- */

  const POIDS = { nom: 10, alias: 9, tags: 5, cat1: 3, cat2: 2, resume: 2.5, par: 2, desc: 1, gratuit: 0.5 };

  function ensemble(texte) {
    const s = new Set();
    for (const w of mots(texte)) if (!VIDES.has(w)) s.add(racine(w));
    return s;
  }

  function creerIndex(catalogue) {
    const cats = new Map((catalogue.categories || []).map((c) => [c.id, c]));
    const motsCat = new Map();
    for (const c of cats.values()) motsCat.set(c.id, ensemble([c.nom, ...(c.mots || [])].join(" ")));

    const entrees = (catalogue.outils || []).map((o) => {
      const champs = {
        nom: ensemble(o.nom),
        alias: ensemble((ALIAS[o.id] || []).join(" ")),
        tags: ensemble((o.tags || []).join(" ")),
        cat1: motsCat.get(o.cat[0]) || new Set(),
        cat2: new Set([].concat(...(o.cat || []).slice(1).map((id) => [...(motsCat.get(id) || [])]))),
        resume: ensemble(o.resume),
        par: ensemble(o.par),
        desc: ensemble(o.desc),
        gratuit: ensemble(o.gratuit),
      };
      const tous = new Set();
      for (const k in champs) champs[k].forEach((w) => tous.add(w));
      const compacts = [normaliser(o.nom).replace(/ /g, "")]
        .concat((ALIAS[o.id] || []).map((a) => normaliser(a).replace(/ /g, "")));
      return { outil: o, champs, tous: [...tous], compacts };
    });

    return { catalogue, entrees, motsCat };
  }

  /* ---------------------------------------------------------------- */
  /* Recherche                                                         */
  /* ---------------------------------------------------------------- */

  // Qualité de la correspondance entre un mot de la requête et un mot indexé.
  function qualite(q, w) {
    if (q === w) return 1;
    if (q.length >= 3 && w.startsWith(q)) return 0.75;
    if (w.length >= 4 && q.length > w.length && q.startsWith(w)) return 0.6;
    if (q.length >= 5) {
      const max = q.length >= 8 ? 2 : 1;
      const d = distance(q, w, max);
      if (d <= max) return d === 1 ? 0.55 : 0.4;
    }
    return 0;
  }

  function analyser(texte) {
    const bruts = mots(texte).filter((w) => !VIDES.has(w));
    const d = detecter(texte);
    const termes = [];
    for (const w of bruts) {
      const r = racine(w);
      const syn = [...(SYN.get(r) || [])];
      // Mot « faible » : intention (gratuit, android…) ou verbe générique. Il compte peu et
      // n'est pas exigé dans les résultats, sauf si la requête ne contient rien d'autre.
      termes.push({ mot: w, racine: r, syn, faible: d.mots.has(w) || GENERIQUES.has(r) });
    }
    if (termes.every((t) => t.faible)) termes.forEach((t) => (t.faible = false));
    return { termes, compact: bruts.join(""), complet: mots(texte).join(""), intentions: d.intentions };
  }

  function scoreTerme(e, t, long) {
    let total = 0;
    for (const champ in POIDS) {
      const set = e.champs[champ];
      if (!set.size) continue;
      let best = 0;
      if (set.has(t.racine)) best = 1;
      else {
        for (const s of t.syn) if (set.has(s)) { best = 0.6; break; }
        if (best < 0.6) {
          for (const w of set) {
            const qv = qualite(t.racine, w);
            if (qv > best) best = qv;
            if (best >= 0.75) break;
          }
        }
      }
      // Dans une phrase longue, le nom compte moins : « une vidéo de mon chat » ne vise pas « Le Chat ».
      const poids = long && (champ === "nom" || champ === "alias") ? POIDS[champ] * 0.4 : POIDS[champ];
      total += poids * best;
    }
    return total;
  }

  function chercher(index, texte, options) {
    const opts = options || {};
    const a = analyser(texte);
    if (!a.termes.length) return { resultats: [], categorie: null, intentions: a.intentions };

    const resultats = [];
    for (const e of index.entrees) {
      let score = 0;
      let couverts = 0;
      const forts = a.termes.filter((t) => !t.faible).length;
      const long = forts >= 3;
      for (const t of a.termes) {
        const s = scoreTerme(e, t, long);
        if (t.faible) {
          score += s * 0.3;
          continue;
        }
        if (s > 0) couverts++;
        score += s;
      }
      // Nom écrit d'un bloc ou en plusieurs morceaux (« chat gpt », « le chat », « midjourney »).
      if (a.complet.length >= 3) {
        for (const c of e.compacts) {
          if (c === a.complet || c === a.compact) score += 40;
          else if (c.startsWith(a.complet) && a.complet.length >= 4) score += 18;
          else if (a.complet.length >= 5 && distance(a.complet, c, 1) <= 1) score += 25;
        }
      }
      if (score <= 0) continue;
      score *= Math.pow(couverts / forts, 1.5) || 0.2;
      const o = e.outil;
      const it = a.intentions;
      if (it.gratuit) score *= o.prix === "gratuit" ? 1.5 : o.prix === "freemium" ? 1.15 : 0.55;
      if (it.sanscompte) score *= o.sanscompte ? 1.5 : 0.7;
      if (it.android) score *= (o.plat || []).includes("android") ? 1.3 : 0.75;
      if (it.fr) score *= o.fr ? 1.2 : 0.7;
      if (it.local) score *= o.local ? 1.6 : 0.8;
      if (it.libre) score *= o.libre ? 1.5 : 0.75;
      if (o.choix) score *= 1.12;
      resultats.push({ outil: o, score });
    }
    resultats.sort((x, y) => y.score - x.score || x.outil.nom.localeCompare(y.outil.nom, "fr"));
    const top = resultats.length ? resultats[0].score : 0;
    const seuil = Math.max(1, top * (opts.seuil == null ? 0.12 : opts.seuil));
    const garde = resultats.filter((r) => r.score >= seuil);
    return { resultats: garde, categorie: deviner(index, a, garde), intentions: a.intentions };
  }

  // Catégorie la plus probable pour la requête (pour proposer « Voir toute la catégorie ») :
  // mots-clés de la catégorie, départagés par la catégorie principale des meilleurs résultats.
  function deviner(index, a, resultats) {
    const bonus = new Map();
    (resultats || []).slice(0, 5).forEach((r, i) => {
      const id = r.outil.cat[0];
      bonus.set(id, (bonus.get(id) || 0) + (0.5 * (5 - i)) / 5);
    });
    let best = null;
    let bestScore = 0;
    for (const [id, set] of index.motsCat) {
      let s = 0;
      for (const t of a.termes) {
        if (set.has(t.racine)) s += 1;
        else if (t.syn.some((x) => set.has(x))) s += 0.6;
      }
      if (s > 0) s += bonus.get(id) || 0;
      if (s > bestScore) {
        bestScore = s;
        best = id;
      }
    }
    return bestScore >= 0.6 ? best : null;
  }

  /* ---------------------------------------------------------------- */
  /* Filtres                                                           */
  /* ---------------------------------------------------------------- */

  function correspond(o, f) {
    if (!f) return true;
    if (f.cat && !(o.cat || []).includes(f.cat)) return false;
    if (f.prix && f.prix.length && !f.prix.includes(o.prix)) return false;
    if (f.sanscompte && !o.sanscompte) return false;
    if (f.fr && !o.fr) return false;
    if (f.libre && !o.libre) return false;
    if (f.local && !o.local) return false;
    if (f.choix && !o.choix) return false;
    if (f.plat && !(o.plat || []).includes(f.plat)) return false;
    if (f.tag && !(o.tags || []).map(normaliser).includes(normaliser(f.tag))) return false;
    return true;
  }

  function filtrer(outils, f) {
    return outils.filter((o) => correspond(o, f));
  }

  return { normaliser, racine, mots, distance, intentions, analyser, creerIndex, chercher, filtrer, correspond };
});
