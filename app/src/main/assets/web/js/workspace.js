/*
 * Nova Graph — espace de travail : liste d'expressions, définitions
 * (variables, fonctions, curseurs) et classification des tracés.
 */
(function (root) {
  'use strict';
  const NM = root.NovaMath;
  const { MathError } = NM;

  const RESERVED = new Set(['x', 'y', 't', 'theta', 'r', 'e', 'pi', 'tau', 'phi', 'inf', 'Ans']);
  const PALETTE = ['#ff4d8d', '#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#2dd4bf', '#f97316'];
  const flip = (op) => ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=' }[op]);

  let uid = Date.now() % 100000;
  const newId = () => 'e' + (uid++).toString(36);

  function numberLiteral(n) {
    if (n.k === 'num') return n.v;
    if (n.k === 'neg' && n.a.k === 'num') return -n.a.v;
    return null;
  }

  function niceStep(range) {
    const raw = Math.abs(range) / 200;
    if (!(raw > 0)) return 0.1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 2 ? 1 : m < 5 ? 2 : 5) * p;
  }

  function fmtSlider(v, step) {
    const d = Math.max(0, Math.min(8, -Math.floor(Math.log10(step || 0.01) + 1e-9)));
    let s = v.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    if (s === '-0') s = '0';
    return s.replace('-', '−');
  }

  class Workspace {
    constructor() {
      this.items = [];
      this.V = Object.create(null);
      this.U = Object.create(null);
      this.info = new Map();
      this.plots = [];
      this.order = [];
      this.env = { vars: new Set(), funcs: new Map() };
    }

    nextColor() {
      const used = this.items.map((i) => i.color);
      for (const c of PALETTE) if (!used.includes(c)) return c;
      return PALETTE[this.items.length % PALETTE.length];
    }

    add(text, opts) {
      const item = Object.assign({ id: newId(), text: text || '', color: this.nextColor(), hidden: false }, opts || {});
      return item;
    }

    /* ---------------------------------------------------------------- */

    _parse(item) {
      const inf = { item, id: item.id, kind: 'empty', error: null, missing: null };
      const text = (item.text || '').trim();
      if (!text) return inf;
      let ast;
      try {
        ast = NM.parse(text);
      } catch (e) {
        inf.kind = 'error';
        inf.error = e.message;
        return inf;
      }
      if (!ast) return inf;
      inf.ast = ast;
      if (ast.k === 'rel' && ast.op === '=') {
        const L = ast.a;
        if (L.k === 'var' && !RESERVED.has(L.n) && !L.p) {
          inf.kind = 'vardef';
          inf.name = L.n;
          inf.body = ast.b;
          inf.literal = numberLiteral(ast.b);
          return inf;
        }
        if (L.k === 'call' && !L.bi && !L.prime && !RESERVED.has(L.n) && L.args.length &&
          L.args.every((a) => a.k === 'var' && !a.p && !NM.isConstName(a.n))) {
          const params = L.args.map((a) => a.n);
          if (new Set(params).size === params.length) {
            inf.kind = 'funcdef';
            inf.name = L.n;
            inf.params = params;
            inf.body = ast.b;
            return inf;
          }
        }
      }
      inf.kind = 'plot';
      return inf;
    }

    build() {
      const V = this.V, U = this.U;
      for (const k in V) delete V[k];
      for (const k in U) delete U[k];
      const infos = this.items.map((it) => this._parse(it));
      this.info = new Map(infos.map((i) => [i.id, i]));

      // Définitions
      const varDefs = new Map(), funcDefs = new Map(), dup = new Set();
      for (const inf of infos) {
        if (inf.kind !== 'vardef' && inf.kind !== 'funcdef') continue;
        if (varDefs.has(inf.name) || funcDefs.has(inf.name)) dup.add(inf.name);
        else (inf.kind === 'vardef' ? varDefs : funcDefs).set(inf.name, inf);
      }
      for (const inf of infos) {
        if ((inf.kind === 'vardef' || inf.kind === 'funcdef') && dup.has(inf.name)) {
          inf.error = inf.name + ' est défini plusieurs fois';
        }
      }
      const isFunc = (n) => funcDefs.has(n) && !dup.has(n);
      const defs = infos.filter((i) => (i.kind === 'vardef' || i.kind === 'funcdef') && !i.error);
      for (const d of defs) {
        try {
          const s = NM.symbols(d.body, isFunc, d.params ? new Set(d.params) : null);
          d.deps = [...s.vars].filter((n) => varDefs.has(n)).concat([...s.calls]);
        } catch (e) {
          d.error = e.message;
          d.deps = [];
        }
      }

      // Tri topologique + détection des cycles
      const byName = new Map(defs.filter((d) => !d.error).map((d) => [d.name, d]));
      const state = new Map();
      const order = [];
      const visit = (d, stack) => {
        const st = state.get(d);
        if (st === 2) return;
        if (st === 1) {
          for (let i = stack.indexOf(d); i < stack.length; i++) stack[i].error = 'Définition circulaire';
          return;
        }
        state.set(d, 1);
        stack.push(d);
        for (const n of d.deps) { const dd = byName.get(n); if (dd) visit(dd, stack); }
        stack.pop();
        state.set(d, 2);
        order.push(d);
      };
      for (const d of byName.values()) visit(d, []);

      const vars = new Set([...varDefs.keys()].filter((n) => !dup.has(n)));
      const funcs = new Map([...funcDefs].filter(([n]) => !dup.has(n)).map(([n, d]) => [n, d.params.length]));
      this.env = { vars, funcs };
      const mk = (code, params) => NM.build(code, params)(NM.M, V, U);

      for (const d of funcDefs.values()) {
        if (dup.has(d.name)) continue;
        U[d.name] = () => NaN;
        if (d.error) continue;
        try {
          const scope = {};
          d.params.forEach((p, i) => { scope[p] = 'p' + i; });
          const code = NM.compile(d.body, { scope, slots: null, vars, funcs });
          U[d.name] = mk(code, d.params.map((_, i) => 'p' + i));
        } catch (e) {
          d.error = e.message;
          d.missing = e.missing || null;
        }
      }
      for (const d of order) {
        if (d.kind !== 'vardef' || d.error) continue;
        try {
          d.fn = mk(NM.compile(d.body, { slots: null, vars, funcs }), []);
        } catch (e) {
          d.error = e.message;
          d.missing = e.missing || null;
        }
      }
      for (const d of varDefs.values()) {
        if (d.error || !d.fn) { d.fn = null; if (!d.error) d.error = 'Définition circulaire'; }
      }
      this.order = order.filter((d) => d.kind === 'vardef' && d.fn);
      this._evalVars();

      for (const inf of infos) {
        if (inf.kind === 'plot' && !inf.error) this._classify(inf);
        if (inf.kind === 'funcdef' && !inf.error && inf.params.length === 1) {
          const name = inf.name;
          const f = U[name];
          inf.plot = { type: 'fx', f: (x) => f(x) };
        }
        if (inf.kind === 'vardef' && !inf.error && inf.literal !== null) this._initSlider(inf);
      }
      this.refreshValues();
      this.plots = infos
        .filter((i) => i.plot && !i.error && !i.item.hidden)
        .map((i) => Object.assign({ id: i.id, color: i.item.color }, i.plot));
      return this;
    }

    _evalVars() {
      for (const d of this.order) {
        try { this.V[d.name] = d.slider ? d.slider.value : d.fn(); } catch (e) { this.V[d.name] = NaN; }
      }
    }

    _initSlider(inf) {
      const item = inf.item;
      const v = inf.literal;
      if (!item.slider) item.slider = { min: Math.min(-10, Math.floor(v)), max: Math.max(10, Math.ceil(v)) };
      const s = item.slider;
      if (!(s.min < s.max)) { s.min = Math.min(v, -10); s.max = Math.max(v, 10); }
      inf.slider = { value: v, min: s.min, max: s.max, step: s.step || niceStep(s.max - s.min) };
    }

    // Valeurs affichées (constantes, points, bornes) recalculées sans recompiler.
    refreshValues() {
      for (const inf of this.info.values()) {
        if (inf.valueFn) {
          try { inf.value = inf.valueFn(); } catch (e) { inf.value = NaN; }
        }
        if (inf.kind === 'vardef' && !inf.error && !inf.slider) inf.value = this.V[inf.name];
      }
    }

    // Déplacement rapide d'un curseur (sans recompilation).
    setSlider(id, value) {
      const inf = this.info.get(id);
      if (!inf || !inf.slider) return false;
      inf.slider.value = value;
      inf.item.text = inf.name + ' = ' + fmtSlider(value, inf.slider.step).replace('−', '-');
      inf.literal = value;
      this._evalVars();
      this.refreshValues();
      return true;
    }

    domainOf(item, which) {
      const d = item.domain || {};
      const txt = (d[which] || '').trim();
      const def = which === 'min' ? 0 : 2 * Math.PI / NM.M.ak;
      if (!txt) return () => def;
      const fn = NM.build(NM.compile(NM.parse(txt), { slots: null, vars: this.env.vars, funcs: this.env.funcs }), [])(NM.M, this.V, this.U);
      return fn;
    }

    _classify(inf) {
      const env = this.env;
      const ast = inf.ast;
      const S = (n) => NM.symbols(n, (name) => env.funcs.has(name)).vars;
      const comp = (node, slots) => NM.compile(node, { slots: new Set(slots), vars: env.vars, funcs: env.funcs });
      const mk = (code, params) => NM.build(code, params)(NM.M, this.V, this.U);
      const isVar = (n, name) => n.k === 'var' && n.n === name;
      const self = this;

      function fx(body, op) {
        const f = mk(comp(body, ['x']), ['x']);
        inf.plot = op === '=' ? { type: 'fx', f } : { type: 'ineq-fx', f, op };
      }
      function fy(body, op) {
        const g = mk(comp(body, ['y']), ['y']);
        inf.plot = op === '=' ? { type: 'fy', f: g } : { type: 'ineq', F: (x, y) => x - g(y), op };
      }
      function polar(body, op) {
        const f = mk(comp(body, ['theta']), ['th']);
        if (op === '=') {
          inf.plot = {
            type: 'polar',
            range: domain(),
            at: (th) => { const r = f(th), a = th * NM.M.ak; return [r * Math.cos(a), r * Math.sin(a)]; },
          };
          inf.domainVar = 'θ';
        } else {
          inf.plot = {
            type: 'ineq',
            op,
            F: (x, y) => {
              let th = Math.atan2(y, x);
              if (th < 0) th += 2 * Math.PI;
              return Math.hypot(x, y) - f(th / NM.M.ak);
            },
          };
        }
      }
      function domain() {
        const lo = self.domainOf(inf.item, 'min'), hi = self.domainOf(inf.item, 'max');
        return () => [lo(), hi()];
      }

      try {
        if (ast.k === 'rel') {
          const L = ast.a, R = ast.b, op = ast.op;
          const sl = S(L), sr = S(R);
          if (isVar(L, 'y') && !sr.has('y')) return fx(R, op);
          if (isVar(R, 'y') && !sl.has('y')) return fx(L, flip(op));
          if (isVar(L, 'x') && !sr.has('x')) return fy(R, op);
          if (isVar(R, 'x') && !sl.has('x')) return fy(L, flip(op));
          if (isVar(L, 'r') && !sr.has('r')) return polar(R, op);
          if (isVar(R, 'r') && !sl.has('r')) return polar(L, flip(op));
          const all = new Set([...sl, ...sr]);
          if (all.has('t')) throw new MathError('t s’utilise dans un point paramétré (x(t), y(t))');
          if (all.has('theta') || all.has('r')) throw new MathError('Écrivez une courbe polaire sous la forme r = f(θ)');
          if (!all.has('x') && !all.has('y')) {
            const a = mk(comp(L, []), []), b = mk(comp(R, []), []);
            const ops = { '=': (u, w) => Math.abs(u - w) < 1e-12 * Math.max(1, Math.abs(w)), '<': (u, w) => u < w, '>': (u, w) => u > w, '<=': (u, w) => u <= w, '>=': (u, w) => u >= w };
            inf.valueFn = () => (ops[op](a(), b()) ? 'vrai' : 'faux');
            inf.kind = 'value';
            return;
          }
          const F = mk(comp({ k: 'bin', op: '-', a: L, b: R }, ['x', 'y']), ['x', 'y']);
          inf.plot = op === '=' ? { type: 'implicit', F } : { type: 'ineq', F, op };
          return;
        }
        if (ast.k === 'tuple') {
          if (ast.items.length !== 2) throw new MathError('Un point s’écrit (x, y)');
          const s = new Set([...S(ast.items[0]), ...S(ast.items[1])]);
          if (s.has('t')) {
            const X = mk(comp(ast.items[0], ['t']), ['t']);
            const Y = mk(comp(ast.items[1], ['t']), ['t']);
            inf.plot = { type: 'param', range: domain(), at: (t) => [X(t), Y(t)] };
            inf.domainVar = 't';
            return;
          }
          const X = mk(comp(ast.items[0], []), []);
          const Y = mk(comp(ast.items[1], []), []);
          inf.plot = { type: 'point', at: () => [X(), Y()] };
          inf.valueFn = () => [X(), Y()];
          inf.kind = 'point';
          return;
        }
        const s = S(ast);
        if (s.has('x') && !s.has('y')) return fx(ast, '=');
        if (s.has('theta') && !s.has('x') && !s.has('y')) return polar(ast, '=');
        if (s.has('x') || s.has('y')) throw new MathError('Ajoutez une égalité, par exemple y = …');
        if (s.has('t')) throw new MathError('t s’utilise dans un point paramétré (x(t), y(t))');
        const fn = mk(comp(ast, []), []);
        inf.valueFn = fn;
        inf.kind = 'value';
      } catch (e) {
        inf.error = e.message;
        inf.missing = e.missing || null;
        inf.plot = null;
      }
    }

    /* ---------------------------------------------------------------- */

    labelFor(item) {
      const inf = this.info.get(item.id);
      if (inf && inf.kind === 'funcdef') return inf.name + '(' + inf.params.join(', ') + ')';
      return 'y' + (this.items.indexOf(item) + 1);
    }

    toJSON() {
      return this.items.map((i) => {
        const o = { text: i.text, color: i.color };
        if (i.hidden) o.hidden = true;
        if (i.slider) o.slider = { min: i.slider.min, max: i.slider.max };
        if (i.domain && (i.domain.min || i.domain.max)) o.domain = { min: i.domain.min || '', max: i.domain.max || '' };
        return o;
      });
    }

    load(list) {
      this.items = (list || []).map((o) => this.add(o.text, {
        color: o.color || undefined,
        hidden: !!o.hidden,
        slider: o.slider ? { min: o.slider.min, max: o.slider.max } : undefined,
        domain: o.domain ? { min: o.domain.min || '', max: o.domain.max || '' } : undefined,
      }));
      this.items.forEach((it, i) => { if (!it.color) it.color = PALETTE[i % PALETTE.length]; });
      return this;
    }
  }

  Workspace.PALETTE = PALETTE;
  Workspace.fmtSlider = fmtSlider;
  Workspace.niceStep = niceStep;
  Workspace.RESERVED = RESERVED;

  if (typeof module !== 'undefined' && module.exports) module.exports = Workspace;
  else root.NovaWorkspace = Workspace;
})(typeof window !== 'undefined' ? window : globalThis);
