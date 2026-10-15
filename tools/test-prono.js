#!/usr/bin/env node
/* Tests de PronoFoot (hors ligne) : calculs du moteur, règlement des paris,
 * cohérence probabilités / règlement et lecture des données ESPN. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'prono', 'src', 'main', 'assets', 'web', 'js');
const routes = {};
const ctx = {
  console, Math, Date, JSON, Promise, Map, Set, Intl, setTimeout, clearTimeout, AbortController,
  fetch: async (url) => {
    const key = Object.keys(routes).find((k) => url.indexOf(k) >= 0);
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(routes[key](url))) };
  }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['leagues.js', 'engine.js', 'stats.js', 'data.js']) {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
}
const E = ctx.PRONO.Engine;
const D = ctx.PRONO.Data;
const ST = ctx.PRONO.Stats;

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else {
    failed++;
    console.error('ÉCHEC : ' + name + (detail !== undefined ? ' → ' + detail : ''));
  }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);
const sum = (arr) => arr.reduce((s, x) => s + x, 0);

/* Moteur : matrice des scores --------------------------------------------- */
for (const [lh, la, rho] of [[0.3, 0.2, 0], [1.5, 1.1, -0.05], [3.2, 0.6, -0.1], [2.4, 2.6, 0.05]]) {
  const m = E.matrix(lh, la, rho, 10);
  const tot = sum(m.map((r) => sum(r)));
  check('matrice normalisée ' + lh + '/' + la, near(tot, 1, 1e-9), tot);
  check('matrice positive ' + lh + '/' + la, m.every((r) => r.every((x) => x >= 0)));
  const b = E.basic(m);
  check('1X2 somme à 1 ' + lh + '/' + la, near(b.h + b.d + b.a, 1, 1e-9));
  let mh = 0;
  for (let i = 0; i < m.length; i++) for (let j = 0; j < m.length; j++) mh += i * m[i][j];
  if (rho === 0) check('moyenne domicile ' + lh, near(mh, lh, 1e-4), mh);
}

/* Moteur : marge du bookmaker ---------------------------------------------- */
{
  const f = E.fairProbs([2.1, 3.3, 3.6]);
  check('marge retirée : somme 1', near(sum(f), 1, 1e-9));
  check('marge retirée : ordre conservé', f[0] > f[1] && f[1] > f[2]);
  const f0 = E.fairProbs([2, 4, 4]);
  check('sans marge : inchangé', near(f0[0], 0.5) && near(f0[1], 0.25));
  check('cote invalide rejetée', E.fairProbs([1, 3, 4]) === null);
  const ou = E.fairProbs([1.9, 1.9]);
  check('total 2,5 équilibré', near(ou[0], 0.5));
}

/* Moteur : buts attendus déduits des cotes --------------------------------- */
for (const [lh, la] of [[1.7, 0.9], [1.1, 1.3], [2.6, 0.7]]) {
  const b = E.basic(E.matrix(lh, la, -0.05, 8));
  const r = E.marketLambdas(b.h, b.d, b.a, b.o25, -0.05);
  check('buts attendus retrouvés ' + lh + '/' + la, near(r.lh, lh, 0.03) && near(r.la, la, 0.03), r.lh.toFixed(3) + '/' + r.la.toFixed(3));
}

