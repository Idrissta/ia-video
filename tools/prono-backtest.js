#!/usr/bin/env node
/* Prono — test du modèle sur des milliers de vrais matchs (football-data.co.uk).
 *
 * Pour chaque match, on ne garde que l'information disponible AVANT le coup
 * d'envoi (5 derniers matchs de chaque équipe, 5 dernières confrontations),
 * on prédit, puis on compare au résultat réel. On calibre les paramètres sur
 * les saisons anciennes et on mesure la qualité sur les saisons récentes.
 *
 * Usage : node tools/prono-backtest.js   (accès internet requis)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, Math };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'prono', 'src', 'main', 'assets', 'web', 'js', 'engine.js'), 'utf8'), ctx);
const E = ctx.PRONO.Engine;

const LEAGUES = (process.env.PRONO_LEAGUES || 'E0,E1,SP1,I1,D1,F1,N1,P1,B1,T1,SC0,G1').split(',');
const SEASONS = (process.env.PRONO_SEASONS || '2122,2223,2324,2425,2526').split(',');
const TEST_FROM = process.env.PRONO_TEST_FROM || '2425';

/* ------------------------------------------------------------------ */
/* Téléchargement et lecture des CSV                                    */
/* ------------------------------------------------------------------ */

async function download(league, season) {
  const cache = path.join(process.env.RUNNER_TEMP || '/tmp', 'prono-' + season + '-' + league + '.csv');
  if (fs.existsSync(cache)) return fs.readFileSync(cache, 'latin1');
  const url = 'https://www.football-data.co.uk/mmz4281/' + season + '/' + league + '.csv';
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.toString('latin1');
  fs.writeFileSync(cache, text, 'latin1');
  return text;
}

