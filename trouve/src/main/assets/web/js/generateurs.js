/* Trouve ton IA — générateurs gratuits utilisés par le studio, sans compte ni clé :
 * Pollinations (scénario et images, une demande à la fois par appareil), AI Horde (images par
 * les GPU de bénévoles, en parallèle) et LTX-Video sur Hugging Face (clips vidéo IA, petit quota
 * gratuit par adresse IP). Vérifiés par tools/trouve-recherche/sonder.js. Les demandes passent
 * par Natif (téléphone) ou fetch (navigateur). */
(function () {
  "use strict";

  const Natif = window.Natif;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  class ErreurGen extends Error {
    constructor(message, o) {
      super(message);
      Object.assign(this, o || {});
    }
  }

  function json(texte) {
    try {
      return JSON.parse(texte);
    } catch (e) {
      return null;
    }
  }

  // Durée d'attente demandée par un serveur (en-tête Retry-After), en millisecondes.
  function attenteDemandee(r, defaut) {
    const s = parseFloat(r && r.retry);
    return isFinite(s) && s >= 0 ? Math.min(s, 300) * 1000 + 500 : defaut;
  }

  /* ---------------------------------------------------------------- */
  /* Pollinations                                                      */
  /* ---------------------------------------------------------------- */

  const POLL_IMG = "https://image.pollinations.ai/prompt/";
  const POLL_TXT = "https://text.pollinations.ai/openai";
  // Limites gratuites : une image toutes les 45 s et un texte toutes les 30 s par adresse IP.
  const rythme = { image: 0, texte: 0 };

  function urlPollinations(t) {
    return `${POLL_IMG}${encodeURIComponent(t.prompt.slice(0, 900))}?width=${t.largeur}&height=${t.hauteur}&seed=${t.seed}&safe=true`;
  }

  async function texteIA(messages, o) {
    const opts = o || {};
    // Deux essais au plus : si le serveur est saturé ou injoignable, l'appli écrit elle-même le scénario.
    for (let essai = 0; essai < 2; essai++) {
      const attente = rythme.texte - Date.now();
      if (attente > 0) {
        if (opts.etat) opts.etat(`serveur gratuit : patiente ${Math.ceil(attente / 1000)} s`);
        await pause(attente);
      }
      if (opts.signal && opts.signal.annule) throw new ErreurGen("annulé");
      const r = await Natif.requete({ methode: "POST", url: POLL_TXT, corps: { model: "openai", messages, response_format: opts.json ? { type: "json_object" } : undefined, seed: Math.floor(Math.random() * 1e6) }, delai: 90000 });
      if (r.code) rythme.texte = Date.now() + 31000;
      if (r.code === 200) {
        const j = json(r.texte);
        const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (c) return c;
      }
      if (r.code === 402 || r.code === 429) rythme.texte = Date.now() + attenteDemandee(r, 31000);
      else if (!r.code) await pause(2000);
    }
    throw new ErreurGen("serveur de texte indisponible");
  }

  function extraireJSON(c) {
    const m = String(c).match(/\{[\s\S]*\}/);
    return m ? json(m[0]) : null;
  }

  /** Découpe l'idée en scènes : texte de voix off en français et prompt d'image en anglais. */
  async function scenario(o) {
    const n = o.n || 5;
    const systeme =
      "Tu es scénariste de vidéos courtes pour les réseaux sociaux. Réponds uniquement en JSON valide, sans texte autour.";
    const demande = `Idée de la vidéo : « ${o.idee} ».
Écris une vidéo de ${n} scènes qui s'enchaînent comme une petite histoire (début, milieu, fin).
Format : {"titre":"titre accrocheur de 2 à 6 mots en français","scenes":[{"texte":"phrase de voix off en français, 8 à 18 mots, naturelle à l'oral","image":"English image prompt: subject, action, setting, camera angle, lighting"}]}
Dans chaque prompt d'image, décris à nouveau l'apparence précise du personnage principal pour qu'il reste identique d'une scène à l'autre. Pas de texte écrit dans les images.`;
    try {
      const c = await texteIA([{ role: "system", content: systeme }, { role: "user", content: demande }], { json: true, signal: o.signal, etat: o.etat });
      const j = extraireJSON(c);
      const scenes = j && Array.isArray(j.scenes) ? j.scenes.filter((s) => s && s.image).slice(0, n) : [];
      if (scenes.length >= Math.min(2, n)) {
        return {
          source: "pollinations",
          titre: String(j.titre || "").slice(0, 60),
          scenes: scenes.map((s) => ({ texte: String(s.texte || "").slice(0, 220), prompt: String(s.image).slice(0, 600) })),
        };
      }
    } catch (e) {
      if (o.signal && o.signal.annule) throw e;
    }
    return scenarioLocal(o.idee, n);
  }

  // Sans serveur de texte : mêmes sujet et style, cadrages différents ; l'idée sert de voix off.
  const CADRAGES = ["wide establishing shot", "medium shot", "close-up shot", "dynamic low angle shot", "aerial view", "over the shoulder shot", "detail shot", "final wide shot at golden hour"];
  function scenarioLocal(idee, n) {
    const phrases = idee.split(/(?<=[.!?])\s+/).filter(Boolean);
    return {
      source: "local",
      titre: idee.length <= 40 ? idee : "",
      scenes: Array.from({ length: n }, (_, i) => ({
        texte: i < phrases.length ? phrases[i] : i === 0 ? idee : "",
        prompt: `${idee}, ${CADRAGES[i % CADRAGES.length]}`,
      })),
    };
  }

  /** Prompt d'image en anglais à partir d'une description en français (sinon, le texte tel quel). */
  async function traduire(texte) {
    try {
      const c = await texteIA(
        [
          { role: "system", content: "You turn image descriptions into concise English prompts for an image generator. Reply with the prompt only." },
          { role: "user", content: texte },
        ],
        {}
      );
      const t = String(c).replace(/^["'\s]+|["'\s]+$/g, "");
      return t.length > 3 && t.length < 800 ? t : texte;
    } catch (e) {
      return texte;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Espaces Hugging Face (protocole Gradio)                           */
  /* ---------------------------------------------------------------- */

  const fichier = (url) => ({ path: url, url, orig_name: "image.jpg", mime_type: "image/jpeg", meta: { _type: "gradio.FileData" } });

  function messageGradio(data) {
    const j = json(data);
    const m = typeof j === "string" ? j : j && (j.message || j.error || j.title);
    return m ? String(m) : "";
  }

  function estQuota(m) {
    return /quota|exceeded|gpu duration|zerogpu|limit/i.test(m || "");
  }

  async function gradio(hote, api, data, o) {
    const opts = o || {};
    const r = await Natif.requete({ methode: "POST", url: `${hote}/gradio_api/call${api}`, corps: { data }, delai: 30000 });
    const j = r.code === 200 ? json(r.texte) : null;
    if (!j || !j.event_id) throw new ErreurGen(`serveur indisponible (${r.code || r.erreur || "?"})`, { hs: r.code === 404 || r.code === 503 });
    if (opts.etat) opts.etat("en file d'attente sur le serveur gratuit");
    const s = await Natif.requete({ url: `${hote}/gradio_api/call${api}/${j.event_id}`, delai: opts.delai || 300000 });
    if (s.code !== 200) throw new ErreurGen(`serveur indisponible (${s.code || s.erreur || "?"})`);
    const lignes = String(s.texte || "").split("\n");
    let evenement = "";
    let sortie = null;
    let message = "";
    for (const l of lignes) {
      if (l.startsWith("event:")) evenement = l.slice(6).trim();
      else if (l.startsWith("data:")) {
        const d = l.slice(5).trim();
        if (evenement === "complete") sortie = json(d);
        else if (evenement === "error") message = messageGradio(d) || message;
      }
    }
    if (sortie) return sortie;
    if (estQuota(message)) throw new ErreurGen("quota gratuit du serveur atteint pour aujourd'hui", { quota: true });
    throw new ErreurGen(message ? message.slice(0, 160) : "le serveur a refusé la demande");
  }

  // Adresse du fichier produit par un espace (image ou vidéo).
  function urlSortie(v) {
    if (!v) return "";
    if (typeof v === "string") return /^https:/.test(v) ? v : "";
    if (v.video) return urlSortie(v.video);
    if (v.value) return urlSortie(v.value);
    return v.url || "";
  }

  /* ---------------------------------------------------------------- */
  /* AI Horde                                                          */
  /* ---------------------------------------------------------------- */

  const HORDE = "https://aihorde.net/api/v2";
  const HORDE_ENTETES = { apikey: "0000000000", "Client-Agent": "TrouveTonIA:1.0:github.com/Idrissta/ia-video" };
  const HORDE_NEG = "blurry, deformed, ugly, bad anatomy, watermark, text, signature, lowres";
  // Modèles proposés selon le style (le premier bénévole disponible parmi eux répond).
  const HORDE_MODELES = {
    anime: ["Rev Animated", "Flat-2D Animerge", "Anything Diffusion"],
    "3d": ["Rev Animated", "Dreamshaper", "Deliberate"],
    realiste: ["ICBINP - I Can't Believe It's Not Photography", "Deliberate", "Realistic Vision"],
    cinema: ["ICBINP - I Can't Believe It's Not Photography", "Deliberate", "Dreamshaper"],
    defaut: ["Deliberate", "Dreamshaper", "Rev Animated", "stable_diffusion"],
  };

  // Sans compte, AI Horde accepte jusqu'à environ 720 × 720 pixels : même proportion, plus petit.
  function tailleHorde(w, h) {
    const k = Math.sqrt(409600 / (w * h));
    return [Math.max(256, Math.floor((w * k) / 64) * 64), Math.max(256, Math.floor((h * k) / 64) * 64)];
  }

  async function horde(t) {
    const [w, h] = tailleHorde(t.largeur, t.hauteur);
    const envoi = await Natif.requete({
      methode: "POST",
      url: `${HORDE}/generate/async`,
      entetes: HORDE_ENTETES,
      corps: {
        prompt: `${t.prompt.slice(0, 700)} ### ${HORDE_NEG}`,
        params: { width: w, height: h, steps: 22, n: 1, sampler_name: "k_euler_a", cfg_scale: 6.5, seed: String(t.seed) },
        nsfw: false,
        censor_nsfw: true,
        r2: true,
        shared: false,
        models: HORDE_MODELES[t.style] || HORDE_MODELES.defaut,
      },
      delai: 30000,
    });
    const j = json(envoi.texte);
    if (envoi.code === 429) throw new ErreurGen("AI Horde occupé", { attente: attenteDemandee(envoi, 20000) });
    if (!j || !j.id) throw new ErreurGen(`AI Horde refuse la demande (${(j && j.message) || envoi.code || envoi.erreur})`, { hs: envoi.code === 403 || envoi.code === 401, reseau: !envoi.code });
    const debut = Date.now();
    for (;;) {
      await pause(4000);
      if (t.signal && t.signal.annule) throw new ErreurGen("annulé");
      if (Date.now() - debut > 240000) throw new ErreurGen("AI Horde trop lent");
      const c = json((await Natif.requete({ url: `${HORDE}/generate/check/${j.id}`, entetes: HORDE_ENTETES, delai: 20000 })).texte);
      if (!c) continue;
      if (c.faulted || c.is_possible === false) throw new ErreurGen("aucun bénévole AI Horde disponible", { hs: true });
      if (c.done) break;
      t.etat(c.queue_position > 0 ? `AI Horde : ${c.queue_position}e dans la file` : `AI Horde : création (≈ ${Math.max(1, c.wait_time || 0)} s)`);
    }
    const st = json((await Natif.requete({ url: `${HORDE}/generate/status/${j.id}`, entetes: HORDE_ENTETES, delai: 20000 })).texte);
    const g = st && st.generations && st.generations[0];
    if (!g || !g.img) throw new ErreurGen("image AI Horde non reçue");
    if (g.censored) throw new ErreurGen("image refusée par le filtre de sécurité");
    return telechargerImage(g.img, Object.assign({}, t, { nom: t.nom.replace(/\.jpg$/, ".webp") }), "AI Horde");
  }

  /* ---------------------------------------------------------------- */
  /* Fournisseurs d'images et répartition                              */
  /* ---------------------------------------------------------------- */

  async function telechargerImage(url, t, source) {
    const d = await Natif.telecharger(url, t.nom);
    if (d.code === 200 && d.chemin) return { chemin: d.chemin, url, source };
    if (d.code === 402 || d.code === 429) throw new ErreurGen("serveur gratuit occupé", { attente: attenteDemandee(d, 46000) });
    throw new ErreurGen(`image non reçue (${d.code || d.erreur || "?"})`, { reseau: !d.code, attente: 4000 });
  }

  const FOURNISSEURS = [
    {
      id: "pollinations",
      nom: "Pollinations",
      pret: 0,
      hs: false,
      async generer(t) {
        t.etat("création par Pollinations");
        rythme.image = Date.now() + 46000;
        this.pret = rythme.image;
        try {
          return await telechargerImage(urlPollinations(t), t, "Pollinations");
        } finally {
          rythme.image = Date.now() + 46000;
          this.pret = rythme.image;
        }
      },
    },
    {
      id: "horde",
      nom: "AI Horde",
      pret: 0,
      hs: false,
      // Deux demandes à la fois : les bénévoles travaillent en parallèle de Pollinations.
      concurrence: 2,
      generer(t) {
        t.etat("création par AI Horde (GPU de bénévoles)");
        return horde(t);
      },
    },
  ];

  /**
   * Génère toutes les images en répartissant les demandes entre les serveurs gratuits disponibles,
   * en parallèle. taches : [{ prompt, largeur, hauteur, seed, nom, etat(msg), fin(r), echec(e) }].
   */
  async function images(taches, signal) {
    const file = taches.slice();
    for (const t of file) t.etat("en attente d'un serveur gratuit");
    const travailleur = async (f) => {
      while (file.length) {
        if (signal && signal.annule) return;
        if (f.hs) return;
        const attente = f.pret - Date.now();
        if (attente > 0) {
          await pause(Math.min(attente, 800));
          continue;
        }
        const t = file.shift();
        if (!t) return;
        try {
          const r = await f.generer(t);
          f.echecs = 0;
          await t.fin(r);
        } catch (e) {
          if (signal && signal.annule) return;
          t.essais = (t.essais || 0) + 1;
          if (e.attente) f.pret = Date.now() + e.attente;
          // Serveur qui sature (402, 429) : on patiente, quatre fois au plus. Panne ou réseau coupé :
          // on abandonne après trois échecs de suite.
          f.echecs = (f.echecs || 0) + (e.attente > 5000 && !e.reseau ? 0.75 : 1);
          if (e.quota || e.hs || f.echecs >= 3 || (f.id !== "pollinations" && t.essais >= 2)) f.hs = true;
          t.derniere = e;
          if (t.essais < 4 && FOURNISSEURS.some((x) => !x.hs)) {
            t.etat("nouvel essai…");
            file.unshift(t);
          } else t.echec(e);
        }
      }
    };
    const travailleurs = [];
    for (const f of FOURNISSEURS) for (let k = 0; k < (f.concurrence || 1); k++) travailleurs.push(travailleur(f));
    await Promise.all(travailleurs);
    // Plus aucun serveur : les tâches restantes échouent.
    for (const t of file.splice(0)) t.echec(t.derniere || new ErreurGen("aucun serveur gratuit disponible"));
    // Les serveurs mis de côté seront réessayés à la prochaine création.
    for (const f of FOURNISSEURS) {
      f.hs = false;
      f.echecs = 0;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Clips vidéo IA                                                    */
  /* ---------------------------------------------------------------- */

  const LTX = "https://lightricks-ltx-video-distilled.hf.space";
  const NEG = "worst quality, inconsistent motion, blurry, jittery, distorted";
  const mult = (x, m) => Math.max(m, Math.round(x / m) * m);

  const CLIPS = [
    {
      id: "ltx",
      nom: "LTX-Video",
      hote: LTX,
      api: "/image_to_video",
      data: (t) => {
        // Dimensions multiples de 32 ; 768 px sur le grand côté (640 en carré) pour ménager le quota.
        const r = t.largeur / t.hauteur;
        const h = r === 1 ? 640 : r < 1 ? 768 : mult(768 / r, 32);
        const w = r === 1 ? 640 : r < 1 ? mult(768 * r, 32) : 768;
        return [`${t.prompt}, natural smooth motion, cinematic`, NEG, fichier(t.image), null, h, w, "image-to-video", 3, 9, 42, true, 1, true];
      },
    },
  ];
  const etatClips = { hs: {} };

  /** Anime une image en clip vidéo IA de quelques secondes : { chemin, source }. */
  async function clip(t) {
    let derniere = null;
    for (const c of CLIPS) {
      if (etatClips.hs[c.id]) continue;
      try {
        if (t.etat) t.etat(`${c.nom} : envoi`);
        const o = await gradio(c.hote, c.api, c.data(t), { delai: 420000, etat: t.etat });
        const url = urlSortie(o && o[0]);
        if (!url) throw new ErreurGen("réponse sans vidéo");
        const d = await Natif.telecharger(url, t.nom);
        if (d.code === 200 && d.chemin) return { chemin: d.chemin, source: c.nom };
        throw new ErreurGen("vidéo non reçue");
      } catch (e) {
        derniere = e;
        if (e.quota || e.hs) etatClips.hs[c.id] = true;
        if (t.signal && t.signal.annule) throw e;
      }
    }
    const tousHs = CLIPS.every((c) => etatClips.hs[c.id]);
    throw new ErreurGen(tousHs ? "quota gratuit des serveurs vidéo atteint : réessaie demain" : (derniere && derniere.message) || "serveurs vidéo indisponibles", { quota: tousHs });
  }

  window.Generateurs = { scenario, scenarioLocal, traduire, images, clip, urlPollinations, tailleHorde, FOURNISSEURS, CLIPS, gradio, ErreurGen };
})();