/* Moteur : règlement des paris --------------------------------------------- */
const S = (key, hg, ag, hthg, htag) => E.settle(key, { hg, ag, hthg, htag });
const cases = [
  ['1', 2, 1, 'won'], ['X', 1, 1, 'won'], ['2', 2, 1, 'lost'], ['1X', 1, 1, 'won'], ['12', 0, 0, 'lost'],
  ['O1.5', 1, 1, 'won'], ['U2.5', 2, 1, 'lost'], ['BTTS_Y', 1, 1, 'won'], ['BTTS_N', 2, 0, 'won'],
  ['DNB1', 1, 1, 'push'], ['DNB2', 0, 1, 'won'],
  ['AH1-0.5', 1, 0, 'won'], ['AH1-0.25', 1, 1, 'half-lost'], ['AH1-0.75', 2, 1, 'half-won'], ['AH2+0.5', 1, 1, 'won'],
  ['AH2+1', 2, 1, 'push'], ['AH1-1.5', 2, 1, 'lost'], ['AH2+0.25', 1, 1, 'half-won'],
  ['AO2.25', 1, 1, 'half-lost'], ['AO2.25', 2, 1, 'won'], ['AU2.75', 2, 1, 'half-lost'], ['AU2.75', 1, 1, 'won'],
  ['AO2', 1, 1, 'push'], ['AU3', 2, 2, 'lost'],
  ['it1O0.5', 1, 0, 'won'], ['it2U1.5', 0, 2, 'lost'], ['EX3', 2, 1, 'won'], ['EX6', 4, 3, 'won'],
  ['CS2-1', 2, 1, 'won'], ['CS1', 3, 0, 'won'], ['CS2', 3, 0, 'lost'], ['WTN1', 2, 0, 'won'],
  ['EH1-1', 2, 1, 'lost'], ['EHX-1', 2, 1, 'won'], ['EH2+2', 0, 3, 'won'], ['MG0', 2, 1, 'won'], ['MG6', 0, 4, 'won'],
  ['RT1O2.5', 2, 1, 'won'], ['RTXU2.5', 1, 1, 'won'], ['RB2Y', 1, 2, 'won'], ['DT1XU3.5', 2, 2, 'lost'],
  ['DBX2N', 0, 0, 'won'], ['BTO2.5', 2, 1, 'won'], ['BNU2.5', 1, 0, 'won'], ['MB2-3', 2, 1, 'won'], ['T3E2', 1, 1, 'won'],
  ['E2Y', 2, 2, 'won'], ['ODD', 2, 1, 'won'], ['FH0', 0, 0, 'won'],
  ['H1', 2, 1, 'won', 1, 0], ['HX', 2, 1, 'lost', 1, 0], ['HO0.5', 2, 1, 'won', 1, 0], ['HU1.5', 2, 1, 'won', 1, 0],
  ['HF1X', 1, 1, 'won', 1, 0], ['HF21', 2, 1, 'won', 0, 1], ['BHY', 2, 1, 'won', 1, 0], ['BHN', 1, 0, 'won', 1, 0],
  ['S1', 1, 1, 'lost', 1, 0], ['S2', 1, 1, 'won', 1, 0], ['SO0.5', 1, 1, 'won', 1, 0], ['SBY', 2, 2, 'won', 1, 1],
  ['WE1', 2, 1, 'won', 0, 1], ['WB1', 2, 0, 'won', 1, 0], ['T1BH', 2, 0, 'won', 1, 0], ['HSH2', 3, 1, 'won', 1, 0],
  ['HCS1-0', 2, 1, 'won', 1, 0], ['HAH2+0.5', 2, 1, 'lost', 1, 0], ['H1O0.5', 2, 1, 'won', 1, 0], ['S2O0.5', 2, 1, 'won', 1, 0],
  ['TH12', 3, 0, 'won', 1, 0], ['TH2X', 3, 0, 'won', 1, 0], ['FH2', 1, 0, 'won', 0, 0], ['BBY', 2, 2, 'won', 1, 1],
  ['HEVEN', 2, 1, 'lost', 1, 0], ['FG1', 1, 0, null], ['H1', 1, 0, null]
];
for (const [k, hg, ag, want, hh, ha] of cases) {
  const got = S(k, hg, ag, hh, ha);
  check('règlement ' + k + ' ' + hg + '-' + ag + (hh != null ? ' (mi-temps ' + hh + '-' + ha + ')' : ''), got === want, got);
}
check('score incohérent ignoré', S('H1', 1, 0, 2, 0) === null);
check('score manquant ignoré', E.settle('1', { hg: NaN, ag: 1 }) === null);

/* Données d'exemple ---------------------------------------------------------- */
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pois = (l) => {
  const L = Math.exp(-l);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > L);
  return k - 1;
};
const sample = (gfL, gaL, n, start) => Array.from({ length: n }, (_, i) => ({
  date: new Date(start - i * 7 * 864e5), isHome: i % 2 === 0, gf: pois(gfL), ga: pois(gaL), w: i === 3 ? 0.75 : 1
}));
const now = Date.UTC(2026, 9, 15);
const input = {
  home: { matches: sample(2.0, 0.8, 20, now) },
  away: { matches: sample(0.9, 1.6, 20, now) },
  h2h: [{ ageYears: 0.5, hg: 2, ag: 0, homeAtHome: true }, { ageYears: 1.4, hg: 1, ag: 1, homeAtHome: false }, { ageYears: 2.2, hg: 3, ag: 1, homeAtHome: true }],
  names: { home: 'Raja', away: 'Wydad' }
};

/* Moteur : analyse complète -------------------------------------------------- */
const res = E.analyze(input);
check('buts attendus valides', isFinite(res.lh) && isFinite(res.la) && res.lh > 0 && res.la > 0, res.lh + '/' + res.la);
check('équipe forte favorite', res.lh > res.la);
check('au moins 45 marchés', res.markets.length >= 45, res.markets.length);
const nSel = sum(res.markets.map((mk) => mk.sels.length));
check('au moins 300 sélections', nSel >= 300, nSel);
const keys = new Set();
let dup = '';
for (const mk of res.markets) {
  for (const s of mk.sels) {
    if (keys.has(s.key)) dup += s.key + ' ';
    keys.add(s.key);
    if (!(s.p >= 0 && s.p <= 1)) check('probabilité dans [0,1] ' + s.key, false, s.p);
    if (s.fair != null && !(s.fair >= 1)) check('cote juste ≥ 1 ' + s.key, false, s.fair);
    if (/[a-z]\.\d/i.test(s.label) && !/\d,\d/.test(s.label) && /\d\.\d/.test(s.label)) check('libellé décimal français ' + s.key, false, s.label);
  }
}
check('clés de sélection uniques', !dup, dup);
const mk = (id) => res.markets.find((m) => m.id === id);
const exclusive = ['1x2', 'btts', 'exact', 'margin', 'htft', 'hsh', 'firstgoaltime', 'ht1x2', '2h1x2', 'oddeven', 'bothhalves', 'bttsboth', 'firstgoal', 'firsthalfgoal'];
for (const id of exclusive) {
  const m = mk(id);
  check('issues exclusives : ' + id, m && near(sum(m.sels.map((s) => s.p)), 1, 2e-3), m && sum(m.sels.map((s) => s.p)));
}
check('double chance somme à 2', near(sum(mk('dc').sels.map((s) => s.p)), 2, 1e-6));
for (const L of [0.5, 1.5, 2.5, 3.5, 4.5]) {
  const o = mk('total').sels.find((s) => s.key === 'O' + L).p;
  const u = mk('total').sels.find((s) => s.key === 'U' + L).p;
  check('plus + moins = 1 (' + L + ')', near(o + u, 1, 1e-9));
}
const cs = mk('cs').sels.filter((s) => s.key !== 'CSO');
check('scores exacts triés', cs.every((s, i) => i === 0 || cs[i - 1].p >= s.p));
check('score exact complet (0-0 à 5-5 + autre)', cs.length === 36 && near(sum(mk('cs').sels.map((s) => s.p)), 1, 1e-9));

