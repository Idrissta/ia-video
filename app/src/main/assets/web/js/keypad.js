/*
 * Nova Graph — clavier mathématique tactile.
 * Les touches insèrent du texte dans le champ ciblé ; « ▮ » marque la
 * position du curseur après insertion (ex. « sin(▮) »).
 */
(function (root) {
  'use strict';
  const NM = root.NovaMath;

  const FN_DELETE = NM.FUNC_NAMES.concat(['d/dx', '√', '∛', '∫', 'Σ']).map((n) => n + '(');

  function setCaret(input, p) {
    try { input.setSelectionRange(p, p); } catch (e) { /* champ sans sélection */ }
  }

  function fire(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insert(input, text) {
    const v = input.value;
    let s = input.selectionStart, e = input.selectionEnd;
    if (s === null || s === undefined) { s = e = v.length; }
    if (text === ')' && s === e && v[s] === ')') { setCaret(input, s + 1); return; }
    let caret = text.indexOf('▮');
    let ins = text.replace('▮', '');
    if (caret < 0) caret = ins.length;
    if (e > s && text.indexOf('▮') >= 0) {
      const sel = v.slice(s, e);
      ins = ins.slice(0, caret) + sel + ins.slice(caret);
      caret += sel.length;
    }
    input.value = v.slice(0, s) + ins + v.slice(e);
    setCaret(input, s + caret);
    fire(input);
  }

  function backspace(input) {
    const v = input.value;
    let s = input.selectionStart, e = input.selectionEnd;
    if (s === null || s === undefined) { s = e = v.length; }
    if (e > s) {
      input.value = v.slice(0, s) + v.slice(e);
      setCaret(input, s);
      fire(input);
      return;
    }
    if (s === 0) return;
    const before = v.slice(0, s);
    let n = 1;
    for (const tok of FN_DELETE) if (before.endsWith(tok)) { n = tok.length; break; }
    let after = 0;
    if ((v[s - 1] === '(' && v[s] === ')') || (v[s - 1] === '|' && v[s] === '|')) after = 1;
    input.value = v.slice(0, s - n) + v.slice(s + after);
    setCaret(input, s - n);
    fire(input);
  }

  function move(input, d) {
    const v = input.value;
    let s = input.selectionStart;
    if (s === null || s === undefined) s = v.length;
    setCaret(input, Math.max(0, Math.min(v.length, s + d)));
  }

  // Raccourci de définition de touche
  function K(label, ins, cls, extra) {
    return Object.assign({ l: label, i: ins === undefined ? label : ins, c: cls || '' }, extra || {});
  }
  const A = (label, action, cls, extra) => Object.assign({ l: label, a: action, c: cls || '' }, extra || {});

  const ICON = {
    back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/><path d="M12.5 9.5l5 5m0-5l-5 5"/></svg>',
    left: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    enter: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5v6a3 3 0 0 1-3 3H5"/><path d="M9 10l-4 4 4 4"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  };

  const v = (s) => '<i class="kv">' + s + '</i>';
  const sup = (b, e) => b + '<sup>' + e + '</sup>';

  const NAV = [
    A('123', 'page:main', 'k-nav k-page', { page: 'main' }),
    A('<i>f</i>(<i>x</i>)', 'page:fn', 'k-nav k-page', { page: 'fn' }),
    A('ABC', 'page:abc', 'k-nav k-page', { page: 'abc' }),
    A(ICON.left, 'left', 'k-nav', { repeat: true }),
    A(ICON.right, 'right', 'k-nav', { repeat: true }),
    A(ICON.back, 'back', 'k-nav k-del', { repeat: true }),
    A(ICON.enter, 'enter', 'k-enter'),
  ];

  const GRAPH_PAGES = {
    main: {
      cols: 8,
      rows: [
        [K(v('x'), 'x', 'k-var'), K(v('y'), 'y', 'k-var'), K(sup(v('a'), '2'), '²'), K(sup(v('a'), v('b')), '^'), K('7'), K('8'), K('9'), K('÷', '÷', 'k-op')],
        [K('(', '(▮)'), K(')'), K('&lt;', '<'), K('&gt;', '>'), K('4'), K('5'), K('6'), K('×', '·', 'k-op')],
        [K('|<i>a</i>|', '|▮|'), K(','), K('≤'), K('≥'), K('1'), K('2'), K('3'), K('−', '−', 'k-op')],
        [K('√', '√(▮)'), K('π'), K(v('θ'), 'θ', 'k-var'), K('='), K('0'), K('.'), K(v('t'), 't', 'k-var'), K('+', '+', 'k-op')],
      ],
      nav: NAV,
    },
    fn: {
      cols: 6,
      rows: [
        [K('sin', 'sin(▮)'), K('cos', 'cos(▮)'), K('tan', 'tan(▮)'), K('ln', 'ln(▮)'), K('log', 'log(▮)'), K(sup('e', v('x')), 'e^(▮)')],
        [K(sup('sin', '−1'), 'asin(▮)'), K(sup('cos', '−1'), 'acos(▮)'), K(sup('tan', '−1'), 'atan(▮)'), K('∛', '∛(▮)'), K(sup('', v('n')) + '√', 'root(▮, )'), K(sup('10', v('x')), '10^(▮)')],
        [K('⌊<i>x</i>⌋', 'floor(▮)'), K('⌈<i>x</i>⌉', 'ceil(▮)'), K('<i>n</i>!', '!'), K('mod', 'mod(▮, )'), K('nCr', 'nCr(▮, )'), K('max', 'max(▮, )')],
        [K('∫', '∫(▮, , )', 'k-big'), K('Σ', 'Σ(▮, , )', 'k-big'), K('<sup>d</sup>⁄<sub>d<i>x</i></sub>', 'd/dx(▮)'), K(v('f') + '′', '′'), K(v('r'), 'r', 'k-var'), K('e', 'e')],
      ],
      nav: NAV,
    },
    abc: {
      cols: 10,
      rows: 'azertyuiop qsdfghjklm wxcvbn'.split(' ').map((r) => Array.from(r).map((c) => K(v(c), c, 'k-letter')))
        .map((r, i) => (i === 2 ? r.concat([K('_', '_'), K('(', '(▮)'), K(')'), K(',')]) : r))
        .concat([['α', 'β', 'γ', 'λ', 'μ', 'σ', 'φ', 'ω'].map((c) => K(v(c), c, 'k-letter')).concat([K('=', '='), K('′')])]),
      nav: NAV,
    },
  };

  class Keypad {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts;
      this.pages = opts.pages;
      this.page = opts.initial || Object.keys(this.pages)[0];
      this.target = null;
      this.inv = false;
      this._repeat = null;
      this.render();
      el.addEventListener('pointerdown', (e) => this._down(e));
      const stop = () => this._stopRepeat();
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('pointerleave', stop);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    setPage(name) {
      if (!this.pages[name]) return;
      this.page = name;
      this.render();
    }

    render() {
      const pg = this.pages[this.page];
      const keys = [];
      this._keys = [];
      const mk = (k, nav) => {
        const idx = this._keys.push(k) - 1;
        const label = k.dyn ? k.dyn() : this.inv && k.inv ? k.inv.l : k.l;
        const on = (k.page && k.page === this.page) || (k.a === 'inv' && this.inv) ? ' on' : '';
        const span = k.span ? ' style="grid-column: span ' + k.span + '"' : '';
        return '<button type="button" class="key ' + k.c + on + (nav ? ' nav' : '') + '" data-k="' + idx + '"' + span + ' tabindex="-1"><span class="kl">' + label + '</span></button>';
      };
      for (const row of pg.rows) keys.push('<div class="krow" style="--cols:' + pg.cols + '">' + row.map((k) => mk(k)).join('') + '</div>');
      if (pg.nav) keys.push('<div class="krow knav" style="--cols:' + pg.nav.length + '">' + pg.nav.map((k) => mk(k, true)).join('') + '</div>');
      this.el.innerHTML = keys.join('');
      this.el.dataset.page = this.page;
    }

    _down(e) {
      const btn = e.target.closest('.key');
      if (!btn) return;
      e.preventDefault();
      const k = this._keys[+btn.dataset.k];
      if (!k) return;
      btn.classList.remove('pressed');
      void btn.offsetWidth;
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 180);
      if (this.opts.haptic) this.opts.haptic(k.a === 'enter' ? 'confirm' : 'tap');
      this._run(k);
      if (k.repeat) {
        this._stopRepeat();
        this._repeat = setTimeout(() => {
          this._repeat = setInterval(() => this._run(k), 65);
        }, 380);
      }
    }

    _stopRepeat() {
      if (this._repeat) { clearTimeout(this._repeat); clearInterval(this._repeat); this._repeat = null; }
    }

    _run(k) {
      const key = this.inv && k.inv ? k.inv : k;
      if (key.a) {
        if (key.a.indexOf('page:') === 0) { this.setPage(key.a.slice(5)); return; }
        if (key.a === 'inv') { this.inv = !this.inv; this.render(); return; }
        const t = this.target;
        if (t && key.a === 'back') backspace(t);
        else if (t && key.a === 'left') move(t, -1);
        else if (t && key.a === 'right') move(t, 1);
        if (this.opts.onAction) this.opts.onAction(key.a, key);
        return;
      }
      if (!this.target) return;
      if (this.opts.beforeInsert) this.opts.beforeInsert(key.i, key);
      insert(this.target, key.i);
      if (this.inv && k.inv) { this.inv = false; this.render(); }
    }
  }

  Keypad.GRAPH_PAGES = GRAPH_PAGES;
  Keypad.K = K;
  Keypad.A = A;
  Keypad.ICON = ICON;
  Keypad.insert = insert;
  Keypad.backspace = backspace;
  root.NovaKeypad = Keypad;
})(window);
