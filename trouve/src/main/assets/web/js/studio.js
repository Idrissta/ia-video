/* Trouve ton IA — studio de création : l'appli crée elle-même la vidéo (scénario, images IA,
 * voix off, musique, montage) ou des images, avec des générateurs gratuits et sans compte. */
(function () {
  "use strict";

  const App = window.App;
  const Natif = window.Natif;
  const M = window.Montage;
  const G = window.Generateurs;
  const { ECRANS, esc, entete, I, toast, haptic, pluriel } = App;
  const $ = (sel) => App.vue.querySelector(sel);

  const STYLES = [
    { id: "cinema", nom: "Cinéma", prompt: "cinematic film still, dramatic lighting, shallow depth of field, rich color grading, highly detailed" },
    { id: "realiste", nom: "Réaliste", prompt: "photorealistic photo, natural light, sharp focus, highly detailed, 35mm" },
    { id: "anime", nom: "Anime", prompt: "anime style illustration, hand-drawn, vibrant colors, detailed background" },
    { id: "3d", nom: "Dessin animé 3D", prompt: "3D animated movie style, soft lighting, expressive characters, high quality render" },
    { id: "aquarelle", nom: "Aquarelle", prompt: "watercolor painting, soft pastel colors, paper texture, delicate brush strokes" },
    { id: "bd", nom: "Bande dessinée", prompt: "comic book art, bold ink lines, flat vivid colors, halftone shading" },
    { id: "fantastique", nom: "Fantastique", prompt: "epic fantasy concept art, magical atmosphere, volumetric light, intricate details" },
    { id: "pixel", nom: "Pixel art", prompt: "pixel art, 16-bit retro video game style, crisp pixels" },
  ];
  const IDEES = [
    "Un renard roux qui court dans une forêt enneigée au lever du soleil",
    "Un astronaute qui fait du skate sur la Lune",
    "La journée d'un petit dragon qui apprend à voler",
    "Publicité pour une boulangerie de quartier",
    "Voyage à Tokyo la nuit, néons et ramen",
    "Les 4 étapes d'une recette de crêpes",
    "Un chat détective qui mène l'enquête à Paris",
    "Motivation : se lever tôt pour réaliser ses rêves",
  ];
  const IDEES_IMAGE = [
    "Portrait d'un chat astronaute, casque doré",
    "Château flottant au-dessus des nuages au coucher du soleil",
    "Logo minimaliste d'une boulangerie, blé et soleil",
    "Ville futuriste sous la pluie, néons violets",
  ];
  const SITES_VIDEO = ["kling", "pixverse", "vidu", "dreamina", "hailuo", "flow"];
  const CLE = "trouve.studio";
  const CLE_CREATIONS = "trouve.creations";

  function lire(cle, defaut) {
    try {
      const v = JSON.parse(localStorage.getItem(cle));
      return v == null ? defaut : v;
    } catch (e) {
      return defaut;
    }
  }

  function ecrire(cle, v) {
    try {
      localStorage.setItem(cle, JSON.stringify(v));
    } catch (e) {
      /* stockage plein ou indisponible */
    }
  }

  const DEFAUT = { mode: "video", idee: "", ideeImage: "", format: "9:16", style: "cinema", n: 5, voix: true, sousTitres: true, ambiance: "calme", ia: false, nImages: 2 };
  const B = Object.assign({}, DEFAUT, lire(CLE, {}));
  if (!M.FORMATS[B.format]) B.format = "9:16";
  if (!STYLES.some((s) => s.id === B.style)) B.style = "cinema";
  if (!M.AMBIANCES[B.ambiance]) B.ambiance = "calme";
  if (![3, 5, 8].includes(B.n)) B.n = 5;
  const garder = () => ecrire(CLE, B);

  const projets = new Map();
  let compteur = 0;

  const creations = {
    tous: () => lire(CLE_CREATIONS, []).filter((x) => x && x.id),
    ajouter(c) {
      const l = creations.tous().filter((x) => x.id !== c.id);
      l.unshift(c);
      ecrire(CLE_CREATIONS, l.slice(0, 30));
    },
    retirer(id) {
      ecrire(CLE_CREATIONS, creations.tous().filter((x) => x.id !== id));
    },
  };

  /* ---------------------------------------------------------------- */
  /* Écran « Créer »                                                   */
  /* ---------------------------------------------------------------- */

  function puce(act, v, on, nom, extra) {
    return `<button type="button" class="filtre${on ? " on" : ""}" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}"${extra || ""}>${nom}</button>`;
  }

  function interrupteur(act, on, titre, aide, desactive) {
    return `<label class="interrupteur${desactive ? " off" : ""}"><span><strong>${titre}</strong><small>${aide}</small></span>
      <input type="checkbox" data-act="${act}"${on ? " checked" : ""}${desactive ? " disabled" : ""}><i></i></label>`;
  }

  function choixFormat() {
    return `<div class="formats" role="radiogroup" aria-label="Format">${Object.entries(M.FORMATS)
      .map(([k, f]) => `<button type="button" role="radio" class="format${B.format === k ? " on" : ""}" aria-checked="${B.format === k}" data-act="st-format" data-v="${k}">
        <span class="format-cadre f-${k.replace(":", "-")}"></span><strong>${k}</strong><small>${f.aide}</small></button>`)
      .join("")}</div>`;
  }

  function formVideo() {
    const voixOk = Natif.voixDispo;
    return `<section class="bloc studio-bloc">
        <label class="st-label" for="st-idee">Décris ta vidéo</label>
        <textarea id="st-idee" class="st-texte" rows="3" maxlength="400" placeholder="Ex. : ${esc(IDEES[0])}">${esc(B.idee)}</textarea>
        <div class="filtres st-idees">${IDEES.slice(1, 6).map((x) => `<button type="button" class="filtre" data-act="st-idee" data-v="${esc(x)}">${esc(x)}</button>`).join("")}</div>
      </section>
      <section class="bloc studio-bloc">
        <h2>Format</h2>
        ${choixFormat()}
        <h2 class="st-h2">Style</h2>
        <div class="filtres enroule">${STYLES.map((s) => puce("st-style", s.id, B.style === s.id, s.nom)).join("")}</div>
        <h2 class="st-h2">Longueur</h2>
        <div class="segment" role="radiogroup" aria-label="Nombre de scènes">${[3, 5, 8]
          .map((n) => `<button type="button" role="radio" aria-checked="${B.n === n}" class="${B.n === n ? "on" : ""}" data-act="st-n" data-v="${n}">${n} scènes<small>≈ ${Math.round(n * 4)} s</small></button>`)
          .join("")}</div>
      </section>
      <section class="bloc studio-bloc">
        <h2>Son et textes</h2>
        <div class="filtres enroule">${Object.entries(M.AMBIANCES).map(([k, a]) => puce("st-ambiance", k, B.ambiance === k, `${a.icone} ${a.nom}`)).join("")}</div>
        ${interrupteur("st-voix", B.voix && voixOk, "Voix off en français", voixOk ? "L'appli lit le texte de chaque scène avec la voix de ton téléphone." : "Disponible dans l'appli Android.", !voixOk)}
        ${interrupteur("st-st", B.sousTitres, "Sous-titres", "Le texte s'affiche à l'écran, façon TikTok.")}
        ${interrupteur("st-ia", B.ia, "Animer avec une vraie IA vidéo", "Chaque image devient un vrai clip vidéo IA de 3 s (LTX-Video, environ 10 s par scène). Le serveur gratuit n'en permet que quelques-uns par jour : au-delà, l'appli anime elle-même les images.")}
      </section>
      <button type="button" class="bouton principal st-go" data-act="st-creer"${B.idee.trim().length < 3 ? " disabled" : ""}>${I.etincelle} Créer ma vidéo</button>
      <p class="petit st-note">Gratuit, sans compte et sans filigrane ajouté par l'appli. Compte 1 à 2 minutes : images par Pollinations et AI Horde, clips IA par LTX-Video (Hugging Face) ; montage, musique et voix faits dans ton téléphone.</p>`;
  }

  function formImage() {
    return `<section class="bloc studio-bloc">
        <label class="st-label" for="st-idee-image">Décris ton image</label>
        <textarea id="st-idee-image" class="st-texte" rows="3" maxlength="400" placeholder="Ex. : ${esc(IDEES_IMAGE[0])}">${esc(B.ideeImage)}</textarea>
        <div class="filtres st-idees">${IDEES_IMAGE.slice(1).map((x) => `<button type="button" class="filtre" data-act="st-idee-image" data-v="${esc(x)}">${esc(x)}</button>`).join("")}</div>
      </section>
      <section class="bloc studio-bloc">
        <h2>Format</h2>
        ${choixFormat()}
        <h2 class="st-h2">Style</h2>
        <div class="filtres enroule">${STYLES.map((s) => puce("st-style", s.id, B.style === s.id, s.nom)).join("")}</div>
        <h2 class="st-h2">Nombre d'images</h2>
        <div class="segment" role="radiogroup" aria-label="Nombre d'images">${[1, 2, 4]
          .map((n) => `<button type="button" role="radio" aria-checked="${B.nImages === n}" class="${B.nImages === n ? "on" : ""}" data-act="st-nimages" data-v="${n}">${n}</button>`)
          .join("")}</div>
      </section>
      <button type="button" class="bouton principal st-go" data-act="st-creer-image"${B.ideeImage.trim().length < 3 ? " disabled" : ""}>${I.etincelle} Créer ${B.nImages > 1 ? "mes images" : "mon image"}</button>
      <p class="petit st-note">Gratuit et sans compte. Les images de Pollinations portent un petit logo dans un coin.</p>`;
  }

  function sectionCreations() {
    const l = creations.tous();
    if (!l.length) return "";
    return `<section class="sec"><div class="sec-tete"><h2>Mes créations</h2><span class="sec-note">${pluriel(l.length, "vidéo", "vidéos")}</span></div>
      <div class="defile creations">${l
        .map((c) => `<button type="button" class="creation" data-act="st-ouvrir-creation" data-id="${esc(c.id)}">
          <span class="creation-img f-${esc((c.format || "9:16").replace(":", "-"))}">${c.vignette ? `<img src="${esc(c.vignette)}" alt="">` : "🎬"}</span>
          <strong>${esc(c.titre || "Vidéo")}</strong><small>${new Date(c.date).toLocaleDateString("fr-FR")} · ${Math.round(c.duree || 0)} s</small></button>`)
        .join("")}</div></section>`;
  }

  function sectionSites() {
    const l = SITES_VIDEO.map((id) => App.S.outils.get(id)).filter(Boolean);
    if (!l.length) return "";
    return `<section class="sec"><div class="sec-tete"><h2>Ou crée sur les sites d'IA vidéo</h2></div>
      <p class="intro">Meilleure qualité avec leurs crédits gratuits du jour. Ils s'ouvrent dans l'appli ; crée ton compte gratuit avec un e-mail (Google ne permet pas sa connexion dans une autre appli).</p>
      <div class="grille-cats large">${l
        .map((o) => `<button type="button" class="tuile large" data-act="site" data-id="${esc(o.id)}">${App.logo(o)}<span class="tuile-texte"><strong>${esc(o.nom)}</strong><small>${esc(o.gratuit || o.resume)}</small></span>${I.externe}</button>`)
        .join("")}</div>
      <button type="button" class="banniere" data-act="videos"><span class="banniere-icone">📊</span><span class="banniere-texte"><strong>Comparer les générateurs vidéo</strong><small>Qualité, vitesse, gratuité</small></span>${I.fleche}</button>
    </section>`;
  }

  ECRANS.creer = function () {
    const enCours = [...projets.values()].filter((p) => !p.fini && !p.erreur);
    return `${entete("Créer", { retour: false, droite: " " })}
    <div class="page studio">
      <div class="segment st-modes" role="radiogroup" aria-label="Que veux-tu créer ?">
        <button type="button" role="radio" aria-checked="${B.mode === "video"}" class="${B.mode === "video" ? "on" : ""}" data-act="st-mode" data-v="video">🎬 Vidéo</button>
        <button type="button" role="radio" aria-checked="${B.mode === "image"}" class="${B.mode === "image" ? "on" : ""}" data-act="st-mode" data-v="image">🖼️ Image</button>
      </div>
      ${enCours.map((p) => `<button type="button" class="banniere" data-act="st-voir" data-id="${p.id}"><span class="banniere-icone">⏳</span><span class="banniere-texte"><strong>${esc(p.titre || p.idee)}</strong><small>Création en cours : ${esc(resumeEtat(p))}</small></span>${I.fleche}</button>`).join("")}
      ${B.mode === "image" ? formImage() : formVideo()}
      ${sectionCreations()}
      ${sectionSites()}
    </div>`;
  };

  App.apres.creer = function () {
    for (const [sel, cle, bouton] of [["#st-idee", "idee", "st-creer"], ["#st-idee-image", "ideeImage", "st-creer-image"]]) {
      const champ = $(sel);
      if (!champ) continue;
      champ.addEventListener("input", () => {
        B[cle] = champ.value;
        garder();
        const b = $(`[data-act="${bouton}"]`);
        if (b) b.disabled = champ.value.trim().length < 3;
      });
    }
  };

  /* ---------------------------------------------------------------- */
  /* Atelier : suivi de la création et résultat                        */
  /* ---------------------------------------------------------------- */

  const ETAPES = [
    ["scenario", "Scénario"],
    ["images", "Images IA"],
    ["voix", "Voix off"],
    ["clips", "Animation IA"],
    ["montage", "Montage et musique"],
  ];

  function resumeEtat(p) {
    const e = ETAPES.find(([k]) => p.etapes[k] && p.etapes[k].etat === "cours");
    if (!e) return p.fini ? "terminée" : "en préparation";
    const d = p.etapes[e[0]];
    return `${e[1].toLowerCase()}${d.detail ? " (" + d.detail + ")" : ""}`;
  }

  function vueEtapes(p) {
    return `<ol class="etapes-st">${ETAPES.filter(([k]) => p.etapes[k])
      .map(([k, nom]) => {
        const d = p.etapes[k];
        const icone = d.etat === "fait" ? "✓" : d.etat === "cours" ? '<span class="rond"></span>' : d.etat === "erreur" ? "!" : "•";
        return `<li class="e-${d.etat}"><span class="e-icone">${icone}</span><span class="e-texte"><strong>${nom}</strong>${d.detail ? `<small>${esc(d.detail)}</small>` : ""}</span></li>`;
      })
      .join("")}</ol>`;
  }

  function vueScene(p, s, i) {
    const F = M.FORMATS[p.format];
    let media;
    if (s.clip && s.clip.chemin) media = `<video src="${esc(s.clip.chemin)}" muted loop playsinline autoplay></video>`;
    else if (s.image && s.image.chemin) media = `<img src="${esc(s.image.chemin)}" alt="">`;
    else if (s.statut === "erreur") media = `<span class="sc-attente erreur">Image impossible<small>${esc(s.erreur || "")}</small></span>`;
    else media = `<span class="sc-attente"><span class="rond"></span><small>${esc(s.attente || "En attente")}</small></span>`;
    const libre = p.fini || p.erreur;
    return `<article class="scene" id="sc-${i}">
      <div class="sc-media" style="aspect-ratio:${F.w}/${F.h}">${media}<b class="sc-num">${i + 1}</b>${s.clip && s.clip.statut === "cours" ? '<em class="sc-clip"><span class="rond"></span> Animation IA…</em>' : ""}</div>
      ${p.type === "image" ? "" : s.edition
        ? `<div class="sc-edition"><textarea id="st-t-${i}" class="st-texte" rows="3" maxlength="220">${esc(s.texte || "")}</textarea>
            <button type="button" class="mini-bouton on" data-act="st-texte-ok" data-id="${p.id}" data-i="${i}">OK</button></div>`
        : `<p class="sc-texte">${esc(s.texte || "")}</p>`}
      ${libre ? `<div class="sc-actions">
        ${p.type === "image" && s.image ? `<button type="button" class="mini-bouton" data-act="st-img-enregistrer" data-id="${p.id}" data-i="${i}">Enregistrer</button><button type="button" class="mini-bouton" data-act="st-img-video" data-id="${p.id}" data-i="${i}">Animer en vidéo</button>` : ""}
        ${p.type === "image" ? "" : `<button type="button" class="mini-bouton" data-act="st-texte" data-id="${p.id}" data-i="${i}">Texte</button>`}
        <button type="button" class="mini-bouton" data-act="st-refaire" data-id="${p.id}" data-i="${i}">Nouvelle image</button>
        ${p.type === "image" ? "" : `<button type="button" class="mini-bouton" data-act="st-animer" data-id="${p.id}" data-i="${i}"${s.image ? "" : " disabled"}>Animer (IA)</button>`}
      </div>` : ""}
    </article>`;
  }

  function vueResultat(p) {
    if (p.erreur) {
      return `<div class="bloc st-erreur"><h2>La création s'est arrêtée</h2><p>${esc(p.erreur)}</p>
        <button type="button" class="bouton principal" data-act="st-reprendre" data-id="${p.id}">Réessayer</button></div>`;
    }
    if (p.type === "image") return "";
    if (!p.video) {
      const pct = Math.round((p.progres || 0) * 100);
      return `<div class="st-progres"><div class="barre-progres"><i style="width:${pct}%"></i></div><p>${esc(resumeEtat(p))}</p>
        <p class="petit">Tu peux utiliser le reste de l'appli pendant ce temps. Pour le montage, reste sur l'appli : il dure le temps de la vidéo.</p>
        <button type="button" class="bouton secondaire" data-act="st-annuler" data-id="${p.id}">Annuler</button></div>`;
    }
    const F = M.FORMATS[p.format];
    return `<div class="st-video">
        <video src="${esc(p.video.url)}" controls playsinline style="aspect-ratio:${F.w}/${F.h}"></video>
      </div>
      <div class="st-actions">
        <button type="button" class="bouton principal" data-act="st-enregistrer" data-id="${p.id}">${p.uri ? "✓ Dans ta galerie" : "Enregistrer dans la galerie"}</button>
        <button type="button" class="bouton secondaire" data-act="st-partager" data-id="${p.id}">Partager</button>
      </div>
      <p class="petit st-note">${Math.round(p.video.duree)} s · ${p.video.extension.toUpperCase()} · ${F.w}×${F.h}${p.modifie ? " · modifications à appliquer" : ""}</p>
      <div class="bloc studio-bloc">
        <h2>Musique</h2>
        <div class="filtres enroule">${Object.entries(M.AMBIANCES).map(([k, a]) => puce("st-p-ambiance", k, p.ambiance === k, `${a.icone} ${a.nom}`, ` data-id="${p.id}"`)).join("")}</div>
        ${interrupteur("st-p-st", p.sousTitres, "Sous-titres", "Afficher le texte à l'écran.").replace('data-act="st-p-st"', `data-act="st-p-st" data-id="${p.id}"`)}
        <button type="button" class="bouton secondaire" data-act="st-remonter" data-id="${p.id}">Refaire le montage</button>
      </div>`;
  }

  ECRANS.atelier = function (q) {
    const p = projets.get(q.id);
    if (!p) return ECRANS.introuvable();
    return `${entete(p.type === "image" ? "Tes images" : "Ta vidéo")}
    <div class="page atelier">
      <h1 class="st-titre">${esc(p.titre || p.idee)}</h1>
      <div id="st-resultat">${vueResultat(p)}</div>
      ${p.type === "image" ? "" : `<div id="st-etapes">${vueEtapes(p)}</div>`}
      <div id="st-scenes" class="scenes${p.type === "image" ? " grille-img" : ""}">${p.scenes.map((s, i) => vueScene(p, s, i)).join("")}</div>
      ${p.fini || p.erreur ? `<button type="button" class="bouton secondaire plus" data-act="studio">Nouvelle création</button>` : ""}
    </div>`;
  };

  // Met à jour l'atelier affiché sans recharger la vidéo en cours de lecture.
  function maj(p, tout) {
    const e = App.actuel();
    if (!e || e.ecran !== "atelier" || e.p.id !== p.id) return;
    const r = $("#st-resultat");
    const cle = (p.erreur ? "e" : "") + (p.video ? p.video.url + (p.uri || "") + p.ambiance + p.sousTitres + !!p.modifie : "p");
    if (r && (tout || r.dataset.cle !== cle || !p.video)) {
      if (!p.video || r.dataset.cle !== cle || tout) r.innerHTML = vueResultat(p);
      r.dataset.cle = cle;
    }
    const h = $(".st-titre");
    if (h && h.textContent !== (p.titre || p.idee)) h.textContent = p.titre || p.idee;
    const et = $("#st-etapes");
    if (et) et.innerHTML = vueEtapes(p);
    const sc = $("#st-scenes");
    if (sc) {
      p.scenes.forEach((s, i) => {
        const html = vueScene(p, s, i);
        if (s._html === html && !tout) return;
        s._html = html;
        const el = sc.querySelector(`#sc-${i}`);
        if (el) el.outerHTML = html;
        else sc.insertAdjacentHTML("beforeend", html);
      });
    }
    if ((p.fini || p.erreur) && !App.vue.querySelector(".atelier > .plus")) {
      App.vue.querySelector(".atelier").insertAdjacentHTML("beforeend", `<button type="button" class="bouton secondaire plus" data-act="studio">Nouvelle création</button>`);
    }
  }

  function etape(p, cle, etat, detail) {
    p.etapes[cle] = { etat, detail: detail || "" };
    maj(p);
  }

  /* ---------------------------------------------------------------- */
  /* Création d'une vidéo                                              */
  /* ---------------------------------------------------------------- */

  function promptImage(p, s) {
    const st = STYLES.find((x) => x.id === p.style) || STYLES[0];
    return `${s.prompt}, ${st.prompt}`;
  }

  function nouveauProjet(type) {
    compteur++;
    const id = Date.now().toString(36) + compteur;
    return {
      id,
      type,
      cree: Date.now(),
      idee: "",
      titre: "",
      format: B.format,
      style: B.style,
      ambiance: B.ambiance,
      sousTitres: B.sousTitres,
      voixOff: B.voix && Natif.voixDispo,
      ia: B.ia,
      seed: Math.floor(Math.random() * 1e6),
      scenes: [],
      etapes: {},
      signal: { annule: false },
      progres: 0,
    };
  }

  function chargerImage(chemin) {
    return new Promise((ok, ko) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => ok(img);
      img.onerror = () => ko(new Error("image illisible"));
      img.src = chemin;
    });
  }

  // Le clip est chargé en mémoire (adresse blob:) pour pouvoir avancer librement dans la vidéo.
  async function chargerClip(chemin) {
    let src = chemin;
    if (!chemin.startsWith("blob:")) src = URL.createObjectURL(await (await fetch(chemin)).blob());
    return new Promise((ok, ko) => {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.oncanplaythrough = () => ok(v);
      v.onerror = () => ko(new Error("clip illisible"));
      v.src = src;
      v.load();
    });
  }

  async function lancerVideo() {
    const p = nouveauProjet("video");
    p.idee = B.idee.trim();
    p.n = B.n;
    projets.set(p.id, p);
    haptic("confirm");
    App.aller("atelier", { id: p.id });
    await executer(p);
  }

  async function executer(p) {
    Natif.ecranAllume(true);
    p.erreur = null;
    try {
      if (!p.scenes.length) {
        etape(p, "scenario", "cours", "écriture de l'histoire");
        const sc = await G.scenario({ idee: p.idee, n: p.n, signal: p.signal });
        verifier(p);
        p.titre = sc.titre;
        p.scenes = sc.scenes.map((s, i) => ({ texte: s.texte, prompt: s.prompt, mouvement: M.MOUVEMENTS[i % M.MOUVEMENTS.length], statut: "attente" }));
        p.progres = 0.1;
        etape(p, "scenario", "fait", sc.source === "local" ? "écrit par l'appli (serveur d'IA occupé)" : pluriel(p.scenes.length, "scène", "scènes"));
        maj(p, true);
      }
      const voix = p.voixOff ? genererVoix(p) : Promise.resolve();
      await genererImages(p);
      await voix;
      verifier(p);
      if (p.ia) await genererClips(p);
      await monter(p);
      p.fini = true;
      haptic("confirm");
      maj(p, true);
      if (App.actuel().ecran !== "atelier") toast("Ta vidéo est prête !");
    } catch (e) {
      if (p.signal.annule) {
        projets.delete(p.id);
        return;
      }
      p.erreur = e.message || String(e);
      for (const k of Object.keys(p.etapes)) if (p.etapes[k].etat === "cours") p.etapes[k].etat = "erreur";
      maj(p, true);
    } finally {
      Natif.ecranAllume(false);
    }
  }

  function verifier(p) {
    if (p.signal.annule) throw new Error("annulé");
  }

  async function genererImages(p) {
    const F = M.FORMATS[p.format];
    const a_faire = p.scenes.map((s, i) => [s, i]).filter(([s]) => !s.image);
    if (!a_faire.length) return;
    let faites = p.scenes.length - a_faire.length;
    etape(p, "images", "cours", `${faites} sur ${p.scenes.length}`);
    await G.images(
      a_faire.map(([s, i]) => ({
        prompt: promptImage(p, s),
        style: p.style,
        signal: p.signal,
        largeur: F.iw,
        hauteur: F.ih,
        seed: p.seed + i,
        nom: `img-${p.id}-${i}-${Date.now().toString(36)}.jpg`,
        etat(msg) {
          s.attente = msg;
          maj(p);
        },
        async fin(r) {
          s.image = r;
          s.statut = "ok";
          try {
            s.imageEl = await chargerImage(r.chemin);
          } catch (e) {
            s.image = null;
            s.statut = "erreur";
            s.erreur = e.message;
          }
          faites++;
          p.progres = (0.1 + (0.5 * faites) / p.scenes.length);
          etape(p, "images", "cours", `${faites} sur ${p.scenes.length}`);
        },
        echec(e) {
          s.statut = "erreur";
          s.erreur = e.message;
          s.reseau = !!e.reseau;
          maj(p);
        },
      })),
      p.signal
    );
    verifier(p);
    const ok = p.scenes.filter((s) => s.imageEl).length;
    if (!ok) {
      etape(p, "images", "erreur", "aucun serveur gratuit n'a répondu");
      const reseau = p.scenes.every((s) => s.reseau);
      throw new Error(reseau
        ? "Pas de connexion aux serveurs d'images : vérifie ton Internet (Wi-Fi ou données mobiles), puis réessaie."
        : "Les serveurs d'images gratuits sont saturés pour le moment. Réessaie dans quelques minutes.");
    }
    etape(p, "images", "fait", ok < p.scenes.length ? `${ok} sur ${p.scenes.length} (les autres réutilisent une image)` : pluriel(ok, "image", "images"));
  }

  async function decoder(chemin) {
    const r = await fetch(chemin);
    const buf = await r.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    return ctx.decodeAudioData(buf);
  }

  async function genererVoix(p) {
    const l = p.scenes.filter((s) => s.texte && !s.voixBuffer);
    if (!l.length) return;
    etape(p, "voix", "cours", `0 sur ${l.length}`);
    let n = 0;
    for (const s of l) {
      if (p.signal.annule) return;
      const r = await Natif.voix(s.texte, { vitesse: 1.03 });
      if (r.chemin) {
        try {
          s.voixBuffer = await decoder(r.chemin);
        } catch (e) {
          s.voixBuffer = null;
        }
      }
      n++;
      etape(p, "voix", "cours", `${n} sur ${l.length}`);
    }
    const ok = p.scenes.filter((s) => s.voixBuffer).length;
    etape(p, "voix", ok ? "fait" : "erreur", ok ? pluriel(ok, "phrase", "phrases") : "voix française indisponible sur ce téléphone");
  }

  async function genererClips(p, seule) {
    const F = M.FORMATS[p.format];
    const l = p.scenes.map((s, i) => [s, i]).filter(([s, i]) => s.image && s.image.url && !(s.clip && s.clip.chemin) && (seule == null || seule === i));
    if (!l.length) return;
    let n = 0;
    etape(p, "clips", "cours", `0 sur ${l.length}`);
    for (const [s, i] of l) {
      if (p.signal.annule) return;
      s.clip = { statut: "cours" };
      maj(p);
      try {
        const r = await G.clip({ prompt: s.prompt, image: s.image.url, largeur: F.iw, hauteur: F.ih, nom: `clip-${p.id}-${i}-${Date.now().toString(36)}.mp4`, signal: p.signal, etat: (m) => etape(p, "clips", "cours", `${n} sur ${l.length} · ${m}`) });
        s.clipEl = await chargerClip(r.chemin);
        s.clip = { statut: "ok", chemin: s.clipEl.src, source: r.source };
      } catch (e) {
        s.clip = { statut: "erreur", erreur: e.message };
        if (e.quota) {
          etape(p, "clips", "erreur", e.message);
          maj(p);
          return;
        }
      }
      n++;
      p.progres = 0.6 + (0.2 * n) / l.length;
      etape(p, "clips", "cours", `${n} sur ${l.length}`);
    }
    const ok = p.scenes.filter((s) => s.clipEl).length;
    etape(p, "clips", ok ? "fait" : "erreur", ok ? pluriel(ok, "clip IA", "clips IA") : "serveurs vidéo gratuits indisponibles : images animées par l'appli");
  }

  function scenesMontage(p) {
    // Une scène sans image reprend l'image précédente (ou suivante) avec un autre mouvement.
    const avec = p.scenes.map((s, i) => [s, i]).filter(([s]) => s.imageEl || s.clipEl);
    return p.scenes.map((s, i) => {
      let src = s;
      if (!s.imageEl && !s.clipEl) {
        const proche = avec.reduce((best, x) => (Math.abs(x[1] - i) < Math.abs(best[1] - i) ? x : best), avec[0]);
        src = proche[0];
      }
      const voix = s.voixBuffer ? s.voixBuffer.duration : 0;
      const clip = s.clipEl ? s.clipEl.duration || 0 : 0;
      let duree = Math.max(voix ? voix + 0.95 : 3.8, Math.min(clip, 6), 2.6);
      if (i === 0 && p.titre) duree = Math.max(duree, 3.6);
      return {
        imageEl: src.imageEl,
        clipEl: s.clipEl || null,
        mouvement: s === src ? s.mouvement : M.MOUVEMENTS[(i + 3) % M.MOUVEMENTS.length],
        texte: s.texte,
        voixBuffer: s.voixBuffer,
        voixDebut: 0.35,
        voixDuree: voix || 0,
        duree,
      };
    });
  }

  async function monter(p) {
    verifier(p);
    etape(p, "montage", "cours", "composition de la musique");
    const scenes = scenesMontage(p);
    const chrono = M.chronologie(scenes);
    const voix = scenes.map((s, i) => (s.voixBuffer ? { buffer: s.voixBuffer, debut: chrono.plages[i].debut + s.voixDebut } : null)).filter(Boolean);
    const audio = await M.bandeSon(p.ambiance, chrono.total, voix);
    verifier(p);
    etape(p, "montage", "cours", "enregistrement 0 %");
    const base = p.progres;
    const r = await M.enregistrer(
      { format: p.format, scenes, titre: p.titre, sousTitres: p.sousTitres },
      audio,
      (x) => {
        p.progres = base + (1 - base) * x;
        const d = p.etapes.montage;
        const txt = `enregistrement ${Math.round(x * 100)} %`;
        if (d.detail !== txt && Math.round(x * 100) % 5 === 0) etape(p, "montage", "cours", txt);
      },
      p.signal
    );
    if (p.video) URL.revokeObjectURL(p.video.url);
    p.video = Object.assign(r, { url: URL.createObjectURL(r.blob) });
    p.uri = null;
    p.modifie = false;
    p.vignette = M.vignette({ format: p.format, scenes }, 0, 160);
    etape(p, "montage", "fait", `${Math.round(r.duree)} s`);
  }

  /* ---------------------------------------------------------------- */
  /* Création d'images                                                 */
  /* ---------------------------------------------------------------- */

  async function lancerImages() {
    const p = nouveauProjet("image");
    p.idee = B.ideeImage.trim();
    p.titre = p.idee;
    projets.set(p.id, p);
    haptic("confirm");
    p.scenes = Array.from({ length: B.nImages }, (_, i) => ({ prompt: p.idee, mouvement: M.MOUVEMENTS[i % 6], statut: "attente", attente: "préparation de la description" }));
    App.aller("atelier", { id: p.id });
    try {
      // Les générateurs comprennent mieux l'anglais : la description est d'abord traduite.
      const prompt = await G.traduire(p.idee);
      for (const s of p.scenes) s.prompt = prompt;
      await genererImages(p);
      p.fini = true;
    } catch (e) {
      p.erreur = e.message;
    }
    maj(p, true);
  }

  /* ---------------------------------------------------------------- */
  /* Enregistrer, partager                                             */
  /* ---------------------------------------------------------------- */

  function nomFichier(p, ext) {
    const base = (p.titre || p.idee || "creation").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "creation";
    return `${base}-${p.id}.${ext}`;
  }

  async function enregistrerVideo(p) {
    if (p.uri) return p.uri;
    toast("Enregistrement…");
    const r = await Natif.enregistrer(p.video.blob, nomFichier(p, p.video.extension), p.video.type);
    if (r.code !== 200) {
      toast("Impossible d'enregistrer : " + (r.erreur || "erreur"));
      return null;
    }
    p.uri = r.uri || "navigateur";
    creations.ajouter({ id: p.id, titre: p.titre || p.idee, date: Date.now(), uri: r.uri, type: p.video.type, duree: p.video.duree, format: p.format, vignette: p.vignette });
    haptic("confirm");
    toast(r.navigateur ? "Vidéo téléchargée" : "Enregistrée dans ta galerie (Films › Trouve ton IA)");
    maj(p, true);
    return p.uri;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  function retracer() {
    const s = App.vue.scrollTop;
    App.rendre();
    App.vue.scrollTop = s;
  }

  async function action(act, el) {
    const p = el.dataset.id ? projets.get(el.dataset.id) : null;
    const i = el.dataset.i == null ? -1 : +el.dataset.i;
    switch (act) {
      case "studio":
        App.onglet("creer");
        break;
      case "st-mode":
        B.mode = el.dataset.v;
        garder();
        retracer();
        break;
      case "st-format":
        B.format = el.dataset.v;
        garder();
        haptic("tick");
        retracer();
        break;
      case "st-style":
        B.style = el.dataset.v;
        garder();
        haptic("tick");
        retracer();
        break;
      case "st-n":
        B.n = +el.dataset.v;
        garder();
        retracer();
        break;
      case "st-nimages":
        B.nImages = +el.dataset.v;
        garder();
        retracer();
        break;
      case "st-ambiance":
        B.ambiance = el.dataset.v;
        garder();
        haptic("tick");
        retracer();
        break;
      case "st-idee":
        B.idee = el.dataset.v;
        garder();
        retracer();
        break;
      case "st-idee-image":
        B.ideeImage = el.dataset.v;
        garder();
        retracer();
        break;
      case "st-creer":
        if (B.idee.trim().length >= 3) lancerVideo();
        break;
      case "st-creer-image":
        if (B.ideeImage.trim().length >= 3) lancerImages();
        break;
      case "st-voir":
        if (p) App.aller("atelier", { id: p.id });
        break;
      case "st-annuler":
        if (!p) break;
        p.signal.annule = true;
        toast("Création annulée");
        App.retour() || App.onglet("creer");
        break;
      case "st-reprendre":
        if (p) {
          p.signal = { annule: false };
          maj(p, true);
          if (p.type === "image") {
            p.erreur = null;
            genererImages(p).then(() => (p.fini = true), (e) => (p.erreur = e.message)).then(() => maj(p, true));
          } else executer(p);
        }
        break;
      case "st-enregistrer":
        if (p && p.video) enregistrerVideo(p);
        break;
      case "st-partager":
        if (p && p.video) {
          const uri = await enregistrerVideo(p);
          if (uri && uri !== "navigateur") Natif.partager(uri, p.video.type, "Créé avec l'appli Trouve ton IA");
        }
        break;
      case "st-p-ambiance":
        if (p) {
          p.ambiance = el.dataset.v;
          p.modifie = true;
          maj(p, true);
        }
        break;
      case "st-remonter":
        if (p) remonter(p);
        break;
      case "st-texte":
        if (p && p.scenes[i]) {
          p.scenes[i].edition = true;
          maj(p);
          const champ = $(`#st-t-${i}`);
          if (champ) champ.focus();
        }
        break;
      case "st-texte-ok":
        if (p && p.scenes[i]) {
          const champ = $(`#st-t-${i}`);
          const t = champ ? champ.value.trim() : p.scenes[i].texte;
          p.scenes[i].edition = false;
          if (t !== (p.scenes[i].texte || "")) {
            p.scenes[i].texte = t;
            p.scenes[i].voixBuffer = null;
            p.modifie = true;
          }
          maj(p, true);
        }
        break;
      case "st-refaire":
        if (p && p.scenes[i]) refaireImage(p, i);
        break;
      case "st-animer":
        if (p && p.scenes[i]) animerScene(p, i);
        break;
      case "st-img-enregistrer":
        if (p && p.scenes[i] && p.scenes[i].image) {
          const ext = /\.webp$/.test(p.scenes[i].image.chemin) ? "webp" : "jpg";
          const r = await Natif.enregistrerCache(p.scenes[i].image.chemin, nomFichier(p, ext).replace(`.${ext}`, `-${i + 1}.${ext}`), ext === "webp" ? "image/webp" : "image/jpeg");
          toast(r.code === 200 ? (r.navigateur ? "Image téléchargée" : "Enregistrée dans ta galerie (Images › Trouve ton IA)") : "Impossible d'enregistrer");
        }
        break;
      case "st-img-video":
        if (p && p.scenes[i] && p.scenes[i].image) videoDepuisImage(p, i);
        break;
      case "st-ouvrir-creation": {
        const c = creations.tous().find((x) => x.id === el.dataset.id);
        if (c && c.uri) Natif.ouvrir(c.uri, c.type);
        else if (projets.get(el.dataset.id)) App.aller("atelier", { id: el.dataset.id });
        break;
      }
      default:
        break;
    }
  }

  async function remonter(p) {
    if (p.enMontage) return;
    p.enMontage = true;
    p.fini = false;
    p.signal = { annule: false };
    Natif.ecranAllume(true);
    try {
      if (p.voixOff) await genererVoix(p);
      p.progres = 0.6;
      if (p.video) URL.revokeObjectURL(p.video.url);
      p.video = null;
      maj(p, true);
      await monter(p);
      p.fini = true;
    } catch (e) {
      p.erreur = e.message;
    } finally {
      p.enMontage = false;
      Natif.ecranAllume(false);
      maj(p, true);
    }
  }

  async function refaireImage(p, i) {
    const s = p.scenes[i];
    s.image = null;
    s.imageEl = null;
    s.clip = null;
    s.clipEl = null;
    s.statut = "attente";
    p.seed += 101;
    p.modifie = true;
    const fini = p.fini;
    p.fini = false;
    maj(p, true);
    try {
      await genererImages(p);
    } catch (e) {
      toast(e.message);
    }
    p.fini = fini || p.type === "image";
    maj(p, true);
  }

  async function animerScene(p, i) {
    const fini = p.fini;
    p.fini = false;
    maj(p, true);
    await genererClips(p, i);
    p.modifie = !!p.scenes[i].clipEl || p.modifie;
    p.fini = fini;
    maj(p, true);
    if (p.scenes[i].clipEl) toast("Clip IA prêt : refais le montage pour l'ajouter");
    else toast((p.scenes[i].clip && p.scenes[i].clip.erreur) || "Animation impossible pour le moment");
  }

  function videoDepuisImage(src, i) {
    const p = nouveauProjet("video");
    p.idee = src.idee;
    p.titre = "";
    p.format = src.format;
    p.voixOff = false;
    p.ia = true;
    p.n = 1;
    const s = src.scenes[i];
    p.scenes = [{ texte: "", prompt: s.prompt, image: s.image, imageEl: s.imageEl, mouvement: "zoom-avant", statut: "ok" }];
    p.etapes.scenario = { etat: "fait", detail: "à partir de ton image" };
    p.etapes.images = { etat: "fait", detail: "1 image" };
    projets.set(p.id, p);
    App.aller("atelier", { id: p.id });
    executer(p);
  }

  function change(el) {
    const act = el.dataset.act;
    const p = el.dataset.id ? projets.get(el.dataset.id) : null;
    if (act === "st-voix") B.voix = el.checked;
    else if (act === "st-st") B.sousTitres = el.checked;
    else if (act === "st-ia") B.ia = el.checked;
    else if (act === "st-p-st" && p) {
      p.sousTitres = el.checked;
      p.modifie = true;
      maj(p, true);
      return;
    } else return;
    garder();
  }

  window.Studio = { action, change, projets, creations, STYLES };
})();
