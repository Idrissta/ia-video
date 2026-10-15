/* Vélo Champion — rendu pseudo-3D de la course (Canvas 2D). */
(function (root) {
  'use strict';
  const VC = root.VC;
  const SEG = VC.SEG;
  const ROAD = VC.ROAD;
  const PLAYER_Z = 2750;     // distance caméra → joueur
  const CAM_H = 1280;        // hauteur de la caméra
  const FOG_STEPS = 24;
  // Décors portant du texte : jamais retournés en miroir.
  const NO_FLIP = new Set(['barrier', 'neon', 'sign', 'billboard', 'p1000', 'p500', 'p200', 'archStart', 'archFinish', 'chevL', 'chevR']);

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.W = canvas.width;
    this.H = canvas.height;
    this.quality = 'high';
    this.drawDistance = 300;
    this.camX = 0;
    this.skyOffset = 0;
    this.shake = 0;
    this.time = 0;
    this.particles = [];
    this.themeId = null;
    this.proj = [];
    this.buckets = new Map();
  }

  Renderer.prototype.resize = function (w, h) {
    w = Math.max(64, Math.round(w));
    h = Math.max(48, Math.round(h));
    if (w === this.W && h === this.H && this.bg) return;
    this.canvas.width = this.W = w;
    this.canvas.height = this.H = h;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.bg = null;
    this.vignette = null;
    if (this.themeId) this.prepareBackground();
  };

  Renderer.prototype.setQuality = function (q) {
    this.quality = q;
    this.drawDistance = q === 'low' ? 190 : 300;
  };

  Renderer.prototype.setTheme = function (themeId) {
    if (this.themeId === themeId && this.bg) return;
    this.themeId = themeId;
    this.theme = VC.THEMES[themeId];
    const t = this.theme;
    // Rampe de brouillard pré-calculée pour chaque couleur de la route.
    const fog = VC.rgb(t.fog);
    const ramp = (hex) => {
      const c = VC.rgb(hex);
      const out = [];
      for (let k = 0; k < FOG_STEPS; k++) {
        const f = k / (FOG_STEPS - 1);
        out.push(VC.css([VC.lerp(c[0], fog[0], f), VC.lerp(c[1], fog[1], f), VC.lerp(c[2], fog[2], f)]));
      }
      return out;
    };
    this.colors = {
      grass: [ramp(t.grass[0]), ramp(t.grass[1])],
      shoulder: [ramp(t.shoulder[0]), ramp(t.shoulder[1])],
      road: [ramp(t.road[0]), ramp(t.road[1])],
      rumble: [ramp(t.rumble[0]), ramp(t.rumble[1])],
      lane: ramp(t.lane),
      white: ramp('#f4f4f4'),
      black: ramp('#141414')
    };
    const res = this.quality === 'low' ? 0.75 : 1.1;
    this.props = VC.Art.buildProps(themeId, res);
    this.prepareBackground();
  };

  Renderer.prototype.prepareBackground = function () {
    this.bg = VC.Art.buildBackground(this.themeId, this.W, this.H);
    const ctx = this.ctx;
    const H = this.H;
    const hz = Math.round(H * 0.42);
    const t = this.theme;
    this.groundGrad = ctx.createLinearGradient(0, hz, 0, H);
    this.groundGrad.addColorStop(0, t.fog);
    this.groundGrad.addColorStop(0.25, VC.mix(t.grass[0], t.fog, 0.5));
    this.groundGrad.addColorStop(1, t.grass[0]);
    this.hazeGrad = ctx.createLinearGradient(0, hz - H * 0.09, 0, hz + H * 0.05);
    const fog = VC.rgb(t.fog);
    this.hazeGrad.addColorStop(0, VC.css(fog, 0));
    this.hazeGrad.addColorStop(0.6, VC.css(fog, t.night ? 0.35 : 0.5));
    this.hazeGrad.addColorStop(1, VC.css(fog, 0));
    // Vignette
    const v = document.createElement('canvas');
    v.width = Math.max(1, Math.round(this.W / 4));
    v.height = Math.max(1, Math.round(this.H / 4));
    const vx = v.getContext('2d');
    const g = vx.createRadialGradient(v.width / 2, v.height * 0.55, v.height * 0.35, v.width / 2, v.height * 0.55, v.width * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, t.night ? 'rgba(0,0,10,0.55)' : 'rgba(0,0,0,0.32)');
    vx.fillStyle = g;
    vx.fillRect(0, 0, v.width, v.height);
    this.vignette = v;
  };

  /* --------------------------------------------------------------------- */

  Renderer.prototype.drawBackground = function (ctx, speedRatio) {
    const W = this.W;
    const H = this.H;
    const bg = this.bg;
    const hz = bg.horizon;
    const t = this.theme;
    ctx.drawImage(bg.sky, 0, 0);
    ctx.fillStyle = this.groundGrad;
    ctx.fillRect(0, hz, W, H - hz);
    const sunX = ((t.sun.x * W - this.skyOffset * 0.04) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * 0.2;
    ctx.drawImage(bg.sun, sunX - bg.sun.width / 2, t.sun.y * H - bg.sun.height / 2);
    const layer = (img, factor, bottom) => {
      if (!img) return;
      const LW = img.width;
      let off = (this.skyOffset * factor) % LW;
      if (off < 0) off += LW;
      const y = bottom - img.height;
      for (let x = -off; x < W; x += LW) ctx.drawImage(img, Math.round(x), Math.round(y));
    };
    layer(bg.clouds, 0.1, hz - H * 0.12);
    layer(bg.far, 0.3, hz + 2);
    layer(bg.near, 0.6, hz + Math.round(H * 0.012));
  };

  /** Projette les segments visibles (de près à loin) et prépare le dessin. */
  Renderer.prototype.project = function (track, camZ, camX, camY) {
    const W = this.W;
    const H = this.H;
    const f = H * 1.1;
    const hz = H * 0.42;
    const segs = track.segments;
    const base = track.segAt(camZ);
    const basePct = (camZ - base.i * SEG) / SEG;
    let x = 0;
    let dx = -(base.curve * basePct);
    const proj = this.proj;
    let count = 0;
    const dd = this.drawDistance;
    for (let n = 0; n < dd; n++) {
      const i = base.i + n;
      if (i >= segs.length) break;
      const s = segs[i];
      const z1 = Math.max(40, i * SEG - camZ);
      const z2 = Math.max(41, (i + 1) * SEG - camZ);
      const k1 = f / z1;
      const k2 = f / z2;
      let p = proj[count];
      if (!p) p = proj[count] = {};
      p.seg = s;
      p.n = n;
      p.near = i * SEG - camZ;
      p.x1 = x;
      p.x2 = x + dx;
      p.k1 = k1;
      p.k2 = k2;
      p.sx1 = W / 2 + k1 * (x - camX);
      p.sy1 = Math.round(hz - k1 * (s.y1 - camY));
      p.w1 = k1 * ROAD;
      p.sx2 = W / 2 + k2 * (x + dx - camX);
      p.sy2 = Math.round(hz - k2 * (s.y2 - camY));
      p.w2 = k2 * ROAD;
      const fd = n / dd;
      p.fog = Math.min(FOG_STEPS - 1, Math.floor((1 - Math.exp(-fd * fd * this.theme.fogDensity)) * FOG_STEPS));
      x += dx;
      dx += s.curve;
      count++;
    }
    this.count = count;
    this.f = f;
    this.hz = hz;
    return count;
  };

  function quad(ctx, x1, y1, w1a, w1b, x2, y2, w2a, w2b, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1 + w1a, y1);
    ctx.lineTo(x1 + w1b, y1);
    ctx.lineTo(x2 + w2b, y2);
    ctx.lineTo(x2 + w2a, y2);
    ctx.closePath();
    ctx.fill();
  }

  Renderer.prototype.drawSegment = function (ctx, p, far) {
    const W = this.W;
    const c = this.colors;
    const s = p.seg;
    const group = Math.floor(s.i / 3) % 2;
    const fog = p.fog;
    const y1 = p.sy1;
    const y2 = far ? far.sy2 : p.sy2;
    const x2 = far ? far.sx2 : p.sx2;
    const w2 = far ? far.w2 : p.w2;
    const x1 = p.sx1;
    const w1 = p.w1;
    if (y2 >= y1) return;
    ctx.fillStyle = c.grass[group][fog];
    ctx.fillRect(0, y2, W, y1 - y2);
    // Accotements
    quad(ctx, x1, y1, -w1 * 1.3, w1 * 1.3, x2, y2, -w2 * 1.3, w2 * 1.3, c.shoulder[group][fog]);
    // Bordures (vibreurs)
    quad(ctx, x1, y1, -w1 * 1.085, w1 * 1.085, x2, y2, -w2 * 1.085, w2 * 1.085, c.rumble[group][fog]);
    // Chaussée
    quad(ctx, x1, y1, -w1, w1, x2, y2, -w2, w2, c.road[group][fog]);
    if (w1 < 3) return;
    if (s.mark) {
      this.drawCheckers(ctx, p, x1, y1, w1, x2, y2, w2, s.mark === 'finish');
      return;
    }
    // Lignes de rive et ligne centrale discontinue.
    const lane = c.lane[fog];
    quad(ctx, x1, y1, -w1 * 0.95, -w1 * 0.92, x2, y2, -w2 * 0.95, -w2 * 0.92, lane);
    quad(ctx, x1, y1, w1 * 0.92, w1 * 0.95, x2, y2, w2 * 0.92, w2 * 0.95, lane);
    if (group === 0) quad(ctx, x1, y1, -w1 * 0.018, w1 * 0.018, x2, y2, -w2 * 0.018, w2 * 0.018, lane);
  };

  Renderer.prototype.drawCheckers = function (ctx, p, x1, y1, w1, x2, y2, w2, finish) {
    const c = this.colors;
    const n = finish ? 14 : 1;
    const rows = finish ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const ta = r / rows;
      const tb = (r + 1) / rows;
      const ya = VC.lerp(y1, y2, ta);
      const yb = VC.lerp(y1, y2, tb);
      const xa = VC.lerp(x1, x2, ta);
      const xb = VC.lerp(x1, x2, tb);
      const wa = VC.lerp(w1, w2, ta);
      const wb = VC.lerp(w1, w2, tb);
      for (let k = 0; k < n; k++) {
        const u0 = -1 + 2 * k / n;
        const u1 = -1 + 2 * (k + 1) / n;
        const col = finish ? ((k + r) % 2 ? c.black[p.fog] : c.white[p.fog]) : c.white[p.fog];
        quad(ctx, xa, ya, wa * u0, wa * u1, xb, yb, wb * u0, wb * u1, col);
      }
    }
  };

  Renderer.prototype.drawProp = function (ctx, p, prop, frameT) {
    const list = this.props[prop.kind];
    if (!list) return;
    const v = list[(prop.seed !== undefined ? prop.seed : (p.seg.i * 7 + (prop.x > 0 ? 3 : 0))) % list.length];
    const k = p.k1;
    const dw = v.ww * prop.s * k;
    const dh = v.wh * prop.s * k;
    if (dh < 1.2) return;
    const cx = p.sx1 + prop.x * k;
    const x0 = cx - dw / 2;
    if (x0 > this.W || x0 + dw < 0) return;
    const y0 = p.sy1 - dh;
    const img = v.imgs.length > 1 ? v.imgs[Math.floor(frameT * 3 + p.seg.i) % v.imgs.length] : v.imgs[0];
    if (prop.flip && !NO_FLIP.has(prop.kind)) {
      ctx.save();
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, -dw / 2, y0, dw, dh);
      if (p.fog > 1) {
        ctx.globalAlpha = p.fog / (FOG_STEPS - 1);
        ctx.drawImage(v.fog, -dw / 2, y0, dw, dh);
      }
      ctx.restore();
    } else {
      ctx.drawImage(img, x0, y0, dw, dh);
      if (p.fog > 1) {
        ctx.globalAlpha = p.fog / (FOG_STEPS - 1);
        ctx.drawImage(v.fog, x0, y0, dw, dh);
        ctx.globalAlpha = 1;
      }
    }
    if (v.glow && this.theme.night) {
      const g = this.props.glow;
      const gr = dw * v.glow.r;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.8;
      ctx.drawImage(g, cx - gr, y0 + dh * v.glow.y - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* --------------------------------------------------------------------- */

  /**
   * Rendu d'une image. opts : { dt, focus (coureur suivi), labels, effects }
   */
  Renderer.prototype.render = function (race, opts) {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const dt = opts.dt || 0;
    this.time += dt;
    const track = race.track;
    const me = opts.focus || race.player;
    if (track.themeId !== this.themeId) this.setTheme(track.themeId);

    const playerY = track.yAt(me.z);
    const camZ = me.z - PLAYER_Z;
    const camY = playerY + CAM_H;
    const pSeg = track.segAt(me.z);
    const speedRatio = me.speed / me.sprintSpeed;
    this.skyOffset += pSeg.curve * speedRatio * dt * 26 * (W / 1000);

    // Caméra : suit le coureur avec un léger retard (sensation de vitesse dans les virages).
    this.project(track, camZ, this.camX, camY);
    let curveAtMe = 0;
    for (let k = 0; k < this.count; k++) {
      const p = this.proj[k];
      if (p.near + SEG > PLAYER_Z) {
        const tt = VC.clamp((PLAYER_Z - p.near) / SEG, 0, 1);
        curveAtMe = VC.lerp(p.x1, p.x2, tt);
        break;
      }
    }
    const wantX = me.x * 0.92 + curveAtMe;
    this.camX = dt > 0 ? VC.approach(this.camX, wantX, 7, dt) : wantX;
    this.project(track, camZ, this.camX, camY);

    ctx.save();
    if (this.shake > 0) {
      const a = this.shake * H * 0.012;
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      this.shake = Math.max(0, this.shake - dt * 3);
    }

    this.drawBackground(ctx, speedRatio);
    // Brume à l'horizon (sur l'arrière-plan seulement).
    ctx.fillStyle = this.hazeGrad;
    ctx.fillRect(0, this.hz - H * 0.09, W, H * 0.14);

    // Coureurs rangés par segment.
    const buckets = this.buckets;
    buckets.clear();
    for (const r of race.riders) {
      const rz = r.z - camZ;
      if (rz < 260) continue;
      const i = Math.floor(r.z / SEG);
      let b = buckets.get(i);
      if (!b) buckets.set(i, b = []);
      b.push(r);
    }

    // Dessin de l'arrière vers l'avant (peintre) : route, décors puis coureurs.
    // Les segments lointains de moins d'un pixel sont regroupés en un seul polygone.
    const count = this.count;
    const frameT = this.time;
    let pf = null;
    let pn = null;
    const flush = () => {
      if (pn) this.drawSegment(ctx, pn, pf);
      pf = pn = null;
    };
    for (let k = count - 1; k >= 0; k--) {
      const p = this.proj[k];
      const s = p.seg;
      const b = buckets.get(s.i);
      if (p.sy2 < p.sy1) {
        if (k > 0 && !s.mark && p.sy1 - p.sy2 < 1) {
          if (!pf) pf = p;
          pn = p;
          if (s.props.length || b) flush();
        } else {
          flush();
          this.drawSegment(ctx, p, null);
        }
      } else {
        flush();
      }
      const props = s.props;
      for (let j = 0; j < props.length; j++) this.drawProp(ctx, p, props[j], frameT);
      if (b) {
        if (b.length > 1) b.sort((a, c) => c.z - a.z);
        for (const r of b) this.drawRiderAt(ctx, r, p, camZ, camY, track, opts, race);
      }
    }
    flush();

    if (opts.effects !== false) this.drawEffects(ctx, race, me, dt);
    ctx.restore();
  };

  Renderer.prototype.drawRiderAt = function (ctx, r, p, camZ, camY, track, opts, race) {
    const rz = r.z - camZ;
    const k = this.f / rz;
    const t = VC.clamp((r.z - p.seg.i * SEG) / SEG, 0, 1);
    const cx = VC.lerp(p.x1, p.x2, t);
    const sx = this.W / 2 + k * (cx + r.x - this.camX);
    const sy = this.hz - k * (track.yAt(r.z) - camY);
    const s = k * VC.BODY;
    if (sx < -s * 60 || sx > this.W + s * 60) return;
    VC.Art.drawRider(ctx, r, sx, sy, s, this.theme.night);
    if (opts.labels && !r.isPlayer && r.z > race.player.z && rz < 26 * VC.U_M && s > 0.12) {
      const size = Math.max(11, Math.min(26, s * 15));
      const y = sy - (165 + r.stand * 12) * s - size;
      ctx.font = '800 ' + Math.round(size * 0.78) + 'px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = String(r.rank);
      const w = Math.max(size * 1.2, ctx.measureText(label).width + size * 0.7);
      ctx.globalAlpha = VC.clamp(1.6 - rz / (18 * VC.U_M), 0.25, 0.92);
      ctx.fillStyle = 'rgba(10,12,20,0.75)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(sx - w / 2, y - size / 2, w, size, size / 2) : ctx.rect(sx - w / 2, y - size / 2, w, size);
      ctx.fill();
      ctx.fillStyle = r.favorite ? '#ffd21f' : '#ffffff';
      ctx.fillText(label, sx, y + 1);
      ctx.globalAlpha = 1;
    }
  };

  Renderer.prototype.drawEffects = function (ctx, race, me, dt) {
    const W = this.W;
    const H = this.H;
    // Lignes de vitesse en sprint.
    const sp = me.speed / me.sprintSpeed;
    const intensity = VC.clamp((sp - 0.82) / 0.2, 0, 1) * (me.sprinting ? 1 : 0.35);
    if (intensity > 0.02 && this.quality !== 'low') {
      const cx = W / 2;
      const cy = this.hz + H * 0.06;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.28 * intensity).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, H * 0.003);
      ctx.beginPath();
      const n = 26;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (Math.floor(this.time * 20) % 7) * 0.13;
        const r0 = H * (0.42 + ((i * 37 + Math.floor(this.time * 30)) % 10) * 0.035);
        const r1 = r0 + H * 0.25 * intensity;
        ctx.moveTo(cx + Math.cos(a) * r0 * 1.6, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1 * 1.6, cy + Math.sin(a) * r1);
      }
      ctx.stroke();
    }
    // Particules (confettis, poussière).
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.life -= dt;
      if (q.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += q.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.min(1, q.life * 2);
      ctx.translate(q.x * W, q.y * H);
      ctx.rotate(q.rot);
      ctx.fillStyle = q.color;
      ctx.fillRect(-q.size * H / 2, -q.size * H / 4, q.size * H, q.size * H / 2);
      ctx.restore();
    }
    if (me.offroad && me.speed > 500 && this.quality !== 'low' && Math.random() < 0.6) {
      ps.push({
        x: 0.5 + (Math.random() - 0.5) * 0.03, y: 0.94, vx: (Math.random() - 0.5) * 0.25, vy: -Math.random() * 0.3,
        g: 0.9, rot: 0, vr: 3, size: 0.008, life: 0.5, color: this.theme.shoulder[1]
      });
    }
    if (this.vignette && this.quality !== 'low') ctx.drawImage(this.vignette, 0, 0, W, H);
  };

  Renderer.prototype.confetti = function () {
    const colors = ['#ffd21f', '#ff4d6d', '#4dabf7', '#69db7c', '#ffffff', '#b197fc'];
    for (let i = 0; i < 160; i++) {
      this.particles.push({
        x: Math.random(), y: -0.05 - Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.15, vy: Math.random() * 0.2,
        g: 0.25, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, size: 0.012 + Math.random() * 0.01,
        life: 2.5 + Math.random() * 2, color: colors[i % colors.length]
      });
    }
  };

  VC.Renderer = Renderer;
  VC.Renderer.PLAYER_Z = PLAYER_Z;
})(typeof window !== 'undefined' ? window : globalThis);
