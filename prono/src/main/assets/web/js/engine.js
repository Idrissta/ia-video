/* Prono — moteur de prédiction.
 *
 * 1. Forces d'attaque et de défense de chaque équipe à partir de ses derniers
 *    matchs (pondérés par l'ancienneté, corrigés du lieu et, si possible, de la
 *    force des adversaires), avec un rétrécissement bayésien vers la moyenne de
 *    la ligue pour ne pas sur-réagir à 5 matchs.
 * 2. Correction par les confrontations directes (poids modéré, décroissant
 *    avec l'ancienneté).
 * 3. Buts attendus → matrice des scores (Poisson + correction Dixon-Coles des
 *    petits scores), modèle par mi-temps pour les paris « 1re / 2e mi-temps ».
 * 4. Combinaison facultative avec les cotes du bookmaker (marge retirée).
 * 5. Probabilités et cotes justes de tous les marchés, « value » face aux
 *    cotes saisies, pronostics recommandés.
 */
(function (root) {
  'use strict';
  const P = root.PRONO || (root.PRONO = {});
  const E = P.Engine = {};
  E.lastHtShare = 0.448;

  /** Paramètres par défaut (calibrés par tools/prono-backtest.js). */
  E.DEFAULTS = {
    homeAvg: 1.533,       // buts par match de l'équipe qui reçoit (12 championnats, 2021-2026)
    awayAvg: 1.236,       // buts par match de l'équipe qui se déplace
    decay: 0.95,          // poids d'un match par rang d'ancienneté (le plus récent = 1)
    prior: 12,            // « matchs moyens » ajoutés en a priori (rétrécissement)
    oppAdjust: 0,         // correction par la force des adversaires (sans gain mesuré)
    h2hWeight: 0.2,       // poids des confrontations directes
    h2hHalfLife: 5,       // demi-vie (années) d'une confrontation directe
    rho: -0.05,           // correction Dixon-Coles
    htShare: 0.448,       // part des buts marqués en 1re mi-temps (mesurée)
    marketWeight: 0.85,   // poids des cotes de référence quand elles existent
    window: 20,           // matchs récents utilisés par équipe (20 > 10 > 5 au test)
    seasonWeight: 0,      // poids du classement de la saison (sans gain au test)
    seasonPrior: 6,
    maxGoals: 10
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* --------------------------------------------------------------------- */
  /* Lois de Poisson et matrice des scores                                 */
  /* --------------------------------------------------------------------- */

  E.poisson = function (lambda, n) {
    const out = new Array(n + 1);
    let p = Math.exp(-lambda);
    out[0] = p;
    for (let k = 1; k <= n; k++) {
      p = p * lambda / k;
      out[k] = p;
    }
    return out;
  };

  /** Matrice M[i][j] = P(domicile i buts, extérieur j buts), Dixon-Coles. */
  E.matrix = function (lh, la, rho, n) {
    n = n || 10;
    const ph = E.poisson(lh, n);
    const pa = E.poisson(la, n);
    const m = [];
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const row = new Array(n + 1);
      for (let j = 0; j <= n; j++) {
        let v = ph[i] * pa[j];
        if (rho) {
          if (i === 0 && j === 0) v *= 1 - lh * la * rho;
          else if (i === 0 && j === 1) v *= 1 + lh * rho;
          else if (i === 1 && j === 0) v *= 1 + la * rho;
          else if (i === 1 && j === 1) v *= 1 - rho;
        }
        if (v < 0) v = 0;
        row[j] = v;
        sum += v;
      }
      m.push(row);
    }
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) m[i][j] /= sum;
    return m;
  };

  /** Probabilités de base utilisées par la calibration. */
  E.basic = function (m) {
    const n = m.length - 1;
    let h = 0;
    let d = 0;
    let a = 0;
    let btts = 0;
    const tot = new Array(2 * n + 1).fill(0);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const v = m[i][j];
        if (i > j) h += v;
        else if (i === j) d += v;
        else a += v;
        if (i > 0 && j > 0) btts += v;
        tot[i + j] += v;
      }
    }
    const under = (L) => {
      let s = 0;
      for (let k = 0; k < L; k++) s += tot[k];
      return s;
    };
    return { h, d, a, btts, o15: 1 - under(2), o25: 1 - under(3), o35: 1 - under(4), o05: 1 - tot[0], tot };
  };

  /* --------------------------------------------------------------------- */
  /* Forces des équipes                                                     */
  /* --------------------------------------------------------------------- */

  /**
   * matches : du plus récent au plus ancien, { isHome, gf, ga, neutral?, opp?: {att, def} }.
   * Renvoie { att, def, n } (1 = moyenne de la ligue).
   */
  E.rating = function (matches, p, lg, center) {
    const mu = lg.mu;
    const c0 = center || { att: 1, def: 1 };
    let attNum = 0;
    let defNum = 0;
    let den = 0;
    let n = 0;
    (matches || []).forEach((m) => {
      if (m == null || !isFinite(m.gf) || !isFinite(m.ga)) return;
      if (n >= p.window) return;
      const w = Math.pow(p.decay, n) * (m.w || 1);
      n++;
      const venueFor = m.neutral ? 1 : m.isHome ? lg.hs : lg.as;
      const venueAgainst = m.neutral ? 1 : m.isHome ? lg.as : lg.hs;
      let oppDef = 1;
      let oppAtt = 1;
      if (m.opp && p.oppAdjust) {
        oppDef = Math.pow(clamp(m.opp.def, 0.4, 2.5), p.oppAdjust);
        oppAtt = Math.pow(clamp(m.opp.att, 0.4, 2.5), p.oppAdjust);
      }
      attNum += w * m.gf / (venueFor * oppDef);
      defNum += w * m.ga / (venueAgainst * oppAtt);
      den += w;
    });
    // Moyenne a posteriori gamma-Poisson : `prior` matchs « type » ajoutés,
    // centrés sur la force de saison (classement) quand elle est connue.
    const att = (attNum + p.prior * mu * c0.att) / ((den + p.prior) * mu);
    const def = (defNum + p.prior * mu * c0.def) / ((den + p.prior) * mu);
    return { att, def, n, weight: den };
  };

  /**
   * Force de saison (classement) servant de centre au rétrécissement :
   * season = { gp, gf?, ga?, gd } ; sans buts marqués/encaissés on répartit
   * la différence de buts à parts égales entre attaque et défense.
   */
  E.seasonCenter = function (season, p, lg) {
    if (!season || !(season.gp > 0) || !p.seasonWeight) return null;
    const k = season.gp / (season.gp + p.seasonPrior);
    let att;
    let def;
    if (isFinite(season.gf) && isFinite(season.ga)) {
      att = season.gf / season.gp / lg.mu;
      def = season.ga / season.gp / lg.mu;
    } else if (isFinite(season.gd)) {
      const g = clamp(season.gd / season.gp, -3, 3);
      att = 1 + g / (2 * lg.mu);
      def = 1 - g / (2 * lg.mu);
    } else return null;
    const w = p.seasonWeight * k;
    return { att: clamp(1 + w * (att - 1), 0.3, 3), def: clamp(1 + w * (def - 1), 0.3, 3) };
  };

  /** Moyennes de ligue → facteurs domicile/extérieur. */
  E.league = function (p) {
    const mu = (p.homeAvg + p.awayAvg) / 2;
    return { mu, hs: p.homeAvg / mu, as: p.awayAvg / mu, home: p.homeAvg, away: p.awayAvg };
  };

  /**
   * Buts attendus d'un match.
   * input : { home: {matches}, away: {matches}, h2h: [{ageYears, hg, ag, homeAtHome, neutral}], neutral }
   * (dans h2h, hg = buts de l'équipe qui reçoit AUJOURD'HUI, homeAtHome = elle jouait à domicile ce jour-là).
   */
  E.lambdas = function (input, params) {
    const p = Object.assign({}, E.DEFAULTS, params || {});
    const lg = E.league(p);
    const rh = E.rating(input.home.matches, p, lg, E.seasonCenter(input.home.season, p, lg));
    const ra = E.rating(input.away.matches, p, lg, E.seasonCenter(input.away.season, p, lg));
    const neutral = !!input.neutral;
    let lh = lg.mu * (neutral ? 1 : lg.hs) * rh.att * ra.def;
    let la = lg.mu * (neutral ? 1 : lg.as) * ra.att * rh.def;
    const formH = lh;
    const formA = la;

    // Confrontations directes : écart entre buts observés et buts attendus.
    let mh = 1;
    let ma = 1;
    let h2hW = 0;
    const h2h = (input.h2h || []).filter((g) => g && isFinite(g.hg) && isFinite(g.ag));
    if (h2h.length && p.h2hWeight > 0) {
      let obsH = 0;
      let expH = 0;
      let obsA = 0;
      let expA = 0;
      h2h.forEach((g, k) => {
        const age = isFinite(g.ageYears) ? Math.max(0, g.ageYears) : k * 0.5;
        const w = Math.pow(0.5, age / p.h2hHalfLife);
        const vh = g.neutral ? 1 : g.homeAtHome ? lg.hs : lg.as;
        const va = g.neutral ? 1 : g.homeAtHome ? lg.as : lg.hs;
        const eh = lg.mu * vh * rh.att * ra.def;
        const ea = lg.mu * va * ra.att * rh.def;
        obsH += w * g.hg;
        expH += w * eh;
        obsA += w * g.ag;
        expA += w * ea;
        h2hW += w;
      });
      // Rétrécissement : 2 « confrontations attendues » ajoutées.
      const K = 2 * (expH / Math.max(h2hW, 1e-9));
      const KA = 2 * (expA / Math.max(h2hW, 1e-9));
      mh = (obsH + K) / (expH + K);
      ma = (obsA + KA) / (expA + KA);
      lh *= Math.pow(mh, p.h2hWeight);
      la *= Math.pow(ma, p.h2hWeight);
    }
    return {
      lh: clamp(lh, 0.08, 6),
      la: clamp(la, 0.08, 6),
      formH, formA, mh, ma, h2hW,
      home: rh, away: ra, params: p, league: lg
    };
  };

  /* --------------------------------------------------------------------- */
  /* Cotes du bookmaker                                                     */
  /* --------------------------------------------------------------------- */

  /** Retire la marge (méthode « power ») : renvoie des probabilités qui somment à 1. */
  E.fairProbs = function (odds) {
    const inv = odds.map((o) => (o > 1 ? 1 / o : 0));
    if (inv.some((x) => x <= 0)) return null;
    const total = inv.reduce((a, b) => a + b, 0);
    if (total <= 1) return inv.map((x) => x / total);
    let lo = 1;
    let hi = 3;
    for (let it = 0; it < 60; it++) {
      const k = (lo + hi) / 2;
      const s = inv.reduce((a, x) => a + Math.pow(x, k), 0);
      if (s > 1) lo = k;
      else hi = k;
    }
    const k = (lo + hi) / 2;
    const ps = inv.map((x) => Math.pow(x, k));
    const s = ps.reduce((a, b) => a + b, 0);
    return ps.map((x) => x / s);
  };

  /** Buts attendus implicites dans les cotes 1X2 (+ total 2.5 si fourni). */
  E.marketLambdas = function (pH, pD, pA, pOver25, rho) {
    // Recherche sur la somme et l'écart des buts attendus.
    let best = null;
    const target = (lh, la) => {
      const b = E.basic(E.matrix(lh, la, rho, 8));
      let e = (b.h - pH) ** 2 + (b.a - pA) ** 2 + 0.5 * (b.d - pD) ** 2;
      if (pOver25 != null) e += (b.o25 - pOver25) ** 2;
      return e;
    };
    let lh = 1.4;
    let la = 1.1;
    let step = 0.5;
    let cur = target(lh, la);
    for (let it = 0; it < 80 && step > 0.002; it++) {
      let moved = false;
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, -step], [-step, step]]) {
        const nh = lh + dx;
        const na = la + dy;
        if (nh < 0.05 || na < 0.05 || nh > 6 || na > 6) continue;
        const e = target(nh, na);
        if (e < cur) {
          cur = e;
          lh = nh;
          la = na;
          moved = true;
        }
      }
      if (!moved) step /= 2;
    }
    best = { lh, la, err: cur };
    return best;
  };

  /* --------------------------------------------------------------------- */
  /* Analyse complète                                                       */
  /* --------------------------------------------------------------------- */

  /**
   * input : comme E.lambdas + { odds?: { '1','X','2','O2.5','U2.5', … } (cotes décimales),
   *                              names?: {home, away} }
   */
  E.analyze = function (input, params) {
    const base = E.lambdas(input, params);
    const p = base.params;
    let lh = base.lh;
    let la = base.la;
    let market = null;
    // refOdds : cotes de référence (marché) combinées au modèle ;
    // odds : cotes de l'utilisateur (1xBet…), servent uniquement au calcul de la value.
    const odds = input.odds || {};
    const ref = input.refOdds || {};
    if (ref['1'] > 1 && ref.X > 1 && ref['2'] > 1) {
      const f = E.fairProbs([ref['1'], ref.X, ref['2']]);
      let pOver = null;
      if (ref['O2.5'] > 1 && ref['U2.5'] > 1) pOver = E.fairProbs([ref['O2.5'], ref['U2.5']])[0];
      if (f) {
        market = E.marketLambdas(f[0], f[1], f[2], pOver, p.rho);
        market.probs = { h: f[0], d: f[1], a: f[2], o25: pOver };
        const w = p.marketWeight;
        lh = Math.exp((1 - w) * Math.log(lh) + w * Math.log(market.lh));
        la = Math.exp((1 - w) * Math.log(la) + w * Math.log(market.la));
      }
    }
    const n = p.maxGoals;
    const ft = E.matrix(lh, la, p.rho, n);
    const r = p.htShare;
    const h1 = E.matrix(lh * r, la * r, 0, n);
    const h2 = E.matrix(lh * (1 - r), la * (1 - r), 0, n);
    E.lastHtShare = r;
    const markets = E.markets(ft, h1, h2, input.names || { home: 'Domicile', away: 'Extérieur' }, lh, la);
    const model = { lh: base.lh, la: base.la };
    const out = {
      lh, la, model, market, ft, h1, h2, markets,
      base, confidence: E.confidence(input, base, market)
    };
    E.applyOdds(out, odds);
    out.picks = E.picks(out);
    return out;
  };

  /** Indice de confiance (0..100) selon la quantité de données et la netteté du match. */
  E.confidence = function (input, base, market) {
    const nh = Math.min(5, base.home.n);
    const na = Math.min(5, base.away.n);
    const nh2h = Math.min(5, (input.h2h || []).length);
    let score = 30 + nh * 6 + na * 6 + nh2h * 2;
    if (market) score += 10;
    score = Math.min(100, score);
    const label = score >= 75 ? 'Élevée' : score >= 55 ? 'Moyenne' : 'Faible';
    return { score, label };
  };

  /* --------------------------------------------------------------------- */
  /* Marchés                                                                */
  /* --------------------------------------------------------------------- */

  const pct = (x) => Math.max(0, Math.min(1, x));
  const fx = (v) => String(v).replace('.', ',');
  const fair = (prob) => (prob > 0.0001 ? 1 / prob : null);
  const sel = (key, label, prob, extra) => Object.assign({ key, label, p: pct(prob), fair: fair(prob) }, extra || {});

  /** Règlement d'un pari « asiatique » (lignes entières, demies et quarts). */
  E.asian = function (dist, line) {
    // dist : tableau [valeur, probabilité] de la variable (marge ou total) ; on parie « valeur + ligne > 0 ».
    const parts = Math.abs(line * 4) % 2 === 1 ? [line - 0.25, line + 0.25] : [line];
    let win = 0;
    let lose = 0;
    let push = 0;
    for (const L of parts) {
      const share = 1 / parts.length;
      for (const [v, pr] of dist) {
        const s = v + L;
        if (s > 1e-9) win += pr * share;
        else if (s < -1e-9) lose += pr * share;
        else push += pr * share;
      }
    }
    // Cote juste : espérance nulle.
    const fairOdd = win > 0 ? 1 + lose / win : null;
    return { win, lose, push, fair: fairOdd };
  };

  /**
   * Répartition des buts dans le match (parts par tranche de 15 minutes,
   * temps additionnel compris dans 31-45 et 76-90) et part des buts marqués
   * dans le temps additionnel de chaque mi-temps. Mesurées par tools/prono-stats.js.
   */
  /**
   * Nombre de buts marqués à chaque minute (1 à 90 ; temps additionnel compté
   * dans la 45e et la 90e), mesuré sur 2 779 matchs ESPN (tools/prono-stats.js),
   * et part des buts marqués dans le temps additionnel de chaque mi-temps.
   */
  E.TIME = {
    minutes: [39, 45, 73, 71, 79, 70, 90, 70, 73, 84, 84, 66, 66, 72, 66, 75, 63, 84, 73, 79, 62, 92, 87, 77, 81, 79, 70, 84, 81, 90,
      69, 86, 74, 70, 79, 71, 74, 89, 103, 71, 78, 72, 87, 89, 323, 50, 74, 85, 87, 90, 114, 101, 115, 94, 92, 99, 105, 91, 96, 87,
      89, 88, 83, 71, 77, 99, 82, 82, 89, 86, 83, 93, 87, 109, 85, 74, 76, 78, 102, 77, 84, 84, 92, 84, 85, 98, 97, 104, 101, 662],
    st1: 0.029,
    st2: 0.0677
  };
  /** Part des buts de chaque type (penalty, contre son camp : ESPN, 8 269 buts ; tête : grands championnats). */
  E.GOAL_TYPES = { PG: 0.073, OG: 0.029, HD: 0.11 };

  const timeCache = {};
  /** cum[m] : part des buts marqués jusqu'à la fin de la minute m (m = 0..90). */
  E.timeProfile = function (htShare) {
    const key = htShare.toFixed(4);
    if (timeCache[key]) return timeCache[key];
    const raw = E.TIME.minutes;
    // Lissage léger (moyenne sur 3 minutes) sauf aux minutes particulières :
    // coup d'envoi (1, 2, 46), temps additionnel (45, 90).
    const keep = new Set([1, 2, 45, 46, 90]);
    const w = [0];
    for (let m = 1; m <= 90; m++) {
      if (keep.has(m) || keep.has(m - 1) && keep.has(m + 1)) w[m] = raw[m - 1];
      else {
        const a = keep.has(m - 1) ? raw[m - 1] : raw[m - 2];
        const c = keep.has(m + 1) ? raw[m - 1] : raw[m];
        w[m] = (a + raw[m - 1] + c) / 3;
      }
    }
    // Mise à l'échelle : la part de la 1re mi-temps vaut htShare (modèle des mi-temps).
    let f1 = 0;
    let f2 = 0;
    for (let m = 1; m <= 45; m++) f1 += w[m];
    for (let m = 46; m <= 90; m++) f2 += w[m];
    for (let m = 1; m <= 90; m++) w[m] *= m <= 45 ? htShare / f1 : (1 - htShare) / f2;
    const cum = [0];
    for (let m = 1; m <= 90; m++) cum[m] = cum[m - 1] + w[m];
    cum[90] = 1;
    const st1 = Math.min(E.TIME.st1, w[45] * 0.9);
    const st2 = Math.min(E.TIME.st2, w[90] * 0.9);
    return (timeCache[key] = { cum, st1, st2 });
  };

  const seqCache = {};
  /**
   * Pour un score final i-j, ordre des buts uniformément aléatoire :
   * probabilité que le domicile mène à un moment (hl), l'extérieur (al), les
   * deux (bl), et qui atteint 2 / 3 buts en premier.
   */
  E.sequence = function (i, j) {
    const key = i + '-' + j;
    if (seqCache[key]) return seqCache[key];
    // État : a, b, drapeaux (mené domicile, mené extérieur, course à 2, course à 3).
    let dist = new Map([['0,0,0,0,0,0', 1]]);
    for (let step = 0; step < i + j; step++) {
      const next = new Map();
      for (const [st, pr] of dist) {
        const [a, b, hl, al, r2, r3] = st.split(',').map(Number);
        const remH = i - a;
        const remA = j - b;
        const tot = remH + remA;
        for (const [da, db, q] of [[1, 0, remH / tot], [0, 1, remA / tot]]) {
          if (q <= 0) continue;
          const na = a + da;
          const nb = b + db;
          const nr2 = r2 || (na === 2 ? 1 : nb === 2 ? 2 : 0);
          const nr3 = r3 || (na === 3 ? 1 : nb === 3 ? 2 : 0);
          const k = [na, nb, hl || (na > nb ? 1 : 0), al || (nb > na ? 1 : 0), nr2, nr3].join(',');
          next.set(k, (next.get(k) || 0) + pr * q);
        }
      }
      dist = next;
    }
    const out = { hl: 0, al: 0, bl: 0, r2h: 0, r2a: 0, r3h: 0, r3a: 0 };
    for (const [st, pr] of dist) {
      const [, , hl, al, r2, r3] = st.split(',').map(Number);
      if (hl) out.hl += pr;
      if (al) out.al += pr;
      if (hl && al) out.bl += pr;
      if (r2 === 1) out.r2h += pr;
      if (r2 === 2) out.r2a += pr;
      if (r3 === 1) out.r3h += pr;
      if (r3 === 2) out.r3a += pr;
    }
    return (seqCache[key] = out);
  };

  E.markets = function (ft, h1, h2, names, lh, la) {
    const n = ft.length - 1;
    const H = names.home;
    const A = names.away;
    const sum = (f) => {
      let s = 0;
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) if (f(i, j)) s += ft[i][j];
      return s;
    };
    const b = E.basic(ft);
    const M = [];
    const add = (id, group, name, sels, info) => M.push({ id, group, name, sels, info });
    const marginDist = [];
    const totalDist = [];
    {
      const md = {};
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) md[i - j] = (md[i - j] || 0) + ft[i][j];
      for (const k in md) marginDist.push([+k, md[k]]);
      b.tot.forEach((pr, k) => totalDist.push([k, pr]));
    }

    // --- Principaux
    add('1x2', 'Principaux', '1X2', [sel('1', 'V1 · ' + H, b.h), sel('X', 'Nul', b.d), sel('2', 'V2 · ' + A, b.a)]);
    add('dc', 'Principaux', 'Double chance', [sel('1X', '1X · ' + H + ' ou nul', b.h + b.d), sel('12', '12 · pas de nul', b.h + b.a), sel('X2', 'X2 · ' + A + ' ou nul', b.d + b.a)]);
    {
      const dnbH = E.asian(marginDist, 0);
      const dnbA = E.asian(marginDist.map(([v, pr]) => [-v, pr]), 0);
      add('dnb', 'Principaux', 'Remboursé si match nul', [
        sel('DNB1', H, dnbH.win / Math.max(1e-9, dnbH.win + dnbH.lose), { fair: dnbH.fair, push: dnbH.push }),
        sel('DNB2', A, dnbA.win / Math.max(1e-9, dnbA.win + dnbA.lose), { fair: dnbA.fair, push: dnbA.push })
      ], 'Mise remboursée en cas de nul');
    }
    add('btts', 'Principaux', 'Les deux équipes marquent', [sel('BTTS_Y', 'Oui', b.btts), sel('BTTS_N', 'Non', 1 - b.btts)]);

    // --- Totaux
    const totals = [];
    for (const L of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) {
      let under = 0;
      for (let k = 0; k < L; k++) under += b.tot[k] || 0;
      totals.push(sel('O' + L, 'Plus de ' + fx(L), 1 - under), sel('U' + L, 'Moins de ' + fx(L), under));
    }
    add('total', 'Buts', 'Total de buts', totals);
    const atot = [];
    for (const L of [1.75, 2, 2.25, 2.75, 3, 3.25]) {
      const over = E.asian(totalDist.map(([v, pr]) => [v, pr]), -L);
      const under = E.asian(totalDist.map(([v, pr]) => [-v, pr]), L);
      atot.push(sel('AO' + L, 'Plus de ' + fx(L), over.win + over.push / 2, { fair: over.fair, push: over.push, asian: over }),
        sel('AU' + L, 'Moins de ' + fx(L), under.win + under.push / 2, { fair: under.fair, push: under.push, asian: under }));
    }
    add('atotal', 'Buts', 'Total asiatique', atot, 'Lignes .25/.75 : moitié gagnée ou remboursée');
    for (const [id, team, idx] of [['it1', H, 0], ['it2', A, 1]]) {
      const lam = idx === 0 ? lh : la;
      const marg = new Array(n + 1).fill(0);
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) marg[idx === 0 ? i : j] += ft[i][j];
      const s = [];
      for (const L of [0.5, 1.5, 2.5, 3.5, 4.5]) {
        let u = 0;
        for (let k = 0; k < L; k++) u += marg[k];
        s.push(sel(id + 'O' + L, 'Plus de ' + fx(L), 1 - u), sel(id + 'U' + L, 'Moins de ' + fx(L), u));
      }
      add(id, 'Buts', 'Total individuel ' + (idx + 1) + ' · ' + team, s, 'Buts attendus : ' + lam.toFixed(2).replace('.', ','));
    }
    {
      const s = [];
      for (let k = 0; k <= 5; k++) s.push(sel('EX' + k, k + ' but' + (k > 1 ? 's' : ''), b.tot[k] || 0));
      let rest = 0;
      for (let k = 6; k < b.tot.length; k++) rest += b.tot[k];
      s.push(sel('EX6', '6 buts ou plus', rest));
      add('exact', 'Buts', 'Nombre exact de buts', s);
    }
    {
      const s = [];
      for (const N of [1, 2, 3, 4]) {
        s.push(sel('T3O' + N, 'Plus de ' + N, sum((i, j) => i + j > N)), sel('T3E' + N, 'Exactement ' + N, b.tot[N] || 0), sel('T3U' + N, 'Moins de ' + N, sum((i, j) => i + j < N)));
      }
      add('total3', 'Buts', 'Total (3 issues)', s);
    }
    {
      const s = [];
      for (const [lo, hi] of [[0, 1], [2, 3], [4, 5], [6, 99], [1, 2], [1, 3], [2, 4], [3, 4]]) {
        let pr = 0;
        for (let k = lo; k <= Math.min(hi, b.tot.length - 1); k++) pr += b.tot[k];
        s.push(sel('MB' + lo + '-' + hi, hi > 50 ? lo + ' buts ou plus' : lo + ' à ' + hi + ' buts', pr));
      }
      add('multigoals', 'Buts', 'Intervalle de buts', s);
    }
    add('each2', 'Buts', 'Chaque équipe marque 2 buts ou plus', [sel('E2Y', 'Oui', sum((i, j) => i >= 2 && j >= 2)), sel('E2N', 'Non', 1 - sum((i, j) => i >= 2 && j >= 2))]);
    {
      const even = sum((i, j) => (i + j) % 2 === 0);
      add('oddeven', 'Buts', 'Pair / Impair', [sel('EVEN', 'Pair', even), sel('ODD', 'Impair', 1 - even)]);
    }
    add('teamscore', 'Buts', 'Équipe marque', [
      sel('S1Y', H + ' marque', 1 - sum((i) => i === 0)), sel('S1N', H + ' ne marque pas', sum((i) => i === 0)),
      sel('S2Y', A + ' marque', 1 - sum((i, j) => j === 0)), sel('S2N', A + ' ne marque pas', sum((i, j) => j === 0))
    ]);

    // --- Handicaps
    const eh = [];
    for (const L of [-3, -2, -1, 1, 2, 3]) {
      const t = (L > 0 ? '+' : '') + fx(L);
      const k = (L > 0 ? '+' : '') + L;
      eh.push(sel('EH1' + k, H + ' (' + t + ')', sum((i, j) => i + L > j)),
        sel('EHX' + k, 'Nul (' + t + ')', sum((i, j) => i + L === j)),
        sel('EH2' + k, A + ' (' + (L > 0 ? '-' : '+') + Math.abs(L) + ')', sum((i, j) => i + L < j)));
    }
    add('eh', 'Handicaps', 'Handicap européen', eh, 'Handicap appliqué à ' + H);
    const ah = [];
    for (const L of [-2.5, -2, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5]) {
      const r1 = E.asian(marginDist, L);
      const t = (L > 0 ? '+' : '') + fx(L);
      ah.push(sel('AH1' + (L > 0 ? '+' : '') + L, H + ' (' + t + ')', r1.win + r1.push / 2, { fair: r1.fair, push: r1.push, asian: r1 }));
      const r2 = E.asian(marginDist.map(([v, pr]) => [-v, pr]), -L);
      const t2 = (-L > 0 ? '+' : '') + fx(-L);
      ah.push(sel('AH2' + (-L > 0 ? '+' : '') + -L, A + ' (' + t2 + ')', r2.win + r2.push / 2, { fair: r2.fair, push: r2.push, asian: r2 }));
    }
    add('ah', 'Handicaps', 'Handicap asiatique', ah, 'Ligne entière : remboursé si égalité ; ligne .25/.75 : moitié');
    {
      const s = [];
      for (const [lbl, f] of [[H + ' par 1 but', (i, j) => i - j === 1], [H + ' par 2 buts', (i, j) => i - j === 2], [H + ' par 3 buts ou +', (i, j) => i - j >= 3],
        ['Nul', (i, j) => i === j], [A + ' par 1 but', (i, j) => j - i === 1], [A + ' par 2 buts', (i, j) => j - i === 2], [A + ' par 3 buts ou +', (i, j) => j - i >= 3]]) {
        s.push(sel('MG' + s.length, lbl, sum(f)));
      }
      add('margin', 'Handicaps', 'Écart de victoire', s);
    }

    // --- Combinés
    const rt = [];
    for (const L of [1.5, 2.5, 3.5]) {
      for (const [k, lbl, f] of [['1', 'V1', (i, j) => i > j], ['X', 'Nul', (i, j) => i === j], ['2', 'V2', (i, j) => i < j]]) {
        rt.push(sel('RT' + k + 'O' + L, lbl + ' et plus de ' + fx(L), sum((i, j) => f(i, j) && i + j > L)));
        rt.push(sel('RT' + k + 'U' + L, lbl + ' et moins de ' + fx(L), sum((i, j) => f(i, j) && i + j < L)));
      }
    }
    add('restotal', 'Combinés', 'Résultat + Total', rt);
    const rb = [];
    for (const [k, lbl, f] of [['1', 'V1', (i, j) => i > j], ['X', 'Nul', (i, j) => i === j], ['2', 'V2', (i, j) => i < j]]) {
      rb.push(sel('RB' + k + 'Y', lbl + ' et les deux marquent', sum((i, j) => f(i, j) && i > 0 && j > 0)));
      rb.push(sel('RB' + k + 'N', lbl + ' et pas les deux', sum((i, j) => f(i, j) && !(i > 0 && j > 0))));
    }
    add('resbtts', 'Combinés', 'Résultat + Les deux marquent', rb);
    const dt = [];
    for (const L of [1.5, 2.5, 3.5]) {
      for (const [k, f] of [['1X', (i, j) => i >= j], ['12', (i, j) => i !== j], ['X2', (i, j) => i <= j]]) {
        dt.push(sel('DT' + k + 'O' + L, k + ' et plus de ' + fx(L), sum((i, j) => f(i, j) && i + j > L)));
        dt.push(sel('DT' + k + 'U' + L, k + ' et moins de ' + fx(L), sum((i, j) => f(i, j) && i + j < L)));
      }
    }
    add('dctotal', 'Combinés', 'Double chance + Total', dt);
    add('wtn', 'Combinés', 'Gagne à zéro', [
      sel('WTN1', H + ' gagne sans encaisser', sum((i, j) => i > j && j === 0)),
      sel('WTN2', A + ' gagne sans encaisser', sum((i, j) => j > i && i === 0))
    ]);
    add('clean', 'Combinés', 'N\u2019encaisse pas de but', [
      sel('CS1', H + ' n\u2019encaisse pas', sum((i, j) => j === 0)),
      sel('CS2', A + ' n\u2019encaisse pas', sum((i) => i === 0))
    ]);
    {
      const s = [];
      for (const [k, f] of [['1X', (i, j) => i >= j], ['12', (i, j) => i !== j], ['X2', (i, j) => i <= j]]) {
        s.push(sel('DB' + k + 'Y', k + ' et les deux marquent', sum((i, j) => f(i, j) && i > 0 && j > 0)));
        s.push(sel('DB' + k + 'N', k + ' et pas les deux', sum((i, j) => f(i, j) && !(i > 0 && j > 0))));
      }
      add('dcbtts', 'Combinés', 'Double chance + Les deux marquent', s);
    }
    {
      const s = [];
      for (const L of [1.5, 2.5, 3.5, 4.5]) {
        const t = fx(L);
        s.push(sel('BTO' + L, 'Les deux marquent et plus de ' + t, sum((i, j) => i > 0 && j > 0 && i + j > L)),
          sel('BTU' + L, 'Les deux marquent et moins de ' + t, sum((i, j) => i > 0 && j > 0 && i + j < L)),
          sel('BNO' + L, 'Pas les deux et plus de ' + t, sum((i, j) => !(i > 0 && j > 0) && i + j > L)),
          sel('BNU' + L, 'Pas les deux et moins de ' + t, sum((i, j) => !(i > 0 && j > 0) && i + j < L)));
      }
      add('btotal', 'Combinés', 'Les deux marquent + Total', s);
    }

    // --- Score exact
    const cells = [];
    for (let i = 0; i <= Math.min(n, 6); i++) for (let j = 0; j <= Math.min(n, 6); j++) cells.push([i, j, ft[i][j]]);
    cells.sort((x, y) => y[2] - x[2]);
    {
      const grid = cells.filter(([i, j]) => i <= 5 && j <= 5);
      const other = 1 - grid.reduce((a, c) => a + c[2], 0);
      add('cs', 'Score exact', 'Score exact', grid.map(([i, j, pr]) => sel('CS' + i + '-' + j, i + ' - ' + j, pr)).concat([sel('CSO', 'Autre score', other)]), 'Classés du plus probable au moins probable');
      const grp = (name, f) => sum(f);
      add('csgroup', 'Score exact', 'Score exact groupé', [
        sel('CG1', H + ' gagne 1-0, 2-0 ou 2-1', grp('', (i, j) => (i === 1 && j === 0) || (i === 2 && j === 0) || (i === 2 && j === 1))),
        sel('CG2', H + ' gagne 3-0, 3-1 ou 3-2', grp('', (i, j) => i === 3 && j <= 2)),
        sel('CG3', H + ' gagne par 4 buts ou plus d’écart', grp('', (i, j) => i - j >= 4)),
        sel('CGX', 'Nul 0-0 ou 1-1', grp('', (i, j) => i === j && i <= 1)),
        sel('CGX2', 'Nul 2-2 ou plus', grp('', (i, j) => i === j && i >= 2)),
        sel('CG4', A + ' gagne 0-1, 0-2 ou 1-2', grp('', (i, j) => (i === 0 && j === 1) || (i === 0 && j === 2) || (i === 1 && j === 2))),
        sel('CG5', A + ' gagne 0-3, 1-3 ou 2-3', grp('', (i, j) => j === 3 && i <= 2)),
        sel('CG6', A + ' gagne par 4 buts ou plus d’écart', grp('', (i, j) => j - i >= 4))
      ]);
      for (const [id, team, idx] of [['tg1', H, 0], ['tg2', A, 1]]) {
        const ss = [];
        for (let k = 0; k <= 3; k++) ss.push(sel('TG' + (idx + 1) + '_' + k, k + ' but' + (k > 1 ? 's' : ''), sum((i, j) => (idx === 0 ? i : j) === k)));
        ss.push(sel('TG' + (idx + 1) + '_4', '4 buts ou plus', sum((i, j) => (idx === 0 ? i : j) >= 4)));
        add(id, 'Buts', 'Nombre de buts de ' + team, ss);
      }
    }

    // --- Mi-temps (modèle par périodes indépendantes)
    const halfBasic = (m) => E.basic(m);
    const hb1 = halfBasic(h1);
    const hb2 = halfBasic(h2);
    add('ht1x2', 'Mi-temps', '1re mi-temps · 1X2', [sel('H1', 'V1', hb1.h), sel('HX', 'Nul', hb1.d), sel('H2', 'V2', hb1.a)]);
    add('htdc', 'Mi-temps', '1re mi-temps · Double chance', [sel('H1X', '1X', hb1.h + hb1.d), sel('H12', '12', hb1.h + hb1.a), sel('HX2', 'X2', hb1.d + hb1.a)]);
    add('httotal', 'Mi-temps', '1re mi-temps · Total', [
      sel('HO0.5', 'Plus de 0,5', hb1.o05), sel('HU0.5', 'Moins de 0,5', 1 - hb1.o05),
      sel('HO1.5', 'Plus de 1,5', hb1.o15), sel('HU1.5', 'Moins de 1,5', 1 - hb1.o15),
      sel('HO2.5', 'Plus de 2,5', hb1.o25), sel('HU2.5', 'Moins de 2,5', 1 - hb1.o25)
    ]);
    add('htbtts', 'Mi-temps', '1re mi-temps · Les deux marquent', [sel('HBY', 'Oui', hb1.btts), sel('HBN', 'Non', 1 - hb1.btts)]);
    {
      const c = [];
      for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) c.push([i, j, h1[i][j]]);
      c.sort((x, y) => y[2] - x[2]);
      add('htcs', 'Mi-temps', '1re mi-temps · Score exact', c.map(([i, j, pr]) => sel('HCS' + i + '-' + j, i + ' - ' + j, pr)).concat([sel('HCSO', 'Autre score', 1 - c.reduce((a, x) => a + x[2], 0))]));
      const c2 = [];
      for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) c2.push([i, j, h2[i][j]]);
      c2.sort((x, y) => y[2] - x[2]);
      add('2hcs', 'Mi-temps', '2e mi-temps · Score exact', c2.map(([i, j, pr]) => sel('SCS' + i + '-' + j, i + ' - ' + j, pr)).concat([sel('SCSO', 'Autre score', 1 - c2.reduce((a, x) => a + x[2], 0))]));
      const hx = [];
      for (let k = 0; k <= 2; k++) hx.push(sel('HEX' + k, k + ' but' + (k > 1 ? 's' : ''), hb1.tot[k] || 0));
      hx.push(sel('HEX3', '3 buts ou plus', 1 - (hb1.tot[0] || 0) - (hb1.tot[1] || 0) - (hb1.tot[2] || 0)));
      add('htexact', 'Mi-temps', '1re mi-temps · Nombre exact de buts', hx);
    }
    {
      const hm = (m, f) => {
        let t = 0;
        for (let i = 0; i < m.length; i++) for (let j = 0; j < m.length; j++) if (f(i, j)) t += m[i][j];
        return t;
      };
      add('htteam', 'Mi-temps', '1re mi-temps · Total individuel', [
        sel('H1O0.5', H + ' plus de 0,5', hm(h1, (i) => i > 0)), sel('H1U0.5', H + ' moins de 0,5', hm(h1, (i) => i === 0)),
        sel('H2O0.5', A + ' plus de 0,5', hm(h1, (i, j) => j > 0)), sel('H2U0.5', A + ' moins de 0,5', hm(h1, (i, j) => j === 0)),
        sel('H1O1.5', H + ' plus de 1,5', hm(h1, (i) => i > 1)), sel('H2O1.5', A + ' plus de 1,5', hm(h1, (i, j) => j > 1))
      ]);
      add('htah', 'Mi-temps', '1re mi-temps · Handicap', [
        sel('HAH1-0.5', H + ' (-0,5)', hm(h1, (i, j) => i > j)), sel('HAH2+0.5', A + ' (+0,5)', hm(h1, (i, j) => j >= i)),
        sel('HAH1+0.5', H + ' (+0,5)', hm(h1, (i, j) => i >= j)), sel('HAH2-0.5', A + ' (-0,5)', hm(h1, (i, j) => j > i)),
        sel('HAH1-1.5', H + ' (-1,5)', hm(h1, (i, j) => i - j >= 2)), sel('HAH2-1.5', A + ' (-1,5)', hm(h1, (i, j) => j - i >= 2))
      ]);
      const he = hm(h1, (i, j) => (i + j) % 2 === 0);
      add('htoddeven', 'Mi-temps', '1re mi-temps · Pair / Impair', [sel('HEVEN', 'Pair', he), sel('HODD', 'Impair', 1 - he)]);
      add('2hbtts', 'Mi-temps', '2e mi-temps · Les deux marquent', [sel('SBY', 'Oui', hb2.btts), sel('SBN', 'Non', 1 - hb2.btts)]);
      add('2hteam', 'Mi-temps', '2e mi-temps · Total individuel', [
        sel('S1O0.5', H + ' plus de 0,5', hm(h2, (i) => i > 0)), sel('S1U0.5', H + ' moins de 0,5', hm(h2, (i) => i === 0)),
        sel('S2O0.5', A + ' plus de 0,5', hm(h2, (i, j) => j > 0)), sel('S2U0.5', A + ' moins de 0,5', hm(h2, (i, j) => j === 0))
      ]);
    }
    add('2h1x2', 'Mi-temps', '2e mi-temps · 1X2', [sel('S1', 'V1', hb2.h), sel('SX', 'Nul', hb2.d), sel('S2', 'V2', hb2.a)]);
    add('2htotal', 'Mi-temps', '2e mi-temps · Total', [
      sel('SO0.5', 'Plus de 0,5', hb2.o05), sel('SU0.5', 'Moins de 0,5', 1 - hb2.o05),
      sel('SO1.5', 'Plus de 1,5', hb2.o15), sel('SU1.5', 'Moins de 1,5', 1 - hb2.o15)
    ]);
    // Mi-temps / fin de match et marchés liés aux deux périodes.
    const hf = {};
    let hsh1 = 0;
    let hsh2 = 0;
    let hshEq = 0;
    let bothHalves = 0;
    let t1Both = 0;
    let t2Both = 0;
    let win1Either = 0;
    let win2Either = 0;
    let win1Both = 0;
    let win2Both = 0;
    let bttsBoth = 0;
    const tHalf = [[0, 0, 0], [0, 0, 0]];
    const m = Math.min(n, 7);
    const res = (x, y) => (x > y ? '1' : x === y ? 'X' : '2');
    for (let a = 0; a <= m; a++) {
      for (let c = 0; c <= m; c++) {
        const p1 = h1[a][c];
        if (p1 < 1e-9) continue;
        for (let d = 0; d <= m; d++) {
          for (let e = 0; e <= m; e++) {
            const pr = p1 * h2[d][e];
            if (pr < 1e-11) continue;
            const k = res(a, c) + '/' + res(a + d, c + e);
            hf[k] = (hf[k] || 0) + pr;
            const g1 = a + c;
            const g2 = d + e;
            if (g1 > g2) hsh1 += pr;
            else if (g2 > g1) hsh2 += pr;
            else hshEq += pr;
            if (g1 > 0 && g2 > 0) bothHalves += pr;
            if (a > 0 && d > 0) t1Both += pr;
            if (c > 0 && e > 0) t2Both += pr;
            if (a > c || d > e) win1Either += pr;
            if (c > a || e > d) win2Either += pr;
            if (a > c && d > e) win1Both += pr;
            if (c > a && e > d) win2Both += pr;
            if (a > 0 && c > 0 && d > 0 && e > 0) bttsBoth += pr;
            tHalf[0][a > d ? 0 : a < d ? 1 : 2] += pr;
            tHalf[1][c > e ? 0 : c < e ? 1 : 2] += pr;
          }
        }
      }
    }
    const lbl = { 1: H, X: 'Nul', 2: A };
    const hfs = [];
    for (const x of ['1', 'X', '2']) for (const y of ['1', 'X', '2']) hfs.push(sel('HF' + x + y, x + '/' + y + ' · ' + lbl[x] + ' / ' + lbl[y], hf[x + '/' + y] || 0));
    add('htft', 'Mi-temps', 'Mi-temps / Fin de match', hfs);
    add('hsh', 'Mi-temps', 'Mi-temps la plus prolifique', [sel('HSH1', '1re mi-temps', hsh1), sel('HSH2', '2e mi-temps', hsh2), sel('HSHX', 'Égalité', hshEq)]);
    add('bothhalves', 'Mi-temps', 'But dans les deux mi-temps', [sel('BHY', 'Oui', bothHalves), sel('BHN', 'Non', 1 - bothHalves)]);
    add('teamhalves', 'Mi-temps', 'Équipe marque dans les deux mi-temps', [sel('T1BH', H, t1Both), sel('T2BH', A, t2Both)]);
    add('wineither', 'Mi-temps', 'Gagne au moins une mi-temps', [sel('WE1', H, win1Either), sel('WE2', A, win2Either)]);
    add('winboth', 'Mi-temps', 'Gagne les deux mi-temps', [sel('WB1', H, win1Both), sel('WB2', A, win2Both)]);
    add('bttsboth', 'Mi-temps', 'Les deux marquent dans les deux mi-temps', [sel('BBY', 'Oui', bttsBoth), sel('BBN', 'Non', 1 - bttsBoth)]);
    add('bttshalves', 'Mi-temps', 'Les deux marquent : 1re / 2e mi-temps', [
      sel('HB2YY', 'Oui / Oui', hb1.btts * hb2.btts), sel('HB2YN', 'Oui / Non', hb1.btts * (1 - hb2.btts)),
      sel('HB2NY', 'Non / Oui', (1 - hb1.btts) * hb2.btts), sel('HB2NN', 'Non / Non', (1 - hb1.btts) * (1 - hb2.btts))
    ]);
    add('teamhsh', 'Mi-temps', 'Mi-temps la plus prolifique par équipe', [
      sel('TH11', H + ' : 1re', tHalf[0][0]), sel('TH12', H + ' : 2e', tHalf[0][1]), sel('TH1X', H + ' : égalité', tHalf[0][2]),
      sel('TH21', A + ' : 1re', tHalf[1][0]), sel('TH22', A + ' : 2e', tHalf[1][1]), sel('TH2X', A + ' : égalité', tHalf[1][2])
    ]);
    {
      const r = lh + la > 0 ? (h1[0][0] < 1 ? 1 - h1[0][0] : 0) : 0;
      const none = ft[0][0];
      add('firsthalfgoal', 'Mi-temps', 'Mi-temps du premier but', [sel('FH1', '1re mi-temps', r), sel('FH2', '2e mi-temps', Math.max(0, 1 - r - none)), sel('FH0', 'Aucun but', none)]);
    }
    // --- Ordre des buts : à score final fixé, l'ordre des buts est aléatoire
    // (processus de Poisson) ; tables exactes calculées une fois pour toutes.
    {
      const none = ft[0][0];
      let fg1 = 0;
      const fr = { '1_1': 0, '1_X': 0, '1_2': 0, '2_1': 0, '2_X': 0, '2_2': 0 };
      let r2h = 0;
      let r2a = 0;
      let r3h = 0;
      let r3a = 0;
      let cb1 = 0;
      let cb2 = 0;
      let bl = 0;
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          const pr = ft[i][j];
          if (!(i + j) || pr < 1e-12) continue;
          const q = E.sequence(i, j);
          const res = i > j ? '1' : i === j ? 'X' : '2';
          fg1 += pr * i / (i + j);
          fr['1_' + res] += pr * i / (i + j);
          fr['2_' + res] += pr * j / (i + j);
          r2h += pr * q.r2h;
          r2a += pr * q.r2a;
          r3h += pr * q.r3h;
          r3a += pr * q.r3a;
          if (i > j) cb1 += pr * q.al;
          if (j > i) cb2 += pr * q.hl;
          bl += pr * q.bl;
        }
      }
      const fg2 = 1 - none - fg1;
      add('firstgoal', 'Buts', 'Premier but', [sel('FG1', H, fg1), sel('FG0', 'Aucun but', none), sel('FG2', A, fg2)]);
      add('lastgoal', 'Buts', 'Dernier but', [sel('LG1', H, fg1), sel('LG0', 'Aucun but', none), sel('LG2', A, fg2)], 'À score égal, chaque équipe a autant de chances de marquer le dernier but que le premier');
      add('firstres', 'Ordre des buts', 'Premier but + résultat', [
        sel('FR1_1', H + ' ouvre le score et gagne', fr['1_1']), sel('FR1_X', H + ' ouvre le score, match nul', fr['1_X']), sel('FR1_2', H + ' ouvre le score et perd', fr['1_2']),
        sel('FR2_2', A + ' ouvre le score et gagne', fr['2_2']), sel('FR2_X', A + ' ouvre le score, match nul', fr['2_X']), sel('FR2_1', A + ' ouvre le score et perd', fr['2_1']),
        sel('FR0', 'Aucun but', none)
      ]);
      const fw = fr['1_1'] + fr['2_2'];
      add('firstwins', 'Ordre des buts', 'L’équipe qui ouvre le score gagne', [sel('FWY', 'Oui', fw), sel('FWN', 'Non (nul ou remontée)', 1 - none - fw), sel('FW0', 'Aucun but', none)]);
      add('race2', 'Ordre des buts', 'Premier à 2 buts', [sel('RA2_1', H, r2h), sel('RA2_2', A, r2a), sel('RA2_0', 'Aucune des deux', 1 - r2h - r2a)]);
      add('race3', 'Ordre des buts', 'Premier à 3 buts', [sel('RA3_1', H, r3h), sel('RA3_2', A, r3a), sel('RA3_0', 'Aucune des deux', 1 - r3h - r3a)]);
      add('comeback', 'Ordre des buts', 'Gagne après avoir été mené', [sel('CB1', H + ' remonte et gagne', cb1), sel('CB2', A + ' remonte et gagne', cb2)]);
      add('bothlead', 'Ordre des buts', 'Les deux équipes mènent au score', [sel('BLY', 'Oui', bl), sel('BLN', 'Non', 1 - bl)]);
    }

    // --- Minutes : intensité des buts minute par minute (mesurée sur ESPN),
    // temps additionnel compté dans la 45e et la 90e minute.
    {
      const T = E.timeProfile(E.lastHtShare);
      const L = lh + la;
      const C = T.cum;
      const yes = (lam) => 1 - Math.exp(-lam);
      for (const X of [2, 5, 10, 15, 20, 30]) {
        const p = yes(L * C[X]);
        add('gb' + X, 'Minutes', 'But dans les ' + X + ' premières minutes', [sel('GB' + X + 'Y', 'Oui', p), sel('GB' + X + 'N', 'Non', 1 - p)], X === 2 ? 'De 0:00 à 1:59' : 'De 0:00 à ' + (X - 1) + ':59');
      }
      const ints = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75], [76, 90]];
      const gi = [];
      for (const [a, b2] of ints) {
        const p = yes(L * (C[b2] - C[a - 1]));
        gi.push(sel('GI' + a + 'Y', a + '-' + b2 + (b2 === 45 || b2 === 90 ? '+' : '') + ' min : but', p), sel('GI' + a + 'N', a + '-' + b2 + (b2 === 45 || b2 === 90 ? '+' : '') + ' min : pas de but', 1 - p));
      }
      add('goalint', 'Minutes', 'But dans chaque tranche de 15 minutes', gi, '« 45+ » et « 90+ » : temps additionnel compris');
      {
        const s = [];
        let prev = 1;
        for (const [a, b2] of ints) {
          const cur = Math.exp(-L * C[b2]);
          s.push(sel('FT' + (a === 1 ? 0 : a), (a === 1 ? 0 : a) + '-' + b2 + (b2 === 45 || b2 === 90 ? '+' : '') + ' min', prev - cur));
          prev = cur;
        }
        s.push(sel('FTN', 'Aucun but', prev));
        add('firstgoaltime', 'Minutes', 'Moment du premier but', s);
      }
      for (const X of [15, 30, 60, 75]) {
        const c = C[X];
        const ph = E.poisson(lh * c, n);
        const pa = E.poisson(la * c, n);
        let w1 = 0;
        let d = 0;
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
          if (i > j) w1 += ph[i] * pa[j];
          else if (i === j) d += ph[i] * pa[j];
        }
        add('res' + X, 'Minutes', 'Résultat à la ' + X + 'e minute', [sel('R' + X + '_1', H, w1), sel('R' + X + '_X', 'Nul', d), sel('R' + X + '_2', A, 1 - w1 - d)], 'Score après ' + X + ' minutes de jeu');
      }
      const late = yes(L * (1 - C[80]));
      add('late', 'Minutes', 'But après la 80e minute', [sel('GL80Y', 'Oui', late), sel('GL80N', 'Non', 1 - late)], 'De 80:00 à la fin du temps additionnel');
      const st1 = yes(L * T.st1);
      const st2 = yes(L * T.st2);
      add('stoppage', 'Minutes', 'But dans le temps additionnel', [sel('GST1Y', '1re mi-temps : oui', st1), sel('GST1N', '1re mi-temps : non', 1 - st1), sel('GST2Y', '2e mi-temps : oui', st2), sel('GST2N', '2e mi-temps : non', 1 - st2)]);
      add('teamearly', 'Minutes', 'Équipe marque dans les 15 premières minutes', [sel('T15_1Y', H + ' : oui', yes(lh * C[15])), sel('T15_1N', H + ' : non', 1 - yes(lh * C[15])), sel('T15_2Y', A + ' : oui', yes(la * C[15])), sel('T15_2N', A + ' : non', 1 - yes(la * C[15]))]);
      add('teamlate', 'Minutes', 'Équipe marque après la 75e minute', [sel('T76_1Y', H + ' : oui', yes(lh * (1 - C[75]))), sel('T76_1N', H + ' : non', 1 - yes(lh * (1 - C[75]))), sel('T76_2Y', A + ' : oui', yes(la * (1 - C[75]))), sel('T76_2N', A + ' : non', 1 - yes(la * (1 - C[75])))]);
      // Types de buts (parts mesurées sur ESPN).
      const G = E.GOAL_TYPES;
      const ty = [];
      for (const [k, lbl] of [['PG', 'But sur penalty'], ['OG', 'But contre son camp'], ['HD', 'But de la tête']]) {
        const p = yes(L * G[k]);
        ty.push(sel(k + 'Y', lbl + ' : oui', p), sel(k + 'N', lbl + ' : non', 1 - p));
      }
      add('goaltype', 'Buts', 'Types de buts dans le match', ty, 'Au moins un but de ce type ; tête : estimation, à vérifier soi-même');
    }
    return M;
  };

  /* --------------------------------------------------------------------- */
  /* Cotes saisies, value et pronostics                                      */
  /* --------------------------------------------------------------------- */

  /** Associe les cotes saisies (clé = sélection) et calcule la value. */
  E.applyOdds = function (res, odds) {
    for (const mk of res.markets) {
      for (const s of mk.sels) {
        const o = odds && odds[s.key];
        if (o > 1) {
          s.odd = o;
          if (s.asian) {
            const a = s.asian;
            s.ev = a.win * (o - 1) - a.lose;
          } else if (s.push) {
            s.ev = s.p * (1 - s.push) * (o - 1) - (1 - s.p) * (1 - s.push);
          } else {
            s.ev = s.p * o - 1;
          }
        }
      }
    }
  };

  /** Marchés « classiques » pris en compte pour le pronostic principal. */
  const PICKABLE = {
    '1x2': 1, dc: 0.9, btts: 1, total: 1, it1: 0.8, it2: 0.8, dnb: 0.85, httotal: 0.75, ah: 0.7, teamscore: 0.8, wineither: 0.6
  };

  const CANON = {
    'it1O0.5': 'S1Y', 'it1U0.5': 'S1N', 'it2O0.5': 'S2Y', 'it2U0.5': 'S2N',
    'AH1+0.5': '1X', 'AH2+0.5': 'X2', 'AH1-0.5': '1', 'AH2-0.5': '2', 'HAH1-0.5': 'H1', 'HAH2-0.5': 'H2', 'HAH1+0.5': 'H1X', 'HAH2+0.5': 'HX2'
  };

  E.picks = function (res) {
    const all = [];
    for (const mk of res.markets) {
      const w = PICKABLE[mk.id];
      if (!w) continue;
      for (const s of mk.sels) {
        if (s.p < 0.5) continue;
        if (mk.id === 'total' && /^(O0\.5|U6\.5|U5\.5)$/.test(s.key)) continue;
        if (mk.id === 'ah' && Math.abs(parseFloat(s.key.slice(3))) > 1.5) continue;
        const fairOdd = s.fair || 1 / s.p;
        // On privilégie les paris probables mais pas triviaux (cote juste ≥ 1,25).
        const interest = fairOdd < 1.18 ? 0.55 : fairOdd < 1.3 ? 0.85 : 1;
        const score = s.p * w * interest + (s.ev != null ? Math.max(-0.2, Math.min(0.3, s.ev)) : 0);
        all.push({ market: mk.name, marketId: mk.id, key: s.key, label: s.label, p: s.p, fair: fairOdd, odd: s.odd, ev: s.ev, score });
      }
    }
    all.sort((a, b) => b.score - a.score);
    const out = [];
    const used = new Set();
    const chosen = new Set();
    for (const c of all) {
      // Paris identiques sous deux noms (ex. « Total individuel 1 : plus de 0,5 » = « Domicile marque »).
      const canon = CANON[c.key] || c.key;
      if (chosen.has(canon)) continue;
      if (used.has(c.marketId) && out.length < 4) continue;
      used.add(c.marketId);
      chosen.add(canon);
      c.level = c.p >= 0.75 ? 'Très probable' : c.p >= 0.62 ? 'Probable' : 'Risqué';
      out.push(c);
      if (out.length >= 6) break;
    }
    const values = [];
    for (const mk of res.markets) for (const s of mk.sels) if (s.ev != null && s.ev > 0.04 && s.p >= 0.2) values.push({ market: mk.name, label: s.label, p: s.p, odd: s.odd, ev: s.ev, fair: s.fair });
    values.sort((a, b) => b.ev - a.ev);
    return { main: out[0] || null, list: out, values: values.slice(0, 8) };
  };

  /**
   * Règlement d'une sélection une fois le match terminé.
   * r = { hg, ag, hthg?, htag? }. Renvoie 'won', 'lost', 'push', 'half-won',
   * 'half-lost' ou null si la sélection n'est pas vérifiable automatiquement.
   */
  /**
   * Paris liés aux minutes et à l'ordre des buts.
   * r.goals = [{ min, extra?, side: 'h' | 'a', type?: 'PG' | 'OG' | 'HD' | 'FK' | '' }]
   * (minute ESPN : « 15' » = de 14:00 à 14:59 ; temps additionnel dans 45 et 90).
   */
  function settleGoals(key, r) {
    const h = r.hg;
    const a = r.ag;
    let goals = r.goals;
    if (!Array.isArray(goals)) {
      if (h + a !== 0) return null;
      goals = [];
    }
    if (goals.length !== h + a) return null;
    goals = goals.slice().sort((x, y) => x.min - y.min || (x.extra || 0) - (y.extra || 0));
    const ok = (c) => (c ? 'won' : 'lost');
    const yn = (c, k) => ok(k === 'Y' ? c : !c);
    const any = (f) => goals.some(f);
    let m;
    if ((m = key.match(/^GB(\d+)([YN])$/))) return yn(any((g) => g.min <= +m[1]), m[2]);
    if ((m = key.match(/^GI(\d+)([YN])$/))) return yn(any((g) => g.min >= +m[1] && g.min <= +m[1] + 14), m[2]);
    if ((m = key.match(/^FT(\d+|N)$/))) {
      if (m[1] === 'N') return ok(!goals.length);
      if (!goals.length) return 'lost';
      const lo = +m[1] === 0 ? 1 : +m[1];
      return ok(goals[0].min >= lo && goals[0].min <= lo + (lo === 1 ? 14 : 14));
    }
    if ((m = key.match(/^R(\d+)_([1X2])$/))) {
      const X = +m[1];
      const gh = goals.filter((g) => g.min <= X && g.side === 'h').length;
      const ga = goals.filter((g) => g.min <= X && g.side === 'a').length;
      return ok((gh > ga ? '1' : gh === ga ? 'X' : '2') === m[2]);
    }
    if ((m = key.match(/^GL(\d+)([YN])$/))) return yn(any((g) => g.min > +m[1]), m[2]);
    if ((m = key.match(/^GST([12])([YN])$/))) {
      if (goals.some((g) => g.extra == null && (g.min === 45 || g.min === 90))) return null;
      const base = m[1] === '1' ? 45 : 90;
      return yn(any((g) => g.min === base && g.extra > 0), m[2]);
    }
    if ((m = key.match(/^T(15|76)_([12])([YN])$/))) {
      const side = m[2] === '1' ? 'h' : 'a';
      return yn(any((g) => g.side === side && (m[1] === '15' ? g.min <= 15 : g.min >= 76)), m[3]);
    }
    if ((m = key.match(/^(PG|OG)([YN])$/))) {
      if (goals.length && goals.every((g) => g.type == null)) return null;
      return yn(any((g) => g.type === m[1]), m[2]);
    }
    const first = goals[0] ? goals[0].side : null;
    const last = goals.length ? goals[goals.length - 1].side : null;
    const res = h > a ? '1' : h === a ? 'X' : '2';
    if ((m = key.match(/^([FL])G([012])$/))) {
      const sd = m[1] === 'F' ? first : last;
      return ok(m[2] === '0' ? !sd : sd === (m[2] === '1' ? 'h' : 'a'));
    }
    if (key === 'FR0') return ok(!first);
    if ((m = key.match(/^FR([12])_([1X2])$/))) return ok(first === (m[1] === '1' ? 'h' : 'a') && res === m[2]);
    if (key === 'FW0') return ok(!first);
    if (key === 'FWY' || key === 'FWN') {
      if (!first) return 'lost';
      const won = (first === 'h' && res === '1') || (first === 'a' && res === '2');
      return ok(key === 'FWY' ? won : !won);
    }
    // Rejoue le match but par but.
    let x = 0;
    let y = 0;
    let hl = false;
    let al = false;
    const race = { 2: null, 3: null };
    for (const g of goals) {
      if (g.side === 'h') x++;
      else y++;
      if (x > y) hl = true;
      if (y > x) al = true;
      for (const k of [2, 3]) if (!race[k]) race[k] = x === k ? '1' : y === k ? '2' : null;
    }
    if ((m = key.match(/^RA([23])_([012])$/))) return ok((race[m[1]] || '0') === m[2]);
    if (key === 'CB1') return ok(res === '1' && al);
    if (key === 'CB2') return ok(res === '2' && hl);
    if (key === 'BLY' || key === 'BLN') return ok((hl && al) === (key === 'BLY'));
    return null;
  }

  E.settle = function (key, r) {
    if (P.Stats && P.Stats.isKey(key)) return P.Stats.settle(key, r);
    const h = r.hg;
    const a = r.ag;
    if (!isFinite(h) || !isFinite(a)) return null;
    const t = h + a;
    const ok = (c) => (c ? 'won' : 'lost');
    const res = (x, y) => (x > y ? '1' : x === y ? 'X' : '2');
    const dc = (k, x, y) => (k === '1X' ? x >= y : k === '12' ? x !== y : x <= y);
    const cmp = (v, op, L) => (op === 'O' ? v > L : v < L);
    const btts = h > 0 && a > 0;
    let m;
    const simple = {
      '1': h > a, X: h === a, '2': h < a, '1X': h >= a, X2: h <= a, '12': h !== a,
      BTTS_Y: btts, BTTS_N: !btts, S1Y: h > 0, S1N: h === 0, S2Y: a > 0, S2N: a === 0,
      EVEN: t % 2 === 0, ODD: t % 2 === 1, WTN1: h > a && a === 0, WTN2: a > h && h === 0, CS1: a === 0, CS2: h === 0,
      E2Y: h >= 2 && a >= 2, E2N: !(h >= 2 && a >= 2), FH0: t === 0
    };
    if (key in simple) return ok(simple[key]);
    if (/^(GB\d|GI\d|FT|R\d|GL\d|GST|T15_|T76_|FG|LG|FR|FW|RA\d|CB\d|BL[YN]$|(PG|OG)[YN]$)/.test(key)) return settleGoals(key, r);
    if ((m = key.match(/^([OU])(\d+\.5)$/))) return ok(cmp(t, m[1], +m[2]));
    if (key === 'CSO') return ok(h > 5 || a > 5);
    if ((m = key.match(/^TG([12])_(\d)$/))) {
      const g = m[1] === '1' ? h : a;
      return ok(+m[2] === 4 ? g >= 4 : g === +m[2]);
    }
    if (/^CG/.test(key)) {
      const groups = {
        CG1: (h === 1 && a === 0) || (h === 2 && a === 0) || (h === 2 && a === 1), CG2: h === 3 && a <= 2, CG3: h - a >= 4,
        CGX: h === a && h <= 1, CGX2: h === a && h >= 2,
        CG4: (h === 0 && a === 1) || (h === 0 && a === 2) || (h === 1 && a === 2), CG5: a === 3 && h <= 2, CG6: a - h >= 4
      };
      return key in groups ? ok(groups[key]) : null;
    }
    if ((m = key.match(/^it([12])([OU])(\d+\.5)$/))) return ok(cmp(m[1] === '1' ? h : a, m[2], +m[3]));
    if ((m = key.match(/^EX(\d)$/))) return ok(+m[1] === 6 ? t >= 6 : t === +m[1]);
    if ((m = key.match(/^CS(\d+)-(\d+)$/))) return ok(h === +m[1] && a === +m[2]);
    if ((m = key.match(/^T3([OEU])(\d+)$/))) return ok(m[1] === 'O' ? t > +m[2] : m[1] === 'E' ? t === +m[2] : t < +m[2]);
    if ((m = key.match(/^MB(\d+)-(\d+)$/))) return ok(t >= +m[1] && t <= +m[2]);
    if ((m = key.match(/^EH([12X])([+-]\d+)$/))) {
      const v = h + +m[2];
      return ok(m[1] === '1' ? v > a : m[1] === 'X' ? v === a : v < a);
    }
    if ((m = key.match(/^MG(\d)$/))) {
      const d = h - a;
      return ok([d === 1, d === 2, d >= 3, d === 0, d === -1, d === -2, d <= -3][+m[1]]);
    }
    if ((m = key.match(/^RT([1X2])([OU])(\d+\.5)$/))) return ok(res(h, a) === m[1] && cmp(t, m[2], +m[3]));
    if ((m = key.match(/^RB([1X2])([YN])$/))) return ok(res(h, a) === m[1] && btts === (m[2] === 'Y'));
    if ((m = key.match(/^DT(1X|12|X2)([OU])(\d+\.5)$/))) return ok(dc(m[1], h, a) && cmp(t, m[2], +m[3]));
    if ((m = key.match(/^DB(1X|12|X2)([YN])$/))) return ok(dc(m[1], h, a) && btts === (m[2] === 'Y'));
    if ((m = key.match(/^B([TN])([OU])(\d+\.5)$/))) return ok(btts === (m[1] === 'T') && cmp(t, m[2], +m[3]));
    if (key === 'DNB1' || key === 'DNB2') return h === a ? 'push' : ok(key === 'DNB1' ? h > a : a > h);
    if ((m = key.match(/^AH([12])([+-][\d.]+)$/) || key.match(/^(AO|AU)()([\d.]+)$/))) {
      if (m[1] === '1' || m[1] === '2') m = ['', 'AH', m[1], m[2]];
      const L = parseFloat(m[3]);
      const parts = Math.abs(L * 4) % 2 === 1 ? [L - 0.25, L + 0.25] : [L];
      let score = 0;
      for (const x of parts) {
        let v;
        if (m[1] === 'AH') v = (m[2] === '1' ? h - a : a - h) + x;
        else if (m[1] === 'AO') v = t - x;
        else v = x - t;
        score += v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0;
      }
      if (parts.length === 2) return score === 2 ? 'won' : score === 1 ? 'half-won' : score === 0 ? 'push' : score === -1 ? 'half-lost' : 'lost';
      return score > 0 ? 'won' : score < 0 ? 'lost' : 'push';
    }

    // Paris liés aux mi-temps : il faut le score à la pause.
    const hh = r.hthg;
    const ha = r.htag;
    if (!isFinite(hh) || !isFinite(ha) || hh > h || ha > a) return null;
    const ht = hh + ha;
    const sh = h - hh;
    const sa = a - ha;
    const st = sh + sa;
    const half = { 1: [hh, sh], 2: [ha, sa] };
    const htSimple = {
      H1: hh > ha, HX: hh === ha, H2: hh < ha, H1X: hh >= ha, HX2: hh <= ha, H12: hh !== ha, HBY: hh > 0 && ha > 0, HBN: !(hh > 0 && ha > 0),
      HEVEN: ht % 2 === 0, HODD: ht % 2 === 1,
      S1: sh > sa, SX: sh === sa, S2: sh < sa, SBY: sh > 0 && sa > 0, SBN: !(sh > 0 && sa > 0),
      HSH1: ht > st, HSH2: st > ht, HSHX: ht === st, BHY: ht > 0 && st > 0, BHN: !(ht > 0 && st > 0),
      T1BH: hh > 0 && sh > 0, T2BH: ha > 0 && sa > 0, WE1: hh > ha || sh > sa, WE2: ha > hh || sa > sh,
      WB1: hh > ha && sh > sa, WB2: ha > hh && sa > sh, BBY: hh > 0 && ha > 0 && sh > 0 && sa > 0, BBN: !(hh > 0 && ha > 0 && sh > 0 && sa > 0),
      FH1: ht > 0, FH2: ht === 0 && t > 0
    };
    if (key in htSimple) return ok(htSimple[key]);
    if ((m = key.match(/^H([OU])(\d+\.5)$/))) return ok(cmp(ht, m[1], +m[2]));
    if ((m = key.match(/^H([12])([OU])(\d+\.5)$/))) return ok(cmp(half[m[1]][0], m[2], +m[3]));
    if ((m = key.match(/^S([OU])(\d+\.5)$/))) return ok(cmp(st, m[1], +m[2]));
    if ((m = key.match(/^S([12])([OU])(\d+\.5)$/))) return ok(cmp(half[m[1]][1], m[2], +m[3]));
    if ((m = key.match(/^HCS(\d+)-(\d+)$/))) return ok(hh === +m[1] && ha === +m[2]);
    if (key === 'HCSO') return ok(hh > 3 || ha > 3);
    if ((m = key.match(/^SCS(\d+)-(\d+)$/))) return ok(sh === +m[1] && sa === +m[2]);
    if (key === 'SCSO') return ok(sh > 3 || sa > 3);
    if ((m = key.match(/^HEX(\d)$/))) return ok(+m[1] === 3 ? ht >= 3 : ht === +m[1]);
    if ((m = key.match(/^HB2([YN])([YN])$/))) return ok((hh > 0 && ha > 0) === (m[1] === 'Y') && (sh > 0 && sa > 0) === (m[2] === 'Y'));
    if ((m = key.match(/^HAH([12])([+-]\d+\.5)$/))) return ok((m[1] === '1' ? hh - ha : ha - hh) + +m[2] > 0);
    if ((m = key.match(/^HF([12X])([12X])$/))) return ok(res(hh, ha) === m[1] && res(h, a) === m[2]);
    if ((m = key.match(/^TH([12])([12X])$/))) {
      const [g1, g2] = half[m[1]];
      return ok(m[2] === '1' ? g1 > g2 : m[2] === '2' ? g2 > g1 : g1 === g2);
    }
    return null;
  };

  /* --------------------------------------------------------------------- */
  /* Statistiques descriptives des données utilisées                         */
  /* --------------------------------------------------------------------- */

  E.describe = function (matches) {
    const ms = (matches || []).filter((m) => m && isFinite(m.gf) && isFinite(m.ga));
    const n = ms.length;
    const s = { n, w: 0, d: 0, l: 0, gf: 0, ga: 0, o15: 0, o25: 0, btts: 0, cs: 0, fts: 0, form: '' };
    for (const m of ms) {
      if (m.gf > m.ga) s.w++;
      else if (m.gf === m.ga) s.d++;
      else s.l++;
      s.form += m.gf > m.ga ? 'V' : m.gf === m.ga ? 'N' : 'D';
      s.gf += m.gf;
      s.ga += m.ga;
      if (m.gf + m.ga > 1.5) s.o15++;
      if (m.gf + m.ga > 2.5) s.o25++;
      if (m.gf > 0 && m.ga > 0) s.btts++;
      if (m.ga === 0) s.cs++;
      if (m.gf === 0) s.fts++;
    }
    return s;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
