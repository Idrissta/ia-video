#!/usr/bin/env node
/* Sonde les générateurs gratuits utilisables par le studio de Trouve ton IA (exécuté par la CI,
 * qui a accès à Internet) : disponibilité, temps de réponse, format, protocole.
 * Écrit tools/trouve-recherche/sondes.json et affiche un résumé.
 * Utilisation : node tools/trouve-recherche/sonder.js */
"use strict";

const fs = require("fs");
const path = require("path");

const SORTIE = path.join(__dirname, "sondes.json");
const PROMPT = "a red fox running in a snowy forest at sunrise, cinematic";
const res = {};
const t0 = Date.now();

function note(cle, v) {
  res[cle] = v;
  console.log(`\n### ${cle}\n${JSON.stringify(v, null, 1).slice(0, 4000)}`);
}

async function appel(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 60000);
  const debut = Date.now();
  try {
    const r = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
    const type = r.headers.get("content-type") || "";
    let corps = "";
    let octets = 0;
    if (/json|text|html|event-stream/.test(type)) {
      corps = await r.text();
      octets = corps.length;
    } else {
      octets = (await r.arrayBuffer()).byteLength;
    }
    const h = {};
    for (const k of ["content-type", "retry-after", "access-control-allow-origin", "x-ratelimit-remaining", "location"]) if (r.headers.get(k)) h[k] = r.headers.get(k);
    return { code: r.status, ms: Date.now() - debut, octets, entetes: h, corps };
  } catch (e) {
    return { code: 0, ms: Date.now() - debut, erreur: e.name === "AbortError" ? "délai" : (e.cause && e.cause.code) || e.message };
  } finally {
    clearTimeout(t);
  }
}

const court = (r, n) => ({ ...r, corps: r.corps ? r.corps.slice(0, n || 300) : undefined });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Pollinations (API classique, sans clé)                              */
/* ------------------------------------------------------------------ */

async function pollinations() {
  const e = encodeURIComponent(PROMPT);
  note("pollinations.image", court(await appel(`https://image.pollinations.ai/prompt/${e}?width=576&height=1024&seed=7`, {}, 120000)));
  note("pollinations.image.immediat", court(await appel(`https://image.pollinations.ai/prompt/${e}%20b?width=576&height=1024&seed=8`, {}, 120000)));
  note("pollinations.texte", court(await appel(`https://text.pollinations.ai/${encodeURIComponent("Écris un slogan de 6 mots pour une vidéo sur les renards.")}`, {}, 90000)));
  await attendre(31000);
  const corps = {
    messages: [
      { role: "system", content: "Tu réponds uniquement en JSON." },
      { role: "user", content: 'Découpe l\'idée « un renard dans la neige » en 4 scènes. Réponds {"scenes":[{"texte":"phrase de voix off en français","image":"prompt en anglais"}]}' },
    ],
    response_format: { type: "json_object" },
  };
  note("pollinations.texte.openai", court(await appel("https://text.pollinations.ai/openai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) }, 90000), 1500));
  note("pollinations.modeles", court(await appel("https://text.pollinations.ai/models"), 600));
  note("pollinations.gen", court(await appel(`https://gen.pollinations.ai/image/${e}`), 400));
}

/* ------------------------------------------------------------------ */
/* AI Horde (GPU de bénévoles, clé anonyme)                            */
/* ------------------------------------------------------------------ */

async function horde() {
  const base = "https://aihorde.net/api/v2";
  const h = { apikey: "0000000000", "client-agent": "TrouveTonIA:1:github.com/Idrissta/ia-video", "content-type": "application/json" };
  note("horde.heartbeat", court(await appel(base + "/status/heartbeat")));
  const m = await appel(base + "/status/models?type=image", { headers: h });
  try {
    const l = JSON.parse(m.corps).sort((a, b) => b.count - a.count).slice(0, 12).map((x) => ({ nom: x.name, workers: x.count, file: x.queued, eta: x.eta }));
    note("horde.modeles", l);
  } catch (err) {
    note("horde.modeles", court(m));
  }
  const debut = Date.now();
  const job = await appel(base + "/generate/async", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ prompt: PROMPT, params: { width: 576, height: 1024, steps: 8, n: 1, sampler_name: "k_euler_a", cfg_scale: 2 }, nsfw: false, censor_nsfw: true, r2: true, models: [] }),
  });
  note("horde.envoi", court(job, 500));
  let id = null;
  try {
    id = JSON.parse(job.corps).id;
  } catch (err) {
    /* rien */
  }
  if (!id) return;
  let fini = null;
  while (Date.now() - debut < 300000) {
    await attendre(5000);
    const c = await appel(`${base}/generate/check/${id}`, { headers: h });
    try {
      const j = JSON.parse(c.corps);
      if (j.done || j.faulted) {
        fini = j;
        break;
      }
    } catch (err) {
      /* réessaie */
    }
  }
  const s = await appel(`${base}/generate/status/${id}`, { headers: h });
  let img = null;
  try {
    const j = JSON.parse(s.corps);
    img = j.generations && j.generations[0] ? { modele: j.generations[0].model, url: j.generations[0].img } : null;
  } catch (err) {
    /* rien */
  }
  note("horde.resultat", { secondes: Math.round((Date.now() - debut) / 1000), fini, img });
  if (img && img.url) note("horde.image", court(await appel(img.url)));
}