/* Cohérence : la probabilité affichée correspond au règlement réel --------- */
// Marchés du temps réglementaire : on parcourt la matrice des scores ;
// marchés des mi-temps : les deux périodes indépendantes du modèle.
const n = res.ft.length - 1;
const ftCells = [];
for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) ftCells.push([i, j, res.ft[i][j]]);
const htCells = [];
const m7 = Math.min(n, 7);
for (let a = 0; a <= m7; a++) for (let c = 0; c <= m7; c++) for (let d = 0; d <= m7; d++) for (let e = 0; e <= m7; e++) {
  const pr = res.h1[a][c] * res.h2[d][e];
  if (pr > 1e-12) htCells.push([a + d, c + e, pr, a, c]);
}
// Périodes : écart d'arrondi toléré (scores de plus de 7 buts par mi-temps négligés).
const approx = { firsthalfgoal: 0.03 };
const HT_TOL = 3e-4;
let settled = 0;
let unsettled = [];
for (const m of res.markets) {
  for (const s of m.sels) {
    let cells = ftCells;
    let tol = approx[m.id] || 2e-6;
    if (E.settle(s.key, { hg: 1, ag: 1 }) === null) {
      if (E.settle(s.key, { hg: 1, ag: 1, hthg: 0, htag: 1 }) === null) {
        unsettled.push(s.key);
        continue;
      }
      cells = htCells;
      tol = Math.max(tol, HT_TOL);
    }
    const tally = { won: 0, lost: 0, push: 0, 'half-won': 0, 'half-lost': 0 };
    for (const [hg, ag, pr, hthg, htag] of cells) tally[E.settle(s.key, { hg, ag, hthg, htag })] += pr;
    const tot = sum(Object.values(tally));
    let expect;
    let got = s.p;
    if (s.asian) {
      const win = (tally.won + tally['half-won'] / 2) / tot;
      const lose = (tally.lost + tally['half-lost'] / 2) / tot;
      check('asiatique ' + s.key + ' : gain', near(s.asian.win, win, 1e-6), s.asian.win + ' ≠ ' + win);
      check('asiatique ' + s.key + ' : perte', near(s.asian.lose, lose, 1e-6), s.asian.lose + ' ≠ ' + lose);
      expect = win + (1 - win - lose) / 2;
    } else if (s.push != null) {
      expect = tally.won / Math.max(1e-12, tally.won + tally.lost);
    } else {
      expect = tally.won / tot;
    }
    settled++;
    check('probabilité ↔ règlement ' + s.key, near(got, expect, tol), got.toFixed(5) + ' ≠ ' + expect.toFixed(5));
  }
}
check('presque tous les paris se règlent automatiquement', settled >= 280, settled + ' réglés, non réglés : ' + unsettled.join(' '));
// Les paris liés aux minutes et à l'ordre des buts ont besoin du déroulé du match (testés plus bas).
const needGoals = (k) => E.settle(k, { hg: 1, ag: 1, hthg: 0, htag: 1, goals: [{ min: 10, extra: 0, side: 'h', type: '' }, { min: 80, extra: 0, side: 'a', type: '' }] }) !== null;
const manual = unsettled.filter((k) => !needGoals(k));
check('seuls « but de la tête » reste à vérifier soi-même', manual.every((k) => /^HD[YN]$/.test(k)), manual.join(' '));

/* Minutes et ordre des buts : comparaison avec une simulation du match ------- */
{
  const r0 = E.analyze(input, { rho: 0 });
  const T = E.timeProfile(E.lastHtShare);
  const cumW = T.cum;
  let sd = 12345;
  const u = () => (sd = (sd * 48271) % 2147483647) / 2147483647;
  const poisN = (l) => {
    const L = Math.exp(-l);
    let k = 0;
    let q = 1;
    do {
      k++;
      q *= u();
    } while (q > L);
    return k - 1;
  };
  const minute = () => {
    const x = u();
    let m = 1;
    while (m < 90 && cumW[m] < x) m++;
    const w = cumW[m] - cumW[m - 1];
    const extra = (m === 45 && u() < T.st1 / w) || (m === 90 && u() < T.st2 / w) ? 1 + Math.floor(u() * 5) : 0;
    return { min: m, extra };
  };
  const sims = [];
  const NS = 60000;
  for (let i = 0; i < NS; i++) {
    const hg = poisN(r0.lh);
    const ag = poisN(r0.la);
    const goals = [];
    for (let k = 0; k < hg; k++) goals.push(Object.assign(minute(), { side: 'h', type: u() < E.GOAL_TYPES.PG / (1 - E.GOAL_TYPES.OG) ? 'PG' : '' }));
    for (let k = 0; k < ag; k++) goals.push(Object.assign(minute(), { side: 'a', type: '' }));
    sims.push({ hg, ag, goals });
  }
  let n = 0;
  for (const m of r0.markets) {
    for (const s of m.sels) {
      if (!/^(GB|GI|FT|R\d|GL|GST|T15_|T76_|FG|LG|FR|FW|RA|CB|BL)/.test(s.key) || /^FT$/.test(s.key)) continue;
      let won = 0;
      for (const sm of sims) if (E.settle(s.key, sm) === 'won') won++;
      const f = won / NS;
      const tol = 4.5 * Math.sqrt(Math.max(s.p * (1 - s.p), 1e-4) / NS) + 0.004;
      n++;
      check('simulation ↔ probabilité ' + s.key, Math.abs(f - s.p) <= tol, s.p.toFixed(4) + ' vs ' + f.toFixed(4));
    }
  }
  check('paris de minutes/ordre vérifiés par simulation', n >= 70, n);
}

