/* Vélo Champion — utilitaires communs (navigateur et Node pour les tests). */
(function (root) {
  'use strict';
  const VC = root.VC || (root.VC = {});

  /** Générateur pseudo-aléatoire déterministe (mulberry32). */
  VC.rng = function (seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + (hi - lo) * next();
    next.int = (lo, hi) => lo + Math.floor((hi - lo + 1) * next());
    next.pick = (list) => list[Math.floor(next() * list.length)];
    next.chance = (p) => next() < p;
    return next;
  };

  VC.hash = function (str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  VC.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  VC.lerp = (a, b, t) => a + (b - a) * t;
  VC.easeIn = (a, b, t) => a + (b - a) * t * t;
  VC.easeOut = (a, b, t) => a + (b - a) * (1 - (1 - t) * (1 - t));
  VC.easeInOut = (a, b, t) => a + (b - a) * (-Math.cos(t * Math.PI) / 2 + 0.5);
  VC.approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

  /* Couleurs ------------------------------------------------------------ */

  VC.rgb = function (hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  VC.css = (c, a) => (a === undefined || a >= 1)
    ? 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'
    : 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')';

  /** Mélange deux couleurs hexadécimales et renvoie une couleur CSS. */
  VC.mix = function (a, b, t) {
    const ca = typeof a === 'string' ? VC.rgb(a) : a;
    const cb = typeof b === 'string' ? VC.rgb(b) : b;
    return VC.css([VC.lerp(ca[0], cb[0], t), VC.lerp(ca[1], cb[1], t), VC.lerp(ca[2], cb[2], t)]);
  };

  VC.shade = (hex, amount) => amount >= 0 ? VC.mix(hex, '#ffffff', amount) : VC.mix(hex, '#000000', -amount);

  /* Format -------------------------------------------------------------- */

  VC.fmtTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  };

  VC.fmtGap = (sec) => '+' + (sec < 60 ? sec.toFixed(2) + ' s' : VC.fmtTime(sec));

  VC.fmtDist = function (m) {
    return m >= 1000 ? (m / 1000).toFixed(m % 1000 === 0 ? 0 : 1).replace('.', ',') + ' km' : Math.round(m) + ' m';
  };

  VC.ordinal = (n) => n === 1 ? '1er' : n + 'e';

  if (typeof module !== 'undefined' && module.exports) module.exports = VC;
})(typeof window !== 'undefined' ? window : globalThis);
