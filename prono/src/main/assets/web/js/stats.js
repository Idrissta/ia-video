/* Prono — paris sur les statistiques de match : corners, cartons, tirs,
 * fautes, hors-jeu, arrêts du gardien, penalty.
 *
 * Pour chaque statistique, chaque équipe a une « production » (ce qu'elle
 * obtient : corners gagnés, cartons reçus…) et une « concession » (ce que ses
 * adversaires obtiennent contre elle), mesurées sur ses derniers matchs par
 * rapport à la moyenne de ces matchs, avec retour vers la moyenne quand il y a
 * peu de données. Valeur attendue = moyenne × production × concession adverse.
 * Les comptes suivent une loi binomiale négative (plus dispersée que Poisson,
 * comme les vrais cartons et corners).
 *
 * Réglages mesurés par tools/prono-stats-backtest.js (football-data.co.uk)
 * et tools/prono-stats.js (ESPN).
 */
(function (root) {
  'use strict';
  const P = root.PRONO || (root.PRONO = {});
  const S = P.Stats = {};

  /*
   * home / away : moyenne par équipe et par match (domicile / extérieur) ;
   * prior : poids (en matchs) du retour vers la moyenne ; decay : poids des
   * matchs plus anciens ; window : nombre de matchs utilisés ; k : dispersion
   * (variance = m + m²/k) ; refPrior : poids de la moyenne globale face à la
   * moyenne des matchs récents des deux équipes ; h1 : part en 1re mi-temps.
   */
  S.SPECS = {
    corners: { name: 'Corners', home: 5.4, away: 4.6, prior: 8, decay: 0.95, window: 10, k: 12, refPrior: 60, h1: 0.47, lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5], teamLines: [2.5, 3.5, 4.5, 5.5, 6.5] },
    yellow: { name: 'Cartons jaunes', home: 1.8, away: 2.05, prior: 16, decay: 0.95, window: 10, k: 1e6, refPrior: 60, h1: 0.38, lines: [2.5, 3.5, 4.5, 5.5, 6.5], teamLines: [0.5, 1.5, 2.5, 3.5] },
    red: { name: 'Cartons rouges', home: 0.095, away: 0.11, prior: 200, decay: 0.95, window: 10, k: 8, refPrior: 60, h1: 0.3, lines: [], teamLines: [] },
    shotsOn: { name: 'Tirs cadrés', home: 4.9, away: 4.1, prior: 8, decay: 0.95, window: 10, k: 20, refPrior: 60, h1: 0.46, lines: [6.5, 7.5, 8.5, 9.5, 10.5], teamLines: [2.5, 3.5, 4.5, 5.5] },
    shots: { name: 'Tirs', home: 13.9, away: 11.8, prior: 4, decay: 0.95, window: 10, k: 20, refPrior: 60, h1: 0.46, lines: [20.5, 22.5, 24.5, 26.5, 28.5], teamLines: [9.5, 11.5, 13.5, 15.5] },
    fouls: { name: 'Fautes', home: 11.6, away: 11.9, prior: 8, decay: 0.9, window: 10, k: 1e6, refPrior: 60, h1: 0.48, lines: [19.5, 21.5, 23.5, 25.5, 27.5], teamLines: [9.5, 10.5, 11.5, 12.5, 13.5] },
    offsides: { name: 'Hors-jeu', home: 1.85, away: 1.95, prior: 8, decay: 0.95, window: 10, k: 8, refPrior: 60, h1: 0.5, lines: [2.5, 3.5, 4.5, 5.5], teamLines: [0.5, 1.5, 2.5] },
    saves: { name: 'Arrêts du gardien', home: 2.9, away: 3.4, prior: 16, decay: 0.95, window: 10, k: 12, refPrior: 60, h1: 0.47, lines: [4.5, 5.5, 6.5, 7.5], teamLines: [1.5, 2.5, 3.5, 4.5] }
  };
  /** Penalty : un penalty est accordé dans 25 % des matchs (ESPN), 79 % sont marqués. */
  S.PENALTY = { base: 0.25, prior: 25, scored: 0.79 };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const fx = (v) => String(v).replace('.', ',');

  /** Loi binomiale négative de moyenne m et de dispersion k (tableau 0..n). */
  S.nb = function (m, k, n) {
    const out = new Array(n + 1).fill(0);
    if (!(m > 0)) {
      out[0] = 1;
      return out;
    }
    if (!(k > 0) || k > 1e5) {
      let p = Math.exp(-m);
      for (let i = 0; i <= n; i++) {
        out[i] = p;
        p *= m / (i + 1);
      }
    } else {
      const q = k / (k + m);
      let p = Math.pow(q, k);
      for (let i = 0; i <= n; i++) {
        out[i] = p;
        p *= ((i + k) / (i + 1)) * (1 - q);
      }
    }
    const s = out.reduce((a, b) => a + b, 0);
    return out.map((x) => x / s);
  };

  /** Somme de deux variables indépendantes (convolution). */
  S.conv = function (a, b) {
    const out = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    return out;
  };

  /**
   * Valeurs attendues pour un match.
   * hist : derniers matchs de l'équipe, du plus récent au plus ancien,
   *        { isHome, for, against, w? } (valeurs manquantes ignorées).
   */
  S.lambdas = function (histH, histA, spec, neutral) {
    const ok = (g) => g && isFinite(g.for) && isFinite(g.against);
    const hH = (histH || []).filter(ok).slice(0, spec.window);
    const hA = (histA || []).filter(ok).slice(0, spec.window);
    // Moyennes de référence (domicile / extérieur) : matchs récents des deux équipes,
    // ramenées vers la moyenne générale.
    let sh = spec.refPrior * spec.home;
    let sa = spec.refPrior * spec.away;
    let nh = spec.refPrior;
    let na = spec.refPrior;
    for (const g of hH.concat(hA)) {
      sh += g.isHome ? g.for : g.against;
      sa += g.isHome ? g.against : g.for;
      nh++;
      na++;
    }
    const refH = sh / nh;
    const refA = sa / na;
    const rate = (hist) => {
      let fNum = 0;
      let aNum = 0;
      let den = 0;
      hist.forEach((g, i) => {
        const w = Math.pow(spec.decay, i) * (g.w || 1);
        fNum += w * g.for / (g.isHome ? refH : refA);
        aNum += w * g.against / (g.isHome ? refA : refH);
        den += w;
      });
      return {
        att: (fNum + spec.prior) / (den + spec.prior),
        def: (aNum + spec.prior) / (den + spec.prior),
        n: hist.length
      };
    };
    const rH = rate(hH);
    const rA = rate(hA);
    const vh = neutral ? (refH + refA) / 2 : refH;
    const va = neutral ? (refH + refA) / 2 : refA;
    return {
      lh: clamp(vh * rH.att * rA.def, 0.01, 60),
      la: clamp(va * rA.att * rH.def, 0.01, 60),
      n: Math.min(rH.n, rA.n),
      home: rH,
      away: rA,
      ref: [refH, refA]
    };
  };

  const sel = (key, label, p, extra) => Object.assign({ key, label, p: clamp(p, 0, 1), fair: p > 0.0001 ? 1 / p : null }, extra || {});
  const tail = (pmf, L) => {
    let u = 0;
    for (let k = 0; k < pmf.length && k < L; k++) u += pmf[k];
    return 1 - u;
  };

  /** Marchés d'une statistique : totaux, par équipe, qui en a le plus, handicaps, 1re mi-temps. */
  S.markets = function (id, lam, spec, names) {
    const H = names.home;
    const A = names.away;
    const N = Math.max(30, Math.ceil((lam.lh + lam.la) * 4 + 20));
    const ph = S.nb(lam.lh, spec.k, N);
    const pa = S.nb(lam.la, spec.k, N);
    const tot = S.conv(ph, pa);
    const M = [];
    const add = (mid, name, sels, info) => M.push({ id: id + ':' + mid, group: spec.name, name, sels, info, stat: id, data: lam.n });
    const exp = (lam.lh + lam.la).toFixed(1).replace('.', ',');
    const lines = linesAround(lam.lh + lam.la, spec.lines);
    add('total', spec.name + ' · Total', lines.flatMap((L) => [
      sel(id + 'O' + L, 'Plus de ' + fx(L), tail(tot, L)),
      sel(id + 'U' + L, 'Moins de ' + fx(L), 1 - tail(tot, L))
    ]), 'Attendu : ' + exp + ' (' + H + ' ' + lam.lh.toFixed(1).replace('.', ',') + ', ' + A + ' ' + lam.la.toFixed(1).replace('.', ',') + ')');
    for (const [side, team, pm, mu] of [['1', H, ph, lam.lh], ['2', A, pa, lam.la]]) {
      const tl = linesAround(mu, spec.teamLines);
      if (tl.length) add('team' + side, spec.name + ' · ' + team, tl.flatMap((L) => [
        sel(id + side + 'O' + L, 'Plus de ' + fx(L), tail(pm, L)),
        sel(id + side + 'U' + L, 'Moins de ' + fx(L), 1 - tail(pm, L))
      ]));
    }
    let w1 = 0;
    let eq = 0;
    const diff = {};
    for (let i = 0; i < ph.length; i++) {
      for (let j = 0; j < pa.length; j++) {
        const pr = ph[i] * pa[j];
        if (i > j) w1 += pr;
        else if (i === j) eq += pr;
        diff[i - j] = (diff[i - j] || 0) + pr;
      }
    }
    add('1x2', spec.name + ' · Qui en aura le plus', [sel(id + 'W1', H, w1), sel(id + 'WX', 'Égalité', eq), sel(id + 'W2', A, 1 - w1 - eq)]);
    if (id === 'corners' || id === 'shots' || id === 'shotsOn' || id === 'fouls') {
      const hs = [];
      for (const L of [-2.5, -1.5, 1.5, 2.5]) {
        let p1 = 0;
        for (const d in diff) if (+d + L > 0) p1 += diff[d];
        hs.push(sel(id + 'H1' + (L > 0 ? '+' : '') + L, H + ' (' + (L > 0 ? '+' : '') + fx(L) + ')', p1));
        hs.push(sel(id + 'H2' + (-L > 0 ? '+' : '') + -L, A + ' (' + (-L > 0 ? '+' : '') + fx(-L) + ')', 1 - p1));
      }
      add('hcp', spec.name + ' · Handicap', hs);
    }
    if (spec.h1 && spec.lines.length) {
      const f = spec.h1;
      const t1 = S.conv(S.nb(lam.lh * f, spec.k, N), S.nb(lam.la * f, spec.k, N));
      const hl = linesAround((lam.lh + lam.la) * f, spec.lines.map((x) => Math.max(0.5, Math.round(x * f) - 0.5)));
      add('h1', spec.name + ' · 1re mi-temps', hl.flatMap((L) => [
        sel(id + 'HO' + L, 'Plus de ' + fx(L), tail(t1, L)),
        sel(id + 'HU' + L, 'Moins de ' + fx(L), 1 - tail(t1, L))
      ]));
    }
    if (id === 'corners') {
      const r = lam.lh / (lam.lh + lam.la);
      const none = ph[0] * pa[0];
      add('first', 'Corners · Premier corner', [sel('cornersF1', H, (1 - none) * r), sel('cornersF2', A, (1 - none) * (1 - r))]);
    }
    if (id === 'yellow') {
      const both = (1 - ph[0]) * (1 - pa[0]);
      add('both', 'Cartons · Les deux équipes prennent un carton', [sel('yellowBY', 'Oui', both), sel('yellowBN', 'Non', 1 - both)]);
    }
    return M;
  };

  /** Lignes proches de la valeur attendue (comme les bookmakers). */
  function linesAround(mu, lines) {
    if (!lines.length) return [];
    const sorted = lines.slice().sort((a, b) => Math.abs(a - mu) - Math.abs(b - mu));
    return sorted.slice(0, Math.min(5, lines.length)).sort((a, b) => a - b);
  }
  S.linesAround = linesAround;

  /** Carton rouge et penalty : probabilité qu'il y en ait au moins un. */
  S.eventMarkets = function (red, pen, names) {
    const M = [];
    if (red) {
      const p = 1 - Math.exp(-(red.lh + red.la));
      M.push({ id: 'red', group: 'Cartons rouges', name: 'Carton rouge dans le match', stat: 'red', data: red.n, sels: [sel('redY', 'Oui', p), sel('redN', 'Non', 1 - p)] });
      const p1 = 1 - Math.exp(-red.lh);
      const p2 = 1 - Math.exp(-red.la);
      M.push({ id: 'redteam', group: 'Cartons rouges', name: 'Carton rouge par équipe', stat: 'red', data: red.n, sels: [sel('red1Y', names.home + ' : oui', p1), sel('red2Y', names.away + ' : oui', p2)] });
    }
    if (pen) {
      M.push({ id: 'pen', group: 'Penalty', name: 'Penalty accordé dans le match', stat: 'pen', data: pen.n, sels: [sel('penY', 'Oui', pen.p), sel('penN', 'Non', 1 - pen.p)], info: 'Penalty de la séance de tirs au but non compté' });
      M.push({ id: 'penteam', group: 'Penalty', name: 'Penalty pour une équipe', stat: 'pen', data: pen.n, sels: [sel('pen1Y', names.home + ' obtient un penalty', pen.p1), sel('pen2Y', names.away + ' obtient un penalty', pen.p2)] });
      M.push({ id: 'penscored', group: 'Penalty', name: 'Penalty marqué dans le match', stat: 'pen', data: pen.n, sels: [sel('penSY', 'Oui', pen.pScored), sel('penSN', 'Non', 1 - pen.pScored)] });
    }
    return M;
  };

  /**
   * Penalty : taux de base, ajusté par les penaltys obtenus et concédés récemment.
   * hist : { isHome, for, against } = penaltys obtenus / concédés par match.
   */
  S.penalty = function (histH, histA) {
    const base = S.PENALTY.base;
    const perTeam = -Math.log(1 - base) / 2;
    const ok = (g) => g && isFinite(g.for) && isFinite(g.against);
    const hH = (histH || []).filter(ok).slice(0, 15);
    const hA = (histA || []).filter(ok).slice(0, 15);
    const k = S.PENALTY.prior;
    const r = (h, f) => (h.reduce((s, g) => s + g[f], 0) + k * perTeam) / (h.length + k) / perTeam;
    const l1 = perTeam * Math.sqrt(r(hH, 'for') * r(hA, 'against'));
    const l2 = perTeam * Math.sqrt(r(hA, 'for') * r(hH, 'against'));
    const p = 1 - Math.exp(-(l1 + l2));
    const sc = S.PENALTY.scored;
    return { p, p1: 1 - Math.exp(-l1), p2: 1 - Math.exp(-l2), pScored: 1 - Math.exp(-(l1 + l2) * sc), n: Math.min(hH.length, hA.length) };
  };

  /**
   * Tous les marchés statistiques d'un match.
   * teams : { home: { corners: hist, yellow: hist, … , pen: hist }, away: {…} }
   */
  S.analyze = function (teams, names, neutral, opts) {
    const out = { markets: [], expected: {} };
    const th = (teams && teams.home) || {};
    const ta = (teams && teams.away) || {};
    for (const id of Object.keys(S.SPECS)) {
      const spec = S.SPECS[id];
      const hh = th[id] || [];
      const ha = ta[id] || [];
      const lam = S.lambdas(hh, ha, spec, neutral);
      out.expected[id] = lam;
      if (id === 'red') continue;
      if (!(hh.length || ha.length) && !S.ALWAYS[id]) continue;
      const mk = S.markets(id, lam, spec, names);
      if (!(hh.length || ha.length)) for (const m of mk) m.info = 'Moyenne générale (pas de statistiques récentes pour ces équipes)';
      out.markets.push.apply(out.markets, mk);
    }
    const pen = S.penalty(th.pen, ta.pen);
    out.expected.pen = pen;
    out.markets.push.apply(out.markets, S.eventMarkets(out.expected.red, pen, names));
    if (opts && opts.scorers) out.markets.push.apply(out.markets, S.scorerMarkets(opts.scorers, opts.lh, opts.la, names));
    return out;
  };

  /**
   * Buteurs : part des buts de l'équipe marqués par chaque joueur sur ses derniers
   * matchs (avec retour vers zéro), appliquée aux buts attendus de l'équipe.
   * Hypothèse : le joueur est sur le terrain comme lors des derniers matchs.
   */
  S.scorerMarkets = function (sc, lh, la, names) {
    const M = [];
    const one = (block, lam, team, side) => {
      if (!block || !block.list || !block.list.length || !(lam > 0)) return;
      const tot = Math.max(1, block.teamGoals);
      const shrink = 2;
      const sels = block.list.slice(0, 8).map((pl) => {
        const share = pl.goals / (tot + shrink);
        const p = 1 - Math.exp(-lam * share);
        return sel('SC' + pl.id, pl.name + ' (' + pl.goals + ' but' + (pl.goals > 1 ? 's' : '') + ' en ' + block.matches + ' matchs)', p);
      });
      M.push({ id: 'scorer' + side, group: 'Buteurs', name: 'Buteur · ' + team, sels, stat: 'scorer', data: block.matches, info: 'Marque au moins un but (contre son camp exclu), s’il joue comme lors des derniers matchs' });
    };
    one(sc.home, lh, names.home, 1);
    one(sc.away, la, names.away, 2);
    return M;
  };

  /** Statistiques proposées même sans historique (moyennes générales). */
  S.ALWAYS = { corners: true, yellow: true };

  const KEY = /^(corners|yellow|red|shotsOn|shots|fouls|offsides|saves|pen)(.*)$/;
  S.isKey = (key) => KEY.test(key) || /^SC\d+$/.test(key);

  /**
   * Règlement d'un pari statistique. r.stats = { corners: [dom, ext], yellow: […], … },
   * r.statsH1 = { yellow: […] } (si connu), r.pens = { h, a, scored } (hors tirs au but).
   * Renvoie null si la donnée manque.
   */
  S.settle = function (key, r) {
    if (/^SC\d+$/.test(key)) {
      if (!Array.isArray(r.goals) || r.goals.length !== r.hg + r.ag || r.goals.some((g) => !g.scorer && g.type !== 'OG')) return null;
      const id = key.slice(2);
      return r.goals.some((g) => g.type !== 'OG' && g.scorer === id) ? 'won' : 'lost';
    }
    const mm = KEY.exec(key);
    if (!mm) return null;
    const id = mm[1];
    const rest = mm[2];
    const ok = (c) => (c ? 'won' : 'lost');
    if (id === 'pen') {
      const p = r.pens;
      if (!p || !isFinite(p.h) || !isFinite(p.a)) return null;
      if (rest === 'Y' || rest === 'N') return ok((p.h + p.a > 0) === (rest === 'Y'));
      if (rest === '1Y') return ok(p.h > 0);
      if (rest === '2Y') return ok(p.a > 0);
      if ((rest === 'SY' || rest === 'SN') && isFinite(p.scored)) return ok((p.scored > 0) === (rest === 'SY'));
      return null;
    }
    const v = r.stats && r.stats[id];
    if (!v || !isFinite(v[0]) || !isFinite(v[1])) return null;
    const [x, y] = v;
    let m;
    if (id === 'red') {
      if (rest === 'Y' || rest === 'N') return ok((x + y > 0) === (rest === 'Y'));
      if (rest === '1Y') return ok(x > 0);
      if (rest === '2Y') return ok(y > 0);
      return null;
    }
    if ((m = /^([OU])([\d.]+)$/.exec(rest))) return ok(m[1] === 'O' ? x + y > +m[2] : x + y < +m[2]);
    if ((m = /^([12])([OU])([\d.]+)$/.exec(rest))) {
      const g = m[1] === '1' ? x : y;
      return ok(m[2] === 'O' ? g > +m[3] : g < +m[3]);
    }
    if (rest === 'W1') return ok(x > y);
    if (rest === 'WX') return ok(x === y);
    if (rest === 'W2') return ok(x < y);
    if ((m = /^H([12])([+-][\d.]+)$/.exec(rest))) return ok((m[1] === '1' ? x - y : y - x) + +m[2] > 0);
    if ((m = /^H([OU])([\d.]+)$/.exec(rest))) {
      const h1 = r.statsH1 && r.statsH1[id];
      if (!h1 || !isFinite(h1[0]) || !isFinite(h1[1])) return null;
      return ok(m[1] === 'O' ? h1[0] + h1[1] > +m[2] : h1[0] + h1[1] < +m[2]);
    }
    if (rest === 'BY' || rest === 'BN') return ok((x > 0 && y > 0) === (rest === 'BY'));
    return null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