/* Paris statistiques : probabilité ↔ règlement ------------------------------- */
{
  const names = { home: 'Raja', away: 'Wydad' };
  const mkHist = (c, f, a) => Array.from({ length: 10 }, (_, i) => ({ isHome: i % 2 === 0, for: f + (i % 3) - 1, against: a + (i % 2), w: 1 }));
  const teams = { home: {}, away: {} };
  for (const id of Object.keys(ST.SPECS)) {
    const sp = ST.SPECS[id];
    teams.home[id] = mkHist(id, Math.round(sp.home * 1.2), Math.round(sp.away * 0.9));
    teams.away[id] = mkHist(id, Math.round(sp.away * 0.9), Math.round(sp.home * 1.1));
  }
  teams.home.pen = mkHist('pen', 0, 0).map((g, i) => Object.assign(g, { for: i === 2 ? 1 : 0, against: 0 }));
  teams.away.pen = mkHist('pen', 0, 0).map((g, i) => Object.assign(g, { for: 0, against: i === 4 ? 1 : 0 }));
  const sr = ST.analyze(teams, names, false, { lh: 1.6, la: 1.1, scorers: { home: { list: [{ id: '9', name: 'Buteur', goals: 5 }], teamGoals: 15, matches: 10 }, away: null } });
  check('marchés statistiques', sr.markets.length >= 40, sr.markets.length);
  const ids = new Set(sr.markets.map((m) => m.id.split(':')[0]));
  for (const id of ['corners', 'yellow', 'shotsOn', 'shots', 'fouls', 'offsides', 'saves', 'red', 'pen', 'scorer1']) check('marché ' + id + ' présent', ids.has(id));
  let checked = 0;
  for (const m of sr.markets) {
    const stat = m.stat;
    if (!ST.SPECS[stat] || stat === 'red') continue;
    const spec = ST.SPECS[stat];
    const lam = sr.expected[stat];
    const N = 70;
    const isH1 = /:h1$/.test(m.id);
    const f = isH1 ? spec.h1 : 1;
    const ph = ST.nb(lam.lh * f, spec.k, N);
    const pa = ST.nb(lam.la * f, spec.k, N);
    for (const s of m.sels) {
      let won = 0;
      let tot = 0;
      let unknown = false;
      for (let x = 0; x <= N && !unknown; x++) for (let y = 0; y <= N; y++) {
        const pr = ph[x] * pa[y];
        if (pr < 1e-14) continue;
        const r = isH1 ? { hg: 0, ag: 0, stats: { [stat]: [x + 50, y + 50] }, statsH1: { [stat]: [x, y] } } : { hg: 0, ag: 0, stats: { [stat]: [x, y] } };
        const st = E.settle(s.key, r);
        if (st === null) {
          unknown = true;
          break;
        }
        if (st === 'won') won += pr;
        tot += pr;
      }
      if (unknown) {
        check('pari statistique réglable ' + s.key, /^cornersF[12]$/.test(s.key), s.key);
        continue;
      }
      checked++;
      check('probabilité ↔ règlement ' + s.key, near(s.p, won / tot, 2e-6), s.p.toFixed(5) + ' ≠ ' + (won / tot).toFixed(5));
    }
  }
  check('paris statistiques vérifiés', checked >= 150, checked);
  // Carton rouge et penalty (lois de Poisson).
  const red = sr.expected.red;
  const pRed = sr.markets.find((m) => m.id === 'red').sels[0].p;
  check('carton rouge ↔ règlement', near(pRed, 1 - Math.exp(-(red.lh + red.la)), 1e-9) && E.settle('redY', { stats: { red: [0, 1] } }) === 'won' && E.settle('redN', { stats: { red: [0, 0] } }) === 'won');
  const pen = sr.expected.pen;
  check('penalty : plus probable pour l’équipe qui en obtient', pen.p1 > pen.p2, pen.p1 + ' / ' + pen.p2);
  check('penalty : proche de la fréquence mesurée', pen.p > 0.18 && pen.p < 0.4, pen.p);
  check('penalty ↔ règlement', E.settle('penY', { pens: { h: 1, a: 0, scored: 0 } }) === 'won' && E.settle('penSY', { pens: { h: 1, a: 0, scored: 0 } }) === 'lost' && E.settle('pen2Y', { pens: { h: 1, a: 0 } }) === 'lost');
  const sc = sr.markets.find((m) => m.id === 'scorer1');
  check('buteur : probabilité', sc && near(sc.sels[0].p, 1 - Math.exp(-1.6 * 5 / 17), 1e-9), sc && sc.sels[0].p);
  const g9 = [{ min: 20, side: 'h', scorer: '9', type: '' }, { min: 50, side: 'a', scorer: '3', type: '' }];
  check('buteur ↔ règlement', E.settle('SC9', { hg: 1, ag: 1, goals: g9 }) === 'won' && E.settle('SC3', { hg: 1, ag: 1, goals: [{ min: 20, side: 'h', scorer: '9', type: '' }, { min: 50, side: 'a', scorer: '3', type: 'OG' }] }) === 'lost' && E.settle('SC9', { hg: 1, ag: 0 }) === null);
  const noData = ST.analyze({ home: {}, away: {} }, names, false, {});
  check('sans statistiques : corners et cartons sur moyennes', noData.markets.some((m) => m.id === 'corners:total') && noData.markets.some((m) => m.id === 'yellow:total') && !noData.markets.some((m) => m.id === 'fouls:total'));
}