/* ------------------------------------------------------------------ */
/* Espaces Hugging Face (ZeroGPU, quota anonyme par adresse IP)        */
/* ------------------------------------------------------------------ */

async function chercherEspaces(q, n) {
  const r = await appel(`https://huggingface.co/api/spaces?search=${encodeURIComponent(q)}&sort=likes&direction=-1&limit=${n || 15}`);
  try {
    return JSON.parse(r.corps).map((x) => x.id);
  } catch (e) {
    return [];
  }
}

async function infoEspace(id) {
  const r = await appel(`https://huggingface.co/api/spaces/${id}`);
  try {
    const j = JSON.parse(r.corps);
    return { id, likes: j.likes, sdk: j.sdk, stage: j.runtime && j.runtime.stage, materiel: j.runtime && j.runtime.hardware && j.runtime.hardware.current, hote: j.host || (j.subdomain ? `https://${j.subdomain}.hf.space` : null), maj: j.lastModified };
  } catch (e) {
    return { id, erreur: r.code };
  }
}

async function apiGradio(hote) {
  for (const p of ["/gradio_api/info", "/info"]) {
    const r = await appel(hote + p, {}, 30000);
    if (r.code === 200) {
      try {
        return { prefixe: p === "/info" ? "" : "/gradio_api", info: JSON.parse(r.corps) };
      } catch (e) {
        /* suivant */
      }
    }
  }
  return null;
}

function resumeApi(info) {
  const out = {};
  for (const [nom, ep] of Object.entries(info.named_endpoints || {})) {
    out[nom] = {
      entrees: (ep.parameters || []).map((p) => `${p.parameter_name || p.label}:${(p.python_type && p.python_type.type) || (p.type && p.type.type) || "?"}${p.parameter_has_default ? "=" + JSON.stringify(p.parameter_default).slice(0, 40) : ""}`),
      sorties: (ep.returns || []).map((p) => `${p.label}:${(p.python_type && p.python_type.type) || "?"}`),
    };
  }
  return out;
}

