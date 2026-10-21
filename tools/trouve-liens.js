#!/usr/bin/env node
/* Vérifie que les sites officiels du catalogue de Trouve ton IA répondent (réseau requis).
 * Informatif : les sites protégés contre les robots (403, 429…) sont signalés « à vérifier à la main ».
 * Utilisation : node tools/trouve-liens.js */
"use strict";

const fs = require("fs");
const path = require("path");

const FICHIER = path.join(__dirname, "..", "trouve", "src", "main", "assets", "web", "data", "catalogue.json");
const catalogue = JSON.parse(fs.readFileSync(FICHIER, "utf8"));
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const PARALLELE = 8;

async function tester(o) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(o.url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": UA, accept: "text/html,*/*" } });
    const final = r.url && r.url !== o.url ? r.url : "";
    return { o, code: r.status, final };
  } catch (e) {
    return { o, code: 0, erreur: e.name === "AbortError" ? "délai dépassé" : e.cause ? e.cause.code || e.message : e.message };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const file = catalogue.outils.slice();
  const res = [];
  await Promise.all(Array.from({ length: PARALLELE }, async () => {
    while (file.length) res.push(await tester(file.shift()));
  }));
  res.sort((a, b) => a.o.id.localeCompare(b.o.id));
  const morts = res.filter((r) => r.code === 0 || r.code === 404 || r.code === 410 || r.code >= 500);
  const proteges = res.filter((r) => [401, 403, 405, 406, 429, 451].includes(r.code));
  const redirs = res.filter((r) => r.code >= 200 && r.code < 400 && r.final && new URL(r.final).hostname !== new URL(r.o.url).hostname);

  console.log(`${res.length} sites testés : ${res.length - morts.length - proteges.length} OK, ${proteges.length} protégés, ${morts.length} en échec\n`);
  if (morts.length) {
    console.log("En échec (à corriger) :");
    for (const r of morts) console.log(`  ✗ ${r.o.id.padEnd(18)} ${String(r.code || r.erreur).padEnd(14)} ${r.o.url}`);
    console.log("");
  }
  if (proteges.length) {
    console.log("Protégés contre les robots (à vérifier à la main) :");
    for (const r of proteges) console.log(`  ? ${r.o.id.padEnd(18)} ${String(r.code).padEnd(14)} ${r.o.url}`);
    console.log("");
  }
  if (redirs.length) {
    console.log("Redirigés vers un autre domaine (adresse à mettre à jour ?) :");
    for (const r of redirs) console.log(`  → ${r.o.id.padEnd(18)} ${r.o.url}  ⇒  ${r.final}`);
  }
  process.exit(morts.length ? 1 : 0);
})();