function parseCsv(text, league, season) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const head = lines[0].replace(/^﻿/, '').split(',');
  const col = (name) => head.indexOf(name);
  const idx = {};
  for (const k of ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'HTHG', 'HTAG', 'PSCH', 'PSCD', 'PSCA', 'AvgCH', 'AvgCD', 'AvgCA', 'AvgH', 'AvgD', 'AvgA', 'PC>2.5', 'PC<2.5', 'AvgC>2.5', 'AvgC<2.5', 'Avg>2.5', 'Avg<2.5']) idx[k] = col(k);
  const num = (row, k) => {
    const i = idx[k];
    if (i < 0) return NaN;
    const v = parseFloat(row[i]);
    return isFinite(v) ? v : NaN;
  };
  const out = [];
  for (let n = 1; n < lines.length; n++) {
    const row = lines[n].split(',');
    const hg = num(row, 'FTHG');
    const ag = num(row, 'FTAG');
    if (!isFinite(hg) || !isFinite(ag)) continue;
    const ds = row[idx.Date] || '';
    const [d, m, y] = ds.split('/').map((x) => parseInt(x, 10));
    if (!d || !m || !y) continue;
    const date = new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d));
    const pick = (a, b, c) => [a, b, c].map((k) => num(row, k));
    let o1x2 = pick('PSCH', 'PSCD', 'PSCA');
    if (o1x2.some((x) => !(x > 1))) o1x2 = pick('AvgCH', 'AvgCD', 'AvgCA');
    if (o1x2.some((x) => !(x > 1))) o1x2 = pick('AvgH', 'AvgD', 'AvgA');
    let ou = [num(row, 'PC>2.5'), num(row, 'PC<2.5')];
    if (ou.some((x) => !(x > 1))) ou = [num(row, 'AvgC>2.5'), num(row, 'AvgC<2.5')];
    if (ou.some((x) => !(x > 1))) ou = [num(row, 'Avg>2.5'), num(row, 'Avg<2.5')];
    out.push({
      league, season, date, t: date.getTime(),
      home: row[idx.HomeTeam], away: row[idx.AwayTeam], hg, ag,
      hthg: num(row, 'HTHG'), htag: num(row, 'HTAG'),
      odds: o1x2.every((x) => x > 1) ? o1x2 : null,
      ou: ou.every((x) => x > 1) ? ou : null
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Construction des entrées « avant-match »                             */
/* ------------------------------------------------------------------ */

function buildSamples(matches) {
  const samples = [];
  const byLeague = {};
  for (const m of matches) (byLeague[m.league] = byLeague[m.league] || []).push(m);
  for (const lg of Object.keys(byLeague)) {
    const list = byLeague[lg].sort((a, b) => a.t - b.t);
    const hist = new Map();       // équipe → matchs passés (plus récent en dernier)
    const pairs = new Map();      // paire → confrontations
    const recent = [];            // derniers matchs de la ligue (moyennes)
    const team = (n) => {
      if (!hist.has(n)) hist.set(n, []);
      return hist.get(n);
    };
    const strength = (n, mu) => {
      const h = team(n).slice(-10);
      if (!h.length) return null;
      let gf = 0;
      let ga = 0;
      for (const x of h) {
        gf += x.gf;
        ga += x.ga;
      }
      const k = h.length / (h.length + 6);
      const g = (gf - ga) / h.length;
      return { att: 1 + k * g / (2 * mu), def: 1 - k * g / (2 * mu) };
    };
    for (const m of list) {
      const r = recent.slice(-380);
      let homeAvg = 1.5;
      let awayAvg = 1.2;
      if (r.length >= 100) {
        homeAvg = r.reduce((s, x) => s + x.hg, 0) / r.length;
        awayAvg = r.reduce((s, x) => s + x.ag, 0) / r.length;
      }
      const mu = (homeAvg + awayAvg) / 2;
      const hh = team(m.home);
      const ha = team(m.away);
      if (hh.length >= 3 && ha.length >= 3) {
        const conv = (arr) => arr.slice(-20).reverse().map((x) => ({ isHome: x.isHome, gf: x.gf, ga: x.ga, opp: strength(x.opp, mu) }));
        const seasonOf = (arr) => {
          const cur = arr.filter((x) => x.season === m.season);
          if (!cur.length) return null;
          let gf = 0;
          let ga = 0;
          for (const x of cur) {
            gf += x.gf;
            ga += x.ga;
          }
          return { gp: cur.length, gf, ga, gd: gf - ga };
        };
        const key = [m.home, m.away].sort().join('|');
        const h2h = (pairs.get(key) || []).slice(-5).reverse().map((x) => ({
          ageYears: (m.t - x.t) / (365.25 * 864e5),
          hg: x.home === m.home ? x.hg : x.ag,
          ag: x.home === m.home ? x.ag : x.hg,
          homeAtHome: x.home === m.home
        }));
        samples.push({
          m, homeAvg, awayAvg,
          input: { home: { matches: conv(hh), season: seasonOf(hh) }, away: { matches: conv(ha), season: seasonOf(ha) }, h2h }
        });
      }
      hh.push({ t: m.t, season: m.season, isHome: true, gf: m.hg, ga: m.ag, opp: m.away });
      ha.push({ t: m.t, season: m.season, isHome: false, gf: m.ag, ga: m.hg, opp: m.home });
      const key = [m.home, m.away].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(m);
      recent.push(m);
    }
  }
  return samples;
}

/* ------------------------------------------------------------------ */
/* Évaluation                                                           */
/* ------------------------------------------------------------------ */

const ll = (p) => -Math.log(Math.max(1e-6, Math.min(1 - 1e-6, p)));

function probsFor(s, params, mode) {
  const p = Object.assign({}, params, { homeAvg: s.homeAvg, awayAvg: s.awayAvg });
  let lh;
  let la;
  if (mode === 'league') {
    lh = s.homeAvg;
    la = s.awayAvg;
  } else {
    const r = E.lambdas(s.input, p);
    lh = r.lh;
    la = r.la;
  }
  if ((mode === 'market' || mode === 'blend') && s.m.odds) {
    if (!s.mk) {
      const f = E.fairProbs(s.m.odds);
      const ou = s.m.ou ? E.fairProbs(s.m.ou)[0] : null;
      s.mk = E.marketLambdas(f[0], f[1], f[2], ou, -0.07);
      s.mkp = { h: f[0], d: f[1], a: f[2], o25: ou };
    }
    const w = mode === 'market' ? 1 : p.marketWeight;
    lh = Math.exp((1 - w) * Math.log(lh) + w * Math.log(s.mk.lh));
    la = Math.exp((1 - w) * Math.log(la) + w * Math.log(s.mk.la));
  }
  const b = E.basic(E.matrix(lh, la, p.rho, 8));
  const r = p.htShare;
  const ht = E.basic(E.matrix(lh * r, la * r, 0, 6));
  return { b, ht, lh, la };
}

function evaluate(samples, params, mode) {
  const acc = { n: 0, l1x2: 0, lo25: 0, lo15: 0, lbtts: 0, lht05: 0, nht: 0, c1x2: 0, co25: 0, co15: 0, cbtts: 0, brier: 0 };
  for (const s of samples) {
    if ((mode === 'market' || mode === 'blend') && !s.m.odds) continue;
    const { b, ht } = probsFor(s, params, mode);
    const m = s.m;
    const res = m.hg > m.ag ? 'h' : m.hg === m.ag ? 'd' : 'a';
    const tot = m.hg + m.ag;
    acc.n++;
    acc.l1x2 += ll(b[res]);
    acc.brier += (b.h - (res === 'h')) ** 2 + (b.d - (res === 'd')) ** 2 + (b.a - (res === 'a')) ** 2;
    const best = b.h >= b.d && b.h >= b.a ? 'h' : b.a >= b.d ? 'a' : 'd';
    if (best === res) acc.c1x2++;
    acc.lo25 += ll(tot > 2.5 ? b.o25 : 1 - b.o25);
    acc.lo15 += ll(tot > 1.5 ? b.o15 : 1 - b.o15);
    const btts = m.hg > 0 && m.ag > 0;
    acc.lbtts += ll(btts ? b.btts : 1 - b.btts);
    if ((b.o25 >= 0.5) === (tot > 2.5)) acc.co25++;
    if ((b.o15 >= 0.5) === (tot > 1.5)) acc.co15++;
    if ((b.btts >= 0.5) === btts) acc.cbtts++;
    if (isFinite(m.hthg) && isFinite(m.htag)) {
      acc.nht++;
      acc.lht05 += ll(m.hthg + m.htag > 0 ? ht.o05 : 1 - ht.o05);
    }
  }
  const n = Math.max(1, acc.n);
  return {
    n: acc.n,
    l1x2: acc.l1x2 / n, lo25: acc.lo25 / n, lo15: acc.lo15 / n, lbtts: acc.lbtts / n,
    lht05: acc.lht05 / Math.max(1, acc.nht), brier: acc.brier / n,
    a1x2: acc.c1x2 / n, ao25: acc.co25 / n, ao15: acc.co15 / n, abtts: acc.cbtts / n,
    score: (acc.l1x2 + acc.lo25 + acc.lo15 + acc.lbtts) / n
  };
}

/** Taux de réussite des pronostics recommandés par l'application. */
function pickReport(samples, params, withOdds) {
  const buckets = {};
  let mainN = 0;
  let mainWin = 0;
  const byMarket = {};
  for (const s of samples) {
    if (withOdds && !s.m.odds) continue;
    const odds = withOdds ? { 1: s.m.odds[0], X: s.m.odds[1], 2: s.m.odds[2] } : {};
    if (withOdds && s.m.ou) {
      odds['O2.5'] = s.m.ou[0];
      odds['U2.5'] = s.m.ou[1];
    }
    const p = Object.assign({}, params, { homeAvg: s.homeAvg, awayAvg: s.awayAvg });
    const res = E.analyze(Object.assign({}, s.input, { refOdds: odds, names: { home: 'A', away: 'B' } }), p);
    const main = res.picks.main;
    if (!main) continue;
    const won = settle(main.key, s.m);
    if (won === null) continue;
    mainN++;
    if (won) mainWin++;
    const k = main.marketId;
    byMarket[k] = byMarket[k] || [0, 0];
    byMarket[k][0]++;
    if (won) byMarket[k][1]++;
    const bucket = Math.min(9, Math.floor(main.p * 10));
    buckets[bucket] = buckets[bucket] || [0, 0, 0];
    buckets[bucket][0]++;
    buckets[bucket][1] += won ? 1 : 0;
    buckets[bucket][2] += main.p;
  }
  return { mainN, mainWin, byMarket, buckets };
}

/** Résultat d'une sélection (true/false, null si non géré ou remboursé). */
function settle(key, m) {
  const h = m.hg;
  const a = m.ag;
  const t = h + a;
  const ht = m.hthg + m.htag;
  let mm;
  if (key === '1') return h > a;
  if (key === 'X') return h === a;
  if (key === '2') return h < a;
  if (key === '1X') return h >= a;
  if (key === 'X2') return h <= a;
  if (key === '12') return h !== a;
  if (key === 'BTTS_Y') return h > 0 && a > 0;
  if (key === 'BTTS_N') return !(h > 0 && a > 0);
  if ((mm = key.match(/^([OU])(\d+\.5)$/))) return mm[1] === 'O' ? t > +mm[2] : t < +mm[2];
  if ((mm = key.match(/^it([12])([OU])(\d+\.5)$/))) {
    const g = mm[1] === '1' ? h : a;
    return mm[2] === 'O' ? g > +mm[3] : g < +mm[3];
  }
  if ((mm = key.match(/^H([OU])(\d+\.5)$/))) return isFinite(ht) ? (mm[1] === 'O' ? ht > +mm[2] : ht < +mm[2]) : null;
  if (key === 'S1Y') return h > 0;
  if (key === 'S2Y') return a > 0;
  if (key === 'S1N') return h === 0;
  if (key === 'S2N') return a === 0;
  if (key === 'DNB1') return h === a ? null : h > a;
  if (key === 'DNB2') return h === a ? null : a > h;
  if ((mm = key.match(/^AH([12])([+-][\d.]+)$/))) {
    const L = parseFloat(mm[2]);
    const margin = (mm[1] === '1' ? h - a : a - h) + L;
    if (Math.abs(margin) < 0.3) return null;
    return margin > 0;
  }
  return null;
}

/* ------------------------------------------------------------------ */

(async () => {
  const t0 = Date.now();
  const all = [];
  for (const season of SEASONS) {
    for (const lg of LEAGUES) {
      try {
        all.push(...parseCsv(await download(lg, season), lg, season));
      } catch (e) {
        console.log('  (ignoré) ' + lg + ' ' + season + ' : ' + e.message);
      }
    }
  }
  console.log('Matchs chargés : ' + all.length + ' (' + LEAGUES.length + ' championnats, saisons ' + SEASONS.join(', ') + ')');
  let ftGoals = 0;
  let htGoals = 0;
  let nh = 0;
  let sumH = 0;
  let sumA = 0;
  for (const m of all) {
    sumH += m.hg;
    sumA += m.ag;
    if (isFinite(m.hthg) && isFinite(m.htag)) {
      ftGoals += m.hg + m.ag;
      htGoals += m.hthg + m.htag;
      nh++;
    }
  }
  const htShare = htGoals / ftGoals;
  console.log('Buts/match domicile ' + (sumH / all.length).toFixed(3) + ', extérieur ' + (sumA / all.length).toFixed(3) + ', part 1re mi-temps ' + htShare.toFixed(3) + ' (' + nh + ' matchs)');

  const samples = buildSamples(all);
  const train = samples.filter((s) => s.m.season < TEST_FROM);
  const test = samples.filter((s) => s.m.season >= TEST_FROM);
  console.log('Échantillons : ' + samples.length + ' (calibration ' + train.length + ', test ' + test.length + ')');

  const calibrate = (base, grid, label) => {
    let params = Object.assign({}, base);
    let best = evaluate(train, params, 'model').score;
    for (let pass = 0; pass < 2; pass++) {
      for (const k of Object.keys(grid)) {
        for (const v of grid[k]) {
          const trial = Object.assign({}, params, { [k]: v });
          const sc = evaluate(train, trial, 'model').score;
          if (sc < best - 1e-6) {
            best = sc;
            params = trial;
          }
        }
      }
    }
    const t = evaluate(test, params, 'model');
    console.log('[' + label + '] calibration ' + best.toFixed(4) + ' → test ' + t.score.toFixed(4) + ' | 1X2 ' + t.l1x2.toFixed(4) + ' (' + (100 * t.a1x2).toFixed(1) + ' %) ±2,5 ' + t.lo25.toFixed(4) + ' (' + (100 * t.ao25).toFixed(1) + ' %) BTTS ' + t.lbtts.toFixed(4) + ' ' + JSON.stringify(params));
    return params;
  };
  const BASE_GRID = {
    decay: [0.7, 0.8, 0.9, 0.95, 1],
    prior: [2, 4, 8, 12, 16, 24],
    oppAdjust: [0, 0.3, 0.6, 1],
    h2hWeight: [0, 0.15, 0.25, 0.4, 0.6],
    rho: [-0.1, -0.05, 0]
  };
  const base0 = Object.assign({}, E.DEFAULTS, { htShare, h2hHalfLife: 5 });
  console.log('\n=== Variantes (calibrées sur les saisons anciennes, mesurées sur les saisons de test) ===');
  calibrate(Object.assign({}, base0, { window: 5, seasonWeight: 0 }), BASE_GRID, '5 derniers matchs');
  calibrate(Object.assign({}, base0, { window: 10, seasonWeight: 0 }), BASE_GRID, '10 derniers matchs');
  calibrate(Object.assign({}, base0, { window: 20, seasonWeight: 0 }), BASE_GRID, '20 derniers matchs');
  const gdOnly = (samples) => samples.forEach((s) => {
    for (const side of ['home', 'away']) {
      const se = s.input[side].season;
      if (se && !se.gdOnly) s.input[side].season = { gp: se.gp, gd: se.gd, gdOnly: true, full: se };
    }
  });
  const fullSeason = (samples) => samples.forEach((s) => {
    for (const side of ['home', 'away']) {
      const se = s.input[side].season;
      if (se && se.gdOnly) s.input[side].season = se.full;
    }
  });
  gdOnly(samples);
  calibrate(Object.assign({}, base0, { window: 5, seasonWeight: 1 }), Object.assign({ seasonWeight: [0.5, 0.8, 1], seasonPrior: [2, 4, 6, 10] }, BASE_GRID), '5 derniers + classement (diff. de buts)');
  fullSeason(samples);
  calibrate(Object.assign({}, base0, { window: 5, seasonWeight: 1 }), Object.assign({ seasonWeight: [0.5, 0.8, 1], seasonPrior: [2, 4, 6, 10] }, BASE_GRID), '5 derniers + classement (buts pour/contre)');

  let params = Object.assign({}, E.DEFAULTS, { htShare });
  const GRID = {
    decay: [0.6, 0.7, 0.8, 0.85, 0.9, 1],
    prior: [1, 2, 3, 4, 6, 8, 12, 16],
    oppAdjust: [0, 0.3, 0.6, 0.8, 1],
    h2hWeight: [0, 0.1, 0.25, 0.4, 0.6, 0.8],
    h2hHalfLife: [1, 2.5, 5],
    rho: [-0.15, -0.1, -0.07, -0.04, 0],
    window: [5, 8, 10, 15, 20],
    seasonWeight: [0, 0.5, 0.8, 1],
    seasonPrior: [2, 4, 6, 10]
  };
  let best = evaluate(train, params, 'model').score;
  for (let pass = 0; pass < 2; pass++) {
    for (const k of Object.keys(GRID)) {
      for (const v of GRID[k]) {
        const trial = Object.assign({}, params, { [k]: v });
        const sc = evaluate(train, trial, 'model').score;
        if (sc < best - 1e-6) {
          best = sc;
          params = trial;
        }
      }
    }
    console.log('Passe ' + (pass + 1) + ' : score ' + best.toFixed(4) + ' ' + JSON.stringify(params));
  }
  // Poids des cotes dans la combinaison modèle + marché.
  let bestW = params.marketWeight;
  let bestB = Infinity;
  for (const w of [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
    const sc = evaluate(train, Object.assign({}, params, { marketWeight: w }), 'blend').score;
    if (sc < bestB) {
      bestB = sc;
      bestW = w;
    }
  }
  params.marketWeight = bestW;

  const fmt = (r) => 'log-loss 1X2 ' + r.l1x2.toFixed(4) + ' | +2,5 ' + r.lo25.toFixed(4) + ' | +1,5 ' + r.lo15.toFixed(4) + ' | BTTS ' + r.lbtts.toFixed(4) +
    ' | MT+0,5 ' + r.lht05.toFixed(4) + ' || réussite 1X2 ' + (100 * r.a1x2).toFixed(1) + ' % | ±2,5 ' + (100 * r.ao25).toFixed(1) + ' % | ±1,5 ' + (100 * r.ao15).toFixed(1) +
    ' % | BTTS ' + (100 * r.abtts).toFixed(1) + ' % (n=' + r.n + ')';
  console.log('\n=== Résultats sur les saisons de TEST (jamais vues pendant la calibration) ===');
  console.log('Moyenne de ligue  : ' + fmt(evaluate(test, params, 'league')));
  console.log('Défauts actuels   : ' + fmt(evaluate(test, Object.assign({}, E.DEFAULTS, { htShare }), 'model')));
  console.log('Modèle calibré    : ' + fmt(evaluate(test, params, 'model')));
  console.log('Cotes seules      : ' + fmt(evaluate(test, params, 'market')));
  console.log('Modèle + cotes    : ' + fmt(evaluate(test, params, 'blend')) + ' (poids cotes ' + bestW + ')');
  console.log('Sans confrontations directes : ' + fmt(evaluate(test, Object.assign({}, params, { h2hWeight: 0 }), 'model')));

  for (const withOdds of [false, true]) {
    const rep = pickReport(test, params, withOdds);
    console.log('\nPronostic principal ' + (withOdds ? 'AVEC cotes' : 'sans cotes') + ' : ' + rep.mainWin + '/' + rep.mainN + ' gagnés = ' + (100 * rep.mainWin / Math.max(1, rep.mainN)).toFixed(1) + ' %');
    console.log('  par marché : ' + Object.entries(rep.byMarket).map(([k, v]) => k + ' ' + v[1] + '/' + v[0] + ' (' + (100 * v[1] / v[0]).toFixed(0) + ' %)').join(', '));
    console.log('  calibration (prob. annoncée → réussite) : ' + Object.keys(rep.buckets).sort().map((b) => {
      const [n, w, ps] = rep.buckets[b];
      return (100 * ps / n).toFixed(0) + '%→' + (100 * w / n).toFixed(0) + '% (n=' + n + ')';
    }).join(' ; '));
  }
  const out = {};
  for (const k of ['decay', 'prior', 'oppAdjust', 'h2hWeight', 'h2hHalfLife', 'rho', 'htShare', 'marketWeight', 'window', 'seasonWeight', 'seasonPrior']) out[k] = Math.round(params[k] * 1000) / 1000;
  out.homeAvg = Math.round(sumH / all.length * 1000) / 1000;
  out.awayAvg = Math.round(sumA / all.length * 1000) / 1000;
  console.log('\nPARAMS=' + JSON.stringify(out));
  console.log('Durée : ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
})();
