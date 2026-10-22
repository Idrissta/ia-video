/* Trouve ton IA — moteur de montage du studio : anime les images générées (mouvements de caméra,
 * fondus), ajoute sous-titres, titre, voix off et une musique composée dans le téléphone, puis
 * enregistre le tout en vidéo (MP4 si le téléphone le permet, sinon WebM). Aucun serveur. */
(function () {
  "use strict";

  const TRANSITION = 0.6;
  const FORMATS = {
    "9:16": { nom: "Vertical 9:16", aide: "TikTok, Shorts, Reels", w: 720, h: 1280, iw: 576, ih: 1024 },
    "16:9": { nom: "Horizontal 16:9", aide: "YouTube", w: 1280, h: 720, iw: 1024, ih: 576 },
    "1:1": { nom: "Carré 1:1", aide: "Instagram, Facebook", w: 960, h: 960, iw: 768, ih: 768 },
  };
  const MOUVEMENTS = ["zoom-avant", "gauche", "zoom-arriere", "droite", "haut", "bas"];
  const doux = (p) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));

  /* ---------------------------------------------------------------- */
  /* Chronologie                                                       */
  /* ---------------------------------------------------------------- */

  // Début et fin de chaque scène : deux scènes se chevauchent le temps du fondu.
  function chronologie(scenes) {
    const plages = [];
    let t = 0;
    scenes.forEach((s, i) => {
      const debut = i === 0 ? 0 : t - TRANSITION;
      plages.push({ debut, fin: debut + s.duree });
      t = debut + s.duree;
    });
    return { plages, total: t };
  }

  /* ---------------------------------------------------------------- */
  /* Dessin d'une image                                                */
  /* ---------------------------------------------------------------- */

  function cadrage(mouvement, p) {
    const q = doux(p);
    switch (mouvement) {
      case "zoom-arriere":
        return { e: 1.2 - 0.16 * q, x: 0, y: 0 };
      case "gauche":
        return { e: 1.18, x: 0.85 - 1.7 * q, y: 0 };
      case "droite":
        return { e: 1.18, x: -0.85 + 1.7 * q, y: 0 };
      case "haut":
        return { e: 1.18, x: 0, y: 0.85 - 1.7 * q };
      case "bas":
        return { e: 1.18, x: 0, y: -0.85 + 1.7 * q };
      case "fixe":
        return { e: 1, x: 0, y: 0 };
      default:
        return { e: 1.04 + 0.16 * q, x: 0, y: 0 };
    }
  }

  // Dessine la source en remplissant le cadre (comme « cover »), agrandie et décalée.
  function couvrir(ctx, src, sw, sh, W, H, c) {
    if (!sw || !sh) return;
    const r = Math.max(W / sw, H / sh) * c.e;
    const w = sw * r;
    const h = sh * r;
    const x = (W - w) / 2 + (c.x * (w - W)) / 2;
    const y = (H - h) / 2 + (c.y * (h - H)) / 2;
    ctx.drawImage(src, x, y, w, h);
  }

  function dessinerMedia(ctx, s, p, t, plage, W, H) {
    const clip = s.clipEl;
    if (clip && clip.readyState >= 2) {
      // Clip vidéo IA : joué au ralenti si besoin pour couvrir la scène, puis figé sur la dernière image.
      const d = clip.duration || 1;
      const vitesse = Math.max(0.5, Math.min(1, d / (plage.fin - plage.debut)));
      const voulu = Math.min(d - 0.05, (t - plage.debut) * vitesse);
      if (Math.abs(clip.currentTime - voulu) > 0.25) clip.currentTime = Math.max(0, voulu);
      if (clip.paused && voulu < d - 0.1 && s.lecture) clip.play().catch(() => {});
      clip.playbackRate = vitesse;
      couvrir(ctx, clip, clip.videoWidth, clip.videoHeight, W, H, { e: 1, x: 0, y: 0 });
      return;
    }
    const img = s.imageEl;
    if (img && (img.naturalWidth || img.width)) {
      couvrir(ctx, img, img.naturalWidth || img.width, img.naturalHeight || img.height, W, H, cadrage(s.mouvement, p));
      return;
    }
    // Pas encore d'image : dégradé de couleur.
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#1e1b4b");
    g.addColorStop(1, "#0e7490");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------------------------------------------------------- */
  /* Textes : sous-titres façon TikTok et titre                        */
  /* ---------------------------------------------------------------- */

  function lignes(ctx, texte, largeur) {
    const mots = texte.split(/\s+/).filter(Boolean);
    const out = [];
    let ligne = "";
    for (const m of mots) {
      const essai = ligne ? ligne + " " + m : m;
      if (ctx.measureText(essai).width > largeur && ligne) {
        out.push(ligne);
        ligne = m;
      } else ligne = essai;
    }
    if (ligne) out.push(ligne);
    return out;
  }

  function rectArrondi(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  // Découpe le texte en courts morceaux affichés l'un après l'autre, au rythme de la voix.
  function morceaux(texte, n) {
    const mots = texte.split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < mots.length; i += n) out.push(mots.slice(i, i + n).join(" "));
    return out;
  }

  function sousTitre(ctx, s, t, plage, W, H, alpha) {
    if (!s.texte) return;
    const parts = s.parts || (s.parts = morceaux(s.texte, W > H ? 8 : 5));
    const debut = plage.debut + (s.voixDebut || 0.25);
    const duree = s.voixDuree || Math.max(1, plage.fin - plage.debut - 0.6);
    const total = parts.reduce((a, x) => a + x.length + 4, 0);
    let cumul = 0;
    let k = parts.length - 1;
    for (let i = 0; i < parts.length; i++) {
      cumul += parts[i].length + 4;
      if (t < debut + (duree * cumul) / total) {
        k = i;
        break;
      }
    }
    if (t < debut - 0.1) k = 0;
    const fs = Math.round(Math.min(W, H) * (W > H ? 0.05 : 0.062));
    ctx.font = `800 ${fs}px "Inter", "Roboto", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const ls = lignes(ctx, parts[k], W * 0.84);
    const lh = fs * 1.22;
    const y0 = H * (W > H ? 0.84 : 0.76) - ((ls.length - 1) * lh) / 2;
    const largeur = Math.max(...ls.map((l) => ctx.measureText(l).width)) + fs * 1.1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(8, 8, 20, 0.62)";
    rectArrondi(ctx, (W - largeur) / 2, y0 - lh / 2 - fs * 0.32, largeur, ls.length * lh + fs * 0.64, fs * 0.5);
    ctx.fillStyle = "#ffffff";
    ls.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
    ctx.globalAlpha = 1;
  }

  function titre(ctx, texte, t, W, H) {
    if (!texte || t > 3.2) return;
    const a = t < 0.4 ? t / 0.4 : t > 2.6 ? Math.max(0, (3.2 - t) / 0.6) : 1;
    const fs = Math.round(Math.min(W, H) * 0.085);
    ctx.font = `900 ${fs}px "Inter", "Roboto", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const ls = lignes(ctx, texte.toUpperCase(), W * 0.84).slice(0, 3);
    const lh = fs * 1.12;
    const y0 = H * 0.3 - ((ls.length - 1) * lh) / 2;
    ctx.globalAlpha = a;
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = fs * 0.4;
    ctx.fillStyle = "#ffffff";
    ls.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------------- */
  /* Image complète à l'instant t                                      */
  /* ---------------------------------------------------------------- */

  function dessiner(ctx, projet, chrono, t) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    let courante = -1;
    projet.scenes.forEach((s, i) => {
      const pl = chrono.plages[i];
      if (t < pl.debut || t > pl.fin) {
        if (s.clipEl && !s.clipEl.paused) s.clipEl.pause();
        return;
      }
      const a = i > 0 && t < pl.debut + TRANSITION ? (t - pl.debut) / TRANSITION : 1;
      ctx.globalAlpha = a;
      dessinerMedia(ctx, s, (t - pl.debut) / (pl.fin - pl.debut), t, pl, W, H);
      ctx.globalAlpha = 1;
      courante = i;
    });
    if (courante >= 0 && projet.sousTitres) {
      const pl = chrono.plages[courante];
      const a = courante > 0 && t < pl.debut + TRANSITION ? (t - pl.debut) / TRANSITION : Math.min(1, (pl.fin - t) / 0.3);
      sousTitre(ctx, projet.scenes[courante], t, pl, W, H, Math.max(0, Math.min(1, a)));
    }
    if (projet.titre) titre(ctx, projet.titre, t, W, H);
    // Fondu au noir au début et à la fin.
    const noir = t < 0.35 ? 1 - t / 0.35 : t > chrono.total - 0.5 ? Math.min(1, (t - (chrono.total - 0.5)) / 0.5) : 0;
    if (noir > 0) {
      ctx.globalAlpha = noir;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Musique composée dans le téléphone                                */
  /* ---------------------------------------------------------------- */

  const AMBIANCES = {
    calme: { nom: "Calme", icone: "🌙", bpm: 72, accords: [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]], pad: 0.09, arpege: 0.06, basse: 0.12, batterie: null },
    joyeuse: { nom: "Joyeuse", icone: "☀️", bpm: 112, accords: [[48, 55, 60, 64], [43, 55, 59, 62], [45, 52, 57, 60], [41, 53, 57, 60]], pad: 0.05, arpege: 0.07, basse: 0.16, batterie: "pop" },
    epique: { nom: "Épique", icone: "⚔️", bpm: 90, accords: [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [43, 50, 55, 59]], pad: 0.11, arpege: 0.04, basse: 0.18, batterie: "epique" },
    energique: { nom: "Énergique", icone: "⚡", bpm: 124, accords: [[41, 48, 53, 56], [37, 49, 53, 56], [44, 51, 56, 60], [39, 51, 55, 58]], pad: 0.05, arpege: 0.05, basse: 0.2, batterie: "club" },
    lofi: { nom: "Lo-fi", icone: "☕", bpm: 80, accords: [[50, 53, 57, 60, 64], [43, 53, 55, 59], [48, 52, 55, 59], [45, 52, 55, 61]], pad: 0.06, arpege: 0.07, basse: 0.14, batterie: "lofi" },
    mystere: { nom: "Mystère", icone: "🌫️", bpm: 60, accords: [[50, 57, 62, 65], [46, 53, 58, 62], [43, 50, 55, 58], [45, 52, 57, 61]], pad: 0.1, arpege: 0.05, basse: 0.1, batterie: null },
    aucune: { nom: "Sans musique", icone: "🔇" },
  };

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function bruit(oc) {
    const b = oc.createBuffer(1, oc.sampleRate, oc.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function reverb(oc, duree) {
    const n = Math.round(oc.sampleRate * duree);
    const b = oc.createBuffer(2, n, oc.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    const r = oc.createConvolver();
    r.buffer = b;
    return r;
  }

  function enveloppe(oc, t, a, d, r, g) {
    const v = oc.createGain();
    v.gain.setValueAtTime(0, t);
    v.gain.linearRampToValueAtTime(g, t + a);
    v.gain.setTargetAtTime(0, t + Math.max(a, d), r / 3);
    return v;
  }

  function ton(oc, dest, o) {
    const osc = oc.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.value = o.f;
    if (o.detune) osc.detune.value = o.detune;
    const v = enveloppe(oc, o.t, o.a || 0.01, o.d, o.r || 0.3, o.g);
    let n = osc;
    if (o.filtre) {
      const f = oc.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.filtre;
      osc.connect(f);
      n = f;
    }
    n.connect(v);
    v.connect(dest);
    osc.start(o.t);
    osc.stop(o.t + o.d + (o.r || 0.3) + 0.1);
  }

  function frappe(oc, dest, sorte, t, g, B) {
    if (sorte === "kick") {
      const o = oc.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const v = enveloppe(oc, t, 0.002, 0.05, 0.35, g);
      o.connect(v);
      v.connect(dest);
      o.start(t);
      o.stop(t + 0.5);
      return;
    }
    const s = oc.createBufferSource();
    s.buffer = B;
    const f = oc.createBiquadFilter();
    f.type = sorte === "hat" ? "highpass" : "bandpass";
    f.frequency.value = sorte === "hat" ? 7500 : sorte === "tom" ? 220 : 1800;
    const v = enveloppe(oc, t, 0.002, sorte === "hat" ? 0.01 : 0.04, sorte === "hat" ? 0.06 : sorte === "tom" ? 0.5 : 0.2, g);
    s.connect(f);
    f.connect(v);
    v.connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.6);
  }

  function batterie(oc, dest, style, t, temps, beat, B) {
    const b = beat % 4;
    if (style === "club") {
      frappe(oc, dest, "kick", t, 0.9, B);
      frappe(oc, dest, "hat", t + temps / 2, 0.12, B);
      if (b === 1 || b === 3) frappe(oc, dest, "clap", t, 0.25, B);
    } else if (style === "pop") {
      if (b === 0 || b === 2) frappe(oc, dest, "kick", t, 0.8, B);
      if (b === 1 || b === 3) frappe(oc, dest, "clap", t, 0.22, B);
      frappe(oc, dest, "hat", t, 0.07, B);
      frappe(oc, dest, "hat", t + temps / 2, 0.05, B);
    } else if (style === "lofi") {
      if (b === 0) frappe(oc, dest, "kick", t, 0.7, B);
      if (b === 2) frappe(oc, dest, "clap", t, 0.16, B);
      frappe(oc, dest, "hat", t, 0.05, B);
      frappe(oc, dest, "hat", t + temps * 0.62, 0.035, B);
    } else if (style === "epique") {
      if (b === 0 || b === 2) frappe(oc, dest, "kick", t, 0.85, B);
      if (b === 2) frappe(oc, dest, "tom", t + temps / 2, 0.35, B);
    }
  }

  /**
   * Bande-son complète : musique (atténuée pendant la voix off) et voix placées aux débuts de scènes.
   * voix : [{ buffer: AudioBuffer, debut: secondes }]
   */
  async function bandeSon(ambiance, duree, voix) {
    const SR = 44100;
    const oc = new OfflineAudioContext(2, Math.ceil((duree + 0.3) * SR), SR);
    const master = oc.createDynamicsCompressor();
    master.threshold.value = -8;
    master.ratio.value = 6;
    master.connect(oc.destination);

    const A = AMBIANCES[ambiance];
    if (A && A.bpm) {
      const musique = oc.createGain();
      musique.gain.value = (voix || []).length ? 0.62 : 0.9;
      musique.connect(master);
      // Atténue la musique pendant la voix off.
      for (const v of voix || []) {
        const fin = v.debut + v.buffer.duration;
        musique.gain.setTargetAtTime(0.28, Math.max(0, v.debut - 0.2), 0.08);
        musique.gain.setTargetAtTime(0.62, fin + 0.15, 0.25);
      }
      const fondu = oc.createGain();
      fondu.gain.setValueAtTime(1, 0);
      fondu.gain.setValueAtTime(1, Math.max(0, duree - 1.6));
      fondu.gain.linearRampToValueAtTime(0, duree);
      fondu.connect(musique);
      const rev = reverb(oc, 2.2);
      const humide = oc.createGain();
      humide.gain.value = 0.32;
      rev.connect(humide);
      humide.connect(fondu);
      const B = bruit(oc);
      const temps = 60 / A.bpm;
      const mesure = temps * 4;
      for (let m = 0, t = 0; t < duree; m++, t += mesure) {
        const acc = A.accords[m % A.accords.length];
        const fin = Math.min(mesure, duree - t);
        // Nappe : deux oscillateurs désaccordés par note.
        for (const n of acc.slice(1)) {
          for (const d of [-7, 7]) ton(oc, rev, { t, d: fin, a: mesure * 0.3, r: 1.2, f: hz(n), type: "sawtooth", detune: d, filtre: 1100, g: A.pad / acc.length });
          ton(oc, fondu, { t, d: fin, a: mesure * 0.3, r: 1.0, f: hz(n), type: "triangle", g: A.pad / acc.length });
        }
        // Basse.
        const racine = acc[0] - 12;
        for (let b = 0; b < 4; b++) {
          const tb = t + b * temps;
          if (tb >= duree) break;
          if (A.batterie === "club") ton(oc, fondu, { t: tb + temps / 2, d: temps * 0.35, r: 0.08, f: hz(racine), type: "triangle", g: A.basse });
          else if (b % 2 === 0) ton(oc, fondu, { t: tb, d: temps * 1.6, r: 0.3, f: hz(racine), type: "sine", g: A.basse });
          if (A.batterie && m > 0) batterie(oc, fondu, A.batterie, tb, temps, b, B);
        }
        // Arpège.
        const pas = A.bpm > 100 ? temps / 2 : temps;
        const notes = acc.slice(1).concat([acc[1] + 12]);
        for (let k = 0, ta = t; ta < t + fin - 0.05; k++, ta += pas) {
          const n = notes[(k * 2 + m) % notes.length] + 12;
          ton(oc, rev, { t: ta, d: pas * 0.5, r: pas * 1.6, f: hz(n), type: "triangle", g: A.arpege });
          ton(oc, fondu, { t: ta, d: pas * 0.3, r: pas, f: hz(n) * 2, type: "sine", g: A.arpege * 0.25 });
        }
      }
    }

    const voixBus = oc.createGain();
    voixBus.gain.value = 1.15;
    voixBus.connect(master);
    for (const v of voix || []) {
      const s = oc.createBufferSource();
      s.buffer = v.buffer;
      s.connect(voixBus);
      s.start(Math.max(0, v.debut));
    }
    return oc.startRendering();
  }

  /* ---------------------------------------------------------------- */
  /* Enregistrement de la vidéo                                        */
  /* ---------------------------------------------------------------- */

  const TYPES = [
    "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  function typeVideo() {
    if (typeof MediaRecorder === "undefined") return "";
    return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  /**
   * Monte et enregistre la vidéo en temps réel. projet : { format, scenes: [{ imageEl, clipEl,
   * mouvement, duree, texte, voixDebut, voixDuree }], titre, sousTitres }, audio : AudioBuffer.
   */
  async function enregistrer(projet, audio, surProgres, signal) {
    const F = FORMATS[projet.format] || FORMATS["9:16"];
    const type = typeVideo();
    if (!type) throw new Error("Ce téléphone ne sait pas enregistrer de vidéo depuis l'appli.");
    const canvas = document.createElement("canvas");
    canvas.width = F.w;
    canvas.height = F.h;
    const ctx = canvas.getContext("2d", { alpha: false });
    const chrono = chronologie(projet.scenes);
    projet.scenes.forEach((s) => (s.lecture = true));

    const ac = new AudioContext({ sampleRate: audio.sampleRate });
    if (ac.state === "suspended") await ac.resume();
    const dest = ac.createMediaStreamDestination();
    const src = ac.createBufferSource();
    src.buffer = audio;
    src.connect(dest);

    const flux = canvas.captureStream(30);
    for (const piste of dest.stream.getAudioTracks()) flux.addTrack(piste);
    const rec = new MediaRecorder(flux, { mimeType: type, videoBitsPerSecond: F.w * F.h > 900000 ? 7000000 : 5000000, audioBitsPerSecond: 128000 });
    const parts = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) parts.push(e.data);
    };
    const arret = new Promise((r) => (rec.onstop = r));

    dessiner(ctx, projet, chrono, 0);
    rec.start(1000);
    const t0 = ac.currentTime + 0.2;
    src.start(t0);
    let interrompu = null;
    await new Promise((fini) => {
      const boucle = () => {
        if (signal && signal.annule) {
          interrompu = "annule";
          return fini();
        }
        if (document.hidden) {
          interrompu = "cache";
          return fini();
        }
        const t = ac.currentTime - t0;
        dessiner(ctx, projet, chrono, Math.max(0, t));
        if (surProgres) surProgres(Math.max(0, Math.min(1, t / chrono.total)));
        if (t >= chrono.total + 0.15) return fini();
        requestAnimationFrame(boucle);
      };
      requestAnimationFrame(boucle);
    });
    rec.stop();
    await arret;
    try {
      src.stop();
    } catch (e) {
      /* déjà arrêté */
    }
    ac.close();
    projet.scenes.forEach((s) => {
      s.lecture = false;
      if (s.clipEl) s.clipEl.pause();
    });
    if (interrompu === "cache") throw new Error("Le montage s'est arrêté car l'appli est passée en arrière-plan. Reste sur l'appli pendant le montage.");
    if (interrompu) throw new Error("Montage annulé.");
    const mime = type.split(";")[0];
    return { blob: new Blob(parts, { type: mime }), type: mime, extension: mime === "video/mp4" ? "mp4" : "webm", duree: chrono.total };
  }

  /** Vignette (JPEG en data URL) d'une image du projet, pour « Mes créations ». */
  function vignette(projet, t, largeur) {
    const F = FORMATS[projet.format] || FORMATS["9:16"];
    const c = document.createElement("canvas");
    c.width = largeur;
    c.height = Math.round((largeur * F.h) / F.w);
    const ctx = c.getContext("2d", { alpha: false });
    const s = projet.scenes.find((x) => x.imageEl);
    if (s) couvrir(ctx, s.imageEl, s.imageEl.naturalWidth, s.imageEl.naturalHeight, c.width, c.height, { e: 1, x: 0, y: 0 });
    try {
      return c.toDataURL("image/jpeg", 0.6);
    } catch (e) {
      return "";
    }
  }

  window.Montage = { FORMATS, AMBIANCES, MOUVEMENTS, TRANSITION, chronologie, dessiner, bandeSon, enregistrer, typeVideo, vignette };
})();
