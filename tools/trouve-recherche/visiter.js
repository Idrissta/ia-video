#!/usr/bin/env node
/* Recherche pour le catalogue de Trouve ton IA (exécuté par la CI, qui a accès à Internet).
 *
 * 1. « taaft » : affiche la structure publique de There's An AI For That (menus, titres, filtres,
 *    noms des outils de la page vidéo) pour s'en inspirer ; rien n'est enregistré.
 * 2. « sites » : visite chaque site candidat (tools/trouve-recherche/candidats.json) et enregistre
 *    s'il répond, son titre, sa description et des indices (offre gratuite, appli Android, open source…)
 *    dans tools/trouve-recherche/resultats.json.
 * Utilisation : node tools/trouve-recherche/visiter.js [taaft] [sites] */
"use strict";

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const PARALLELE = 16;
const MAX_HTML = 600000;

function texte(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html, nom) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${nom}["'][^>]*>`, "i");
  const m = html.match(re);
  if (!m) return "";
  const c = m[0].match(/content=["']([^"']*)["']/i);
  return c ? texte(c[1]).slice(0, 300) : "";
}

async function lire(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 20000);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" } });
    let html = "";
    const type = r.headers.get("content-type") || "";
    if (/html|text|json/.test(type)) html = (await r.text()).slice(0, MAX_HTML);
    return { code: r.status, final: r.url, html };
  } catch (e) {
    return { code: 0, final: url, html: "", erreur: e.name === "AbortError" ? "délai" : (e.cause && e.cause.code) || e.message };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------ */
/* There's An AI For That : structure publique                         */
/* ------------------------------------------------------------------ */

async function taaft() {
  const base = "https://theresanaiforthat.com";
  const robots = await lire(base + "/robots.txt");
  console.log("=== robots.txt (" + robots.code + ")\n" + robots.html.slice(0, 1500));
  const pages = ["/", "/task/videos/", "/s/video+generator/", "/just-released/", "/leaderboard/", "/mini-tools/", "/jobs/"];
  for (const p of pages) {
    const r = await lire(base + p);
    const h = r.html;
    console.log(`\n=== ${p} → ${r.code} ${r.final}`);
    if (!h) continue;
    console.log("titre :", (h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    console.log("description :", meta(h, "description"));
    const titres = [...h.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => `h${m[1]} ${texte(m[2])}`).filter((x) => x.length > 3);
    console.log("titres :", [...new Set(titres)].slice(0, 40).join(" | "));
    const liens = [...h.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => [m[1], texte(m[2])])
      .filter(([u, t]) => t && t.length < 40 && (u.startsWith("/") || u.includes("theresanaiforthat")));
    const nav = [...new Map(liens.map(([u, t]) => [t, u])).entries()].slice(0, 90).map(([t, u]) => `${t} (${u})`);
    console.log("liens :", nav.join(" · "));
    const boutons = [...h.matchAll(/<(?:button|label|option)[^>]*>([\s\S]*?)<\/(?:button|label|option)>/gi)].map((m) => texte(m[1])).filter((x) => x && x.length < 30);
    console.log("boutons/filtres :", [...new Set(boutons)].slice(0, 60).join(" · "));
    const prix = [...new Set((texte(h).match(/\b(100% free|free mode|freemium|free trial|paid|from \$\d+[^ ]*|no pricing)\b/gi) || []).map((x) => x.toLowerCase()))];
    console.log("étiquettes de prix :", prix.join(", "));
    const outils = [...h.matchAll(/data-name=["']([^"']+)["']/gi)].map((m) => m[1]);
    const outils2 = [...h.matchAll(/class=["'][^"']*ai_link[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => texte(m[1])).filter(Boolean);
    const noms = [...new Set(outils.concat(outils2))];
    if (noms.length) console.log(`outils listés (${noms.length}) :`, noms.slice(0, 120).join(", "));
    const chiffres = (texte(h).match(/\b\d[\d,. ]{2,}\s*(AIs?|tools|tasks|jobs|users|humans)\b/gi) || []).slice(0, 15);
    console.log("chiffres :", [...new Set(chiffres)].join(" | "));
  }
}

/* ------------------------------------------------------------------ */
/* Sites candidats                                                     */
/* ------------------------------------------------------------------ */

const INDICES = {
  gratuit: /\b(free|gratuit|gratis|kostenlos)\b/i,
  planGratuit: /(free plan|free forever|forever free|plan gratuit|gratuit pour toujours|start(ed)? for free|try (it )?for free|get started free|free credits|crédits gratuits|\$0\b|0 ?€|no credit card)/i,
  essai: /(free trial|essai gratuit|try free for \d+|\d+-day trial)/i,
  tarifs: /(pricing|tarifs|prix|plans)\b/i,
  prixAffiche: /(\$\s?\d+|\d+(?:[.,]\d+)?\s?(€|\$|usd|eur)\b)\s*(\/|per|par)\s*(mo|month|mois)/i,
  open: /(open[- ]source|github\.com\/[\w.-]+\/[\w.-]+)/i,
  android: /play\.google\.com\/store\/apps/i,
  ios: /apps\.apple\.com\//i,
  extension: /(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i,
  sansCompte: /(no sign[- ]?up|no login|without (signing|an account)|sans inscription|no account (needed|required))/i,
  fr: /(\bfrançais\b|lang=["']fr)/i,
  ia: /\b(ai|ia|artificial intelligence|intelligence artificielle|gpt|llm|machine learning|neural|diffusion)\b/i,
};

async function github(url) {
  const m = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!m) return null;
  const headers = { "user-agent": "trouve-ton-ia", accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = "Bearer " + process.env.GITHUB_TOKEN;
  try {
    const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers });
    if (!r.ok) return { code: r.status };
    const d = await r.json();
    return { code: 200, desc: d.description, etoiles: d.stargazers_count, licence: d.license && d.license.spdx_id, archive: d.archived, maj: d.pushed_at, site: d.homepage };
  } catch (e) {
    return { code: 0 };
  }
}

async function visiter(c) {
  if (/github\.com\/[\w.-]+\/[\w.-]+/.test(c.url)) {
    const g = await github(c.url);
    return { url: c.url, nom: c.nom, cat: c.cat, source: c.source, code: g ? g.code : 0, github: g };
  }
  const r = await lire(c.url);
  const h = r.html;
  const out = { url: c.url, nom: c.nom, cat: c.cat, source: c.source, code: r.code, final: r.final !== c.url ? r.final : undefined, erreur: r.erreur };
  if (!h) return out;
  const t = texte(h);
  out.titre = texte((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 160);
  out.desc = meta(h, "description") || meta(h, "og:description");
  out.h1 = texte((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").slice(0, 160);
  out.lang = (h.match(/<html[^>]+lang=["']([\w-]+)/i) || [])[1];
  out.indices = Object.keys(INDICES).filter((k) => INDICES[k].test(k === "android" || k === "ios" || k === "extension" || k === "open" || k === "fr" ? h : t));
  out.parking = /(domain (is )?for sale|buy this domain|this domain may be for sale|parked free|domaine à vendre|godaddy\.com\/domainsearch|sedo\.com)/i.test(t) || t.length < 40;
  // Page de tarifs : précise s'il existe une offre gratuite.
  const lien = (h.match(/href=["']([^"']*(?:pricing|tarif|plans)[^"']*)["']/i) || [])[1];
  if (lien && r.code >= 200 && r.code < 400) {
    try {
      const u = new URL(lien, r.final).toString();
      const p = await lire(u, 15000);
      if (p.html) {
        const pt = texte(p.html);
        out.tarifs = {
          url: u,
          gratuit: /(\$0\b|0 ?€|free plan|plan gratuit|\bfree\b\s*(forever|plan|tier)?|gratuit)/i.test(pt),
          essai: INDICES.essai.test(pt),
          prix: (pt.match(/(\$\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?€)\s*(?:\/|per|par)\s*(?:mo|month|mois|user)/gi) || []).slice(0, 4),
        };
      }
    } catch (e) {
      /* lien invalide */
    }
  }
  return out;
}

async function sites() {
  const cands = JSON.parse(fs.readFileSync(path.join(DIR, "candidats.json"), "utf8"));
  const file = cands.slice();
  const res = [];
  let n = 0;
  await Promise.all(Array.from({ length: PARALLELE }, async () => {
    while (file.length) {
      const c = file.shift();
      res.push(await visiter(c));
      if (++n % 100 === 0) console.log(`${n}/${cands.length} sites visités`);
    }
  }));
  res.sort((a, b) => cands.findIndex((c) => c.url === a.url) - cands.findIndex((c) => c.url === b.url));
  fs.writeFileSync(path.join(DIR, "resultats.json"), JSON.stringify(res, null, 0).replace(/\},\{/g, "},\n{") + "\n");
  const ok = res.filter((r) => r.code >= 200 && r.code < 400 && !r.parking).length;
  const proteges = res.filter((r) => [401, 403, 429].includes(r.code)).length;
  console.log(`${res.length} candidats : ${ok} répondent, ${proteges} protégés, ${res.length - ok - proteges} en échec ou parqués`);
}

(async () => {
  const modes = process.argv.slice(2);
  if (!modes.length || modes.includes("taaft")) await taaft();
  if (!modes.length || modes.includes("sites")) await sites();
})();
