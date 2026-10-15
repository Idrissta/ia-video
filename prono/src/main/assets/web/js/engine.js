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

  /** Paramètres par défaut (calibrés par tools/prono-backtest.js). */
  E.DEFAULTS = {
    homeAvg: 1.52,        // buts par match de l'équipe à domicile (moyenne de ligue)
    awayAvg: 1.19,        // buts par match de l'équipe à l'extérieur
    decay: 0.85,          // poids d'un match par rang d'ancienneté (le plus récent = 1)
    prior: 4,             // « matchs moyens » ajoutés en a priori (rétrécissement)
    oppAdjust: 0.6,       // correction par la force des adversaires (0 = aucune)
    h2hWeight: 0.25,      // poids des confrontations directes
    h2hHalfLife: 2.5,     // demi-vie (années) d'une confrontation directe
    rho: -0.07,           // correction Dixon-Coles
    htShare: 0.445,       // part des buts marqués en 1re mi-temps
    marketWeight: 0.6,    // poids des cotes dans la combinaison modèle + marché
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
  E.rating = function (matches, p, lg) {
    const mu = lg.mu;
    let attNum = 0;
    let defNum = 0;
    let den = 0;
    let n = 0;
    (matches || []).forEach((m, k) => {
      if (m == null || !isFinite(m.gf) || !isFinite(m.ga)) return;
      const w = Math.pow(p.decay, n);
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
      void k;
    });
    // Moyenne a posteriori gamma-Poisson : `prior` matchs moyens ajoutés.
    const att = (attNum + p.prior * mu) / ((den + p.prior) * mu);
    const def = (defNum + p.prior * mu) / ((den + p.prior) * mu);
    return { att, def, n, weight: den };
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
    const rh = E.rating(input.home.matches, p, lg);
    const ra = E.rating(input.away.matches, p, lg);
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
    const odds = input.odds || {};
    if (odds['1'] > 1 && odds.X > 1 && odds['2'] > 1) {
      const f = E.fairProbs([odds['1'], odds.X, odds['2']]);
      let pOver = null;
      if (odds['O2.5'] > 1 && odds['U2.5'] > 1) pOver = E.fairProbs([odds['O2.5'], odds['U2.5']])[0];
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
      totals.push(sel('O' + L, 'Plus de ' + L, 1 - under), sel('U' + L, 'Moins de ' + L, under));
    }
    add('total', 'Buts', 'Total de buts', totals);
    const atot = [];
    for (const L of [1.75, 2, 2.25, 2.75, 3, 3.25]) {
      const over = E.asian(totalDist.map(([v, pr]) => [v, pr]), -L);
      const under = E.asian(totalDist.map(([v, pr]) => [-v, pr]), L);
      atot.push(sel('AO' + L, 'Plus de ' + L, over.win + over.push / 2, { fair: over.fair, push: over.push, asian: over }),
        sel('AU' + L, 'Moins de ' + L, under.win + under.push / 2, { fair: under.fair, push: under.push, asian: under }));
    }
    add('atotal', 'Buts', 'Total asiatique', atot, 'Lignes .25/.75 : moitié gagnée ou remboursée');
    for (const [id, team, idx] of [['it1', H, 0], ['it2', A, 1]]) {
      const lam = idx === 0 ? lh : la;
      const marg = new Array(n + 1).fill(0);
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) marg[idx === 0 ? i : j] += ft[i][j];
      const s = [];
      for (const L of [0.5, 1.5, 2.5, 3.5]) {
        let u = 0;
        for (let k = 0; k < L; k++) u += marg[k];
        s.push(sel(id + 'O' + L, 'Plus de ' + L, 1 - u), sel(id + 'U' + L, 'Moins de ' + L, u));
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
      const even = sum((i, j) => (i + j) % 2 === 0);
      add('oddeven', 'Buts', 'Pair / Impair', [sel('EVEN', 'Pair', even), sel('ODD', 'Impair', 1 - even)]);
    }
    add('teamscore', 'Buts', 'Équipe marque', [
      sel('S1Y', H + ' marque', 1 - sum((i) => i === 0)), sel('S1N', H + ' ne marque pas', sum((i) => i === 0)),
      sel('S2Y', A + ' marque', 1 - sum((i, j) => j === 0)), sel('S2N', A + ' ne marque pas', sum((i, j) => j === 0))
    ]);

    // --- Handicaps
    const eh = [];
    for (const L of [-2, -1, 1, 2]) {
      const t = (L > 0 ? '+' : '') + L;
      eh.push(sel('EH1' + t, H + ' (' + t + ')', sum((i, j) => i + L > j)),
        sel('EHX' + t, 'Nul (' + t + ')', sum((i, j) => i + L === j)),
        sel('EH2' + t, A + ' (' + (L > 0 ? '-' : '+') + Math.abs(L) + ')', sum((i, j) => i + L < j)));
    }
    add('eh', 'Handicaps', 'Handicap européen', eh, 'Handicap appliqué à ' + H);
    const ah = [];
    for (const L of [-2.5, -2, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5]) {
      const r1 = E.asian(marginDist, L);
      const t = (L > 0 ? '+' : '') + L;
      ah.push(sel('AH1' + t, H + ' (' + t + ')', r1.win + r1.push / 2, { fair: r1.fair, push: r1.push, asian: r1 }));
      const r2 = E.asian(marginDist.map(([v, pr]) => [-v, pr]), -L);
      const t2 = (-L > 0 ? '+' : '') + -L;
      ah.push(sel('AH2' + t2, A + ' (' + t2 + ')', r2.win + r2.push / 2, { fair: r2.fair, push: r2.push, asian: r2 }));
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
        rt.push(sel('RT' + k + 'O' + L, lbl + ' et plus de ' + L, sum((i, j) => f(i, j) && i + j > L)));
        rt.push(sel('RT' + k + 'U' + L, lbl + ' et moins de ' + L, sum((i, j) => f(i, j) && i + j < L)));
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
        dt.push(sel('DT' + k + 'O' + L, k + ' et plus de ' + L, sum((i, j) => f(i, j) && i + j > L)));
        dt.push(sel('DT' + k + 'U' + L, k + ' et moins de ' + L, sum((i, j) => f(i, j) && i + j < L)));
      }
    }
    add('dctotal', 'Combinés', 'Double chance + Total', dt);
    add('wtn', 'Combinés', 'Gagne à zéro', [
      sel('WTN1', H + ' gagne sans encaisser', sum((i, j) => i > j && j === 0)),
      sel('WTN2', A + ' gagne sans encaisser', sum((i, j) => j > i && i === 0))
    ]);
    add('btotal', 'Combinés', 'Les deux marquent + Total', [
      sel('BTO2.5', 'Les deux marquent et plus de 2,5', sum((i, j) => i > 0 && j > 0 && i + j > 2.5)),
      sel('BTU2.5', 'Les deux marquent et moins de 2,5', sum((i, j) => i > 0 && j > 0 && i + j < 2.5)),
      sel('BNO2.5', 'Pas les deux et plus de 2,5', sum((i, j) => !(i > 0 && j > 0) && i + j > 2.5)),
      sel('BNU2.5', 'Pas les deux et moins de 2,5', sum((i, j) => !(i > 0 && j > 0) && i + j < 2.5))
    ]);

    // --- Score exact
    const cells = [];
    for (let i = 0; i <= Math.min(n, 6); i++) for (let j = 0; j <= Math.min(n, 6); j++) cells.push([i, j, ft[i][j]]);
    cells.sort((x, y) => y[2] - x[2]);
    add('cs', 'Score exact', 'Score exact', cells.slice(0, 16).map(([i, j, pr]) => sel('CS' + i + '-' + j, i + ' - ' + j, pr)));

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
      add('htcs', 'Mi-temps', '1re mi-temps · Score exact', c.slice(0, 8).map(([i, j, pr]) => sel('HCS' + i + '-' + j, i + ' - ' + j, pr)));
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
    {
      const none = ft[0][0];
      const first1 = (1 - none) * lh / (lh + la);
      add('firstgoal', 'Buts', 'Premier but', [sel('FG1', H, first1), sel('FG0', 'Aucun but', none), sel('FG2', A, 1 - none - first1)]);
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
    for (const c of all) {
      if (used.has(c.marketId) && out.length < 4) continue;
      used.add(c.marketId);
      c.level = c.p >= 0.75 ? 'Très probable' : c.p >= 0.62 ? 'Probable' : 'Risqué';
      out.push(c);
      if (out.length >= 6) break;
    }
    const values = [];
    for (const mk of res.markets) for (const s of mk.sels) if (s.ev != null && s.ev > 0.04 && s.p >= 0.2) values.push({ market: mk.name, label: s.label, p: s.p, odd: s.odd, ev: s.ev, fair: s.fair });
    values.sort((a, b) => b.ev - a.ev);
    return { main: out[0] || null, list: out, values: values.slice(0, 8) };
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
