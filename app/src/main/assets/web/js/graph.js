/*
 * Nova Graph — rendu du graphe sur canvas et interactions tactiles :
 * déplacement avec inertie, zoom à deux doigts, suivi de courbe,
 * points remarquables (racines, extremums, intersections).
 */
(function (root) {
  'use strict';
  const NM = root.NovaMath;

  const THEMES = {
    dark: {
      bg0: '#0b0d1c', bg1: '#05060c',
      grid: 'rgba(150,160,255,0.055)', gridMajor: 'rgba(150,160,255,0.12)',
      axis: 'rgba(225,230,255,0.55)', label: 'rgba(205,212,255,0.62)', halo: 'rgba(6,7,14,0.9)',
      glow: true, poi: '#d4d8ee', poiRing: '#05060c',
      bubble: 'rgba(18,20,36,0.94)', bubbleText: '#eef0ff', bubbleMuted: '#9aa0c0', bubbleBorder: 'rgba(255,255,255,0.12)',
      fillAlpha: 0.2,
    },
    light: {
      bg0: '#ffffff', bg1: '#eef0f8',
      grid: 'rgba(30,41,110,0.06)', gridMajor: 'rgba(30,41,110,0.13)',
      axis: 'rgba(15,23,42,0.7)', label: 'rgba(30,41,59,0.72)', halo: 'rgba(250,250,255,0.92)',
      glow: false, poi: '#5b6280', poiRing: '#ffffff',
      bubble: 'rgba(255,255,255,0.97)', bubbleText: '#0f172a', bubbleMuted: '#64748b', bubbleBorder: 'rgba(15,23,42,0.12)',
      fillAlpha: 0.18,
    },
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fin = Number.isFinite;
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  function hexRGB(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function fmtTick(v, major) {
    if (Math.abs(v) < major * 1e-6) return '0';
    if (Math.abs(v) >= 1e6 || major < 1e-4) return NM.fmt(v, 4);
    const d = Math.max(0, -Math.floor(Math.log10(major) + 1e-9));
    return v.toFixed(d).replace('-', '−');
  }

  class GraphView {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts || {};
      this.view = { cx: 0, cy: 0, scale: 40 };
      this.plots = [];
      this.selected = null;
      this.insets = { top: 0, bottom: 0 };
      this.theme = THEMES.dark;
      this.showGrid = true;
      this.showPOI = true;
      this.poi = [];
      this.poiLabel = null;
      this.trace = null;
      this.hits = new Map();
      this.dirty = true;
      this.active = true;
      this.fine = true;
      this.pointers = new Map();
      this.gesture = null;
      this.anim = null;
      this.fling = null;
      this.lastTap = null;
      this._buf = new Float64Array(0);
      this._off = null;
      this.w = 1; this.h = 1; this.dpr = 1;
      this.resize();
      if (this.opts.interactive !== false) {
        if (root.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
        this._bind();
        const loop = (t) => { this._frame(t); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      }
    }

    /* ----------------------------- état ----------------------------- */

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, 3);
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      if (w === this.w && h === this.h && dpr === this.dpr && this.canvas.width) { return; }
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this._bg = null;
      this.dirty = true;
    }

    setTheme(name) { this.theme = THEMES[name] || THEMES.dark; this._bg = null; this.dirty = true; }
    setPlots(plots) {
      this.plots = plots;
      if (this.trace && !plots.some((p) => p.id === this.trace.id)) this.trace = null;
      this.dirty = true;
      this._schedulePOI(60);
    }
    setSelected(id) {
      if (this.selected === id) return;
      this.selected = id;
      this.poiLabel = null;
      if (this.trace && this.trace.id !== id) this.trace = null;
      this.dirty = true;
    }
    setInsets(top, bottom) {
      if (this.insets.top === top && this.insets.bottom === bottom) return;
      this.insets = { top, bottom };
      this.dirty = true;
    }
    invalidate() { this.dirty = true; }

    _viewChanged() {
      this.dirty = true;
      this.fine = false;
      clearTimeout(this._fineTimer);
      this._fineTimer = setTimeout(() => { this.fine = true; this.dirty = true; }, 140);
      this._schedulePOI(180);
      if (this.opts.onView) this.opts.onView(this.view);
    }

    _schedulePOI(ms) {
      clearTimeout(this._poiTimer);
      this._poiTimer = setTimeout(() => { this._computePOI(); this.dirty = true; }, ms);
    }

    /* -------------------------- coordonnées ------------------------- */

    sx(x) { return (x - this.view.cx) * this.view.scale + this.w / 2; }
    sy(y) { return this.h / 2 - (y - this.view.cy) * this.view.scale; }
    wx(px) { return (px - this.w / 2) / this.view.scale + this.view.cx; }
    wy(py) { return (this.h / 2 - py) / this.view.scale + this.view.cy; }

    visibleCenter() {
      const top = this.insets.top, bottom = this.h - this.insets.bottom;
      return { px: this.w / 2, py: top + Math.max(40, bottom - top) / 2 };
    }

    homeView(span) {
      const top = this.insets.top, visH = Math.max(80, this.h - this.insets.bottom - top);
      const scale = Math.min(this.w, visH * 1.25) / (span || 14);
      const vc = top + visH / 2;
      return { cx: 0, cy: (vc - this.h / 2) / scale, scale };
    }

    // Vue centrée sur un point du monde (wx, wy) dans la zone visible.
    viewCentered(x, y, scale) {
      const vc = this.visibleCenter();
      return { scale, cx: x - (vc.px - this.w / 2) / scale, cy: y + (vc.py - this.h / 2) / scale };
    }

    home(animate) {
      const v = this.homeView();
      if (animate) this.animateTo(v); else { this.view = v; this._viewChanged(); }
    }

    zoomAt(px, py, factor, animate) {
      const s0 = this.view.scale;
      const s1 = clamp(s0 * factor, 1e-7, 1e9);
      if (animate) { this.animateTo(null, { px, py, s0, s1 }); return; }
      const x = this.wx(px), y = this.wy(py);
      this.view.scale = s1;
      this.view.cx = x - (px - this.w / 2) / s1;
      this.view.cy = y - (this.h / 2 - py) / s1;
      this._viewChanged();
    }

    zoomBy(factor) {
      const c = this.visibleCenter();
      this.zoomAt(c.px, c.py, factor, true);
    }

    animateTo(target, zoom) {
      this.fling = null;
      const now = performance.now();
      if (zoom) {
        this.anim = { t0: now, ms: 320, zoom, x: this.wx(zoom.px), y: this.wy(zoom.py) };
      } else {
        this.anim = { t0: now, ms: 420, from: Object.assign({}, this.view), to: target };
      }
    }

    _stepAnim(t) {
      const a = this.anim;
      const k = clamp((t - a.t0) / a.ms, 0, 1);
      const e = ease(k);
      if (a.zoom) {
        const s = a.zoom.s0 * Math.pow(a.zoom.s1 / a.zoom.s0, e);
        this.view.scale = s;
        this.view.cx = a.x - (a.zoom.px - this.w / 2) / s;
        this.view.cy = a.y - (this.h / 2 - a.zoom.py) / s;
      } else {
        const f = a.from, to = a.to;
        const s = f.scale * Math.pow(to.scale / f.scale, e);
        this.view.scale = s;
        this.view.cx = f.cx + (to.cx - f.cx) * e;
        this.view.cy = f.cy + (to.cy - f.cy) * e;
      }
      this._viewChanged();
      if (k >= 1) this.anim = null;
    }

    _stepFling(t) {
      const f = this.fling;
      const dt = Math.min(40, t - f.t);
      f.t = t;
      this.view.cx -= (f.vx * dt) / this.view.scale;
      this.view.cy += (f.vy * dt) / this.view.scale;
      const decay = Math.exp(-dt / 320);
      f.vx *= decay; f.vy *= decay;
      if (Math.hypot(f.vx, f.vy) < 0.02) this.fling = null;
      this._viewChanged();
    }

    _frame(t) {
      if (!this.active) return;
      if (this.anim) this._stepAnim(t);
      if (this.fling) this._stepFling(t);
      if (this.opts.onFrame) this.opts.onFrame(t);
      if (!this.dirty) return;
      this.dirty = false;
      this.render();
    }

    /* ------------------------------ rendu ----------------------------- */

    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._drawBackground();
      this._drawGrid();
      this.hits.clear();
      const fills = [], curves = [], points = [];
      for (const p of this.plots) {
        if (p.type === 'ineq' || p.type === 'ineq-fx') fills.push(p);
        else if (p.type === 'point') points.push(p);
        else curves.push(p);
      }
      for (const p of fills) this._safe(p, () => (p.type === 'ineq' ? this._drawIneq(p) : this._drawIneqFx(p)));
      for (const p of curves) {
        this._safe(p, () => {
          if (p.type === 'fx') this._drawFx(p, false);
          else if (p.type === 'fy') this._drawFx(p, true);
          else if (p.type === 'implicit') this._drawImplicit(p, false);
          else this._drawParam(p);
        });
      }
      for (const p of points) this._safe(p, () => this._drawPoint(p));
      this._drawPOI();
      this._drawTrace();
    }

    _safe(p, fn) {
      try { fn(); } catch (e) { /* une expression défaillante n'interrompt pas le rendu */ }
    }

    _drawBackground() {
      const { ctx, w, h, theme } = this;
      if (!this._bg) {
        const g = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.85);
        g.addColorStop(0, theme.bg0);
        g.addColorStop(1, theme.bg1);
        this._bg = g;
      }
      ctx.fillStyle = this._bg;
      ctx.fillRect(0, 0, w, h);
    }

    _gridLines(step, x0, x1, y0, y1) {
      const { ctx } = this;
      const n = (x1 - x0) / step + (y1 - y0) / step;
      if (n > 600) return;
      for (let k = Math.ceil(x0 / step); k * step <= x1; k++) {
        const px = Math.round(this.sx(k * step)) + 0.5;
        ctx.moveTo(px, 0); ctx.lineTo(px, this.h);
      }
      for (let k = Math.ceil(y0 / step); k * step <= y1; k++) {
        const py = Math.round(this.sy(k * step)) + 0.5;
        ctx.moveTo(0, py); ctx.lineTo(this.w, py);
      }
    }

    _drawGrid() {
      const { ctx, w, h, theme: th } = this;
      const s = this.view.scale;
      const major = niceStep(88 / s);
      const mant = Math.round(major / Math.pow(10, Math.floor(Math.log10(major) + 1e-9)));
      const minor = major / (mant === 2 ? 4 : 5);
      const x0 = this.wx(0), x1 = this.wx(w), y0 = this.wy(h), y1 = this.wy(0);
      ctx.lineWidth = 1;
      if (this.showGrid) {
        if (minor * s > 9) { ctx.strokeStyle = th.grid; ctx.beginPath(); this._gridLines(minor, x0, x1, y0, y1); ctx.stroke(); }
        ctx.strokeStyle = th.gridMajor; ctx.beginPath(); this._gridLines(major, x0, x1, y0, y1); ctx.stroke();
      }
      const ax = this.sx(0), ay = this.sy(0);
      ctx.strokeStyle = th.axis;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (ay >= -1 && ay <= h + 1) { ctx.moveTo(0, ay); ctx.lineTo(w, ay); }
      if (ax >= -1 && ax <= w + 1) { ctx.moveTo(ax, 0); ctx.lineTo(ax, h); }
      ctx.stroke();

      if (this.opts.labels === false) return;
      // Graduations
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = th.halo;
      ctx.fillStyle = th.label;
      const top = this.insets.top + 6, bottom = h - this.insets.bottom - 8;
      const label = (txt, x, y) => { ctx.strokeText(txt, x, y); ctx.fillText(txt, x, y); };

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ly = clamp(ay + 6, top, bottom - 12);
      for (let k = Math.ceil(x0 / major); k * major <= x1; k++) {
        if (k === 0) continue;
        const px = this.sx(k * major);
        if (px < 12 || px > w - 12) continue;
        label(fmtTick(k * major, major), px, ly);
      }
      ctx.textBaseline = 'middle';
      let lx, align;
      if (ax < 44) { lx = Math.max(ax, 0) + 6; align = 'left'; } else if (ax > w - 6) { lx = w - 6; align = 'right'; } else { lx = ax - 6; align = 'right'; }
      ctx.textAlign = align;
      for (let k = Math.ceil(y0 / major); k * major <= y1; k++) {
        if (k === 0) continue;
        const py = this.sy(k * major);
        if (py < top + 6 || py > bottom - 4) continue;
        label(fmtTick(k * major, major), lx, py);
      }
      if (ax > 10 && ax < w - 10 && ay > top && ay < bottom) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        label('0', ax - 5, ay + 5);
      }
    }

    _stroke(p, dashed) {
      const { ctx } = this;
      const sel = this.selected === p.id;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (this.theme.glow) {
        ctx.globalAlpha = sel ? 0.3 : 0.16;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = sel ? 11 : 7;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (sel) {
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 9;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = p.color;
      ctx.lineWidth = sel ? 3.4 : 2.6;
      if (dashed) ctx.setLineDash([9, 7]);
      ctx.stroke();
      if (dashed) ctx.setLineDash([]);
    }

    // Vérifie par dichotomie qu'un saut entre deux échantillons est continu.
    // Sinon, renvoie l'encadrement final [a, f(a), b, f(b)] de la discontinuité.
    _continuous(f, a, fa, b, fb) {
      const s = this.view.scale;
      for (let i = 0; i < 26; i++) {
        const m = (a + b) / 2, fm = f(m);
        if (!fin(fm)) return [a, fa, b, fb];
        if (Math.abs(fm - fa) > Math.abs(fb - fm)) { b = m; fb = fm; } else { a = m; fa = fm; }
        if (Math.abs(fb - fa) * s < 1.5) return true;
      }
      return [a, fa, b, fb];
    }

    // Bord du domaine de définition entre good (défini) et bad (non défini).
    _edge(f, good, bad) {
      let fg = f(good);
      for (let i = 0; i < 40; i++) {
        const m = (good + bad) / 2, fm = f(m);
        if (fin(fm)) { good = m; fg = fm; } else bad = m;
      }
      return [good, fg];
    }

    // y = f(x) (swap = false) ou x = f(y) (swap = true)
    _drawFx(p, swap, pathOnly) {
      const { ctx } = this;
      const f = p.f;
      const n = swap ? this.h : this.w;
      const step = this.fine ? 1 : 2;
      const toW = swap ? (q) => this.wy(q) : (q) => this.wx(q);
      const toS = swap ? (v) => this.sx(v) : (v) => this.sy(v);
      const lim = 4000;
      const cl = (v) => clamp(v, -lim, (swap ? this.w : this.h) + lim);
      const pt = swap ? (q, v) => [cl(v), q] : (q, v) => [q, cl(v)];
      const hits = [];
      const span = swap ? this.w : this.h;
      ctx.beginPath();
      let pen = false, pu = NaN, pv = NaN, ps = 0;
      for (let q = -step; q <= n + step; q += step) {
        const u = toW(q);
        const v = f(u);
        if (fin(v)) {
          const s = toS(v);
          if (pen && Math.abs(s - ps) > 28) {
            const c = this._continuous(f, pu, pv, u, v);
            if (c !== true) {
              // Prolonge chaque branche jusqu'au saut (asymptotes, paliers)
              const qa = swap ? this.sy(c[0]) : this.sx(c[0]);
              const qb = swap ? this.sy(c[2]) : this.sx(c[2]);
              const A = pt(qa, toS(c[1])), Bp = pt(qb, toS(c[3]));
              ctx.lineTo(A[0], A[1]);
              ctx.moveTo(Bp[0], Bp[1]);
            }
          }
          if (!pen && !Number.isNaN(pu) && !fin(pv)) {
            const e = this._edge(f, u, pu);
            const es = toS(e[1]);
            const a = pt(swap ? this.sy(e[0]) : this.sx(e[0]), es);
            ctx.moveTo(a[0], a[1]);
            pen = true;
          }
          const b = pt(q, s);
          if (pen) ctx.lineTo(b[0], b[1]); else ctx.moveTo(b[0], b[1]);
          pen = true;
          if (s > -60 && s < span + 60) hits.push(b[0], b[1]);
          ps = s;
        } else {
          if (pen && fin(pv)) {
            const e = this._edge(f, pu, u);
            const a = pt(swap ? this.sy(e[0]) : this.sx(e[0]), toS(e[1]));
            ctx.lineTo(a[0], a[1]);
          }
          pen = false;
        }
        pu = u; pv = v;
      }
      this.hits.set(p.id, hits);
      if (!pathOnly) this._stroke(p, false);
    }

    _drawParam(p) {
      const { ctx } = this;
      const r = p.range();
      let t0 = r[0], t1 = r[1];
      if (!fin(t0) || !fin(t1) || t0 === t1) return;
      if (t1 < t0) { const tmp = t0; t0 = t1; t1 = tmp; }
      const turns = (t1 - t0) / (2 * Math.PI / NM.M.ak);
      const N = Math.min(24000, Math.max(600, Math.ceil(700 * Math.max(1, turns))));
      const hits = [];
      const self = this;
      const scr = (t) => {
        const xy = p.at(t);
        return fin(xy[0]) && fin(xy[1]) ? [self.sx(xy[0]), self.sy(xy[1])] : null;
      };
      ctx.beginPath();
      let prev = null, prevT = t0;
      const big = Math.max(this.w, this.h);
      const lineTo = (a) => {
        const x = clamp(a[0], -4000, this.w + 4000), y = clamp(a[1], -4000, this.h + 4000);
        ctx.lineTo(x, y);
        if (x > -40 && x < this.w + 40 && y > -40 && y < this.h + 40) hits.push(x, y);
      };
      const refine = (ta, A, tb, B, depth) => {
        const d = Math.abs(B[0] - A[0]) + Math.abs(B[1] - A[1]);
        if (d < 3 || depth === 0) {
          if (d > big * 0.6) ctx.moveTo(clamp(B[0], -4000, this.w + 4000), clamp(B[1], -4000, this.h + 4000)); else lineTo(B);
          return;
        }
        const tm = (ta + tb) / 2, Mm = scr(tm);
        if (!Mm) { ctx.moveTo(clamp(B[0], -4000, this.w + 4000), clamp(B[1], -4000, this.h + 4000)); return; }
        refine(ta, A, tm, Mm, depth - 1);
        refine(tm, Mm, tb, B, depth - 1);
      };
      for (let i = 0; i <= N; i++) {
        const t = t0 + ((t1 - t0) * i) / N;
        const P = scr(t);
        if (!P) { prev = null; continue; }
        if (!prev) ctx.moveTo(clamp(P[0], -4000, this.w + 4000), clamp(P[1], -4000, this.h + 4000));
        else refine(prevT, prev, t, P, 5);
        prev = P; prevT = t;
      }
      this.hits.set(p.id, hits);
      this._stroke(p, false);
    }

    _grid(res) {
      const cols = Math.ceil(this.w / res) + 2, rows = Math.ceil(this.h / res) + 2;
      if (this._buf.length < cols * rows) this._buf = new Float64Array(cols * rows);
      return { cols, rows, vals: this._buf };
    }

    _sampleGrid(F, res) {
      const g = this._grid(res);
      const { cols, rows, vals } = g;
      for (let j = 0; j < rows; j++) {
        const y = this.wy((j - 0.5) * res);
        const o = j * cols;
        for (let i = 0; i < cols; i++) vals[o + i] = F(this.wx((i - 0.5) * res), y);
      }
      return g;
    }

    // Courbe implicite F(x, y) = 0 par « marching squares ».
    _drawImplicit(p, dashed) {
      const { ctx } = this;
      const F = p.F;
      const res = this.fine ? 4 : 8;
      const { cols, rows, vals } = this._sampleGrid(F, res);
      const hits = [];
      const iters = this.fine ? 5 : 2;
      // Point de passage sur une arête, affiné par dichotomie sur F
      const cross = (x0, y0, x1, y1, f0) => {
        let lo = 0, hi = 1, flo = f0;
        for (let k = 0; k < iters; k++) {
          const t = (lo + hi) / 2;
          const ft = F(this.wx(x0 + (x1 - x0) * t), this.wy(y0 + (y1 - y0) * t));
          if (!fin(ft)) break;
          if ((ft > 0) === (flo > 0)) { lo = t; flo = ft; } else hi = t;
        }
        const t = (lo + hi) / 2;
        return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
      };
      ctx.beginPath();
      const seg = (a, b) => {
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        hits.push(a[0], a[1]);
      };
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = vals[j * cols + i], b = vals[j * cols + i + 1];
          const c = vals[(j + 1) * cols + i + 1], d = vals[(j + 1) * cols + i];
          if (!(fin(a) && fin(b) && fin(c) && fin(d))) continue;
          const idx = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          const X = (i - 0.5) * res, Y = (j - 0.5) * res;
          const T = () => cross(X, Y, X + res, Y, a);
          const R = () => cross(X + res, Y, X + res, Y + res, b);
          const B = () => cross(X, Y + res, X + res, Y + res, d);
          const L = () => cross(X, Y, X, Y + res, a);
          // Rejet des faux contours (pôles / discontinuités)
          const mid = F(this.wx(X + res / 2), this.wy(Y + res / 2));
          if (!fin(mid) || Math.abs(mid) > 2 * Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d))) continue;
          switch (idx) {
            case 1: case 14: seg(L(), B()); break;
            case 2: case 13: seg(B(), R()); break;
            case 3: case 12: seg(L(), R()); break;
            case 4: case 11: seg(T(), R()); break;
            case 6: case 9: seg(T(), B()); break;
            case 7: case 8: seg(L(), T()); break;
            case 5: if (mid > 0) { seg(L(), T()); seg(B(), R()); } else { seg(T(), R()); seg(L(), B()); } break;
            case 10: if (mid > 0) { seg(T(), R()); seg(L(), B()); } else { seg(L(), T()); seg(B(), R()); } break;
          }
        }
      }
      this.hits.set(p.id, hits);
      this._stroke(p, dashed);
    }

    _fillCanvas(cols, rows) {
      if (!this._off) { this._off = document.createElement('canvas'); this._offCtx = this._off.getContext('2d'); }
      if (this._off.width !== cols || this._off.height !== rows) { this._off.width = cols; this._off.height = rows; }
      return this._offCtx;
    }

    // Inéquation implicite : remplissage lissé + frontière.
    _drawIneq(p) {
      const { ctx } = this;
      const res = this.fine ? 3 : 6;
      const cols = Math.ceil(this.w / res) + 1, rows = Math.ceil(this.h / res) + 1;
      const octx = this._fillCanvas(cols, rows);
      const img = octx.createImageData(cols, rows);
      const data = img.data;
      const [r, g, b] = hexRGB(p.color);
      const A = Math.round(255 * this.theme.fillAlpha);
      const test = { '<': (v) => v < 0, '<=': (v) => v <= 0, '>': (v) => v > 0, '>=': (v) => v >= 0 }[p.op];
      for (let j = 0; j < rows; j++) {
        const y = this.wy(j * res);
        for (let i = 0; i < cols; i++) {
          const v = p.F(this.wx(i * res), y);
          if (fin(v) && test(v)) {
            const o = (j * cols + i) * 4;
            data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = A;
          }
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this._off, 0, 0, cols, rows, -res / 2, -res / 2, cols * res, rows * res);
      ctx.restore();
      this._drawImplicit({ id: p.id, color: p.color, F: p.F }, p.op === '<' || p.op === '>');
    }

    // y < f(x) / y > f(x)
    _drawIneqFx(p) {
      const { ctx, h } = this;
      const below = p.op === '<' || p.op === '<=';
      ctx.save();
      ctx.globalAlpha = this.theme.fillAlpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      const step = 2;
      for (let q = 0; q <= this.w; q += step) {
        const v = p.f(this.wx(q + step / 2));
        if (!fin(v)) continue;
        const s = clamp(this.sy(v), -10, h + 10);
        if (below) ctx.rect(q, s, step, h - s); else ctx.rect(q, 0, step, s);
      }
      ctx.fill();
      ctx.restore();
      this._drawFx(p, false, true);
      this._stroke(p, p.op === '<' || p.op === '>');
    }

    _drawPoint(p) {
      const { ctx } = this;
      const xy = p.at();
      if (!fin(xy[0]) || !fin(xy[1])) return;
      const X = this.sx(xy[0]), Y = this.sy(xy[1]);
      this.hits.set(p.id, [X, Y]);
      if (this.theme.glow) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(X, Y, 11, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(X, Y, 5.5, 0, Math.PI * 2); ctx.fill();
      if (this.selected === p.id || this.opts.labelPoints) {
        this._bubble(X, Y, null, '(' + NM.fmtAt(xy[0], this.view.scale) + ', ' + NM.fmtAt(xy[1], this.view.scale) + ')', p.color);
      }
    }

    /* ------------------------ points remarquables ------------------------ */

    _computePOI() {
      const out = [];
      if (!this.showPOI) { this.poi = out; return; }
      const fxs = this.plots.filter((p) => p.type === 'fx');
      if (!fxs.length) { this.poi = out; return; }
      const x0 = this.wx(0), x1 = this.wx(this.w);
      const N = 480;
      const xs = new Float64Array(N + 1);
      for (let i = 0; i <= N; i++) xs[i] = x0 + ((x1 - x0) * i) / N;
      const s = this.view.scale;
      const pxTol = 26 / s;
      const samples = fxs.map((p) => {
        const ys = new Float64Array(N + 1);
        for (let i = 0; i <= N; i++) { try { ys[i] = p.f(xs[i]); } catch (e) { ys[i] = NaN; } }
        return ys;
      });
      const bisect = (g, a, b, ga) => {
        for (let k = 0; k < 64; k++) {
          const m = (a + b) / 2, gm = g(m);
          if (!fin(gm)) return null;
          if (gm === 0) return m;
          if ((gm < 0) === (ga < 0)) { a = m; ga = gm; } else b = m;
        }
        return (a + b) / 2;
      };
      const golden = (f, a, b, max) => {
        const r = (Math.sqrt(5) - 1) / 2;
        let c = b - r * (b - a), d = a + r * (b - a);
        let fc = f(c), fd = f(d);
        for (let k = 0; k < 60; k++) {
          if (max ? fc > fd : fc < fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = f(d); }
        }
        return (a + b) / 2;
      };
      fxs.forEach((p, k) => {
        const ys = samples[k], f = p.f;
        let count = 0;
        if (x0 < 0 && x1 > 0) {
          const y = f(0);
          if (fin(y)) out.push({ x: 0, y, kind: 'Ordonnée à l’origine', ids: [p.id], color: p.color });
        }
        for (let i = 0; i < N && count < 60; i++) {
          const ya = ys[i], yb = ys[i + 1];
          if (!fin(ya) || !fin(yb)) continue;
          if (ya === 0 && (i === 0 || ys[i - 1] !== 0)) {
            out.push({ x: xs[i], y: 0, kind: 'Racine', ids: [p.id], color: p.color }); count++;
          } else if (ya * yb < 0) {
            const r = bisect(f, xs[i], xs[i + 1], ya);
            if (r !== null && Math.abs(f(r)) < 1e-6 * Math.max(1, Math.abs(ya), Math.abs(yb))) {
              out.push({ x: r, y: 0, kind: 'Racine', ids: [p.id], color: p.color }); count++;
            }
          }
          if (i > 0) {
            const yp = ys[i - 1];
            if (!fin(yp) || Math.abs(ya - yp) > pxTol || Math.abs(yb - ya) > pxTol) continue;
            const isMax = ya > yp && ya >= yb, isMin = ya < yp && ya <= yb;
            if (!isMax && !isMin) continue;
            const xm = golden(f, xs[i - 1], xs[i + 1], isMax);
            const ym = f(xm);
            if (!fin(ym)) continue;
            out.push({ x: xm, y: ym, kind: isMax ? 'Maximum' : 'Minimum', ids: [p.id], color: p.color });
            count++;
          }
        }
      });
      for (let a = 0; a < fxs.length; a++) {
        for (let b = a + 1; b < fxs.length; b++) {
          const A = samples[a], B = samples[b];
          const fa = fxs[a].f, fb = fxs[b].f;
          const g = (x) => fa(x) - fb(x);
          let count = 0;
          for (let i = 0; i < N && count < 40; i++) {
            const da = A[i] - B[i], db = A[i + 1] - B[i + 1];
            if (!fin(da) || !fin(db)) continue;
            let r = null;
            if (da === 0) r = xs[i];
            else if (da * db < 0) r = bisect(g, xs[i], xs[i + 1], da);
            if (r === null) continue;
            const y = fa(r);
            if (!fin(y) || Math.abs(g(r)) > 1e-6 * Math.max(1, Math.abs(y))) continue;
            out.push({ x: r, y, kind: 'Intersection', ids: [fxs[a].id, fxs[b].id], color: fxs[a].color });
            count++;
          }
        }
      }
      this.poi = out;
    }

    _visiblePOI() {
      if (!this.showPOI || !this.selected) return [];
      return this.poi.filter((q) => q.ids.indexOf(this.selected) >= 0);
    }

    _drawPOI() {
      const { ctx, theme } = this;
      const list = this._visiblePOI();
      for (const q of list) {
        const X = this.sx(q.x), Y = this.sy(q.y);
        if (X < -10 || X > this.w + 10 || Y < -10 || Y > this.h + 10) continue;
        ctx.beginPath();
        ctx.arc(X, Y, 5, 0, Math.PI * 2);
        ctx.fillStyle = theme.poi;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = theme.poiRing;
        ctx.stroke();
      }
      const L = this.poiLabel;
      if (L && list.indexOf(L) >= 0) {
        this._bubble(this.sx(L.x), this.sy(L.y), L.kind, '(' + NM.fmtAt(L.x, this.view.scale) + ', ' + NM.fmtAt(L.y, this.view.scale) + ')', L.color);
      }
    }

    _drawTrace() {
      const tr = this.trace;
      if (!tr) return;
      const p = this.plots.find((q) => q.id === tr.id);
      if (!p) return;
      const { ctx, theme } = this;
      const X = this.sx(tr.x), Y = this.sy(tr.y);
      if (!fin(X) || !fin(Y)) return;
      // Repères pointillés vers les axes
      const ax = clamp(this.sx(0), 0, this.w), ay = clamp(this.sy(0), 0, this.h);
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(X, Y); ctx.lineTo(X, ay);
      ctx.moveTo(X, Y); ctx.lineTo(ax, Y);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(X, Y, 13, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(X, Y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = theme.poiRing;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = p.color;
      ctx.stroke();
      this._bubble(X, Y, tr.kind || null, '(' + NM.fmtAt(tr.x, this.view.scale) + ', ' + NM.fmtAt(tr.y, this.view.scale) + ')', p.color);
    }

    _bubble(X, Y, title, text, color) {
      const { ctx, theme } = this;
      ctx.save();
      ctx.font = '600 13px "JetBrains Mono", ui-monospace, monospace';
      const tw = ctx.measureText(text).width;
      let titleW = 0;
      if (title) { ctx.font = '600 10.5px Inter, system-ui, sans-serif'; titleW = ctx.measureText(title.toUpperCase()).width + 4; }
      const padX = 12, w = Math.max(tw, titleW) + padX * 2 + 10, h = title ? 46 : 32;
      let bx = clamp(X - w / 2, 8, this.w - w - 8);
      let by = Y - h - 18;
      if (by < this.insets.top + 6) by = Y + 18;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = theme.bubble;
      roundRect(ctx, bx, by, w, h, 12);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.bubbleBorder;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bx + padX + 2, by + h - 16, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (title) {
        ctx.font = '600 10.5px Inter, system-ui, sans-serif';
        ctx.fillStyle = theme.bubbleMuted;
        ctx.fillText(title.toUpperCase(), bx + padX, by + 14);
      }
      ctx.font = '600 13px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = theme.bubbleText;
      ctx.fillText(text, bx + padX + 10, by + h - 16);
      ctx.restore();
    }

    /* --------------------------- interactions --------------------------- */

    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _hitPOI(x, y) {
      let best = null, bd = 20 * 20;
      for (const q of this._visiblePOI()) {
        const d = (this.sx(q.x) - x) ** 2 + (this.sy(q.y) - y) ** 2;
        if (d < bd) { bd = d; best = q; }
      }
      return best;
    }

    _hitCurve(x, y, radius, onlyId) {
      let best = null, bd = radius * radius;
      for (const p of this.plots) {
        if (onlyId && p.id !== onlyId) continue;
        if (p.type === 'fx' || p.type === 'ineq-fx') {
          const wx = this.wx(x);
          const v = p.f(wx);
          if (fin(v)) {
            const d = (this.sy(v) - y) ** 2;
            if (d < bd) { bd = d; best = { p, x: wx, y: v }; }
          }
        }
        const arr = this.hits.get(p.id);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i += 2) {
          const dx = arr[i] - x, dy = arr[i + 1] - y;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = { p, x: this.wx(arr[i]), y: this.wy(arr[i + 1]) }; }
        }
      }
      return best;
    }

    _traceTo(x, y) {
      const tr = this.trace;
      const p = this.plots.find((q) => q.id === tr.id);
      if (!p) return;
      let nx, ny;
      if (p.type === 'fx' || p.type === 'ineq-fx') {
        nx = this.wx(x);
        ny = p.f(nx);
        if (!fin(ny)) return;
      } else if (p.type === 'point') {
        const xy = p.at(); nx = xy[0]; ny = xy[1];
      } else {
        const h = this._hitCurve(x, y, 1e6, p.id);
        if (!h) return;
        nx = h.x; ny = h.y;
      }
      // Aimantation vers les points remarquables
      let snap = null;
      for (const q of this.poi) {
        if (q.ids.indexOf(p.id) < 0) continue;
        const d = Math.hypot(this.sx(q.x) - this.sx(nx), this.sy(q.y) - this.sy(ny));
        if (d < 14) { snap = q; break; }
      }
      if (snap) {
        nx = snap.x; ny = snap.y;
        if (tr.snap !== snap && this.opts.haptic) this.opts.haptic('tick');
      }
      tr.snap = snap;
      tr.kind = snap ? snap.kind : null;
      tr.x = nx; tr.y = ny;
      this.dirty = true;
    }

    _bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this._down(e));
      c.addEventListener('pointermove', (e) => this._move(e));
      c.addEventListener('pointerup', (e) => this._up(e));
      c.addEventListener('pointercancel', (e) => this._up(e, true));
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = this._pos(e);
        this.anim = null;
        this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016));
      }, { passive: false });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _down(e) {
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.anim = null;
      this.fling = null;
      const p = this._pos(e);
      this.pointers.set(e.pointerId, p);
      if (this.opts.onInteract) this.opts.onInteract();
      if (this.pointers.size === 1) {
        const now = performance.now();
        this.gesture = { mode: 'pan', sx: p.x, sy: p.y, lx: p.x, ly: p.y, lt: now, t0: now, moved: false, vx: 0, vy: 0 };
        const poi = this._hitPOI(p.x, p.y);
        if (poi) { this.gesture.mode = 'poi'; this.gesture.poi = poi; return; }
        const hit = this._hitCurve(p.x, p.y, e.pointerType === 'mouse' ? 10 : 18);
        if (hit) {
          this.gesture.mode = 'trace';
          if (this.selected !== hit.p.id) {
            this.selected = hit.p.id;
            if (this.opts.onSelect) this.opts.onSelect(hit.p.id);
          }
          this.trace = { id: hit.p.id, x: hit.x, y: hit.y };
          this.poiLabel = null;
          if (this.opts.haptic) this.opts.haptic('tick');
          this._traceTo(p.x, p.y);
          this.dirty = true;
        }
      } else if (this.pointers.size === 2) {
        const [a, b] = Array.from(this.pointers.values());
        this.gesture = {
          mode: 'pinch', moved: true,
          d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
          view0: Object.assign({}, this.view),
        };
      }
    }

    _move(e) {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this._pos(e);
      this.pointers.set(e.pointerId, p);
      const g = this.gesture;
      if (!g) return;
      if (g.mode === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = Array.from(this.pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const v0 = g.view0;
        const s = clamp(v0.scale * (d / g.d0), 1e-7, 1e9);
        const wx = (g.mx - this.w / 2) / v0.scale + v0.cx;
        const wy = (this.h / 2 - g.my) / v0.scale + v0.cy;
        this.view.scale = s;
        this.view.cx = wx - (mx - this.w / 2) / s;
        this.view.cy = wy - (this.h / 2 - my) / s;
        this._viewChanged();
        return;
      }
      if (this.pointers.size !== 1) return;
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > 7) {
        g.moved = true;
        if (g.mode === 'poi') g.mode = 'pan';
      }
      if (g.mode === 'trace') { this._traceTo(p.x, p.y); return; }
      if (g.mode === 'pan' && g.moved) {
        const now = performance.now();
        const dx = p.x - g.lx, dy = p.y - g.ly;
        const dt = Math.max(1, now - g.lt);
        this.view.cx -= dx / this.view.scale;
        this.view.cy += dy / this.view.scale;
        g.vx = 0.75 * (dx / dt) + 0.25 * g.vx;
        g.vy = 0.75 * (dy / dt) + 0.25 * g.vy;
        g.lx = p.x; g.ly = p.y; g.lt = now;
        this._viewChanged();
      }
    }

    _up(e, cancelled) {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this._pos(e);
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (!g) return;
      if (g.mode === 'pinch') {
        if (this.pointers.size === 1) {
          const q = Array.from(this.pointers.values())[0];
          const now = performance.now();
          this.gesture = { mode: 'pan', sx: q.x, sy: q.y, lx: q.x, ly: q.y, lt: now, t0: now, moved: true, vx: 0, vy: 0 };
        } else this.gesture = null;
        return;
      }
      if (this.pointers.size) return;
      this.gesture = null;
      if (cancelled) return;
      if (g.mode === 'poi') {
        this.poiLabel = this.poiLabel === g.poi ? null : g.poi;
        this.trace = null;
        if (this.opts.haptic) this.opts.haptic('tick');
        this.dirty = true;
        return;
      }
      if (g.mode === 'trace') return;
      if (g.moved) {
        const idle = performance.now() - g.lt;
        if (idle < 60 && Math.hypot(g.vx, g.vy) > 0.25) this.fling = { vx: g.vx, vy: g.vy, t: performance.now() };
        return;
      }
      // Appui bref : double appui = zoom, appui simple = désélection
      const now = performance.now();
      if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 30) {
        this.lastTap = null;
        this.zoomAt(p.x, p.y, 2, true);
        return;
      }
      this.lastTap = { t: now, x: p.x, y: p.y };
      if (this.trace || this.poiLabel || this.selected) {
        this.trace = null;
        this.poiLabel = null;
        this.dirty = true;
        if (this.opts.onTapEmpty) this.opts.onTapEmpty();
      }
    }

    /* ------------------------------ export ------------------------------ */

    snapshot(legend) {
      const out = document.createElement('canvas');
      const dpr = this.dpr;
      out.width = this.canvas.width;
      out.height = this.canvas.height;
      const c = out.getContext('2d');
      const savedTrace = this.trace, savedInsets = this.insets;
      this.trace = null;
      this.insets = { top: 0, bottom: 0 };
      this.render();
      c.drawImage(this.canvas, 0, 0);
      this.trace = savedTrace;
      this.insets = savedInsets;
      this.dirty = true;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const th = this.theme;
      if (legend && legend.length) {
        c.font = '500 14px Inter, system-ui, sans-serif';
        const lw = Math.min(this.w - 32, Math.max.apply(null, legend.map((l) => c.measureText(l.text).width)) + 44);
        const lh = 26 * legend.length + 16;
        c.fillStyle = th.bubble;
        roundRect(c, 16, 16, lw, lh, 14);
        c.fill();
        c.strokeStyle = th.bubbleBorder;
        c.stroke();
        legend.forEach((l, i) => {
          const y = 16 + 8 + 13 + i * 26;
          c.fillStyle = l.color;
          c.beginPath(); c.arc(34, y, 5, 0, Math.PI * 2); c.fill();
          c.fillStyle = th.bubbleText;
          c.textBaseline = 'middle';
          c.fillText(l.text, 48, y, lw - 44);
        });
      }
      c.font = '600 12px Inter, system-ui, sans-serif';
      c.textAlign = 'right';
      c.textBaseline = 'bottom';
      c.fillStyle = th.label;
      c.fillText('Nova Graph', this.w - 14, this.h - 12);
      return out.toDataURL('image/png');
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  GraphView.THEMES = THEMES;
  root.NovaGraph = GraphView;
})(window);