/* Cotes de référence et value ------------------------------------------------ */
{
  const ref = { '1': 5.5, X: 4.0, '2': 1.6, 'O2.5': 1.8, 'U2.5': 2.0 };
  const r2 = E.analyze(Object.assign({}, input, { refOdds: ref }));
  check('marché pris en compte', r2.market && r2.market.lh < r2.market.la);
  check('mélange modèle / marché', r2.lh < res.lh && r2.la > res.la && r2.lh >= Math.min(r2.market.lh, res.lh) - 1e-9);
  check('cotes perso sans effet sur les probabilités', near(E.analyze(Object.assign({}, input, { odds: { '1': 9 } })).lh, res.lh, 1e-12));

  const p1 = mk('1x2').sels[0];
  const o15 = mk('total').sels.find((s) => s.key === 'O1.5');
  const ah = mk('ah').sels.find((s) => s.key === 'AH1-0.25');
  const dnb = mk('dnb').sels[0];
  const odds = { '1': +(1.25 / p1.p).toFixed(2), 'O1.5': +(0.9 / o15.p).toFixed(2), 'AH1-0.25': +ah.fair.toFixed(3), DNB1: +dnb.fair.toFixed(3) };
  const r3 = E.analyze(Object.assign({}, input, { odds }));
  const g = (key) => { for (const m of r3.markets) for (const s of m.sels) if (s.key === key) return s; return null; };
  check('value 1X2', near(g('1').ev, g('1').p * odds['1'] - 1, 1e-9) && g('1').ev > 0.2);
  check('pas de value sous la cote juste', g('O1.5').ev < 0);
  check('asiatique à la cote juste : EV nulle', near(g('AH1-0.25').ev, 0, 2e-3), g('AH1-0.25').ev);
  check('remboursé si nul à la cote juste : EV nulle', near(g('DNB1').ev, 0, 2e-3), g('DNB1').ev);
  check('value détectée dans les pronostics', r3.picks.values.some((v) => v.label === g('1').label));
  check('value triée', r3.picks.values.every((v, i, a) => i === 0 || a[i - 1].ev >= v.ev));
}
check('pronostic principal probable', res.picks.main && res.picks.main.p >= 0.5, res.picks.main && res.picks.main.label);
check('6 pronostics au plus', res.picks.list.length >= 3 && res.picks.list.length <= 6);
check('confiance 0..100', res.confidence.score >= 0 && res.confidence.score <= 100);
{
  const empty = E.analyze({ home: { matches: [] }, away: { matches: [] }, h2h: [] });
  check('analyse sans données', isFinite(empty.lh) && isFinite(empty.la) && empty.picks.main, empty.lh);
  check('sans données : avantage du terrain', empty.lh > empty.la);
}
{
  const neutral = E.analyze(Object.assign({}, input, { neutral: true, home: input.away, away: input.away, h2h: [] }));
  check('terrain neutre, équipes identiques : symétrique', near(neutral.lh, neutral.la, 1e-6), neutral.lh + '/' + neutral.la);
}

/* Données ESPN --------------------------------------------------------------- */
check('cote américaine +125', near(D.american('+125'), 2.25));
check('cote américaine -200', near(D.american('-200'), 1.5));
check('cote américaine EVEN', D.american('EVEN') === 2);
check('cote américaine vide', isNaN(D.american('')) && isNaN(D.american(null)));

{
  const lg = D.leagueOf({ uid: 's:600~l:775~e:1', competitions: [{ altGameNote: 'UEFA Champions League, League Phase' }] });
  check('compétition connue', lg.id === '775' && lg.name === 'Ligue des champions' && lg.stage === 'League Phase' && lg.top, JSON.stringify(lg));
  const lg2 = D.leagueOf({ uid: 's:600~l:99999~e:2', competitions: [{ altGameNote: 'Copa Desconocida, Round 2' }] });
  check('compétition inconnue', lg2.name === 'Copa Desconocida' && lg2.stage === 'Round 2' && !lg2.top && lg2.rank === 300, JSON.stringify(lg2));
  const lg3 = D.leagueOf({ uid: 's:600~l:88888~e:3', season: { slug: '2026-27-coupe-de-test' }, competitions: [{}] });
  check('nom tiré de la saison', lg3.name === 'Coupe De Test', lg3.name);
}

