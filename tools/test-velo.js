#!/usr/bin/env node
/* Tests de Vélo Champion : données, tracés, progression et équilibrage des étapes. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'velo', 'src', 'main', 'assets', 'web', 'js');
const store = {};
const ctx = {
  console, Math,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['util.js', 'data.js', 'sim.js', 'save.js']) {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
}
const VC = ctx.VC;

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else {
    failed++;
    console.error('ÉCHEC : ' + name + (detail !== undefined ? ' → ' + detail : ''));
  }
}

/* Données ------------------------------------------------------------------ */
check('5 niveaux', VC.LEVELS.length === 5);
check('5 vélos', VC.BIKES.length === 5);
check('10 niveaux d’adversaires', VC.TIERS.length === 10);
for (let i = 1; i < VC.TIERS.length; i++) check('difficulté croissante ' + i, VC.TIERS[i].f > VC.TIERS[i - 1].f);
for (let i = 1; i < VC.BIKES.length; i++) {
  const a = VC.BIKES[i - 1];
  const b = VC.BIKES[i];
  check('vélo ' + b.id + ' plus rapide', b.cruise > a.cruise && b.sprint > a.sprint);
  check('vélo ' + b.id + ' payant', !!b.product && /^[a-z0-9_.]+$/.test(b.product));
}
check('premier vélo offert', !VC.BIKES[0].product);
check('identifiants produits uniques', new Set(VC.BIKES.map((b) => b.product)).size === VC.BIKES.length);
VC.LEVELS.forEach((L, i) => check('niveau ' + L.n + ' → vélo ' + (i + 1), L.bike === i + 1 && !!VC.THEMES[L.theme]));

const a1 = JSON.stringify(VC.makeOpponents(2, 4));
const a2 = JSON.stringify(VC.makeOpponents(2, 4));
check('adversaires déterministes', a1 === a2);
check('10 adversaires', VC.makeOpponents(1, 1).length === 10);
check('noms uniques', new Set(VC.makeOpponents(3, 7).map((o) => o.name)).size === 10);

/* Tracés -------------------------------------------------------------------- */
for (let L = 1; L <= 5; L++) {
  for (let S = 1; S <= 10; S++) {
    const info = VC.stageInfo(L, S);
    const t = new VC.Track(info);
    const segs = t.segments;
    const fi = Math.floor(t.finishZ / VC.SEG);
    let bad = 0;
    let maxGrade = 0;
    for (const s of segs) {
      if (!isFinite(s.y1) || !isFinite(s.y2) || !isFinite(s.curve)) bad++;
      maxGrade = Math.max(maxGrade, Math.abs(s.y2 - s.y1) / VC.SEG);
    }
    const tag = 'niveau ' + L + ' étape ' + S;
    check(tag + ' : géométrie valide', bad === 0);
    check(tag + ' : pente raisonnable', maxGrade < 0.3, maxGrade.toFixed(3));
    check(tag + ' : ligne d’arrivée', segs[fi] && segs[fi].mark === 'finish');
    check(tag + ' : ligne de départ', segs[Math.floor(t.startZ / VC.SEG)].mark === 'start');
    check(tag + ' : route après l’arrivée', t.length > t.finishZ + 150 * VC.U_M);
    let curved = 0;
    for (let i = fi - Math.floor(140 * VC.U_M / VC.SEG); i <= fi; i++) if (segs[i].curve !== 0) curved++;
    check(tag + ' : dernière ligne droite', curved === 0, curved);
  }
}

/* Progression ---------------------------------------------------------------- */
const Save = VC.Save;
Save.load();
check('étape 1 ouverte', Save.stageUnlocked(1, 1));
check('étape 2 fermée', !Save.stageUnlocked(1, 2));
let out = Save.record(1, 1, 3, 70);
check('3e place : pas de déblocage', !out.next && !Save.stageUnlocked(1, 2));
out = Save.record(1, 1, 1, 65);
check('victoire : étape 2 débloquée', out.next && out.next.stage === 2 && Save.stageUnlocked(1, 2) && out.firstWin);
for (let s = 2; s <= 10; s++) out = Save.record(1, s, 1, 60);
check('niveau 1 terminé', out.levelDone && out.next.level === 2);
check('niveau 2 atteint', Save.levelReached(2));
check('niveau 2 bloqué sans le vélo payant', !Save.levelPlayable(2));
Save.own('alu');
check('niveau 2 jouable avec Alu Sprint', Save.levelPlayable(2) && Save.bikeFor(2).id === 'alu');
check('niveau 3 non atteint', !Save.levelReached(3));
Save.setPurchased([]);
check('remboursement : vélo retiré', !Save.levelPlayable(2) && Save.state.owned.length === 1);
Save.setPurchased(['velo_alu_sprint', 'velo_aero_chrono']);
check('restauration des achats', Save.state.owned.includes('alu') && Save.state.owned.includes('aero'));
Save.state.bike = 'rouleur';
check('vélo adapté choisi automatiquement', Save.bikeFor(2).id === 'alu');
Save.reset();
check('réinitialisation : achats conservés', Save.state.owned.includes('aero') && !Save.isWon(1, 1));
check('sauvegarde écrite', !!store['velo-champion-save-v1']);

/* Équilibrage (pilote automatique) -------------------------------------------- */
function race(level, stage, bikeTier, salt) {
  const r = new VC.Race({ level, stage, bike: VC.bikeOfTier(bikeTier), salt });
  let guard = 0;
  while (r.state !== 'finished' && guard++ < 60 * 400) r.update(1 / 60, VC.autopilot(r, r.player));
  return r.results;
}
const margin = (res) => {
  const me = res.list.find((e) => e.isPlayer);
  const best = res.list.find((e) => !e.isPlayer);
  return best.time - me.time;
};
for (let L = 1; L <= 5; L++) {
  const easy = race(L, 1, L, 0);
  check('niveau ' + L + ' étape 1 : facile', easy && easy.won && margin(easy) > 8, easy && margin(easy).toFixed(1));
  const hard = race(L, 10, L, 0);
  check('niveau ' + L + ' étape 10 : gagnable avec le bon vélo', hard && hard.won, hard && hard.position);
  check('niveau ' + L + ' étape 10 : serrée', hard && margin(hard) < 6, hard && margin(hard).toFixed(1));
  if (L > 1) {
    const old = race(L, 10, L - 1, 0);
    check('niveau ' + L + ' étape 10 : impossible avec l’ancien vélo', old && !old.won, old && old.position);
  }
}

console.log(passed + ' vérifications réussies' + (failed ? ', ' + failed + ' échecs' : ''));
process.exit(failed ? 1 : 0);
