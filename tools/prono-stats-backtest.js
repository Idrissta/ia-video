#!/usr/bin/env node
/* Prono — réglage et test des paris statistiques (corners, cartons, tirs,
 * fautes, arrêts) sur des milliers de vrais matchs (football-data.co.uk).
 *
 * Pour chaque match, seules les données d'AVANT le coup d'envoi sont utilisées
 * (derniers matchs des deux équipes). Les réglages sont choisis sur les
 * saisons anciennes puis mesurés sur les saisons récentes, et comparés à la
 * simple moyenne du championnat.
 *
 * Usage : node tools/prono-stats-backtest.js   (accès internet requis)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, Math };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'prono', 'src', 'main', 'assets', 'web', 'js', 'stats.js'), 'utf8'), ctx);
const S = ctx.PRONO.Stats;

const LEAGUES = (process.env.PRONO_LEAGUES || 'E0,E1,E2,E3,SP1,SP2,I1,I2,D1,D2,F1,F2,N1,P1,B1,T1,SC0,G1').split(',');
const SEASONS = (process.env.PRONO_SEASONS || '2122,2223,2324,2425,2526').split(',');
const TEST_FROM = process.env.PRONO_TEST_FROM || '2425';
const COLS = {
  corners: ['HC', 'AC'],
  yellow: ['HY', 'AY'],
  red: ['HR', 'AR'],
  shotsOn: ['HST', 'AST'],
  shots: ['HS', 'AS'],
  fouls: ['HF', 'AF']
};
const MAIN_LINE = { corners: [8.5, 9.5, 10.5], yellow: [3.5, 4.5], shotsOn: [7.5, 8.5], shots: [22.5, 24.5], fouls: [21.5, 23.5], saves: [5.5, 6.5] };

async function download(league, season) {
  const cache = path.join(process.env.RUNNER_TEMP || '/tmp', 'prono-' + season + '-' + league + '.csv');
  if (fs.existsSync(cache)) return fs.readFileSync(cache, 'latin1');
  const url = 'https://www.football-data.co.uk/mmz4281/' + season + '/' + league + '.csv';
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  const text = Buffer.from(await r.arrayBuffer()).toString('latin1');
  fs.writeFileSync(cache, text, 'latin1');
  return text;
}

function parse(text, league, season) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const head = lines[0].replace(/^﻿/, '').split(',');
  const col = (k) => head.indexOf(k);
  const out = [];
  for (let n = 1; n < lines.length; n++) {
    const row = lines[n].split(',');
    const v = (k) => {
      const i = col(k);
      const x = i < 0 ? NaN : parseFloat(row[i]);
      return isFinite(x) ? x : NaN;
    };
    const [d, m, y] = (row[col('Date')] || '').split('/').map((x) => parseInt(x, 10));
    const hg = v('FTHG');
    const ag = v('FTAG');
    if (!d || !isFinite(hg)) continue;
    const st = {};
    for (const [id, [a, b]] of Object.entries(COLS)) st[id] = [v(a), v(b)];
    // Arrêts estimés : tirs cadrés adverses moins buts encaissés.
    st.saves = isFinite(st.shotsOn[0]) ? [Math.max(0, st.shotsOn[1] - ag), Math.max(0, st.shotsOn[0] - hg)] : [NaN, NaN];
    out.push({ league, season, t: Date.UTC(y < 100 ? 2000 + y : y, m - 1, d), home: row[col('HomeTeam')], away: row[col('AwayTeam')], hg, ag, st });
  }
  return out;
}

const nbLog = (x, m, k) => {
  const pmf = S.nb(m, k, Math.max(x + 1, 40));
  return Math.log(Math.max(1e-12, pmf[x]));
};

(async () => {
  const t0 = Date.now();
  let all = [];
  for (const lg of LEAGUES) for (const s of SEASONS) {
    try {
      all = all.concat(parse(await download(lg, s), lg, s));
    } catch (e) {
      console.log('manquant : ' + lg + ' ' + s + ' (' + e.message + ')');
    }
  }
  all.sort((a, b) => a.t - b.t);
  console.log('Matchs : ' + all.length);
  const IDS = Object.keys(COLS).concat(['saves']);
  const cover = {};
  for (const id of IDS) cover[id] = all.filter((m) => isFinite(m.st[id][0]) && isFinite(m.st[id][1])).length;
  console.log('Matchs avec chaque statistique : ' + JSON.stringify(cover));

  // Historique de chaque équipe, construit dans l'ordre chronologique.
  const teamHist = {};
  const samples = [];
  for (const m of all) {
    const key = (t) => m.league.replace(/\d+$/, '') + ':' + t;
    const hh = teamHist[key(m.home)] || (teamHist[key(m.home)] = []);
    const ha = teamHist[key(m.away)] || (teamHist[key(m.away)] = []);
    samples.push({ m, hh: hh.slice(0, 20), ha: ha.slice(0, 20), test: m.season >= TEST_FROM });
    hh.unshift({ isHome: true, st: m.st, side: 0 });
    ha.unshift({ isHome: false, st: m.st, side: 1 });
  }
  const histOf = (h, id) => h.map((g) => ({ isHome: g.isHome, for: g.st[id][g.side], against: g.st[id][1 - g.side] }));

  const results = {};
  for (const id of IDS) {
    const rows = samples.filter((s) => isFinite(s.m.st[id][0]) && isFinite(s.m.st[id][1]));
    const train = rows.filter((s) => !s.test && s.hh.length >= 3 && s.ha.length >= 3);
    const test = rows.filter((s) => s.test && s.hh.length >= 3 && s.ha.length >= 3);
    if (train.length < 500 || test.length < 300) {
      console.log(id + ' : pas assez de données');
      continue;
    }
    const mean = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
    const home = mean(train, (s) => s.m.st[id][0]);
    const away = mean(train, (s) => s.m.st[id][1]);
    // Moyennes par championnat (référence « moyenne du championnat »).
    const lgMean = {};
    for (const s of train) {
      const b = lgMean[s.m.league] || (lgMean[s.m.league] = [0, 0, 0]);
      b[0] += s.m.st[id][0];
      b[1] += s.m.st[id][1];
      b[2]++;
    }
    const base = Object.assign({}, S.SPECS[id] || S.SPECS.corners, { home, away });
    const evalSet = (set, spec, mode) => {
      let ll = 0;
      let n = 0;
      const pred = [];
      for (const s of set) {
        let lh;
        let la;
        if (mode === 'league') {
          const b = lgMean[s.m.league];
          lh = b ? b[0] / b[2] : home;
          la = b ? b[1] / b[2] : away;
        } else {
          const r = S.lambdas(histOf(s.hh, id), histOf(s.ha, id), spec, false);
          lh = r.lh;
          la = r.la;
        }
        const x = s.m.st[id];
        ll += nbLog(Math.round(x[0]), lh, spec.k) + nbLog(Math.round(x[1]), la, spec.k);
        n++;
        pred.push([lh, la, x[0], x[1]]);
      }
      return { ll: ll / n, pred };
    };
    // Recherche des réglages sur les saisons anciennes.
    let best = Object.assign({}, base);
    let bestLL = evalSet(train, best).ll;
    const grid = {
      prior: [1, 2, 4, 8, 16, 40],
      decay: [0.85, 0.9, 0.95, 1],
      window: [10], // l'application lit les 10 derniers matchs de chaque équipe
      refPrior: [2, 5, 10, 20, 60],
      k: [2, 4, 6, 8, 12, 20, 40, 100, 1e6]
    };
    if (id === 'red') grid.prior = [10, 20, 40, 80, 200];
    for (let pass = 0; pass < 2; pass++) {
      for (const [p, vals] of Object.entries(grid)) {
        for (const v of vals) {
          const cand = Object.assign({}, best, { [p]: v });
          const ll = evalSet(train, cand).ll;
          if (ll > bestLL + 1e-7) {
            bestLL = ll;
            best = cand;
          }
        }
      }
    }
    // Dispersion réglée sur les lignes « plus / moins » (ce que l'application affiche).
    const lines0 = MAIN_LINE[id] || [];
    if (lines0.length) {
      const pred = evalSet(train, best).pred;
      const ouLL = (k) => {
        let ll = 0;
        for (const [lh, la, xh, xa] of pred) {
          const tot = S.conv(S.nb(lh, k, 60), S.nb(la, k, 60));
          for (const L of lines0) {
            let u = 0;
            for (let q = 0; q < L; q++) u += tot[q];
            const po = Math.min(1 - 1e-9, Math.max(1e-9, 1 - u));
            ll += -Math.log(xh + xa > L ? po : 1 - po);
          }
        }
        return ll;
      };
      let bk = best.k;
      let bl = ouLL(best.k);
      for (const k of grid.k) {
        const l = ouLL(k);
        if (l < bl) {
          bl = l;
          bk = k;
        }
      }
      if (bk !== best.k) console.log(id + ' : dispersion ' + best.k + ' → ' + bk + ' (lignes plus/moins)');
      best = Object.assign({}, best, { k: bk });
    }
    const lgSpec = Object.assign({}, best);
    // Dispersion propre à la référence « moyenne du championnat ».
    let lgBest = -Infinity;
    for (const k of grid.k) {
      const ll = evalSet(train, Object.assign({}, lgSpec, { k }), 'league').ll;
      if (ll > lgBest) {
        lgBest = ll;
        lgSpec.k = k;
      }
    }
    const tm = evalSet(test, best);
    const tl = evalSet(test, lgSpec, 'league');
    const lines = MAIN_LINE[id] || [];
    const ouReport = (pred, spec) => lines.map((L) => {
      let ll = 0;
      let hit = 0;
      const cal = {};
      for (const [lh, la, xh, xa] of pred) {
        const tot = S.conv(S.nb(lh, spec.k, 60), S.nb(la, spec.k, 60));
        let u = 0;
        for (let k = 0; k < L; k++) u += tot[k];
        const po = Math.min(1 - 1e-9, Math.max(1e-9, 1 - u));
        const over = xh + xa > L;
        ll += -Math.log(over ? po : 1 - po);
        if ((po > 0.5) === over) hit++;
        const b = Math.round(po * 10) / 10;
        cal[b] = cal[b] || [0, 0];
        cal[b][0]++;
        if (over) cal[b][1]++;
      }
      const c = Object.entries(cal).filter(([, v]) => v[0] >= 50).map(([b, v]) => Math.round(b * 100) + '%→' + Math.round(100 * v[1] / v[0]) + '%').join(' ');
      return '±' + String(L).replace('.', ',') + ' : log-loss ' + (ll / pred.length).toFixed(4) + ', réussite ' + (100 * hit / pred.length).toFixed(1) + ' % [' + c + ']';
    }).join(' | ');
    const winReport = (pred, spec) => {
      let hit = 0;
      let n = 0;
      for (const [lh, la, xh, xa] of pred) {
        if (xh === xa) continue;
        n++;
        if ((lh > la) === (xh > xa)) hit++;
      }
      return (100 * hit / n).toFixed(1) + ' %';
    };
    let corr = 0;
    {
      const xs = tm.pred.map((p) => p[0] + p[1]);
      const ys = tm.pred.map((p) => p[2] + p[3]);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < xs.length; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
      }
      corr = sxy / Math.sqrt(sxx * syy);
    }
    console.log('\n=== ' + id + ' (calibration ' + train.length + ', test ' + test.length + ') ===');
    console.log('moyennes : domicile ' + home.toFixed(3) + ', extérieur ' + away.toFixed(3));
    console.log('modèle   : log-vraisemblance ' + tm.ll.toFixed(4) + ' | ' + ouReport(tm.pred, best) + ' | plus grand nombre : ' + winReport(tm.pred, best) + ' | corrélation total prévu/réel ' + corr.toFixed(3));
    console.log('moyenne du championnat : log-vraisemblance ' + tl.ll.toFixed(4) + ' | ' + ouReport(tl.pred, lgSpec));
    if (id === 'red') {
      let llm = 0;
      let llb = 0;
      const pb = test.filter((s) => s.m.st.red[0] + s.m.st.red[1] > 0).length / test.length;
      const pt = train.filter((s) => s.m.st.red[0] + s.m.st.red[1] > 0).length / train.length;
      for (const [lh, la, xh, xa] of tm.pred) {
        const p = 1 - Math.exp(-(lh + la));
        const y = xh + xa > 0;
        llm += -Math.log(y ? p : 1 - p);
        llb += -Math.log(y ? pt : 1 - pt);
      }
      console.log('carton rouge : fréquence test ' + (100 * pb).toFixed(2) + ' % ; log-loss modèle ' + (llm / tm.pred.length).toFixed(4) + ' vs fréquence fixe ' + (llb / tm.pred.length).toFixed(4));
    }
    results[id] = { home: +home.toFixed(3), away: +away.toFixed(3), prior: best.prior, decay: best.decay, window: best.window, k: best.k, refPrior: best.refPrior };
  }
  console.log('\nSTATS_PARAMS=' + JSON.stringify(results));
  console.log('Durée : ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