const pickcenter = {
  provider: { name: 'DraftKings' }, overUnder: 2.5, overOdds: -125, underOdds: 105,
  homeTeamOdds: { moneyLine: 150 }, awayTeamOdds: { moneyLine: 175 }, drawOdds: { moneyLine: 230 },
  moneyline: { home: { close: { odds: '+140' }, open: { odds: '+150' } }, away: { close: { odds: '+180' } }, draw: { open: { odds: '+230' } } },
  total: { over: { close: { line: 'o2.5', odds: '-120' } }, under: { close: { line: 'u2.5', odds: '+100' } } }
};
{
  const o = D.parseOdds(pickcenter);
  check('cotes 1X2 (clôture prioritaire)', near(o['1'], 2.4) && near(o['2'], 2.8) && near(o.X, 3.3), JSON.stringify(o));
  check('cotes total 2,5', o.line === 2.5 && near(o['O2.5'], 1 + 100 / 120) && near(o['U2.5'], 2), JSON.stringify(o));
  const old = D.parseOdds({ provider: { displayName: 'Book' }, overUnder: 3.5, overOdds: 110, underOdds: -140, homeTeamOdds: { moneyLine: -150 }, awayTeamOdds: { moneyLine: 400 }, drawOdds: { moneyLine: 260 } });
  check('ancien format de cotes', near(old['1'], 1 + 100 / 150) && near(old['2'], 5) && near(old['O3.5'], 2.1) && old.provider === 'Book', JSON.stringify(old));
  check('pas de cotes', D.parseOdds({ provider: { name: 'X' } }) === null && D.parseOdds(null) === null);
}

/* Faux serveur ESPN ----------------------------------------------------------- */
const team = (id, name) => ({ id, displayName: name, shortDisplayName: name, abbreviation: name.slice(0, 3).toUpperCase() });
const HOME = team('101', 'Raja Casablanca');
const AWAY = team('202', 'Wydad AC');
const kickoff = new Date(Date.now() + 3 * 3600e3);
function event(id, date, h, a, state, extra) {
  return Object.assign({
    id: String(id), uid: 's:600~l:700~e:' + id, date: date.toISOString(),
    competitions: [{
      altGameNote: 'English Premier League', neutralSite: false,
      status: { type: { state, completed: state === 'post', shortDetail: state === 'post' ? 'FT' : 'Prévu' } },
      competitors: [
        { id: h.id, homeAway: 'home', form: 'WWDLW', score: state === 'pre' ? '0' : '2', team: h },
        { id: a.id, homeAway: 'away', form: 'LDLWL', score: state === 'pre' ? '0' : '1', team: a }
      ],
      odds: [pickcenter]
    }]
  }, extra || {});
}
function lastFive(t, opp) {
  return {
    team: { id: t.id, displayName: t.displayName },
    events: [0, 1, 2, 3, 4].map((i) => {
      const home = i % 2 === 0;
      return {
        id: 'l' + t.id + i, gameDate: new Date(Date.now() - (i + 1) * 7 * 864e5).toISOString(),
        homeTeamId: home ? t.id : opp, awayTeamId: home ? opp : t.id,
        homeTeamScore: String(home ? 2 : 0), awayTeamScore: String(home ? 1 : 1),
        leagueName: i === 2 ? 'Coupe' : 'English Premier League', opponent: { id: opp, displayName: 'Adversaire ' + i }
      };
    })
  };
}
const h2hEvents = [
  { id: 'h1', date: '2025-03-01T15:00Z', status: 'post', competitors: [{ homeAway: 'home', team: { id: '101' }, score: '3' }, { homeAway: 'away', team: { id: '202' }, score: '1' }] },
  { id: 'h2', date: '2024-10-01T15:00Z', status: 'post', competitors: [{ homeAway: 'home', team: { id: '202' }, score: '2' }, { homeAway: 'away', team: { id: '101' }, score: '0' }] },
  { id: 'h1', date: '2025-03-01T15:00Z', status: 'post', competitors: [{ homeAway: 'home', team: { id: '101' }, score: '3' }, { homeAway: 'away', team: { id: '202' }, score: '1' }] },
  { id: 'h3', date: '2026-12-01T15:00Z', status: 'pre', competitors: [{ homeAway: 'home', team: { id: '101' }, score: '0' }, { homeAway: 'away', team: { id: '202' }, score: '0' }] }
];
const summary = {
  header: { id: '9001', league: { id: '700', name: 'English Premier League' }, competitions: [Object.assign({ date: kickoff.toISOString() }, event(9001, kickoff, HOME, AWAY, 'pre').competitions[0])] },
  lastFiveGames: [lastFive(HOME, '303'), lastFive(AWAY, '404')],
  seasonseries: [{ type: 'head-to-head', shortSummary: 'Last 5 Matchups', events: h2hEvents }],
  standings: { groups: [{ standings: { entries: [
    { id: '101', team: 'Raja Casablanca', stats: [{ name: 'gamesPlayed', value: 8 }, { name: 'points', value: 18 }, { name: 'pointDifferential', value: 7 }, { name: 'rank', value: 1 }] },
    { id: '303', team: 'Adversaire', stats: [{ name: 'gamesPlayed', value: 8 }, { name: 'pointDifferential', value: -4 }] }
  ] } }] },
  pickcenter: [pickcenter],
  gameInfo: { venue: { fullName: 'Stade Mohammed V' } }
};
function schedule(teamId, season) {
  return {
    season: { year: 2026 },
    events: Array.from({ length: season ? 14 : 12 }, (_, i) => ({
      id: 's' + teamId + (season || '') + i,
      date: new Date(Date.now() - (season ? 300 : 7 + i * 6) * 864e5 - i * 864e5).toISOString(),
      league: { slug: i === 4 ? 'club.friendly' : 'eng.1', name: i === 6 ? 'FA Cup' : 'English Premier League' },
      competitions: [{
        neutralSite: false,
        status: { type: { completed: i !== 1 } },
        competitors: [
          { homeAway: i % 2 ? 'away' : 'home', team: { id: teamId, displayName: 'Moi' }, score: { value: 1 + (i % 3), displayValue: String(1 + (i % 3)) } },
          { homeAway: i % 2 ? 'home' : 'away', team: { id: '77', displayName: 'Adv ' + i }, score: { value: i % 2, displayValue: String(i % 2) } }
        ]
      }]
    }))
  };
}
routes['/all/summary'] = () => summary;
routes['/schedule'] = (url) => schedule(/teams\/(\d+)/.exec(url)[1], /season=(\d+)/.test(url) ? 2025 : null);
routes['/all/scoreboard'] = (url) => {
  const d = /dates=(\d{8})/.exec(url)[1];
  const at = (h) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), h));
  return { events: [event(d + '1', at(13), HOME, AWAY, 'pre'), event(d + '2', at(23), AWAY, HOME, 'post'), event(d + '3', at(18), team('5', 'Lens'), team('6', 'Lille'), 'pre', { uid: 's:600~l:710~e:3' })] };
};

