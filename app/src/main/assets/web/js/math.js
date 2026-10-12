/*
 * Nova Graph — moteur mathématique.
 * Analyse lexicale et syntaxique, compilation en fonctions JavaScript,
 * bibliothèque numérique (intégrales, dérivées, gamma…) et formatage.
 */
(function (root) {
  'use strict';

  class MathError extends Error {
    constructor(message, missing) {
      super(message);
      this.missing = missing || null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Bibliothèque numérique                                              */
  /* ------------------------------------------------------------------ */

  const LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  function gamma(z) {
    if (Number.isInteger(z) && z <= 0) return NaN;
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    let a = LANCZOS[0];
    const t = z + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
  }

  const FACT = [1];
  for (let i = 1; i <= 170; i++) FACT[i] = FACT[i - 1] * i;

  function fact(n) {
    if (Number.isInteger(n)) return n < 0 ? NaN : n > 170 ? Infinity : FACT[n];
    return gamma(n + 1);
  }

  // Approximation rationnelle exacte (fractions continues), ou null.
  function ratApprox(x, maxDen, tol) {
    if (!Number.isFinite(x)) return null;
    tol = tol || 1e-12;
    let h0 = 0, h1 = 1, k0 = 1, k1 = 0, v = x;
    for (let i = 0; i < 32; i++) {
      const a = Math.floor(v);
      const h2 = a * h1 + h0, k2 = a * k1 + k0;
      if (k2 > maxDen) break;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (Math.abs(x - h1 / k1) <= tol * Math.max(1, Math.abs(x))) return [h1, k1];
      const fr = v - a;
      if (fr < 1e-15) break;
      v = 1 / fr;
    }
    return null;
  }

  // Puissance réelle : (-8)^(1/3) = -2, comme sur une calculatrice graphique.
  function pow(a, b) {
    if (a >= 0 || Number.isInteger(b) || !Number.isFinite(a) || !Number.isFinite(b)) return Math.pow(a, b);
    const fr = ratApprox(b, 999);
    if (fr && Math.abs(fr[1] % 2) === 1) {
      const r = Math.pow(-a, b);
      return Math.abs(fr[0] % 2) === 1 ? -r : r;
    }
    return NaN;
  }

  function gcd2(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }

  function nCr(n, k) {
    if (Number.isInteger(n) && Number.isInteger(k)) {
      if (k < 0 || n < 0 || k > n) return 0;
      k = Math.min(k, n - k);
      let r = 1;
      for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
      return Math.round(r);
    }
    return gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1));
  }

  function nPr(n, k) {
    if (Number.isInteger(n) && Number.isInteger(k)) {
      if (k < 0 || n < 0 || k > n) return 0;
      let r = 1;
      for (let i = 0; i < k; i++) r *= n - i;
      return r;
    }
    return gamma(n + 1) / gamma(n - k + 1);
  }

  // Intégration adaptative de Gauss–Kronrod (7–15 points).
  const XGK = [0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440,
    0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0];
  const WGK = [0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919,
    0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828];
  const WG = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];

  function gk15(f, a, b) {
    const c = (a + b) / 2, h = (b - a) / 2;
    const fc = f(c);
    let rk = fc * WGK[7], rg = fc * WG[3];
    for (let j = 0; j < 7; j++) {
      const dx = h * XGK[j];
      const s = f(c - dx) + f(c + dx);
      rk += WGK[j] * s;
      if (j % 2 === 1) rg += WG[(j - 1) / 2] * s;
    }
    return [rk * h, Math.abs((rk - rg) * h)];
  }

  function integrate(f, a, b) {
    if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
    if (a === b) return 0;
    let sign = 1;
    if (a > b) { const t = a; a = b; b = t; sign = -1; }
    let g = f;
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      // Bornes infinies : x = tan(u)
      g = (u) => { const c = Math.cos(u); return f(Math.tan(u)) / (c * c); };
      a = Math.atan(a); b = Math.atan(b);
    }
    const first = gk15(g, a, b);
    const segs = [[a, b, first[0], first[1]]];
    let total = first[0], err = first[1];
    for (let it = 0; it < 250; it++) {
      if (!(err > Math.max(1e-12, 1e-10 * Math.abs(total)))) break;
      let idx = 0;
      for (let i = 1; i < segs.length; i++) if (segs[i][3] > segs[idx][3]) idx = i;
      const [sa, sb, sr, se] = segs[idx];
      const m = (sa + sb) / 2;
      const r1 = gk15(g, sa, m), r2 = gk15(g, m, sb);
      segs[idx] = [sa, m, r1[0], r1[1]];
      segs.push([m, sb, r2[0], r2[1]]);
      total += r1[0] + r2[0] - sr;
      err += r1[1] + r2[1] - se;
    }
    total = 0;
    for (const s of segs) total += s[2];
    return sign * total;
  }

  function series(f, a, b, prod) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    a = Math.round(a); b = Math.round(b);
    if (b - a > 1e6) return NaN;
    let s = prod ? 1 : 0;
    for (let k = a; k <= b; k++) s = prod ? s * f(k) : s + f(k);
    return s;
  }

  // Dérivée numérique d'ordre n (différences centrées à 5 points).
  function der(f, x, n) {
    if (!(n > 0)) return f(x);
    if (n === 1) {
      const h = 1e-3 * Math.max(1, Math.abs(x));
      return (f(x - 2 * h) - 8 * f(x - h) + 8 * f(x + h) - f(x + 2 * h)) / (12 * h);
    }
    if (n === 2) {
      const h = 1e-2 * Math.max(1, Math.abs(x));
      return (-f(x + 2 * h) + 16 * f(x + h) - 30 * f(x) + 16 * f(x - h) - f(x - 2 * h)) / (12 * h * h);
    }
    return der((t) => der(f, t, n - 1), x, 1);
  }

  const CONSTS = { pi: Math.PI, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2, inf: Infinity };

  // Les résultats trigonométriques quasi nuls (sin π) sont ramenés à 0.
  function snap(r, a) {
    return Math.abs(a) >= 1 && Math.abs(r) < 4e-16 * Math.abs(a) ? 0 : r;
  }

  const M = {
    ak: 1, // facteur d'angle : 1 en radians, π/180 en degrés
    C: CONSTS,
    E: Math.E,
    pow, fact, gamma, nCr, nPr, der, integrate,
    int: integrate,
    sum: (f, a, b) => series(f, a, b, false),
    prod: (f, a, b) => series(f, a, b, true),
    sin: (a) => { const r = a * M.ak; return snap(Math.sin(r), r); },
    cos: (a) => { const r = a * M.ak; return snap(Math.cos(r), r); },
    tan: (a) => { const r = a * M.ak; return snap(Math.tan(r), r); },
    sec: (a) => 1 / M.cos(a),
    csc: (a) => 1 / M.sin(a),
    cot: (a) => 1 / M.tan(a),
    asin: (a) => Math.asin(a) / M.ak,
    acos: (a) => Math.acos(a) / M.ak,
    atan: (a, b) => (b === undefined ? Math.atan(a) : Math.atan2(a, b)) / M.ak,
    asec: (a) => Math.acos(1 / a) / M.ak,
    acsc: (a) => Math.asin(1 / a) / M.ak,
    acot: (a) => (a === 0 ? Math.PI / 2 : Math.atan(1 / a)) / M.ak,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    ln: Math.log,
    log: (a, b) => (b === undefined ? Math.log10(a) : Math.log(a) / Math.log(b)),
    log2: Math.log2,
    exp: Math.exp,
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    root: (a, n) => (a < 0 && Number.isInteger(n) && Math.abs(n % 2) === 1 ? -Math.pow(-a, 1 / n) : Math.pow(a, 1 / n)),
    abs: Math.abs,
    sign: Math.sign,
    floor: Math.floor,
    ceil: Math.ceil,
    round: (a, n) => { if (!n) return Math.round(a); const p = Math.pow(10, Math.round(n)); return Math.round(a * p) / p; },
    min: Math.min,
    max: Math.max,
    hypot: Math.hypot,
    mod: (a, b) => a - b * Math.floor(a / b),
    gcd: (...xs) => xs.reduce(gcd2),
    lcm: (...xs) => xs.reduce((a, b) => { const g = gcd2(a, b); return g ? Math.abs(Math.round(a) * Math.round(b)) / g : 0; }),
  };

  /* ------------------------------------------------------------------ */
  /* Analyse lexicale                                                    */
  /* ------------------------------------------------------------------ */

  const FUNC_ARITY = {
    sin: [1, 1], cos: [1, 1], tan: [1, 1], sec: [1, 1], csc: [1, 1], cot: [1, 1],
    asin: [1, 1], acos: [1, 1], atan: [1, 2], asec: [1, 1], acsc: [1, 1], acot: [1, 1],
    sinh: [1, 1], cosh: [1, 1], tanh: [1, 1], asinh: [1, 1], acosh: [1, 1], atanh: [1, 1],
    ln: [1, 1], log: [1, 2], log2: [1, 1], exp: [1, 1],
    sqrt: [1, 1], cbrt: [1, 1], root: [2, 2], abs: [1, 1], sign: [1, 1],
    floor: [1, 1], ceil: [1, 1], round: [1, 2],
    min: [1, Infinity], max: [1, Infinity], hypot: [1, Infinity],
    mod: [2, 2], gcd: [1, Infinity], lcm: [1, Infinity],
    nCr: [2, 2], nPr: [2, 2], gamma: [1, 1],
    int: [3, 4], sum: [3, 4], prod: [3, 4],
  };
  const BINDERS = { int: true, sum: true, prod: true };
  const ALIASES = {
    arcsin: 'asin', arccos: 'acos', arctan: 'atan', Arcsin: 'asin', Arccos: 'acos', Arctan: 'atan',
    arsinh: 'asinh', arcosh: 'acosh', artanh: 'atanh', sgn: 'sign', log10: 'log', cotan: 'cot',
  };
  const INVERSE = { sin: 'asin', cos: 'acos', tan: 'atan', sec: 'asec', csc: 'acsc', cot: 'acot', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };
  const WORD_IDS = ['pi', 'tau', 'phi', 'inf', 'theta', 'Ans'];
  const NAMES = Object.keys(FUNC_ARITY).concat(Object.keys(ALIASES), WORD_IDS).sort((a, b) => b.length - a.length);
  const SLOT_JS = { x: 'x', y: 'y', t: 't', theta: 'th' };

  const SUPERS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };

  function normalize(s) {
    return s
      .replace(/[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => '^(' + Array.from(m, (c) => SUPERS[c]).join('') + ')')
      .replace(/[×·∙⋅]/g, '*')
      .replace(/÷/g, '/')
      .replace(/[−–—]/g, '-')
      .replace(/π/g, 'pi')
      .replace(/θ/g, 'theta')
      .replace(/τ/g, 'tau')
      .replace(/φ/g, 'phi')
      .replace(/∞/g, 'inf')
      .replace(/≤/g, '<=')
      .replace(/≥/g, '>=')
      .replace(/∫/g, 'int')
      .replace(/[Σ∑]/g, 'sum')
      .replace(/∏/g, 'prod')
      .replace(/[′’]/g, "'");
  }

  const isLetter = (c) => /[A-Za-zα-ωΑ-Ω]/.test(c);

  function tokenize(src) {
    const s = normalize(src);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^(\d+\.?\d*|\.\d+)((?:ᴇ|E)[+-]?\d+)?/.exec(s.slice(i));
        if (!m) throw new MathError('Nombre invalide');
        out.push({ t: 'num', v: parseFloat(m[1] + (m[2] ? 'e' + m[2].slice(1) : '')) });
        i += m[0].length;
        continue;
      }
      if (s.startsWith('d/dx', i)) { out.push({ t: 'ddx' }); i += 4; continue; }
      if (isLetter(c)) {
        let word = null;
        for (const n of NAMES) if (s.startsWith(n, i)) { word = n; break; }
        if (word) {
          i += word.length;
          const name = ALIASES[word] || word;
          if (FUNC_ARITY[name]) out.push({ t: 'fn', v: name });
          else out.push({ t: 'id', v: name, prime: 0 });
          continue;
        }
        let name = c;
        i++;
        if (s[i] === '_') {
          let j = i + 1;
          const brace = s[j] === '{';
          if (brace) j++;
          let k = j;
          while (k < s.length && /[A-Za-z0-9]/.test(s[k])) k++;
          if (k > j) { name += '_' + s.slice(j, k); i = brace && s[k] === '}' ? k + 1 : k; }
        }
        let prime = 0;
        while (s[i] === "'") { prime++; i++; }
        out.push({ t: 'id', v: name, prime });
        continue;
      }
      const two = s.substr(i, 2);
      if (two === '<=' || two === '>=') { out.push({ t: 'rel', v: two }); i += 2; continue; }
      if (two === '**') { out.push({ t: 'op', v: '^' }); i += 2; continue; }
      if ('+-*/^'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      if (c === '=' || c === '<' || c === '>') { out.push({ t: 'rel', v: c }); i++; continue; }
      if (c === '(' || c === '[') { out.push({ t: '(' }); i++; continue; }
      if (c === ')' || c === ']') { out.push({ t: ')' }); i++; continue; }
      if (c === ',' || c === ';') { out.push({ t: ',' }); i++; continue; }
      if (c === '|' || c === '!' || c === '%') { out.push({ t: c }); i++; continue; }
      if (c === '√') { out.push({ t: 'root', v: 'sqrt' }); i++; continue; }
      if (c === '∛') { out.push({ t: 'root', v: 'cbrt' }); i++; continue; }
      throw new MathError('Caractère inattendu « ' + c + ' »');
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Analyse syntaxique                                                  */
  /* ------------------------------------------------------------------ */

  function tokText(k) {
    if (k.t === 'num') return String(k.v);
    if (k.t === 'ddx') return 'd/dx';
    return k.v !== undefined ? String(k.v) : k.t;
  }

  function isMinusOne(n) {
    return (n.k === 'num' && n.v === -1) || (n.k === 'neg' && n.a.k === 'num' && n.a.v === 1);
  }

  function parse(src) {
    const toks = tokenize(src);
    if (!toks.length) return null;
    let pos = 0;
    let absDepth = 0;
    const peek = () => toks[pos];
    const at = (t, v) => { const k = toks[pos]; return !!k && k.t === t && (v === undefined || k.v === v); };

    function unexpected() {
      const k = toks[pos];
      if (!k) return new MathError('Expression incomplète');
      return new MathError('« ' + tokText(k) + ' » inattendu');
    }
    function expectClose() {
      if (at(')')) { pos++; return; }
      if (pos >= toks.length) return; // parenthèse fermée implicitement en fin de saisie
      throw unexpected();
    }
    function startsOperand(k) {
      if (!k) return false;
      return k.t === 'num' || k.t === 'id' || k.t === 'fn' || k.t === '(' || k.t === 'root' ||
        k.t === 'ddx' || (k.t === '|' && absDepth === 0);
    }

    function parseTop() {
      const a = parseExpr();
      if (at('rel')) {
        const op = toks[pos++].v;
        const b = parseExpr();
        if (at('rel')) throw new MathError('Une seule relation par expression');
        if (pos < toks.length) throw unexpected();
        return { k: 'rel', op, a, b };
      }
      if (pos < toks.length) throw unexpected();
      return a;
    }
    function parseExpr() {
      let a = parseMul();
      while (at('op', '+') || at('op', '-')) {
        const op = toks[pos++].v;
        a = { k: 'bin', op, a, b: parseMul() };
      }
      return a;
    }
    function parseMul() {
      let a = parseUnary();
      for (;;) {
        if (at('op', '*') || at('op', '/')) {
          const op = toks[pos++].v;
          a = { k: 'bin', op, a, b: parseUnary() };
        } else if (startsOperand(peek())) {
          a = { k: 'bin', op: '*', a, b: parsePow(), imp: true };
        } else break;
      }
      return a;
    }
    function parseUnary() {
      if (at('op', '-')) { pos++; return { k: 'neg', a: parseUnary() }; }
      if (at('op', '+')) { pos++; return parseUnary(); }
      return parsePow();
    }
    function parsePow() {
      const base = parsePostfix();
      if (at('op', '^')) {
        pos++;
        return { k: 'bin', op: '^', a: base, b: parseUnary() };
      }
      return base;
    }
    function parsePostfix() {
      let a = parsePrimary();
      for (;;) {
        if (at('!')) { pos++; a = { k: 'fact', a }; } else if (at('%')) { pos++; a = { k: 'pct', a }; } else break;
      }
      return a;
    }
    function parseArgs() {
      const save = absDepth;
      absDepth = 0;
      const args = [];
      if (at(')')) { pos++; absDepth = save; return args; }
      for (;;) {
        args.push(parseExpr());
        if (at(',')) { pos++; continue; }
        expectClose();
        absDepth = save;
        return args;
      }
    }
    function parseChain() {
      // argument d'une fonction sans parenthèses : sin 2x, ln x
      let neg = false;
      if (at('op', '-')) { pos++; neg = true; }
      if (!startsOperand(peek())) throw unexpected();
      let a = parsePow();
      while (startsOperand(peek()) && !at('fn')) a = { k: 'bin', op: '*', a, b: parsePow(), imp: true };
      return neg ? { k: 'neg', a } : a;
    }
    function parseFn(name) {
      let power = null;
      if (at('op', '^')) {
        pos++;
        if (at('op', '-')) { pos++; power = { k: 'neg', a: parsePostfix() }; } else power = parsePostfix();
        if (isMinusOne(power) && INVERSE[name]) { name = INVERSE[name]; power = null; }
      }
      let args;
      if (at('(')) { pos++; args = parseArgs(); } else args = [parseChain()];
      let node = { k: 'call', n: name, args, bi: true };
      if (power) node = { k: 'bin', op: '^', a: node, b: power };
      return node;
    }
    function parsePrimary() {
      const k = toks[pos++];
      if (!k) throw new MathError('Expression incomplète');
      switch (k.t) {
        case 'num': return { k: 'num', v: k.v };
        case '(': {
          const save = absDepth;
          absDepth = 0;
          const items = [parseExpr()];
          while (at(',')) { pos++; items.push(parseExpr()); }
          expectClose();
          absDepth = save;
          if (items.length > 1) return { k: 'tuple', items };
          items[0].p = true;
          return items[0];
        }
        case '|': {
          absDepth++;
          const e = parseExpr();
          absDepth--;
          if (at('|')) pos++;
          else if (pos < toks.length) throw new MathError('Barre « | » fermante attendue');
          return { k: 'call', n: 'abs', args: [e], bi: true, bars: true };
        }
        case 'root': {
          const e = at('(') ? parsePrimary() : parsePow();
          return { k: 'call', n: k.v, args: [e], bi: true, sym: true };
        }
        case 'ddx': {
          const e = at('(') ? parsePrimary() : parsePow();
          return { k: 'ddx', a: e };
        }
        case 'fn': return parseFn(k.v);
        case 'id': {
          if (at('(')) {
            pos++;
            return { k: 'call', n: k.v, args: parseArgs(), prime: k.prime, bi: false };
          }
          if (k.prime) throw new MathError(k.v + '′ doit être suivi d’un argument, ex. ' + k.v + '′(x)');
          return { k: 'var', n: k.v };
        }
        default:
          pos--;
          throw unexpected();
      }
    }
    return parseTop();
  }

  /* ------------------------------------------------------------------ */
  /* Analyse sémantique et compilation                                   */
  /* ------------------------------------------------------------------ */

  function isConstName(n) { return n === 'e' || Object.prototype.hasOwnProperty.call(CONSTS, n); }

  function rawVars(ast, out) {
    out = out || new Set();
    (function walk(n) {
      if (n.k === 'var') out.add(n.n);
      if (n.a) walk(n.a);
      if (n.b) walk(n.b);
      if (n.items) n.items.forEach(walk);
      if (n.args) n.args.forEach(walk);
    })(ast);
    return out;
  }

  function binderParts(n) {
    const a = n.args;
    if (a.length === 4) {
      if (a[1].k !== 'var') throw new MathError('Le 2ᵉ argument de ' + n.n + ' doit être une variable');
      return { v: a[1].n, body: a[0], lims: [a[2], a[3]] };
    }
    if (a.length !== 3) throw new MathError(n.n + ' attend (expression, début, fin)');
    const used = rawVars(a[0]);
    const prefs = n.n === 'int' ? ['x', 't', 'u', 'theta'] : ['n', 'k', 'i', 'j'];
    return { v: prefs.find((p) => used.has(p)) || prefs[0], body: a[0], lims: [a[1], a[2]] };
  }

  // Symboles libres : variables et appels de fonctions utilisateur.
  function symbols(ast, isFunc, bound0) {
    const vars = new Set(), calls = new Set();
    isFunc = isFunc || (() => false);
    (function walk(n, bound) {
      switch (n.k) {
        case 'num': return;
        case 'var':
          if (!bound.has(n.n) && !isConstName(n.n)) vars.add(n.n);
          return;
        case 'neg': case 'fact': case 'pct': case 'ddx':
          walk(n.a, bound); return;
        case 'bin': case 'rel':
          walk(n.a, bound); walk(n.b, bound); return;
        case 'tuple':
          n.items.forEach((c) => walk(c, bound)); return;
        case 'call': {
          if (n.bi && BINDERS[n.n]) {
            const p = binderParts(n);
            p.lims.forEach((c) => walk(c, bound));
            const nb = new Set(bound);
            nb.add(p.v);
            walk(p.body, nb);
            return;
          }
          if (!n.bi && !bound.has(n.n)) {
            if (isFunc(n.n)) calls.add(n.n); else vars.add(n.n);
          }
          n.args.forEach((c) => walk(c, bound));
        }
      }
    })(ast, bound0 || new Set());
    return { vars, calls };
  }

  const PRETTY_NAME = { theta: 'θ', pi: 'π', tau: 'τ', phi: 'φ' };
  const pName = (n) => PRETTY_NAME[n] || n;

  function arityMsg(name, lo, hi) {
    if (lo === hi) return name + ' attend ' + lo + ' argument' + (lo > 1 ? 's' : '');
    if (hi === Infinity) return name + ' attend au moins ' + lo + ' argument' + (lo > 1 ? 's' : '');
    return name + ' attend ' + lo + ' à ' + hi + ' arguments';
  }

  /**
   * Compile un AST en code JavaScript.
   * env = { scope: {nom: identifiantJS}, slots: Set, vars: Set, funcs: Map(nom → arité) }
   */
  function compile(ast, env) {
    const missing = new Set();
    let uid = 0;

    function v(name, sc) {
      if (sc[name] !== undefined) return sc[name];
      if (name === 'e') return 'M.E';
      if (Object.prototype.hasOwnProperty.call(CONSTS, name)) return 'M.C.' + name;
      if (SLOT_JS[name]) {
        if (env.slots && env.slots.has(name)) return SLOT_JS[name];
        throw new MathError(pName(name) + ' n’est pas utilisable ici');
      }
      if (env.vars && env.vars.has(name)) return 'V[' + JSON.stringify(name) + ']';
      if (name === 'r') throw new MathError('r est réservé aux courbes polaires (r = …)');
      missing.add(name);
      return 'NaN';
    }

    function call(n, sc) {
      const name = n.n, args = n.args;
      if (n.bi) {
        const ar = FUNC_ARITY[name];
        if (args.length < ar[0] || args.length > ar[1]) throw new MathError(arityMsg(name, ar[0], ar[1]));
        if (BINDERS[name]) {
          const p = binderParts(n);
          const id = '_b' + uid++;
          const inner = Object.assign({}, sc);
          inner[p.v] = id;
          return 'M.' + name + '(function(' + id + '){return ' + c(p.body, inner) + ';},' +
            c(p.lims[0], sc) + ',' + c(p.lims[1], sc) + ')';
        }
        return 'M.' + name + '(' + args.map((a) => c(a, sc)).join(',') + ')';
      }
      if (sc[name] === undefined && env.funcs && env.funcs.has(name)) {
        const ar = env.funcs.get(name);
        if (args.length !== ar) throw new MathError(name + ' attend ' + ar + ' argument' + (ar > 1 ? 's' : ''));
        const key = 'U[' + JSON.stringify(name) + ']';
        if (n.prime) {
          if (ar !== 1) throw new MathError('La dérivée ' + name + '′ demande une fonction à une variable');
          return 'M.der(' + key + ',' + c(args[0], sc) + ',' + n.prime + ')';
        }
        return key + '(' + args.map((a) => c(a, sc)).join(',') + ')';
      }
      if (n.prime) throw new MathError(name + ' n’est pas une fonction définie');
      if (args.length === 1) return '(' + v(name, sc) + '*' + c(args[0], sc) + ')';
      throw new MathError(name + ' n’est pas une fonction définie');
    }

    function c(n, sc) {
      switch (n.k) {
        case 'num': return String(n.v);
        case 'var': return v(n.n, sc);
        case 'neg': return '(-' + c(n.a, sc) + ')';
        case 'bin':
          if (n.op === '^') return 'M.pow(' + c(n.a, sc) + ',' + c(n.b, sc) + ')';
          return '(' + c(n.a, sc) + n.op + c(n.b, sc) + ')';
        case 'fact': return 'M.fact(' + c(n.a, sc) + ')';
        case 'pct': return '(' + c(n.a, sc) + '/100)';
        case 'ddx': {
          const outer = v('x', sc);
          const id = '_d' + uid++;
          const inner = Object.assign({}, sc, { x: id });
          return 'M.der(function(' + id + '){return ' + c(n.a, inner) + ';},' + outer + ',1)';
        }
        case 'call': return call(n, sc);
        case 'tuple': throw new MathError('Point inattendu ici');
        case 'rel': throw new MathError('Relation inattendue ici');
      }
      throw new MathError('Expression invalide');
    }

    const code = c(ast, env.scope || {});
    if (missing.size) {
      const list = Array.from(missing);
      throw new MathError(
        list.length === 1 ? '« ' + list[0] + ' » n’est pas défini' : 'Non définis : ' + list.join(', '),
        list,
      );
    }
    return code;
  }

  function build(code, params) {
    // eslint-disable-next-line no-new-func
    return new Function('M', 'V', 'U', '"use strict";return function(' + params.join(',') + '){return ' + code + ';};');
  }

  // Évalue une expression constante (sans variable de tracé).
  function evaluate(src, V, U, env) {
    const ast = typeof src === 'string' ? parse(src) : src;
    if (!ast) throw new MathError('Expression vide');
    const code = compile(ast, Object.assign({ slots: null }, env || {}));
    return build(code, [])(M, V || {}, U || {})();
  }

  function setAngleMode(mode) { M.ak = mode === 'deg' ? Math.PI / 180 : 1; }

  /* ------------------------------------------------------------------ */
  /* Formatage                                                           */
  /* ------------------------------------------------------------------ */

  const SUP_DIGITS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '+': '' };
  const toSup = (s) => Array.from(String(s), (c) => SUP_DIGITS[c] !== undefined ? SUP_DIGITS[c] : c).join('');
  const minus = (s) => s.replace(/-/g, '−');

  function stripZeros(s) {
    return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
  }

  function fmt(v, digits) {
    digits = digits || 12;
    if (typeof v !== 'number') return String(v);
    if (Number.isNaN(v)) return 'indéfini';
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '−∞';
    if (v === 0) return '0';
    const a = Math.abs(v);
    const r = parseFloat(v.toPrecision(digits));
    if (a >= 1e15 || a < 1e-6) {
      const parts = r.toExponential(digits - 1).split('e');
      return minus(stripZeros(parts[0]) + '×10' + toSup(parseInt(parts[1], 10)));
    }
    return minus(String(r));
  }

  // Formatage adapté à la résolution d'affichage (coordonnées du graphe).
  function fmtAt(v, scale) {
    if (!Number.isFinite(v)) return fmt(v);
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e7 || a < 1e-5)) return fmt(v, 5);
    const d = Math.max(0, Math.min(10, Math.ceil(Math.log10(scale * 20))));
    let s = v.toFixed(d);
    s = stripZeros(s);
    if (s === '-0') s = '0';
    return minus(s);
  }

  // Fraction ou multiple de π, si le nombre en est un (sinon null).
  function toFraction(v) {
    if (!Number.isFinite(v) || Number.isInteger(v)) return null;
    const f = ratApprox(v, 10000, 1e-11);
    if (f && f[1] > 1) return minus(f[0] + '/' + f[1]);
    const g = ratApprox(v / Math.PI, 360, 1e-11);
    if (g) {
      const num = g[0] === 1 ? 'π' : g[0] === -1 ? '−π' : minus(g[0] + 'π');
      return g[1] === 1 ? num : num + '/' + g[1];
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Rendu « joli » en HTML                                              */
  /* ------------------------------------------------------------------ */

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const REL_HTML = { '=': '=', '<': '&lt;', '>': '&gt;', '<=': '≤', '>=': '≥' };
  const FN_HTML = {
    asin: 'sin<sup>−1</sup>', acos: 'cos<sup>−1</sup>', atan: 'tan<sup>−1</sup>',
    asinh: 'sinh<sup>−1</sup>', acosh: 'cosh<sup>−1</sup>', atanh: 'tanh<sup>−1</sup>',
    asec: 'sec<sup>−1</sup>', acsc: 'csc<sup>−1</sup>', acot: 'cot<sup>−1</sup>',
    log2: 'log<sub>2</sub>',
  };

  let supDepth = 0;

  function prec(n) {
    switch (n.k) {
      case 'rel': return 0;
      case 'bin':
        if (n.op === '+' || n.op === '-') return 1;
        if (n.op === '^') return 4;
        if (n.op === '/') return supDepth ? 2 : 6;
        return 2;
      case 'neg': return 3;
      case 'fact': case 'pct': return 5;
      default: return 6;
    }
  }

  function numHTML(v) {
    if (!Number.isFinite(v)) return v > 0 ? '∞' : 'indéfini';
    let s = String(v);
    if (/e/.test(s)) {
      const p = s.split('e');
      return p[0] + '×10<sup>' + minus(String(parseInt(p[1], 10))) + '</sup>';
    }
    return s;
  }

  function varHTML(name) {
    if (name === 'pi') return '<span class="mc">π</span>';
    if (name === 'inf') return '<span class="mc">∞</span>';
    if (name === 'Ans') return '<span class="mf">Ans</span>';
    const pretty = pName(name);
    const sub = pretty.indexOf('_');
    if (sub > 0) return '<i class="mv">' + esc(pretty.slice(0, sub)) + '</i><sub>' + esc(pretty.slice(sub + 1)) + '</sub>';
    return '<i class="mv">' + esc(pretty) + '</i>';
  }

  function toHTML(ast) {
    function wrap(n, need) {
      const h = H(n);
      return need || n.p ? '<span class="mp">(</span>' + h + '<span class="mp">)</span>' : h;
    }
    function bare(n) { return H(n); }
    function args(list) { return list.map(bare).join(', '); }
    function H(n) {
      switch (n.k) {
        case 'num': return '<span class="mn">' + numHTML(n.v) + '</span>';
        case 'var': return varHTML(n.n);
        case 'neg': return '−' + wrap(n.a, prec(n.a) < 3);
        case 'fact': return wrap(n.a, prec(n.a) < 6) + '!';
        case 'pct': return wrap(n.a, prec(n.a) < 6) + '%';
        case 'tuple': return '(' + args(n.items) + ')';
        case 'rel': return H(n.a) + '<span class="mo">' + REL_HTML[n.op] + '</span>' + H(n.b);
        case 'ddx':
          return '<span class="frac"><span>d</span><span>d<i class="mv">x</i></span></span>' + wrap(n.a, prec(n.a) < 6);
        case 'bin': {
          if (n.op === '/') {
            if (supDepth) return wrap(n.a, prec(n.a) < 2) + '/' + wrap(n.b, prec(n.b) < 3);
            return '<span class="frac"><span>' + bare(n.a) + '</span><span>' + bare(n.b) + '</span></span>';
          }
          if (n.op === '^') {
            const atomic = n.a.k === 'var' || (n.a.k === 'num' && !n.a.p) || (n.a.k === 'call' && !n.a.sym);
            supDepth++;
            const exp = bare(n.b);
            supDepth--;
            return wrap(n.a, !atomic) + '<sup>' + exp + '</sup>';
          }
          if (n.op === '*') {
            const l = wrap(n.a, prec(n.a) < 2);
            const r = wrap(n.b, prec(n.b) < 3);
            const dot = !n.imp || (n.b.k === 'num' && !n.b.p) || n.b.k === 'neg';
            return l + (dot ? '<span class="mo">·</span>' : '<span class="mi"></span>') + r;
          }
          const r = wrap(n.b, n.op === '-' ? prec(n.b) <= 1 : prec(n.b) < 1);
          return H(n.a) + '<span class="mo">' + (n.op === '-' ? '−' : '+') + '</span>' + r;
        }
        case 'call': {
          const name = n.n;
          if (n.bi) {
            if (name === 'sqrt' || name === 'cbrt') {
              const idx = name === 'cbrt' ? '<sup class="ridx">3</sup>' : '';
              return '<span class="msqrt">' + idx + '<span class="rad">√</span><span class="rbody">' + bare(n.args[0]) + '</span></span>';
            }
            if (name === 'root') {
              return '<span class="msqrt"><sup class="ridx">' + bare(n.args[1]) + '</sup><span class="rad">√</span><span class="rbody">' + bare(n.args[0]) + '</span></span>';
            }
            if (name === 'abs') return '<span class="mp">|</span>' + bare(n.args[0]) + '<span class="mp">|</span>';
            if (name === 'floor') return '⌊' + bare(n.args[0]) + '⌋';
            if (name === 'ceil') return '⌈' + bare(n.args[0]) + '⌉';
            if (BINDERS[name]) {
              let p;
              try { p = binderParts(n); } catch (e) { p = null; }
              if (p) {
                const sym = name === 'int' ? '∫' : name === 'sum' ? 'Σ' : '∏';
                const lim = '<span class="mlim"><span>' + bare(p.lims[1]) + '</span><span>' + bare(p.lims[0]) + '</span></span>';
                if (name === 'int') return '<span class="mbig">∫</span>' + lim + wrap(p.body, prec(p.body) < 2) + '<span class="mi"></span>d' + varHTML(p.v);
                return '<span class="mbig">' + sym + '</span><span class="mlim"><span>' + bare(p.lims[1]) + '</span><span>' + varHTML(p.v) + '=' + bare(p.lims[0]) + '</span></span>' + wrap(p.body, prec(p.body) < 2);
              }
            }
            return '<span class="mf">' + (FN_HTML[name] || name) + '</span><span class="mp">(</span>' + args(n.args) + '<span class="mp">)</span>';
          }
          return varHTML(name) + '′'.repeat(n.prime || 0) + '<span class="mp">(</span>' + args(n.args) + '<span class="mp">)</span>';
        }
      }
      return '';
    }
    supDepth = 0;
    return H(ast);
  }

  const NovaMath = {
    MathError, M, CONSTS, FUNC_ARITY, NAMES, SLOT_JS,
    parse, tokenize, normalize, compile, build, evaluate, symbols, rawVars, isConstName,
    setAngleMode, fmt, fmtAt, toFraction, toHTML, integrate, der, gamma, ratApprox,
    FUNC_NAMES: Object.keys(FUNC_ARITY).concat(Object.keys(ALIASES)).sort((a, b) => b.length - a.length),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NovaMath;
  else root.NovaMath = NovaMath;
})(typeof window !== 'undefined' ? window : globalThis);
