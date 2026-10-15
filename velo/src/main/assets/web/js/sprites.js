/* Vélo Champion — graphismes procéduraux : décors, arrière-plans, coureurs, vélos. */
(function (root) {
  'use strict';
  const VC = root.VC;
  const Art = VC.Art = {};
  const TAU = Math.PI * 2;

  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  const lin = (ctx, x0, y0, x1, y1, stops) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach((s, i) => g.addColorStop(s[1] !== undefined ? s[1] : i / (stops.length - 1), s[0]));
    return g;
  };
  const rad = (ctx, x, y, r0, r1, stops) => {
    const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    stops.forEach((s, i) => g.addColorStop(s[1] !== undefined ? s[1] : i / (stops.length - 1), s[0]));
    return g;
  };
  const ellipse = (ctx, x, y, rx, ry, fill) => {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const rrect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const poly = (ctx, pts, fill) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const groundShadow = (ctx, w, h, k) => ellipse(ctx, w / 2, h - h * 0.025, w * (k || 0.36), h * 0.03, 'rgba(0,0,0,0.22)');
  const font = (px, weight) => (weight || 800) + ' ' + Math.round(px) + 'px Inter, system-ui, sans-serif';

  /* ======================================================================= */
  /* Décors                                                                   */
  /* ======================================================================= */

  function blobTree(ctx, w, h, rnd, base, cx, cy, rx, ry, n) {
    const light = VC.shade(base, 0.28);
    const dark = VC.shade(base, -0.35);
    for (let k = 0; k < n; k++) {
      const a = rnd() * TAU;
      const d = Math.sqrt(rnd());
      const x = cx + Math.cos(a) * rx * 0.62 * d;
      const y = cy + Math.sin(a) * ry * 0.6 * d;
      const r = (rx + ry) * 0.5 * VC.lerp(0.36, 0.55, rnd());
      ctx.fillStyle = rad(ctx, x - r * 0.35, y - r * 0.4, r * 0.1, r * 1.05, [[light], [base, 0.55], [dark]]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let k = 0; k < 40; k++) {
      ctx.beginPath();
      ctx.arc(cx + (rnd() - 0.6) * rx * 1.3, cy + (rnd() - 0.7) * ry * 1.1, w * 0.012 + rnd() * w * 0.012, 0, TAU);
      ctx.fill();
    }
  }

  function trunk(ctx, x, top, bottom, wTop, wBot, color) {
    ctx.fillStyle = lin(ctx, x - wBot, 0, x + wBot, 0, [[VC.shade(color, -0.3)], [VC.shade(color, 0.15), 0.4], [VC.shade(color, -0.45)]]);
    ctx.beginPath();
    ctx.moveTo(x - wTop, top);
    ctx.lineTo(x + wTop, top);
    ctx.lineTo(x + wBot, bottom);
    ctx.quadraticCurveTo(x, bottom + wBot * 0.3, x - wBot, bottom);
    ctx.closePath();
    ctx.fill();
  }

  function pineShape(ctx, w, h, color, snow, rnd) {
    groundShadow(ctx, w, h, 0.3);
    trunk(ctx, w / 2, h * 0.7, h * 0.985, w * 0.03, w * 0.05, '#5b3a24');
    const layers = 6;
    for (let k = 0; k < layers; k++) {
      const t = k / (layers - 1);
      const yb = VC.lerp(h * 0.86, h * 0.2, t);
      const half = VC.lerp(w * 0.48, w * 0.16, t);
      const top = yb - h * VC.lerp(0.3, 0.2, t);
      ctx.fillStyle = lin(ctx, w / 2 - half, 0, w / 2 + half, 0, [[VC.shade(color, -0.25)], [VC.shade(color, 0.12), 0.42], [VC.shade(color, -0.42)]]);
      ctx.beginPath();
      ctx.moveTo(w / 2, top);
      ctx.quadraticCurveTo(w / 2 + half * 0.5, yb - h * 0.08, w / 2 + half, yb);
      for (let j = 4; j >= -4; j--) ctx.lineTo(w / 2 + half * j / 4, yb + (j % 2 === 0 ? h * 0.012 : -h * 0.008));
      ctx.quadraticCurveTo(w / 2 - half * 0.5, yb - h * 0.08, w / 2, top);
      ctx.fill();
      if (snow) {
        ctx.fillStyle = 'rgba(250,252,255,0.92)';
        ctx.beginPath();
        ctx.moveTo(w / 2, top);
        ctx.quadraticCurveTo(w / 2 + half * 0.3, yb - h * 0.12, w / 2 + half * 0.55, yb - h * 0.05);
        ctx.quadraticCurveTo(w / 2, yb - h * 0.11 - rnd() * h * 0.02, w / 2 - half * 0.5, yb - h * 0.055);
        ctx.quadraticCurveTo(w / 2 - half * 0.3, yb - h * 0.12, w / 2, top);
        ctx.fill();
      }
    }
  }

  function house(ctx, w, h, wall, roof, shutter, rnd, kind) {
    groundShadow(ctx, w, h, 0.46);
    const x0 = w * 0.08;
    const x1 = w * 0.92;
    const wallTop = h * (kind === 'chalet' ? 0.48 : 0.42);
    const bottom = h * 0.97;
    ctx.fillStyle = lin(ctx, x0, 0, x1, 0, [[VC.shade(wall, -0.18)], [wall, 0.35], [VC.shade(wall, -0.3)]]);
    ctx.fillRect(x0, wallTop, x1 - x0, bottom - wallTop);
    if (kind === 'chalet') {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = wallTop + h * 0.03; y < bottom; y += h * 0.045) ctx.fillRect(x0, y, x1 - x0, h * 0.006);
      ctx.fillStyle = VC.shade(wall, -0.35);
      ctx.fillRect(x0 - w * 0.02, h * 0.66, x1 - x0 + w * 0.04, h * 0.035);
      ctx.fillStyle = '#d94040';
      for (let x = x0 + w * 0.05; x < x1 - w * 0.06; x += w * 0.09) ellipse(ctx, x + w * 0.03, h * 0.655, w * 0.03, h * 0.016, rnd() < 0.5 ? '#e53935' : '#f06292');
    }
    // Toit
    const over = w * 0.06;
    ctx.fillStyle = lin(ctx, 0, h * 0.08, 0, wallTop, [[VC.shade(roof, 0.12)], [VC.shade(roof, -0.25)]]);
    ctx.beginPath();
    if (kind === 'villa') {
      ctx.moveTo(x0 - over, wallTop + h * 0.01);
      ctx.lineTo(w * 0.5, wallTop - h * 0.16);
      ctx.lineTo(x1 + over, wallTop + h * 0.01);
    } else {
      ctx.moveTo(x0 - over, wallTop + h * 0.02);
      ctx.lineTo(w * 0.5, h * (kind === 'chalet' ? 0.12 : 0.1));
      ctx.lineTo(x1 + over, wallTop + h * 0.02);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = Math.max(1, w * 0.004);
    for (let k = 1; k < 7; k++) {
      ctx.beginPath();
      const t = k / 7;
      ctx.moveTo(VC.lerp(x0 - over, w * 0.5, t), VC.lerp(wallTop, h * 0.11, t));
      ctx.lineTo(VC.lerp(x1 + over, w * 0.5, t), VC.lerp(wallTop, h * 0.11, t));
      ctx.stroke();
    }
    if (kind === 'house') {
      ctx.fillStyle = VC.shade(roof, -0.4);
      ctx.fillRect(w * 0.68, h * 0.13, w * 0.07, h * 0.16);
    }
    // Fenêtres et porte
    const win = (x, y) => {
      ctx.fillStyle = shutter;
      ctx.fillRect(x - w * 0.085, y, w * 0.035, h * 0.13);
      ctx.fillRect(x + w * 0.05, y, w * 0.035, h * 0.13);
      ctx.fillStyle = lin(ctx, 0, y, 0, y + h * 0.13, [['#cfe8ff'], ['#7aa6cf']]);
      ctx.fillRect(x - w * 0.05, y, w * 0.1, h * 0.13);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(x - w * 0.004, y, w * 0.008, h * 0.13);
    };
    win(w * 0.26, h * 0.58);
    win(w * 0.74, h * 0.58);
    ctx.fillStyle = VC.shade(shutter, -0.25);
    rrect(ctx, w * 0.44, h * 0.68, w * 0.12, h * 0.29, w * 0.02);
    ctx.fill();
    if (kind === 'villa') {
      for (let k = 0; k < 55; k++) ellipse(ctx, w * (0.08 + rnd() * 0.24), h * (0.45 + rnd() * 0.4), w * 0.016, w * 0.014, rnd() < 0.7 ? '#e91e8c' : '#4caf50');
    }
  }

  function rock(ctx, w, h, color, rnd) {
    groundShadow(ctx, w, h, 0.45);
    const pts = [];
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const a = Math.PI + (k / n) * Math.PI;
      const r = VC.lerp(0.8, 1, rnd());
      pts.push(w / 2 + Math.cos(a) * w * 0.47 * r, h * 0.97 + Math.sin(a) * h * 0.9 * r);
    }
    ctx.fillStyle = lin(ctx, 0, 0, w, h, [[VC.shade(color, 0.25)], [color, 0.45], [VC.shade(color, -0.4)]]);
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = w * 0.01;
    ctx.beginPath();
    ctx.moveTo(w * 0.35, h * 0.25);
    ctx.lineTo(w * 0.45, h * 0.6);
    ctx.lineTo(w * 0.42, h * 0.95);
    ctx.moveTo(w * 0.6, h * 0.35);
    ctx.lineTo(w * 0.7, h * 0.75);
    ctx.stroke();
  }

  function textBoard(ctx, x, y, w, h, bg, fg, text, size) {
    ctx.fillStyle = bg;
    rrect(ctx, x, y, w, h, Math.min(w, h) * 0.08);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = font(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + size * 0.05);
  }

  const PROPS = {
    tree: {
      px: [240, 300], world: [2700, 3400], draw(ctx, w, h, t, rnd) {
        groundShadow(ctx, w, h, 0.32);
        trunk(ctx, w / 2, h * 0.45, h * 0.985, w * 0.035, w * 0.06, '#6b4a2f');
        blobTree(ctx, w, h, rnd, t.night ? '#1f3d2a' : (t === VC.THEMES.cote ? '#5f7d36' : '#3d8b2f'), w / 2, h * 0.36, w * 0.42, h * 0.3, 10);
      }
    },
    tree2: {
      px: [150, 330], world: [1500, 4300], draw(ctx, w, h, t, rnd) {
        groundShadow(ctx, w, h, 0.25);
        trunk(ctx, w / 2, h * 0.7, h * 0.985, w * 0.03, w * 0.06, '#5a3d27');
        const c = '#2f7a35';
        ctx.fillStyle = rad(ctx, w * 0.4, h * 0.3, w * 0.05, w * 0.7, [[VC.shade(c, 0.25)], [c, 0.5], [VC.shade(c, -0.4)]]);
        ctx.beginPath();
        ctx.ellipse(w / 2, h * 0.45, w * 0.36, h * 0.43, 0, 0, TAU);
        ctx.fill();
        blobTree(ctx, w, h, rnd, c, w / 2, h * 0.42, w * 0.3, h * 0.36, 7);
      }
    },
    bush: {
      px: [180, 110], world: [1200, 720], draw(ctx, w, h, t, rnd) {
        groundShadow(ctx, w, h, 0.42);
        blobTree(ctx, w, h, rnd, t === VC.THEMES.cote ? '#6f8f3a' : '#3f9437', w / 2, h * 0.62, w * 0.42, h * 0.35, 8);
        if (rnd() < 0.6) for (let k = 0; k < 14; k++) ellipse(ctx, w * (0.15 + rnd() * 0.7), h * (0.35 + rnd() * 0.45), w * 0.018, w * 0.018, rnd() < 0.5 ? '#ffe14d' : '#ffffff');
      }
    },
    fence: {
      px: [260, 90], world: [1900, 600], draw(ctx, w, h) {
        const wood = '#a87b4f';
        for (const x of [0.08, 0.5, 0.92]) {
          ctx.fillStyle = lin(ctx, w * x - 6, 0, w * x + 6, 0, [[VC.shade(wood, -0.2)], [wood], [VC.shade(wood, -0.4)]]);
          ctx.fillRect(w * x - w * 0.025, h * 0.1, w * 0.05, h * 0.9);
        }
        ctx.fillStyle = VC.shade(wood, 0.08);
        ctx.fillRect(0, h * 0.25, w, h * 0.13);
        ctx.fillRect(0, h * 0.58, w, h * 0.13);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, h * 0.36, w, h * 0.03);
        ctx.fillRect(0, h * 0.69, w, h * 0.03);
      }
    },
    house: {
      px: [300, 260], world: [4300, 3700], draw(ctx, w, h, t, rnd) {
        house(ctx, w, h, '#f1e3c6', '#b5482f', '#3f6fae', rnd, 'house');
      }
    },
    villa: {
      px: [320, 250], world: [4600, 3600], draw(ctx, w, h, t, rnd) {
        house(ctx, w, h, '#fbf6ee', '#d0623a', '#2d7fc1', rnd, 'villa');
      }
    },
    chalet: {
      px: [300, 280], world: [4200, 3900], draw(ctx, w, h, t, rnd) {
        house(ctx, w, h, '#9a6a3f', '#5a3b24', '#2f5d3a', rnd, 'chalet');
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.12);
        ctx.lineTo(w * 0.8, h * 0.32);
        ctx.lineTo(w * 0.2, h * 0.32);
        ctx.closePath();
        ctx.fill();
      }
    },
    hay: {
      px: [150, 115], world: [950, 740], draw(ctx, w, h) {
        groundShadow(ctx, w, h, 0.45);
        ctx.fillStyle = lin(ctx, 0, 0, w, 0, [['#c99a3a'], ['#f1cf6d', 0.4], ['#a67a26']]);
        rrect(ctx, w * 0.06, h * 0.12, w * 0.88, h * 0.85, w * 0.2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,80,20,0.45)';
        ctx.lineWidth = w * 0.015;
        for (let k = 1; k < 5; k++) {
          ctx.beginPath();
          ctx.ellipse(w / 2, h * 0.55, w * 0.09 * k, h * 0.085 * k, 0, 0, TAU);
          ctx.stroke();
        }
      }
    },
    flowers: {
      px: [200, 70], world: [1300, 450], draw(ctx, w, h, t, rnd) {
        const colors = ['#ff5252', '#ffeb3b', '#ffffff', '#ab47bc', '#ff9800'];
        ctx.strokeStyle = '#3e8e2f';
        ctx.lineWidth = w * 0.01;
        for (let k = 0; k < 40; k++) {
          const x = w * (0.05 + rnd() * 0.9);
          const y = h * (0.35 + rnd() * 0.4);
          ctx.beginPath();
          ctx.moveTo(x, h);
          ctx.lineTo(x + (rnd() - 0.5) * w * 0.03, y);
          ctx.stroke();
          ellipse(ctx, x, y, w * 0.016, w * 0.016, colors[k % colors.length]);
        }
      }
    },
    palm: {
      px: [270, 420], world: [2900, 5200], draw(ctx, w, h, t, rnd) {
        groundShadow(ctx, w, h, 0.22);
        const bend = (rnd() - 0.5) * w * 0.3;
        const topX = w / 2 + bend;
        const topY = h * 0.24;
        for (let k = 0; k < 18; k++) {
          const a = k / 18;
          const x = VC.lerp(w / 2, topX, a * a);
          const y = VC.lerp(h * 0.985, topY, a);
          const r = VC.lerp(w * 0.055, w * 0.035, a);
          ellipse(ctx, x, y, r, h * 0.03, k % 2 ? '#8a6640' : '#a37b4e');
        }
        const leaf = (ang, len) => {
          const ex = topX + Math.cos(ang) * len;
          const ey = topY + Math.sin(ang) * len * 0.6 + len * 0.25;
          ctx.fillStyle = lin(ctx, topX, topY, ex, ey, [['#2f7d32'], ['#57a33b'], ['#2e6b2a']]);
          ctx.beginPath();
          ctx.moveTo(topX, topY);
          ctx.quadraticCurveTo((topX + ex) / 2 + Math.sin(ang) * len * 0.2, topY - len * 0.32, ex, ey);
          ctx.quadraticCurveTo((topX + ex) / 2, topY - len * 0.08, topX, topY + h * 0.02);
          ctx.fill();
        };
        for (let k = 0; k < 9; k++) leaf(Math.PI + (k / 8) * Math.PI + (rnd() - 0.5) * 0.3, w * VC.lerp(0.38, 0.5, rnd()));
        for (let k = 0; k < 3; k++) ellipse(ctx, topX + (k - 1) * w * 0.035, topY + h * 0.03, w * 0.03, w * 0.03, '#6b4a1f');
      }
    },
    lamp: {
      px: [90, 420], world: [600, 3500], glow: { color: '#ffd98a', r: 1.6, y: 0.06 }, draw(ctx, w, h, t) {
        ctx.fillStyle = lin(ctx, 0, 0, w, 0, [['#2b2f36'], ['#6b737e', 0.45], ['#22262c']]);
        ctx.fillRect(w * 0.42, h * 0.06, w * 0.16, h * 0.94);
        ctx.fillRect(w * 0.34, h * 0.94, w * 0.32, h * 0.06);
        ctx.fillRect(w * 0.2, h * 0.04, w * 0.6, h * 0.035);
        ctx.fillStyle = t.night ? '#fff6d0' : '#e9e2c8';
        rrect(ctx, w * 0.16, h * 0.065, w * 0.68, h * 0.03, w * 0.1);
        ctx.fill();
      }
    },
    rock: {
      px: [210, 140], world: [1700, 1150], draw(ctx, w, h, t, rnd) {
        const c = t === VC.THEMES.canyon ? '#b5603f' : t === VC.THEMES.alpes ? '#8d8f94' : '#b8a585';
        rock(ctx, w, h, c, rnd);
      }
    },
    cactus: {
      px: [170, 300], world: [1300, 2500], draw(ctx, w, h) {
        groundShadow(ctx, w, h, 0.3);
        const g = lin(ctx, 0, 0, w, 0, [['#2c6b38'], ['#5fae55', 0.45], ['#24572e']]);
        ctx.fillStyle = g;
        rrect(ctx, w * 0.4, h * 0.06, w * 0.2, h * 0.94, w * 0.1);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(w * 0.42, h * 0.62);
        ctx.lineTo(w * 0.18, h * 0.62);
        ctx.quadraticCurveTo(w * 0.1, h * 0.62, w * 0.1, h * 0.5);
        ctx.lineTo(w * 0.1, h * 0.3);
        ctx.quadraticCurveTo(w * 0.1, h * 0.24, w * 0.17, h * 0.24);
        ctx.quadraticCurveTo(w * 0.24, h * 0.24, w * 0.24, h * 0.3);
        ctx.lineTo(w * 0.24, h * 0.52);
        ctx.lineTo(w * 0.42, h * 0.52);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(w * 0.58, h * 0.48);
        ctx.lineTo(w * 0.8, h * 0.48);
        ctx.quadraticCurveTo(w * 0.9, h * 0.48, w * 0.9, h * 0.36);
        ctx.lineTo(w * 0.9, h * 0.18);
        ctx.quadraticCurveTo(w * 0.9, h * 0.12, w * 0.83, h * 0.12);
        ctx.quadraticCurveTo(w * 0.76, h * 0.12, w * 0.76, h * 0.18);
        ctx.lineTo(w * 0.76, h * 0.38);
        ctx.lineTo(w * 0.58, h * 0.38);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = w * 0.012;
        for (const x of [0.46, 0.5, 0.54]) {
          ctx.beginPath();
          ctx.moveTo(w * x, h * 0.1);
          ctx.lineTo(w * x, h * 0.98);
          ctx.stroke();
        }
      }
    },
    cactus2: {
      px: [150, 120], world: [1000, 800], draw(ctx, w, h, t, rnd) {
        groundShadow(ctx, w, h, 0.45);
        for (let k = 0; k < 5; k++) {
          const x = w * (0.2 + rnd() * 0.6);
          const y = h * (0.35 + rnd() * 0.35);
          ctx.fillStyle = rad(ctx, x - w * 0.05, y - h * 0.08, 2, w * 0.25, [['#7cc46a'], ['#3f8a46']]);
          ctx.beginPath();
          ctx.ellipse(x, y, w * 0.14, h * 0.24, (rnd() - 0.5) * 0.9, 0, TAU);
          ctx.fill();
        }
        for (let k = 0; k < 3; k++) ellipse(ctx, w * (0.3 + rnd() * 0.4), h * (0.15 + rnd() * 0.2), w * 0.04, w * 0.035, '#ff5a8a');
      }
    },
    skull: {
      px: [130, 80], world: [700, 430], draw(ctx, w, h) {
        ctx.strokeStyle = '#efe6d2';
        ctx.lineWidth = h * 0.12;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(w * 0.1, h * 0.2);
        ctx.quadraticCurveTo(w * 0.25, h * 0.5, w * 0.4, h * 0.45);
        ctx.moveTo(w * 0.9, h * 0.2);
        ctx.quadraticCurveTo(w * 0.75, h * 0.5, w * 0.6, h * 0.45);
        ctx.stroke();
        ellipse(ctx, w / 2, h * 0.62, w * 0.14, h * 0.33, '#f3ecdc');
        ellipse(ctx, w * 0.45, h * 0.55, w * 0.03, h * 0.07, '#3a2a1a');
        ellipse(ctx, w * 0.55, h * 0.55, w * 0.03, h * 0.07, '#3a2a1a');
      }
    },
    sign: {
      px: [170, 200], world: [1100, 1300], draw(ctx, w, h) {
        ctx.fillStyle = '#6d4a2a';
        ctx.fillRect(w * 0.45, h * 0.3, w * 0.1, h * 0.7);
        ctx.fillStyle = lin(ctx, 0, 0, 0, h * 0.4, [['#c8955c'], ['#9c6b3a']]);
        poly(ctx, [w * 0.05, h * 0.08, w * 0.8, h * 0.08, w * 0.96, h * 0.22, w * 0.8, h * 0.36, w * 0.05, h * 0.36], ctx.fillStyle);
        ctx.fillStyle = '#3a2412';
        ctx.font = font(h * 0.16);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ROUTE 66', w * 0.46, h * 0.225);
      }
    },
    pine: {
      px: [170, 360], world: [1800, 4400], draw(ctx, w, h, t, rnd) {
        pineShape(ctx, w, h, t.night ? '#15301f' : '#24603a', false, rnd);
      }
    },
    pine2: {
      px: [150, 290], world: [1400, 3300], draw(ctx, w, h, t, rnd) {
        pineShape(ctx, w, h, '#2b6b40', true, rnd);
      }
    },
    snow: {
      px: [220, 90], world: [1600, 560], draw(ctx, w, h, t, rnd) {
        rock(ctx, w * 0.5, h * 0.9, '#7f838a', rnd);
        ctx.fillStyle = lin(ctx, 0, 0, 0, h, [['#ffffff'], ['#d6e4f5']]);
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.quadraticCurveTo(w * 0.2, h * 0.3, w * 0.45, h * 0.5);
        ctx.quadraticCurveTo(w * 0.7, h * 0.15, w, h);
        ctx.closePath();
        ctx.fill();
      }
    },
    cow: {
      px: [210, 140], world: [1500, 1000], draw(ctx, w, h) {
        groundShadow(ctx, w, h, 0.42);
        ctx.fillStyle = '#4b3a2e';
        for (const x of [0.25, 0.35, 0.65, 0.75]) ctx.fillRect(w * x, h * 0.6, w * 0.05, h * 0.37);
        ctx.fillStyle = lin(ctx, 0, h * 0.25, 0, h * 0.7, [['#ffffff'], ['#dcd6cc']]);
        rrect(ctx, w * 0.2, h * 0.28, w * 0.62, h * 0.38, h * 0.16);
        ctx.fill();
        ellipse(ctx, w * 0.4, h * 0.42, w * 0.09, h * 0.09, '#7a4b2a');
        ellipse(ctx, w * 0.62, h * 0.38, w * 0.07, h * 0.08, '#7a4b2a');
        ctx.fillStyle = '#e8e1d6';
        rrect(ctx, w * 0.78, h * 0.18, w * 0.17, h * 0.26, h * 0.08);
        ctx.fill();
        ellipse(ctx, w * 0.9, h * 0.38, w * 0.06, h * 0.06, '#f2b8a8');
        ellipse(ctx, w * 0.82, h * 0.52, w * 0.025, w * 0.025, '#d4a73a');
      }
    },
    building: {
      px: [240, 520], world: [3600, 9500], night: true, draw(ctx, w, h, t, rnd) {
        const base = rnd.pick(['#20253b', '#2a2140', '#1c2a3a', '#2d2335']);
        ctx.fillStyle = lin(ctx, 0, 0, w, 0, [[VC.shade(base, 0.1)], [VC.shade(base, -0.3)]]);
        ctx.fillRect(w * 0.06, h * 0.06, w * 0.88, h * 0.94);
        ctx.fillStyle = VC.shade(base, -0.4);
        ctx.fillRect(w * 0.3, h * 0.02, w * 0.4, h * 0.05);
        ctx.fillStyle = '#ff3b3b';
        ellipse(ctx, w * 0.5, h * 0.015, w * 0.02, w * 0.02, '#ff3b3b');
        const cols = 6;
        const rows = 22;
        const lit = rnd.pick([['#ffd76a', '#ffe9a8'], ['#7fe8ff', '#c9f6ff'], ['#ff9de6', '#ffd3f4']]);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const on = rnd() < 0.55;
            ctx.fillStyle = on ? (rnd() < 0.5 ? lit[0] : lit[1]) : 'rgba(0,0,0,0.35)';
            ctx.fillRect(w * (0.12 + c * 0.13), h * (0.09 + r * 0.04), w * 0.08, h * 0.022);
          }
        }
        ctx.fillStyle = rnd.pick(['#ff2bd6', '#22e4ff', '#fff36b']);
        ctx.fillRect(w * 0.06, h * 0.06, w * 0.88, h * 0.008);
      }
    },
    building2: {
      px: [300, 360], world: [4300, 5200], night: true, draw(ctx, w, h, t, rnd) {
        const base = rnd.pick(['#181b2c', '#24183a', '#132233']);
        ctx.fillStyle = lin(ctx, 0, 0, w, 0, [[VC.shade(base, 0.12)], [VC.shade(base, -0.3)]]);
        ctx.fillRect(w * 0.04, h * 0.1, w * 0.92, h * 0.9);
        const neon = rnd.pick(['#ff2bd6', '#22e4ff', '#7c4dff']);
        ctx.shadowColor = neon;
        ctx.shadowBlur = h * 0.04;
        ctx.fillStyle = neon;
        ctx.fillRect(w * 0.1, h * 0.15, w * 0.8, h * 0.012);
        ctx.fillRect(w * 0.1, h * 0.86, w * 0.8, h * 0.012);
        ctx.shadowBlur = 0;
        for (let r = 0; r < 10; r++) {
          for (let c = 0; c < 8; c++) {
            ctx.fillStyle = rnd() < 0.45 ? '#ffe7a3' : 'rgba(0,0,0,0.35)';
            ctx.fillRect(w * (0.1 + c * 0.1), h * (0.2 + r * 0.063), w * 0.06, h * 0.035);
          }
        }
      }
    },
    neon: {
      px: [220, 300], world: [1600, 2600], night: true, draw(ctx, w, h, t, rnd) {
        ctx.fillStyle = '#30343d';
        ctx.fillRect(w * 0.46, h * 0.35, w * 0.08, h * 0.65);
        const c = rnd.pick(['#ff2bd6', '#22e4ff', '#fff36b', '#7cff6b']);
        ctx.fillStyle = '#0d0b18';
        rrect(ctx, w * 0.04, h * 0.04, w * 0.92, h * 0.34, w * 0.05);
        ctx.fill();
        ctx.shadowColor = c;
        ctx.shadowBlur = w * 0.08;
        ctx.strokeStyle = c;
        ctx.lineWidth = w * 0.025;
        rrect(ctx, w * 0.08, h * 0.07, w * 0.84, h * 0.28, w * 0.04);
        ctx.stroke();
        ctx.fillStyle = c;
        ctx.font = font(h * 0.14, 900);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(rnd.pick(['VÉLO', 'SPRINT', 'TURBO', 'NÉON', 'GO !']), w / 2, h * 0.215);
        ctx.shadowBlur = 0;
      }
    },
    crowd: {
      px: [320, 170], world: [2300, 1200], frames: 2, draw(ctx, w, h, t, rnd, frame) {
        const shirts = ['#e53935', '#1e88e5', '#ffd21f', '#43a047', '#ffffff', '#fb8c00', '#8e24aa', '#00acc1', '#f06292', '#212121'];
        const skins = ['#f1c7a5', '#e0ac85', '#c68a5f', '#8a5232', '#5e3824'];
        for (let row = 0; row < 3; row++) {
          const y0 = h * (0.5 + row * 0.2);
          const sz = h * (0.15 + row * 0.03);
          const n = 7 + row;
          for (let k = 0; k < n; k++) {
            const x = w * ((k + 0.5 + (rnd() - 0.5) * 0.5) / n);
            const up = rnd() < 0.5;
            const jump = frame && up ? -sz * 0.25 : 0;
            const shirt = rnd.pick(shirts);
            const skin = rnd.pick(skins);
            ctx.fillStyle = shirt;
            rrect(ctx, x - sz * 0.42, y0 - sz * 0.9 + jump, sz * 0.84, sz * 1.4, sz * 0.3);
            ctx.fill();
            if (up) {
              ctx.strokeStyle = skin;
              ctx.lineWidth = sz * 0.18;
              ctx.lineCap = 'round';
              ctx.beginPath();
              const lift = frame ? sz * 0.5 : sz * 0.15;
              ctx.moveTo(x - sz * 0.35, y0 - sz * 0.7 + jump);
              ctx.lineTo(x - sz * 0.55, y0 - sz * 1.5 - lift + jump);
              ctx.moveTo(x + sz * 0.35, y0 - sz * 0.7 + jump);
              ctx.lineTo(x + sz * 0.55, y0 - sz * 1.5 - lift + jump);
              ctx.stroke();
            }
            ellipse(ctx, x, y0 - sz * 1.15 + jump, sz * 0.3, sz * 0.33, skin);
            if (rnd() < 0.5) ellipse(ctx, x, y0 - sz * 1.33 + jump, sz * 0.31, sz * 0.16, rnd.pick(['#2b1b10', '#111', '#c79a4b', '#5a3a1a']));
          }
        }
      }
    },
    barrier: {
      px: [260, 70], world: [1600, 420], draw(ctx, w, h) {
        ctx.fillStyle = '#9aa3ad';
        for (const x of [0.04, 0.96]) ctx.fillRect(w * x - w * 0.012, h * 0.05, w * 0.024, h * 0.95);
        ctx.fillStyle = lin(ctx, 0, h * 0.08, 0, h * 0.8, [['#ffffff'], ['#e6e9ee']]);
        ctx.fillRect(w * 0.02, h * 0.08, w * 0.96, h * 0.66);
        ctx.fillStyle = '#d6313b';
        ctx.fillRect(w * 0.02, h * 0.08, w * 0.96, h * 0.12);
        ctx.fillStyle = '#1b2a4a';
        ctx.font = font(h * 0.34, 900);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VÉLO CHAMPION', w / 2, h * 0.48);
      }
    },
    flag: {
      px: [110, 320], world: [800, 2600], draw(ctx, w, h, t, rnd) {
        ctx.fillStyle = '#cfd6de';
        ctx.fillRect(w * 0.08, h * 0.02, w * 0.05, h * 0.98);
        const sets = [['#0055a4', '#ffffff', '#ef4135'], ['#009246', '#ffffff', '#ce2b37'], ['#000000', '#ffce00', '#dd0000'], ['#ffd21f', '#ffd21f', '#1a1a1a'], ['#c60b1e', '#ffc400', '#c60b1e'], ['#ae1c28', '#ffffff', '#21468b']];
        const cs = rnd.pick(sets);
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = cs[k];
          ctx.beginPath();
          const y0 = h * 0.04;
          const fh = h * 0.3;
          const x0 = w * 0.13 + (w * 0.8 / 3) * k;
          const x1 = x0 + w * 0.8 / 3;
          ctx.moveTo(x0, y0 + Math.sin(k) * h * 0.02);
          ctx.lineTo(x1, y0 + Math.sin(k + 1) * h * 0.02);
          ctx.lineTo(x1, y0 + fh + Math.sin(k + 1) * h * 0.02);
          ctx.lineTo(x0, y0 + fh + Math.sin(k) * h * 0.02);
          ctx.fill();
        }
      }
    },
    archStart: { px: [900, 440], world: [6400, 3150], draw: (ctx, w, h) => arch(ctx, w, h, '#1565c0', '#42a5f5', 'DÉPART', false) },
    archFinish: { px: [900, 440], world: [6400, 3150], draw: (ctx, w, h) => arch(ctx, w, h, '#c62828', '#ff5252', 'ARRIVÉE', true) },
    p1000: { px: [200, 210], world: [1150, 1300], draw: (ctx, w, h) => panel(ctx, w, h, '1 km') },
    p500: { px: [200, 210], world: [1150, 1300], draw: (ctx, w, h) => panel(ctx, w, h, '500 m') },
    p200: { px: [200, 210], world: [1150, 1300], draw: (ctx, w, h) => panel(ctx, w, h, '200 m') },
    chevL: { px: [150, 130], world: [950, 850], draw: (ctx, w, h) => chevron(ctx, w, h, -1) },
    chevR: { px: [150, 130], world: [950, 850], draw: (ctx, w, h) => chevron(ctx, w, h, 1) },
    billboard: {
      px: [420, 270], world: [3800, 2450], draw(ctx, w, h, t) {
        ctx.fillStyle = '#5a5f66';
        ctx.fillRect(w * 0.2, h * 0.55, w * 0.04, h * 0.45);
        ctx.fillRect(w * 0.76, h * 0.55, w * 0.04, h * 0.45);
        const g = t.night
          ? lin(ctx, 0, 0, w, 0, [['#ff2bd6'], ['#7c4dff', 0.5], ['#22e4ff']])
          : lin(ctx, 0, 0, w, 0, [['#ffd21f'], ['#ff9f1c', 0.6], ['#ff5a1f']]);
        ctx.fillStyle = '#1a1a1a';
        rrect(ctx, w * 0.02, h * 0.02, w * 0.96, h * 0.6, w * 0.02);
        ctx.fill();
        ctx.fillStyle = g;
        rrect(ctx, w * 0.04, h * 0.05, w * 0.92, h * 0.54, w * 0.015);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = 'italic ' + font(h * 0.2, 900);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VÉLO CHAMPION', w / 2, h * 0.27);
        ctx.font = font(h * 0.085, 700);
        ctx.fillText('Le Tour commence ici', w / 2, h * 0.45);
      }
    }
  };

  function arch(ctx, w, h, dark, light, text, finish) {
    const legW = w * 0.075;
    const g = lin(ctx, 0, 0, legW, 0, [[VC.shade(dark, -0.2)], [light, 0.45], [VC.shade(dark, -0.3)]]);
    ctx.fillStyle = g;
    rrect(ctx, 0, h * 0.12, legW, h * 0.88, legW * 0.45);
    ctx.fill();
    ctx.save();
    ctx.translate(w - legW, 0);
    ctx.fillStyle = g;
    rrect(ctx, 0, h * 0.12, legW, h * 0.88, legW * 0.45);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = lin(ctx, 0, 0, 0, h * 0.34, [[light], [dark]]);
    rrect(ctx, 0, 0, w, h * 0.32, h * 0.12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = h * 0.012;
    rrect(ctx, h * 0.03, h * 0.03, w - h * 0.06, h * 0.26, h * 0.1);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic ' + font(h * 0.17, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = h * 0.02;
    ctx.fillText(text, w / 2, h * 0.165);
    ctx.shadowBlur = 0;
    if (finish) {
      const n = 24;
      const cw = (w - legW * 2) / n;
      for (let k = 0; k < n; k++) {
        for (let r = 0; r < 2; r++) {
          ctx.fillStyle = (k + r) % 2 ? '#111' : '#fff';
          ctx.fillRect(legW + k * cw, h * 0.32 + r * h * 0.035, cw + 0.5, h * 0.035);
        }
      }
    }
  }

  function panel(ctx, w, h, text) {
    ctx.fillStyle = '#7a828c';
    ctx.fillRect(w * 0.2, h * 0.5, w * 0.06, h * 0.5);
    ctx.fillRect(w * 0.74, h * 0.5, w * 0.06, h * 0.5);
    ctx.fillStyle = '#d6313b';
    rrect(ctx, w * 0.04, h * 0.02, w * 0.92, h * 0.56, w * 0.06);
    ctx.fill();
    textBoard(ctx, w * 0.1, h * 0.07, w * 0.8, h * 0.46, '#ffffff', '#c62828', text, h * 0.2);
  }

  function chevron(ctx, w, h, dir) {
    ctx.fillStyle = '#5d646c';
    ctx.fillRect(w * 0.46, h * 0.5, w * 0.08, h * 0.5);
    ctx.fillStyle = '#ffd21f';
    rrect(ctx, w * 0.03, h * 0.04, w * 0.94, h * 0.5, w * 0.04);
    ctx.fill();
    ctx.fillStyle = '#111';
    for (let k = 0; k < 3; k++) {
      const cx = w * (0.28 + k * 0.22);
      const s = dir;
      poly(ctx, [cx - s * w * 0.08, h * 0.1, cx + s * w * 0.06, h * 0.29, cx - s * w * 0.08, h * 0.48, cx - s * w * 0.02, h * 0.48, cx + s * w * 0.12, h * 0.29, cx - s * w * 0.02, h * 0.1], '#111');
    }
  }

  /**
   * Prépare les images d'un décor : { sprites: {kind: {img, fog, flip, ww, wh, glow}} }.
   * `res` règle la définition des images (1 = normale).
   */
  Art.buildProps = function (themeId, res) {
    const theme = VC.THEMES[themeId];
    const kinds = new Set(theme.props.map((p) => p[0]));
    ['barrier', 'crowd', 'flag', 'archStart', 'archFinish', 'p1000', 'p500', 'p200', 'chevL', 'chevR', 'billboard'].forEach((k) => kinds.add(k));
    const out = {};
    const fog = VC.rgb(theme.fog);
    for (const kind of kinds) {
      const def = PROPS[kind];
      if (!def) continue;
      const variants = kind === 'crowd' ? 4 : (kind === 'flag' || kind === 'building' || kind === 'building2' || kind === 'neon' || kind === 'tree' || kind === 'pine' || kind === 'rock' || kind === 'palm') ? 3 : 1;
      const frames = def.frames || 1;
      const list = [];
      for (let v = 0; v < variants; v++) {
        const imgs = [];
        for (let f = 0; f < frames; f++) {
          const w = def.px[0] * res;
          const h = def.px[1] * res;
          const c = canvas(w, h);
          const cx = c.getContext('2d');
          def.draw(cx, c.width, c.height, theme, VC.rng(VC.hash(kind + themeId) + v * 977), f);
          imgs.push(c);
        }
        list.push({ imgs, fog: tint(imgs[0], fog), ww: def.world[0], wh: def.world[1], glow: def.glow });
      }
      out[kind] = list;
    }
    out.glow = glowSprite(theme.night ? '#ffd98a' : '#fff3c4');
    return out;
  };

  function tint(img, rgb) {
    const c = canvas(img.width, img.height);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = VC.css(rgb);
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function glowSprite(color) {
    const c = canvas(128, 128);
    const x = c.getContext('2d');
    x.fillStyle = rad(x, 64, 64, 0, 64, [[VC.css(VC.rgb(color), 0.9)], [VC.css(VC.rgb(color), 0.25), 0.35], [VC.css(VC.rgb(color), 0)]]);
    x.fillRect(0, 0, 128, 128);
    return c;
  }

  /* ======================================================================= */
  /* Arrière-plans (bandes horizontales répétables)                           */
  /* ======================================================================= */

  function periodic(rnd, n, minK, maxK) {
    const waves = [];
    for (let k = 0; k < n; k++) waves.push({ k: rnd.int(minK, maxK), a: rnd.range(0.2, 1) / (1 + k * 0.35), p: rnd() * TAU });
    const sum = waves.reduce((s, w) => s + w.a, 0);
    return (t) => {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(t * TAU * w.k + w.p);
      return v / sum;
    };
  }

  function ridge(ctx, w, h, f, base, amp, fill) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 2) ctx.lineTo(x, base - amp * f(x / w));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  Art.buildBackground = function (themeId, W, H) {
    const t = VC.THEMES[themeId];
    const rnd = VC.rng(VC.hash('bg-' + themeId));
    const LW = Math.max(1024, Math.round(W * 1.6));
    const out = { LW };

    // Ciel (avec étoiles la nuit).
    const horizon = Math.round(H * 0.42);
    const sky = canvas(W, horizon + 2);
    const sx = sky.getContext('2d');
    sx.fillStyle = lin(sx, 0, 0, 0, horizon, [[t.sky[0]], [t.sky[1], 0.62], [t.sky[2]]]);
    sx.fillRect(0, 0, W, horizon + 2);
    if (t.stars) {
      for (let k = 0; k < 220; k++) {
        const y = Math.pow(rnd(), 1.6) * horizon * 0.85;
        sx.fillStyle = 'rgba(255,255,255,' + rnd.range(0.25, 0.95).toFixed(2) + ')';
        const r = rnd() < 0.08 ? 1.6 : 0.9;
        sx.fillRect(rnd() * W, y, r * (W / 1200 + 0.5), r * (W / 1200 + 0.5));
      }
    }
    out.sky = sky;
    out.horizon = horizon;

    // Soleil / lune.
    const sr = Math.round(H * t.sun.r);
    const sun = canvas(sr * 8, sr * 8);
    const ux = sun.getContext('2d');
    const c = sr * 4;
    ux.fillStyle = rad(ux, c, c, 0, c, [[VC.css(VC.rgb(t.sun.glow), 0.55)], [VC.css(VC.rgb(t.sun.glow), 0.16), 0.35], [VC.css(VC.rgb(t.sun.glow), 0)]]);
    ux.fillRect(0, 0, sun.width, sun.height);
    ux.fillStyle = rad(ux, c - sr * 0.3, c - sr * 0.3, sr * 0.1, sr, [[VC.shade(t.sun.color, 0.5)], [t.sun.color]]);
    ux.beginPath();
    ux.arc(c, c, sr, 0, TAU);
    ux.fill();
    if (t.sun.moon) {
      ux.fillStyle = 'rgba(160,150,210,0.35)';
      for (const [dx, dy, rr] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.4, 0.12]]) {
        ux.beginPath();
        ux.arc(c + dx * sr, c + dy * sr, rr * sr, 0, TAU);
        ux.fill();
      }
    }
    out.sun = sun;

    // Nuages.
    if (t.clouds && t.clouds.n) {
      const ch = Math.round(H * 0.3);
      const cl = canvas(LW, ch);
      const cx = cl.getContext('2d');
      const col = VC.rgb(t.clouds.color);
      for (let k = 0; k < t.clouds.n; k++) {
        const x0 = (k + rnd() * 0.6) / t.clouds.n * LW;
        const y0 = ch * rnd.range(0.25, 0.75);
        const size = H * rnd.range(0.035, 0.07);
        for (let j = 0; j < 9; j++) {
          const px = x0 + (j - 4) * size * 0.75 + rnd() * size * 0.4;
          const py = y0 - Math.sin(j / 8 * Math.PI) * size * 0.8 + rnd() * size * 0.2;
          const r = size * (0.6 + Math.sin(j / 8 * Math.PI) * 0.7);
          for (const off of [-LW, 0, LW]) {
            cx.fillStyle = rad(cx, px + off - r * 0.2, py - r * 0.35, r * 0.1, r, [[VC.css(col, t.clouds.alpha)], [VC.css(col, t.clouds.alpha * 0.85), 0.7], [VC.css(VC.rgb(VC.shade(t.clouds.color, -0.25)), 0)]]);
            cx.beginPath();
            cx.arc(px + off, py, r, 0, TAU);
            cx.fill();
          }
        }
      }
      out.clouds = cl;
    }

    // Plan lointain.
    const fh = Math.round(H * 0.3);
    const far = canvas(LW, fh);
    const fx = far.getContext('2d');
    const fc = t.far.colors;
    if (t.far.kind === 'mountains' || t.far.kind === 'sea') {
      const f1 = periodic(rnd, 9, 1, 14);
      const peak = (u) => {
        const v = f1(u);
        return Math.sign(v) * Math.pow(Math.abs(v), 0.8);
      };
      const amp = t.far.kind === 'sea' ? fh * 0.25 : fh * 0.42;
      const base = t.far.kind === 'sea' ? fh * 0.78 : fh * 0.58;
      ridge(fx, LW, fh, peak, base, amp, lin(fx, 0, base - amp, 0, fh, [[fc[0]], [fc[1]]]));
      if (t.far.snow) {
        fx.save();
        fx.beginPath();
        fx.moveTo(0, fh);
        for (let x = 0; x <= LW; x += 2) fx.lineTo(x, base - amp * peak(x / LW));
        fx.lineTo(LW, fh);
        fx.closePath();
        fx.clip();
        const fs = periodic(rnd, 6, 20, 60);
        fx.beginPath();
        fx.moveTo(0, 0);
        for (let x = 0; x <= LW; x += 3) fx.lineTo(x, base - amp * 0.35 + fs(x / LW) * fh * 0.06);
        fx.lineTo(LW, 0);
        fx.closePath();
        fx.fillStyle = lin(fx, 0, 0, 0, base, [['#ffffff'], ['#dce8f5']]);
        fx.fill();
        fx.restore();
      }
      const f2 = periodic(rnd, 7, 3, 20);
      ridge(fx, LW, fh, f2, fh * 0.82, fh * 0.16, VC.mix(fc[1], t.fog, 0.15));
      if (t.far.kind === 'sea') {
        fx.fillStyle = lin(fx, 0, fh * 0.86, 0, fh, [[VC.shade(t.far.sea, 0.1)], [t.far.sea]]);
        fx.fillRect(0, fh * 0.86, LW, fh * 0.14);
        fx.fillStyle = 'rgba(255,220,170,0.55)';
        for (let k = 0; k < 160; k++) fx.fillRect(rnd() * LW, fh * (0.87 + rnd() * 0.12), rnd.range(4, 30), 1.5);
      }
    } else if (t.far.kind === 'mesa') {
      for (let layer = 0; layer < 2; layer++) {
        const color = layer ? fc[1] : fc[0];
        let x = -rnd() * 200;
        while (x < LW) {
          const mw = rnd.range(LW * 0.05, LW * 0.16);
          const top = fh * rnd.range(0.2, 0.55) + layer * fh * 0.22;
          const grad = lin(fx, 0, top, 0, fh, [[VC.shade(color, 0.12)], [VC.shade(color, -0.2)]]);
          for (const off of [0, LW]) {
            poly(fx, [x + off, fh, x + off + mw * 0.12, top, x + off + mw * 0.88, top, x + off + mw, fh], grad);
            fx.fillStyle = 'rgba(0,0,0,0.12)';
            for (let s = 1; s < 4; s++) fx.fillRect(x + off + mw * 0.12, top + (fh - top) * s / 4, mw * 0.76, 2);
          }
          x += mw + rnd.range(LW * 0.02, LW * 0.1);
        }
      }
    } else if (t.far.kind === 'city') {
      let x = 0;
      while (x < LW) {
        const bw = rnd.range(LW * 0.015, LW * 0.045);
        const top = fh * rnd.range(0.05, 0.6);
        fx.fillStyle = rnd() < 0.5 ? fc[0] : fc[1];
        fx.fillRect(x, top, bw, fh - top);
        fx.fillStyle = 'rgba(255,220,140,0.75)';
        for (let yy = top + 4; yy < fh - 3; yy += 6) {
          for (let xx = x + 2; xx < x + bw - 2; xx += 5) if (rnd() < 0.22) fx.fillRect(xx, yy, 2, 2);
        }
        if (rnd() < 0.3) {
          fx.fillStyle = '#ff3b5c';
          fx.fillRect(x + bw / 2 - 1, top - 6, 2, 6);
        }
        x += bw + rnd.range(0, LW * 0.006);
      }
      fx.fillStyle = lin(fx, 0, fh * 0.5, 0, fh, [['rgba(155,35,112,0)'], ['rgba(155,35,112,0.45)']]);
      fx.fillRect(0, fh * 0.5, LW, fh * 0.5);
    }
    out.far = far;

    // Plan proche.
    const nh = Math.round(H * 0.16);
    const near = canvas(LW, nh);
    const nx = near.getContext('2d');
    const n = t.near;
    if (n.kind === 'hills' || n.kind === 'dunes') {
      const f3 = periodic(rnd, 6, 2, 9);
      ridge(nx, LW, nh, f3, nh * 0.55, nh * 0.4, lin(nx, 0, 0, 0, nh, [[VC.shade(n.color, 0.1)], [n.color2]]));
      if (n.kind === 'hills') {
        for (let k = 0; k < 160; k++) {
          const u = rnd();
          const y = nh * 0.55 - nh * 0.4 * f3(u) + rnd() * nh * 0.25;
          const r = nh * rnd.range(0.04, 0.09);
          nx.fillStyle = VC.shade(n.color2, -0.2 - rnd() * 0.2);
          nx.beginPath();
          nx.arc(u * LW, y, r, 0, TAU);
          nx.fill();
        }
      }
    } else if (n.kind === 'forest') {
      const f4 = periodic(rnd, 5, 2, 8);
      ridge(nx, LW, nh, f4, nh * 0.6, nh * 0.3, n.color2);
      for (let x = 0; x < LW; x += nh * 0.07) {
        const base = nh * 0.6 - nh * 0.3 * f4(x / LW) + nh * 0.15;
        const th = nh * rnd.range(0.25, 0.5);
        poly(nx, [x - th * 0.22, base, x, base - th, x + th * 0.22, base], rnd() < 0.5 ? n.color : n.color2);
      }
    } else {
      let x = 0;
      while (x < LW) {
        const bw = rnd.range(LW * 0.02, LW * 0.05);
        const top = nh * rnd.range(0.1, 0.6);
        nx.fillStyle = rnd() < 0.5 ? n.color : n.color2;
        nx.fillRect(x, top, bw, nh - top);
        nx.fillStyle = rnd.pick(['#ff2bd6', '#22e4ff', '#7c4dff']);
        nx.fillRect(x, top, bw, 2);
        nx.fillStyle = 'rgba(255,231,163,0.55)';
        for (let yy = top + 5; yy < nh - 3; yy += 7) {
          for (let xx = x + 3; xx < x + bw - 3; xx += 6) if (rnd() < 0.25) nx.fillRect(xx, yy, 3, 3);
        }
        x += bw;
      }
    }
    out.near = near;
    return out;
  };

  /* ======================================================================= */
  /* Coureur vu de dos (dessin vectoriel, unités en centimètres)              */
  /* ======================================================================= */

  const LIFT = 0.33;    // projection de la profondeur (vue légèrement plongeante)
  const Y = (y, z) => -(y + z * LIFT);
  const THIGH = 44;
  const SHIN = 47;
  /** Dégradés réutilisables, propres à chaque contexte de dessin. */
  function shades(ctx) {
    if (ctx.__vcShades) return ctx.__vcShades;
    const torso = ctx.createLinearGradient(-19, 0, 19, 0);
    torso.addColorStop(0, 'rgba(0,0,0,0.38)');
    torso.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    torso.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    torso.addColorStop(1, 'rgba(0,0,0,0.42)');
    const helmet = ctx.createRadialGradient(-3, -4, 0.5, -3, -4, 9);
    helmet.addColorStop(0, 'rgba(255,255,255,0.55)');
    helmet.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.__vcShades = { torso, helmet };
    return ctx.__vcShades;
  }

  function knee(hy, hz, fy, fz) {
    const dy = fy - hy;
    const dz = fz - hz;
    let d = Math.sqrt(dy * dy + dz * dz);
    d = Math.min(d, THIGH + SHIN - 0.5);
    const uy = dy / d;
    const uz = dz / d;
    const a = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, THIGH * THIGH - a * a));
    let py = -uz;
    let pz = uy;
    if (pz < 0) {
      py = -py;
      pz = -pz;
    }
    return [hy + uy * a + py * h, hz + uz * a + pz * h];
  }

  function leg(ctx, side, crank, stand, skin, shorts, sock, shoe, detail) {
    const a = crank + (side > 0 ? 0 : Math.PI);
    const fy = 27 + 17 * Math.sin(a);
    const fz = 17 * Math.cos(a) + 4;
    const hy = 90 + stand * 13;
    const hz = -13 + stand * 13;
    const [ky, kz] = knee(hy, hz, fy, fz);
    const hx = side * 8.5;
    const kx = side * (10.5 + 3 * VC.clamp(kz / 40, 0, 1));
    const fx = side * 10.5;
    const Hy = Y(hy, hz);
    const Ky = Y(ky, kz);
    const Fy = Y(fy + 3, fz);
    ctx.lineCap = 'round';
    ctx.strokeStyle = skin;
    ctx.lineWidth = 9.5;
    ctx.beginPath();
    ctx.moveTo(kx, Ky);
    ctx.lineTo(fx, Fy);
    ctx.stroke();
    if (detail) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(kx + side * 2.5, Ky + 2);
      ctx.lineTo(fx + side * 2, Fy - 6);
      ctx.stroke();
    }
    ctx.strokeStyle = skin;
    ctx.lineWidth = 12.5;
    ctx.beginPath();
    ctx.moveTo(hx, Hy);
    ctx.lineTo(kx, Ky);
    ctx.stroke();
    ctx.strokeStyle = shorts;
    ctx.lineWidth = 13.5;
    ctx.beginPath();
    ctx.moveTo(hx, Hy);
    ctx.lineTo(VC.lerp(hx, kx, 0.55), VC.lerp(Hy, Ky, 0.55));
    ctx.stroke();
    ctx.strokeStyle = sock;
    ctx.lineWidth = 8.6;
    ctx.beginPath();
    ctx.moveTo(VC.lerp(kx, fx, 0.78), VC.lerp(Ky, Fy, 0.78));
    ctx.lineTo(fx, Fy);
    ctx.stroke();
    ellipse(ctx, fx, Fy + 2.5, 5, 4, shoe);
  }

  /**
   * Dessine un coureur vu de dos. (sx, sy) : contact de la roue arrière au sol,
   * s : pixels par centimètre.
   */
  Art.drawRider = function (ctx, r, sx, sy, s, night) {
    if (s < 0.04) return;
    const kit = r.kit;
    // Ombre portée
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 26 * s, 6.5 * s, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(sx, sy);
    const rock = r.stand * 0.075 * Math.sin(r.crank);
    ctx.rotate(r.lean + rock);
    ctx.scale(s, s);

    if (s < 0.22) {
      // Version simplifiée pour les coureurs lointains.
      ctx.fillStyle = '#151515';
      ctx.fillRect(-2, -68, 4, 68);
      ctx.fillStyle = kit[2];
      ctx.fillRect(-13, -98, 26, 18);
      ctx.fillStyle = kit[0];
      ctx.beginPath();
      ctx.ellipse(0, -112, 17, 20, 0, 0, TAU);
      ctx.fill();
      ellipse(ctx, 0, Y(124 + r.stand * 8, 40), 9.5, 8.5, kit[3]);
      ctx.restore();
      return;
    }
    const detail = s > 0.55;
    const stand = r.stand;
    const shoe = kit[4] === 'player' ? '#ffffff' : '#1d1d1f';
    const sock = kit[4] === 'player' ? '#ffd21f' : '#f5f5f5';
    leg(ctx, -1, r.crank, stand, r.skin, kit[2], sock, shoe, detail);
    leg(ctx, 1, r.crank, stand, r.skin, kit[2], sock, shoe, detail);

    // Bases du cadre, roue arrière, cassette, haubans.
    ctx.strokeStyle = r.frame;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(-3.5, Y(34, 0));
    ctx.lineTo(-4, Y(27, 40));
    ctx.moveTo(3.5, Y(34, 0));
    ctx.lineTo(4, Y(27, 40));
    ctx.stroke();
    ctx.fillStyle = '#121214';
    rrect(ctx, -2, Y(68, 0), 4, 68, 2);
    ctx.fill();
    if (r.wheel !== 'spokes') {
      ctx.fillStyle = r.wheel === 'disc' ? VC.shade(r.frame, -0.2) : '#2a2a2e';
      ctx.fillRect(-1.3, Y(62, 0), 2.6, 18);
      ctx.fillRect(-1.3, Y(24, 0), 2.6, 18);
    }
    if (detail) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-1.6, Y(66, 0), 1, 62);
    }
    ctx.fillStyle = '#9097a0';
    ctx.fillRect(2, Y(41, 0), 3.2, 13);
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(4.5, Y(33, 0), 3.2, 12);
    ctx.strokeStyle = r.frame;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-3, Y(35, 0));
    ctx.lineTo(-2.2, Y(79, -12));
    ctx.moveTo(3, Y(35, 0));
    ctx.lineTo(2.2, Y(79, -12));
    ctx.stroke();

    // Selle et cuissard.
    ellipse(ctx, 0, Y(85, -17), 6.5, 2.6, '#18181a');
    if (night) {
      ellipse(ctx, 0, Y(76, -16), 2.4, 3.4, '#ff2a2a');
      ctx.fillStyle = 'rgba(255,40,40,0.25)';
      ctx.beginPath();
      ctx.arc(0, Y(76, -16), 9, 0, TAU);
      ctx.fill();
    }
    const hipY = Y(93 + stand * 13, -11 + stand * 12);
    ctx.fillStyle = kit[2];
    ctx.beginPath();
    ctx.ellipse(0, hipY, 14.5, 9.5, 0, 0, TAU);
    ctx.fill();
    if (detail) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.ellipse(-4, hipY - 2, 7, 4, 0, 0, TAU);
      ctx.fill();
    }

    // Bras et cintre (derrière le buste).
    const shY = Y(118 + stand * 9, 28 + stand * 4);
    const handY = Y(96 + stand * 3, 60);
    ctx.strokeStyle = '#1b1c1f';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-21, handY + 1);
    ctx.lineTo(21, handY + 1);
    ctx.stroke();
    ctx.lineCap = 'round';
    for (const sd of [-1, 1]) {
      const ex = sd * 25;
      const ey = Y(107 + stand * 5, 46);
      ctx.strokeStyle = r.skin;
      ctx.lineWidth = 6.8;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(sd * 20.5, handY);
      ctx.stroke();
      ctx.strokeStyle = kit[0];
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(sd * 15, shY + 2);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ellipse(ctx, sd * 20.5, handY + 1, 3.6, 3.2, '#202124');
    }

    // Buste vu de dos.
    const bot = Y(95 + stand * 13, -9 + stand * 12);
    const top = shY - 4;
    ctx.beginPath();
    ctx.moveTo(-12.5, bot);
    ctx.bezierCurveTo(-15, bot - 12, -20, top + 14, -17, top + 4);
    ctx.quadraticCurveTo(-13, top - 3, 0, top - 4);
    ctx.quadraticCurveTo(13, top - 3, 17, top + 4);
    ctx.bezierCurveTo(20, top + 14, 15, bot - 12, 12.5, bot);
    ctx.quadraticCurveTo(0, bot + 3, -12.5, bot);
    ctx.closePath();
    ctx.fillStyle = kit[0];
    ctx.fill();
    ctx.save();
    ctx.clip();
    const sec = kit[1];
    ctx.fillStyle = sec;
    switch (kit[4]) {
      case 'band':
        ctx.fillRect(-25, (top + bot) / 2 - 5, 50, 8);
        break;
      case 'sides':
        ctx.fillRect(-25, top - 6, 10.5, bot - top + 10);
        ctx.fillRect(14.5, top - 6, 10.5, bot - top + 10);
        break;
      case 'stripes':
        for (const x of [-10, -2, 6]) ctx.fillRect(x, top - 6, 4, bot - top + 10);
        break;
      case 'dots':
        for (let yy = top; yy < bot; yy += 7) for (let xx = -18 + ((yy / 7) & 1) * 3.5; xx < 19; xx += 7) {
          ctx.beginPath();
          ctx.arc(xx, yy, 2, 0, TAU);
          ctx.fill();
        }
        break;
      case 'player':
        ctx.fillRect(-25, top - 6, 7.5, bot - top + 10);
        ctx.fillRect(17.5, top - 6, 7.5, bot - top + 10);
        ctx.fillRect(-25, top - 6, 50, 4);
        break;
    }
    ctx.fillStyle = shades(ctx).torso;
    ctx.fillRect(-25, top - 8, 50, bot - top + 14);
    if (detail) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(-14, bot - 9, 28, 1.2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-7.5, bot - 19, 15, 10);
      ctx.fillStyle = '#111';
      ctx.font = '900 8.5px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(r.num), 0, bot - 13.6);
    }
    ctx.restore();

    // Tête et casque.
    const headY = Y(122 + stand * 9, 40 + stand * 5);
    ellipse(ctx, 0, headY + 6, 5.5, 5, r.skin);
    ellipse(ctx, -8.8, headY + 2, 2.2, 3, r.skin);
    ellipse(ctx, 8.8, headY + 2, 2.2, 3, r.skin);
    ctx.fillStyle = kit[3];
    ctx.beginPath();
    ctx.ellipse(0, headY - 1, 10, 8.8, 0, 0, TAU);
    ctx.fill();
    if (detail) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      for (const vx of [-5, 0, 5]) {
        rrect(ctx, vx - 1.2, headY - 7, 2.4, 7, 1.2);
        ctx.fill();
      }
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, headY + 1, 8.6, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.save();
      ctx.translate(0, headY);
      ctx.fillStyle = shades(ctx).helmet;
      ctx.beginPath();
      ctx.ellipse(0, -1, 10, 8.8, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  /* ======================================================================= */
  /* Vélo vu de profil (garage, menus)                                        */
  /* ======================================================================= */

  Art.drawBikeSide = function (ctx, bike, x, y, size, t) {
    // size : diamètre d'une roue en pixels ; (x, y) : centre de la roue arrière.
    const R = size / 2;
    const wb = size * 1.45;
    const rear = [x, y];
    const front = [x + wb, y];
    const bb = [x + wb * 0.4, y + R * 0.12];
    const seatTop = [x + wb * 0.3, y - R * 1.15];
    const headTop = [x + wb * 0.9, y - R * 1.12];
    const headBot = [x + wb * 0.93, y - R * 0.75];
    const spin = (t || 0) * 6;

    const wheel = (c) => {
      ctx.save();
      ctx.translate(c[0], c[1]);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.lineWidth = R * 0.12;
      ctx.strokeStyle = '#141416';
      ctx.stroke();
      if (bike.wheel === 'disc') {
        ctx.fillStyle = lin(ctx, -R, -R, R, R, [[VC.shade(bike.frame, 0.25)], [VC.shade(bike.frame, -0.35)]]);
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.92, 0, TAU);
        ctx.fill();
        ctx.rotate(spin);
        ctx.fillStyle = bike.accent;
        ctx.font = '900 ' + Math.round(R * 0.22) + 'px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FUSION', 0, -R * 0.45);
      } else {
        const depth = bike.wheel === 'deep' ? R * 0.28 : R * 0.08;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.94 - depth / 2, 0, TAU);
        ctx.lineWidth = depth;
        ctx.strokeStyle = bike.wheel === 'deep' ? '#202126' : '#b9c0c8';
        ctx.stroke();
        if (bike.wheel === 'deep') {
          ctx.save();
          ctx.rotate(spin);
          ctx.strokeStyle = bike.accent;
          ctx.lineWidth = depth * 0.25;
          ctx.beginPath();
          ctx.arc(0, 0, R * 0.94 - depth / 2, -0.5, 0.5);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, R * 0.94 - depth / 2, Math.PI - 0.5, Math.PI + 0.5);
          ctx.stroke();
          ctx.restore();
        }
        ctx.rotate(spin);
        ctx.strokeStyle = 'rgba(200,205,212,0.85)';
        ctx.lineWidth = Math.max(0.6, R * 0.012);
        const n = bike.wheel === 'deep' ? 18 : 28;
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const a = k / n * TAU;
          ctx.moveTo(Math.cos(a) * R * 0.06, Math.sin(a) * R * 0.06);
          ctx.lineTo(Math.cos(a + 0.2) * (R * 0.94 - depth), Math.sin(a + 0.2) * (R * 0.94 - depth));
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#a9b0b8';
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.07, 0, TAU);
      ctx.fill();
      ctx.restore();
    };
    wheel(rear);
    wheel(front);

    const tube = (a, b, w, color) => {
      ctx.strokeStyle = color || bike.frame;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };
    const tw = R * (bike.tier >= 3 ? 0.13 : 0.09);
    tube(rear, bb, tw * 0.8);
    tube(rear, [seatTop[0] + R * 0.04, seatTop[1] + R * 0.22], tw * 0.7);
    tube(bb, seatTop, tw);
    tube(seatTop, headTop, tw * (bike.tier >= 4 ? 1.2 : 1));
    tube(bb, headBot, tw * 1.25);
    tube(headTop, headBot, tw * 1.15);
    tube(headBot, front, tw * 0.75);
    // Décor du cadre
    ctx.strokeStyle = bike.accent;
    ctx.lineWidth = tw * 0.28;
    ctx.beginPath();
    ctx.moveTo(VC.lerp(bb[0], headBot[0], 0.3), VC.lerp(bb[1], headBot[1], 0.3));
    ctx.lineTo(VC.lerp(bb[0], headBot[0], 0.7), VC.lerp(bb[1], headBot[1], 0.7));
    ctx.stroke();
    // Tige de selle, selle, potence, cintre
    const saddle = [seatTop[0] - R * 0.08, seatTop[1] - R * 0.22];
    tube(seatTop, saddle, tw * 0.55, '#2a2b30');
    ctx.fillStyle = '#18181b';
    rrect(ctx, saddle[0] - R * 0.25, saddle[1] - R * 0.07, R * 0.42, R * 0.1, R * 0.05);
    ctx.fill();
    const stem = [headTop[0] + R * 0.2, headTop[1] - R * 0.05];
    tube(headTop, stem, tw * 0.6, '#2a2b30');
    ctx.strokeStyle = '#1f2024';
    ctx.lineWidth = tw * 0.55;
    ctx.beginPath();
    ctx.moveTo(stem[0], stem[1]);
    ctx.quadraticCurveTo(stem[0] + R * 0.28, stem[1] + R * 0.05, stem[0] + R * 0.12, stem[1] + R * 0.32);
    ctx.stroke();
    // Pédalier
    ctx.save();
    ctx.translate(bb[0], bb[1]);
    ctx.fillStyle = '#9aa1aa';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2a2b30';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.08, 0, TAU);
    ctx.fill();
    ctx.rotate(spin * 0.5);
    ctx.strokeStyle = '#3a3c42';
    ctx.lineWidth = R * 0.06;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, R * 0.36);
    ctx.stroke();
    ctx.restore();
    // Chaîne
    ctx.strokeStyle = 'rgba(70,72,78,0.9)';
    ctx.lineWidth = R * 0.025;
    ctx.beginPath();
    ctx.moveTo(bb[0], bb[1] - R * 0.2);
    ctx.lineTo(rear[0], rear[1] - R * 0.1);
    ctx.moveTo(bb[0], bb[1] + R * 0.2);
    ctx.lineTo(rear[0], rear[1] + R * 0.1);
    ctx.stroke();
  };
})(typeof window !== 'undefined' ? window : globalThis);