// Appelle un point d'entrée avec le prompt et les valeurs par défaut, en suivant le protocole Gradio.
async function essayer(hote, prefixe, nom, ep, prompt, ms) {
  const data = (ep.parameters || []).map((p) => {
    const n = (p.parameter_name || p.label || "").toLowerCase();
    if (/negative/.test(n)) return p.parameter_has_default ? p.parameter_default : "";
    if (/prompt|text|description/.test(n)) return prompt;
    if (p.parameter_has_default) return p.parameter_default;
    return null;
  });
  const debut = Date.now();
  const r = await appel(`${hote}${prefixe}/call${nom}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) }, 30000);
  let ev = null;
  try {
    ev = JSON.parse(r.corps).event_id;
  } catch (e) {
    /* rien */
  }
  if (!ev) return { envoi: court(r, 400) };
  const s = await appel(`${hote}${prefixe}/call${nom}/${ev}`, {}, ms || 300000);
  const lignes = (s.corps || "").split("\n").filter((l) => /^event:|^data:/.test(l));
  return { secondes: Math.round((Date.now() - debut) / 1000), code: s.code, erreur: s.erreur, flux: lignes.slice(-6).map((l) => l.slice(0, 500)) };
}

async function huggingface() {
  const groupes = {
    video: ["ltx video", "wan2.2", "wan 2.2", "wan2.1", "image to video", "text to video", "framepack", "hunyuan video"],
    image: ["flux schnell", "z-image", "flux.1", "qwen image", "sdxl lightning"],
  };
  const vus = new Set();
  const espaces = { video: [], image: [] };
  for (const [g, qs] of Object.entries(groupes)) {
    for (const q of qs) {
      for (const id of await chercherEspaces(q, 12)) {
        if (vus.has(id)) continue;
        vus.add(id);
        espaces[g].push(await infoEspace(id));
      }
    }
    espaces[g] = espaces[g].filter((x) => x.stage === "RUNNING" && x.sdk === "gradio").sort((a, b) => b.likes - a.likes);
  }
  note("hf.video.espaces", espaces.video.slice(0, 25).map((x) => `${x.id} ♥${x.likes} ${x.materiel} ${x.hote}`));
  note("hf.image.espaces", espaces.image.slice(0, 15).map((x) => `${x.id} ♥${x.likes} ${x.materiel} ${x.hote}`));

  // API des meilleurs espaces vidéo et image (ZeroGPU ou GPU dédié), puis un essai réel.
  const essais = [...espaces.video.slice(0, 10).map((x) => ["video", x]), ...espaces.image.slice(0, 5).map((x) => ["image", x])];
  let reels = 0;
  for (const [g, e] of essais) {
    if (!e.hote) continue;
    const a = await apiGradio(e.hote);
    if (!a) {
      note(`hf.api.${e.id}`, "pas d'API Gradio lisible");
      continue;
    }
    const api = resumeApi(a.info);
    note(`hf.api.${e.id}`, { prefixe: a.prefixe, api });
    if (reels >= 7 || Date.now() - t0 > 25 * 60000) continue;
    // Point d'entrée principal : celui qui prend un prompt et renvoie une vidéo ou une image.
    const cible = Object.entries(a.info.named_endpoints || {}).find(([nom, ep]) => {
      const entrees = (ep.parameters || []).map((p) => (p.parameter_name || p.label || "").toLowerCase()).join(" ");
      const sorties = JSON.stringify(ep.returns || []).toLowerCase();
      return /prompt/.test(entrees) && (g === "video" ? /video/.test(sorties) : /image/.test(sorties)) && !/lambda|_js|clear/.test(nom);
    });
    if (!cible) continue;
    reels++;
    note(`hf.essai.${e.id}${cible[0]}`, await essayer(e.hote, a.prefixe, cible[0], cible[1], PROMPT, g === "video" ? 300000 : 120000));
  }
}

(async () => {
  // Les trois services sont indépendants : sondés en parallèle.
  await Promise.all(
    [["pollinations", pollinations], ["horde", horde], ["huggingface", huggingface]].map(([nom, f]) =>
      f().catch((e) => note(`${nom}.erreur`, String(e && e.stack)))
    )
  );
  res.duree = Math.round((Date.now() - t0) / 1000);
  res.date = new Date().toISOString();
  fs.writeFileSync(SORTIE, JSON.stringify(res, null, 1) + "\n");
  console.log(`\nTerminé en ${res.duree} s → ${SORTIE}`);
})();