(async () => {
  const m = D.parseSummary(summary, '9001');
  check('résumé : compétition', m.league.name === 'Premier League · Angleterre' && m.league.espnName === 'English Premier League');
  check('résumé : 5 derniers matchs', m.home.games.length === 5 && m.away.games.length === 5);
  check('résumé : matchs triés du plus récent', m.home.games[0].date > m.home.games[4].date);
  check('résumé : point de vue de l’équipe', m.home.games[0].isHome && m.home.games[0].gf === 2 && m.home.games[1].gf === 1 && m.home.games[1].ga === 0);
  check('résumé : autre compétition pondérée', m.home.games[2].w === 0.75 && m.home.games[0].w === 1);
  check('résumé : adversaire depuis le classement', m.home.games[0].opp && m.home.games[0].opp.att < 1);
  check('résumé : confrontations sans doublon ni match à venir', m.h2h.length === 2, m.h2h.length);
  check('résumé : confrontation vue de l’équipe qui reçoit', m.h2h[0].hg === 3 && m.h2h[0].homeAtHome && m.h2h[1].hg === 0 && m.h2h[1].ag === 2 && !m.h2h[1].homeAtHome);
  check('résumé : ancienneté des confrontations', m.h2h[0].ageYears > 0.5 && m.h2h[1].ageYears > m.h2h[0].ageYears);
  check('résumé : classement', m.home.standing && m.home.standing.pts === 18 && m.away.standing === null);
  check('résumé : cotes', m.odds && near(m.odds['1'], 2.4));
  check('résumé : stade', m.venue === 'Stade Mohammed V');

  const sch = D.parseSchedule(schedule('101', null), '101', { leagueName: 'English Premier League' });
  check('calendrier : amicaux et matchs non joués exclus', sch.length === 10, sch.length);
  check('calendrier : coupe pondérée', sch.find((g) => g.competition === 'FA Cup').w === 0.75);
  check('calendrier : score vu de l’équipe', sch.every((g) => g.gf >= 1));

  const full = await D.match('9001');
  check('historique : jusqu’à 20 matchs et plus', full.home.recent.length >= 20, full.home.recent.length);
  check('historique : aucun match futur', full.home.recent.every((g) => g.date < new Date(Date.now() + 864e5)));
  check('historique : trié', full.home.recent.every((g, i, a) => i === 0 || a[i - 1].date >= g.date));
  const keysSeen = new Set(full.home.recent.map((g) => g.date.toISOString().slice(0, 10) + g.gf + g.ga));
  check('historique : sans doublon', keysSeen.size === full.home.recent.length);

  const inp = D.engineInput(full, full.odds, { '1': 3.1 });
  check('entrée moteur', inp.home.matches === full.home.recent && inp.odds['1'] === 3.1 && inp.refOdds === full.odds && inp.names.home === 'Raja Casablanca');
  const ar = E.analyze(inp);
  check('analyse d’un vrai format de match', isFinite(ar.lh) && ar.picks.main && ar.market, ar.lh);
  check('value calculée sur la cote saisie', mkOf(ar, '1x2').sels[0].odd === 3.1);

  const day = await D.day(new Date());
  check('journée : matchs du jour local uniquement', day.length > 0 && day.every((e) => e.date.toDateString() === new Date().toDateString()), day.length);
  check('journée : sans doublon', new Set(day.map((e) => e.id)).size === day.length);
  check('journée : grands championnats d’abord', day.every((e, i, a) => i === 0 || a[i - 1].league.rank <= e.league.rank));
  check('journée : cotes lues', day[0].odds && near(day[0].odds['1'], 2.4));

  const r = await (async () => {
    summary.header.competitions[0].status.type = { state: 'post', completed: true, shortDetail: 'FT' };
    summary.header.competitions[0].competitors[0].score = '3';
    summary.header.competitions[0].competitors[1].score = '1';
    summary.header.competitions[0].competitors[0].linescores = [{ displayValue: '1' }, { displayValue: '2' }];
    summary.header.competitions[0].competitors[1].linescores = [{ displayValue: '1' }, { displayValue: '0' }];
    D.clearCache();
    return D.result('9001');
  })();
  check('résultat final', r.completed && r.hg === 3 && r.ag === 1 && r.hthg === 1 && r.htag === 1, JSON.stringify(r));
  check('règlement sur le résultat', E.settle('HF X1'.replace(' ', ''), r) === 'won' && E.settle('O2.5', r) === 'won');

  /* Détails d'un match terminé (statistiques, buts, penaltys) --------------- */
  const stat = (o) => Object.entries(o).map(([name, v]) => ({ name, displayValue: String(v) }));
  const detailJson = (opts) => ({
    header: { id: opts.id, competitions: [{ status: { type: { completed: true, state: 'post', shortDetail: opts.detail || 'FT' } }, competitors: [
      { homeAway: 'home', id: '101', score: String(opts.hs), team: { id: '101' }, linescores: opts.lh },
      { homeAway: 'away', id: '202', score: String(opts.as), team: { id: '202' }, linescores: opts.la }] }] },
    boxscore: { teams: [
      { homeAway: 'home', team: { id: '101' }, statistics: stat({ wonCorners: 7, yellowCards: 2, redCards: 0, shotsOnTarget: 6, totalShots: 15, foulsCommitted: 10, offsides: 1, saves: 2 }) },
      { homeAway: 'away', team: { id: '202' }, statistics: stat({ wonCorners: 3, yellowCards: 3, redCards: 1, shotsOnTarget: 3, totalShots: 8, foulsCommitted: 14, offsides: 3, saves: 4 }) }] },
    keyEvents: opts.events
  });
  const ev = (type, min, team, extra) => Object.assign({ type: { type }, clock: { displayValue: min }, period: { number: parseInt(min, 10) > 90 ? 3 : parseInt(min, 10) > 45 ? 2 : 1 }, team: team ? { id: team } : undefined, shootout: false }, extra || {});
  const events = [
    ev('kickoff', '', null),
    ev('goal', "12'", '101', { scoringPlay: true, participants: [{ athlete: { id: '9', displayName: 'Avant' } }] }),
    ev('yellow-card', "30'", '202'),
    ev('penalty---saved', "40'", '101'),
    ev('own-goal', "45'+2'", '101', { scoringPlay: true, participants: [{ athlete: { id: '55', displayName: 'Défenseur' } }] }),
    ev('penalty---scored', "70'", '202', { scoringPlay: true, participants: [{ athlete: { id: '7', displayName: 'Tireur' } }] }),
    ev('red-card', "80'", '202'),
    ev('goal', "105'", '202', { scoringPlay: true, participants: [{ athlete: { id: '7', displayName: 'Tireur' } }] }),
    ev('penalty---scored', "120'", '101', { scoringPlay: true, shootout: true })
  ];
  const det = D.parseDetail(detailJson({ id: 'd1', hs: 2, as: 2, events, lh: [{ displayValue: '2' }, { displayValue: '0' }, { displayValue: '0' }], la: [{ displayValue: '0' }, { displayValue: '1' }, { displayValue: '1' }], detail: 'AET' }));
  check('détail : statistiques', det.stats.corners[0] === 7 && det.stats.corners[1] === 3 && det.stats.red[1] === 1 && det.stats.saves[1] === 4, JSON.stringify(det.stats));
  check('détail : buts (tirs au but exclus)', det.goals && det.goals.length === 4 && det.goals[1].type === 'OG' && det.goals[1].min === 45 && det.goals[1].extra === 2 && det.goals[2].type === 'PG', JSON.stringify(det.goals));
  check('détail : penaltys accordés', det.pens.h === 1 && det.pens.a === 1 && det.pens.scored === 1, JSON.stringify(det.pens));
  check('détail : cartons de 1re mi-temps', det.statsH1.yellow[1] === 1);
  routes['/all/summary'] = (url) => (/event=d1/.test(url) ? detailJson({ id: 'd1', hs: 2, as: 2, events, lh: [{ displayValue: '2' }, { displayValue: '0' }, { displayValue: '0' }], la: [{ displayValue: '0' }, { displayValue: '1' }, { displayValue: '1' }], detail: 'AET' }) : summary);
  D.clearCache();
  const aet = await D.result('d1');
  check('prolongation : score à 90 minutes', aet.hg === 2 && aet.ag === 1 && aet.aet, JSON.stringify([aet.hg, aet.ag]));
  check('prolongation : buts du temps réglementaire', aet.goals && aet.goals.length === 3, aet.goals && aet.goals.length);
  check('prolongation : 1X2 réglé sur 90 minutes', E.settle('1', aet) === 'won' && E.settle('X', aet) === 'lost');
  check('prolongation : premier but et penalty', E.settle('FG1', aet) === 'won' && E.settle('PGY', aet) === 'won' && E.settle('OGY', aet) === 'won' && E.settle('GST1Y', aet) === 'won');
  check('prolongation : statistiques non réglées', E.settle('cornersO9.5', aet) === null);
  // Statistiques des derniers matchs d'une équipe.
  const team = { id: '101', recent: [{ id: 'd1', date: new Date(Date.now() - 864e5), w: 1 }, { id: 'zz', date: new Date(Date.now() - 2 * 864e5) }] };
  const st2 = await D.stats({ home: team, away: { id: '202', recent: [{ id: 'd1' }] } });
  check('statistiques d’équipe : point de vue', st2.teams.home.corners[0].for === 7 && st2.teams.home.corners[0].against === 3 && st2.teams.away.corners[0].for === 3, JSON.stringify(st2.teams.home.corners));
  check('statistiques d’équipe : match introuvable ignoré', st2.n.home === 1 && st2.n.away === 1);
  check('statistiques d’équipe : penaltys', st2.teams.home.pen[0].for === 1 && st2.teams.home.pen[0].against === 1);

  console.log(passed + ' tests réussis, ' + failed + ' échec(s).');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function mkOf(r, id) {
  return r.markets.find((m) => m.id === id);
}
