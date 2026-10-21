#!/usr/bin/env node
/* Tests hors ligne de Trouve ton IA : validité du catalogue et pertinence du moteur de recherche.
 * Utilisation : node tools/test-trouve.js */
"use strict";

const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "trouve", "src", "main", "assets", "web");
const R = require(path.join(WEB, "js", "search.js"));
const catalogue = JSON.parse(fs.readFileSync(path.join(WEB, "data", "catalogue.json"), "utf8"));

let ok = 0;
let ko = 0;
function verifier(cond, msg) {
  if (cond) ok++;
  else {
    ko++;
    console.error("✗ " + msg);
  }
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

const PRIX = ["gratuit", "freemium", "essai", "payant"];
const PLATS = ["web", "android", "ios", "windows", "mac", "linux", "extension"];
const BOOLS = ["fr", "sanscompte", "libre", "local", "choix"];
const CHAMPS = new Set(["id", "nom", "par", "url", "cat", "prix", "tarif", "gratuit", "resume", "desc", "forts", "limites", "tags", "plat", "ajout", ...BOOLS]);

verifier(catalogue.format === 1, "format du catalogue = 1");
verifier(Number.isInteger(catalogue.version) && catalogue.version >= 1, "version entière");
verifier(/^\d{4}-\d{2}-\d{2}$/.test(catalogue.maj), "date de mise à jour AAAA-MM-JJ");

const cats = new Map(catalogue.categories.map((c) => [c.id, c]));
verifier(cats.size === catalogue.categories.length, "identifiants de catégories uniques");
for (const c of catalogue.categories) {
  verifier(c.nom && c.icone && c.desc && Array.isArray(c.mots) && c.mots.length >= 5, `catégorie ${c.id} complète`);
}

const ids = new Set();
const urls = new Set();
for (const o of catalogue.outils) {
  const id = o.id;
  verifier(/^[a-z0-9-]+$/.test(id || ""), `identifiant valide : ${id}`);
  verifier(!ids.has(id), `identifiant unique : ${id}`);
  ids.add(id);
  for (const k of Object.keys(o)) verifier(CHAMPS.has(k), `${id} : champ inconnu « ${k} »`);
  for (const k of ["nom", "par", "url", "resume", "desc"]) verifier(typeof o[k] === "string" && o[k].trim().length > 1, `${id} : ${k} renseigné`);
  let u = null;
  try {
    u = new URL(o.url);
  } catch (e) {
    /* vérifié ci-dessous */
  }
  verifier(u && u.protocol === "https:", `${id} : URL https valide`);
  verifier(!urls.has(o.url), `${id} : URL unique`);
  urls.add(o.url);
  verifier(Array.isArray(o.cat) && o.cat.length >= 1 && o.cat.every((c) => cats.has(c)), `${id} : catégories connues`);
  verifier(new Set(o.cat).size === o.cat.length, `${id} : catégories sans doublon`);
  verifier(PRIX.includes(o.prix), `${id} : prix connu (${o.prix})`);
  verifier(o.prix === "payant" || (typeof o.gratuit === "string" && o.gratuit.length > 5), `${id} : ce qui est gratuit est décrit`);
  verifier(o.tarif === undefined || typeof o.tarif === "string", `${id} : tarif texte`);
  verifier(o.resume.length <= 110, `${id} : résumé court (${o.resume.length} caractères)`);
  verifier(o.desc.length >= 60 && o.desc.length <= 420, `${id} : description de taille raisonnable (${o.desc.length})`);
  verifier(Array.isArray(o.forts) && o.forts.length >= 1 && o.forts.every((s) => typeof s === "string" && s), `${id} : points forts`);
  verifier(Array.isArray(o.limites) && o.limites.length >= 1 && o.limites.every((s) => typeof s === "string" && s), `${id} : limites`);
  verifier(Array.isArray(o.tags) && o.tags.length >= 3, `${id} : au moins 3 mots-clés`);
  verifier(Array.isArray(o.plat) && o.plat.length >= 1 && o.plat.every((p) => PLATS.includes(p)), `${id} : plateformes connues`);
  verifier(/^\d{4}-\d{2}-\d{2}$/.test(o.ajout || ""), `${id} : date d'ajout`);
  for (const b of BOOLS) verifier(o[b] === undefined || o[b] === true, `${id} : ${b} vaut true ou est absent`);
  if (o.local) verifier(o.prix === "gratuit" || o.prix === "freemium", `${id} : un outil local n'est pas payant`);
}

for (const c of catalogue.categories) {
  const n = catalogue.outils.filter((o) => o.cat.includes(c.id)).length;
  verifier(n >= 3, `catégorie ${c.id} : au moins 3 outils (${n})`);
}

for (const col of catalogue.collections) {
  const n = R.filtrer(catalogue.outils, col.filtre).length;
  verifier(col.titre && col.icone && n >= 5, `collection ${col.id} : au moins 5 outils (${n})`);
}

for (const p of catalogue.parcours) {
  verifier(p.titre && p.icone && p.intro && p.etapes.length >= 3, `parcours ${p.id} complet`);
  for (const e of p.etapes) {
    verifier(e.titre && e.texte && e.outils.length >= 1, `parcours ${p.id} : étape « ${e.titre} » complète`);
    for (const id of e.outils) verifier(ids.has(id), `parcours ${p.id} : outil « ${id} » présent dans le catalogue`);
  }
}

verifier(catalogue.outils.length >= 200, `au moins 200 outils (${catalogue.outils.length})`);
verifier(R.filtrer(catalogue.outils, { prix: ["gratuit"] }).length >= 40, "au moins 40 outils entièrement gratuits");

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

verifier(R.normaliser("Éléphant à l'École !") === "elephant a l ecole", "normalisation des accents et apostrophes");
verifier(R.normaliser("Cœur") === "coeur", "ligature œ");
verifier(R.racine("vidéos".normalize("NFD").replace(/[̀-ͯ]/g, "")) === "video", "vidéos → video");
verifier(R.racine("images") === R.racine("image"), "image / images");
verifier(R.racine("jeux") === R.racine("jeu") || R.racine("jeux") === "jeu", "jeu / jeux");
verifier(R.racine("animer") === R.racine("animation"), "animer / animation");
verifier(R.racine("sites") === R.racine("site"), "site / sites");
verifier(R.distance("chatgtp", "chatgpt", 1) === 1, "inversion de lettres = 1 faute");
verifier(R.intentions("une IA gratuite sans inscription").gratuit === true, "intention gratuit");
verifier(R.intentions("une IA gratuite sans inscription").sanscompte === true, "intention sans compte");
verifier(R.intentions("sur mon téléphone").android === true, "intention téléphone");

/* ------------------------------------------------------------------ */
/* Pertinence                                                          */
/* ------------------------------------------------------------------ */

const index = R.creerIndex(catalogue);

function rang(requete, id) {
  const r = R.chercher(index, requete).resultats;
  const i = r.findIndex((x) => x.outil.id === id);
  return i < 0 ? Infinity : i + 1;
}

function attendu(requete, attendus, max) {
  const r = R.chercher(index, requete).resultats.slice(0, max).map((x) => x.outil.id);
  const trouve = attendus.some((id) => r.includes(id));
  verifier(trouve, `« ${requete} » : ${attendus.join(" ou ")} dans les ${max} premiers (obtenu : ${r.join(", ")})`);
}

function categorie(requete, id) {
  const c = R.chercher(index, requete).categorie;
  verifier(c === id, `« ${requete} » : catégorie ${id} (obtenu : ${c})`);
}

verifier(rang("chatgpt", "chatgpt") === 1, "chatgpt en premier");
verifier(rang("Chat GPT", "chatgpt") === 1, "« Chat GPT » → ChatGPT");
verifier(rang("chatgtp", "chatgpt") === 1, "faute de frappe « chatgtp »");
verifier(rang("mid journey", "midjourney") === 1, "« mid journey » → Midjourney");
verifier(rang("eleven labs", "elevenlabs") === 1, "« eleven labs » → ElevenLabs");
verifier(rang("mistral", "lechat") === 1, "« mistral » → Le Chat");
verifier(rang("capcut", "capcut") === 1, "capcut en premier");
verifier(rang("suno", "suno") === 1, "suno en premier");
verifier(rang("kling", "kling") === 1, "kling en premier");

attendu("je veux enlever le fond d'une photo", ["removebg", "photoroom", "pixelcut", "clipdrop"], 3);
attendu("créer une chanson", ["suno", "udio"], 2);
attendu("faire une vidéo avec l'IA", ["kling", "flow", "sora", "runway", "dreamina", "hailuo"], 5);
attendu("traduire un document pdf", ["deepl"], 3);
attendu("réviser mon bac", ["notebooklm", "knowunity", "quizlet"], 5);
attendu("exercice de maths", ["photomath", "gauth", "wolframalpha"], 3);
attendu("sous-titres pour tiktok", ["capcut", "submagic", "captions"], 3);
attendu("IA sans internet sur mon téléphone android", ["aiedge", "pocketpal"], 3);
attendu("transcrire une réunion", ["otter", "fathom", "notta", "fireflies", "tldv", "noota"], 4);
attendu("voix off", ["elevenlabs", "murf"], 3);
attendu("faire mon cv", ["kickresume", "teal"], 3);
attendu("créer un site web sans coder", ["lovable", "wix", "framer", "durable", "bolt", "v0"], 4);
attendu("agrandir une image en 4k", ["upscayl", "topaz", "magnific", "letsenhance", "krea"], 5);
attendu("faire un logo", ["looka", "recraft", "ideogram", "canva", "kittl"], 4);
attendu("présentation powerpoint", ["gamma", "m365copilot", "beautifulai", "pitch"], 3);
attendu("générer des images gratuitement", ["perchance", "craiyon", "bing-create", "whisk"], 4);
attendu("séparer la voix d'une musique", ["lalal", "moises", "uvr"], 3);
attendu("restaurer une vieille photo floue", ["remini", "letsenhance", "topaz"], 4);
attendu("modèle 3d pour imprimante", ["meshy", "tripo", "polycam"], 4);
attendu("détecter un texte écrit par chatgpt", ["gptzero", "compilatio"], 3);
attendu("faire parler une photo", ["did", "hedra", "heygen"], 4);
attendu("programmer en python", ["cursor", "ghcopilot", "claudecode", "codex", "windsurf"], 5);
attendu("automatiser mes tâches", ["zapier", "make", "n8n"], 4);
attendu("vendre sur vinted", ["photoroom"], 3);
attendu("chatbot anonyme sans compte", ["duckai", "lumo"], 3);
attendu("musique libre de droits pour youtube", ["mubert", "soundraw", "stableaudio"], 4);
attendu("apprendre l'anglais", ["duolingo", "speak"], 4);

categorie("enlever le fond d'une photo", "retouche");
categorie("faire une vidéo", "video");
categorie("créer une chanson", "musique");
categorie("réviser un examen", "etudes");
categorie("faire mon cv", "emploi");

verifier(R.chercher(index, "").resultats.length === 0, "requête vide → aucun résultat");
verifier(R.chercher(index, "le la les de").resultats.length === 0, "uniquement des mots vides → aucun résultat");
verifier(R.chercher(index, "zzqxw").resultats.length === 0, "charabia → aucun résultat");

const gratuits = R.chercher(index, "logo gratuit").resultats.slice(0, 5);
verifier(gratuits.every((r) => r.outil.prix !== "payant"), "« logo gratuit » : aucun outil payant dans le top 5");

const t0 = Date.now();
for (let i = 0; i < 50; i++) R.chercher(index, "je cherche une ia pour enlever le fond de mes photos");
const ms = (Date.now() - t0) / 50;
verifier(ms < 25, `recherche rapide (${ms.toFixed(1)} ms)`);

console.log(`${ok} vérifications réussies, ${ko} échec(s) — ${catalogue.outils.length} outils, ${catalogue.categories.length} catégories, ${catalogue.parcours.length} parcours`);
process.exit(ko ? 1 : 0);
