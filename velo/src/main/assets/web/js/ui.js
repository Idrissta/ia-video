/* Vélo Champion — écrans, boucle de jeu, commandes et HUD. */
(function (root) {
  'use strict';
  const VC = root.VC;
  const Save = VC.Save;
  const Store = VC.Store;
  const Audio = VC.Audio;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const icon = (id) => '<svg><use href="#i-' + id + '"/></svg>';
  const native = () => root.VeloNative;
  const STEP = 1 / 60;

  /* ======================================================================= */
  /* Pont natif                                                               */
  /* ======================================================================= */

  const Native = {
    haptic(kind) {
      if (!Save.state.settings.haptics) return;
      const n = native();
      if (n && n.haptic) n.haptic(kind);
      else if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 40 : 12);
    },
    keepAwake(on) {
      const n = native();
      if (n && n.keepAwake) n.keepAwake(!!on);
    },
    setBack(on) {
      const n = native();
      if (n && n.setBackEnabled) n.setBackEnabled(!!on);
    }
  };

  root.veloInsets = function (t, r, b, l) {
    const s = document.documentElement.style;
    s.setProperty('--sa-t', t + 'px');
    s.setProperty('--sa-r', r + 'px');
    s.setProperty('--sa-b', b + 'px');
    s.setProperty('--sa-l', l + 'px');
  };

  /* ======================================================================= */
  /* Commandes                                                                */
  /* ======================================================================= */

  const Input = {
    left: false,
    right: false,
    sprint: false,
    keys: {},
    tilt: 0,
    tiltZero: null,
    tiltRaw: 0,

    init() {
      const steer = $('ctl-steer');
      const padL = $('ctl-l');
      const padR = $('ctl-r');
      const steerPtrs = new Map();
      const updateSteer = () => {
        let l = false;
        let r = false;
        const rect = steer.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        for (const x of steerPtrs.values()) {
          if (x < mid) l = true;
          else r = true;
        }
        if (l !== this.left || r !== this.right) {
          if ((l && !this.left) || (r && !this.right)) Native.haptic('tick');
        }
        this.left = l;
        this.right = r;
        padL.classList.toggle('on', l);
        padR.classList.toggle('on', r);
      };
      steer.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        steer.setPointerCapture(e.pointerId);
        steerPtrs.set(e.pointerId, e.clientX);
        updateSteer();
      });
      steer.addEventListener('pointermove', (e) => {
        if (!steerPtrs.has(e.pointerId)) return;
        steerPtrs.set(e.pointerId, e.clientX);
        updateSteer();
      });
      const steerUp = (e) => {
        steerPtrs.delete(e.pointerId);
        updateSteer();
      };
      steer.addEventListener('pointerup', steerUp);
      steer.addEventListener('pointercancel', steerUp);
      steer.addEventListener('lostpointercapture', steerUp);

      const sp = $('ctl-sprint');
      const sprintPtrs = new Set();
      const setSprint = () => {
        const on = sprintPtrs.size > 0;
        if (on && !this.sprint) Native.haptic('tick');
        this.sprint = on;
        sp.classList.toggle('on', on);
      };
      sp.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sp.setPointerCapture(e.pointerId);
        sprintPtrs.add(e.pointerId);
        setSprint();
      });
      const sprintUp = (e) => {
        sprintPtrs.delete(e.pointerId);
        setSprint();
      };
      sp.addEventListener('pointerup', sprintUp);
      sp.addEventListener('pointercancel', sprintUp);
      sp.addEventListener('lostpointercapture', sprintUp);

      root.addEventListener('keydown', (e) => {
        this.keys[e.code] = true;
        if (e.code === 'Escape' || e.code === 'KeyP') UI.back();
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      });
      root.addEventListener('keyup', (e) => {
        this.keys[e.code] = false;
      });
      root.addEventListener('blur', () => {
        this.keys = {};
      });
      root.addEventListener('deviceorientation', (e) => {
        if (e.beta === null) return;
        const angle = (screen.orientation && screen.orientation.angle) || root.orientation || 0;
        let v = e.beta;
        if (angle === 270 || angle === -90) v = -v;
        else if (angle === 0 || angle === 180) v = angle === 180 ? -e.gamma : e.gamma;
        this.tiltRaw = v;
      });
    },

    calibrate() {
      this.tiltZero = this.tiltRaw;
    },

    reset() {
      this.left = this.right = this.sprint = false;
      $('ctl-l').classList.remove('on');
      $('ctl-r').classList.remove('on');
      $('ctl-sprint').classList.remove('on');
    },

    read() {
      const k = this.keys;
      let steer = 0;
      if (this.left || k.ArrowLeft || k.KeyA || k.KeyQ) steer -= 1;
      if (this.right || k.ArrowRight || k.KeyD) steer += 1;
      if (Save.state.settings.controls === 'tilt' && this.tiltZero !== null && steer === 0) {
        steer = VC.clamp((this.tiltRaw - this.tiltZero) / 16, -1, 1);
        if (Math.abs(steer) < 0.06) steer = 0;
      }
      return { steer, sprint: this.sprint || !!(k.Space || k.ArrowUp || k.KeyW || k.KeyZ) };
    }
  };

  /* ======================================================================= */
  /* Interface                                                                */
  /* ======================================================================= */

  const UI = VC.UI = {
    screen: null,
    history: [],
    mode: 'menu',          // 'menu' | 'race' | 'end'
    paused: false,
    race: null,
    demo: null,
    selLevel: 1,
    selStage: 1,
    garageSel: null,
    renderScale: 1,

    init() {
      Save.load();
      Store.init();
      Store.on((evt) => this.onStore(evt));
      Audio.set(Save.state.settings.sound, Save.state.settings.music);
      Input.init();

      const canvas = $('scene');
      this.renderer = new VC.Renderer(canvas);
      this.renderer.setQuality(Save.state.settings.quality);
      this.resize();
      root.addEventListener('resize', () => this.resize());

      this.bind();
      this.newDemo();
      this.show('home', true);

      const unlock = () => {
        Audio.unlock();
        Audio.playSong(this.currentTheme());
      };
      document.addEventListener('pointerdown', unlock, { capture: true });
      document.addEventListener('keydown', unlock, { capture: true });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          if (this.mode === 'race' && !this.paused) this.pause();
          Audio.suspend(true);
        } else {
          Audio.suspend(false);
        }
      });
      root.veloBack = () => this.back();
      root.veloPause = () => {
        if (this.mode === 'race' && !this.paused) this.pause();
      };

      this.last = performance.now();
      this.fpsAcc = 0;
      this.fpsN = 0;
      this.fpsT = 0;
      requestAnimationFrame((t) => this.frame(t));
      setTimeout(() => $('loader').classList.add('out'), 250);
      setTimeout(() => $('loader').classList.add('hidden'), 800);
    },

    currentTheme() {
      if (this.mode !== 'menu' && this.race) return this.race.info.theme;
      return VC.LEVELS[(this.selLevel || 1) - 1].theme;
    },

    resize() {
      const dprCap = Save.state.settings.quality === 'low' ? 1 : 1.75;
      const dpr = Math.min(root.devicePixelRatio || 1, dprCap) * this.renderScale;
      const w = root.innerWidth;
      const h = root.innerHeight;
      this.renderer.resize(w * dpr, h * dpr);
      if (this.screen === 'garage') this.drawGarage();
    },

    /* --------------------------------------------------------------------- */
    /* Boucle principale                                                     */
    /* --------------------------------------------------------------------- */

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.1) dt = 0.1;
      if (dt <= 0) return;
      this.adaptResolution(dt);

      if (this.mode === 'menu') {
        // Course de démonstration en arrière-plan des menus (30 images/s).
        this.demoAcc = (this.demoAcc || 0) + dt;
        if (this.demoAcc < 1 / 31) return;
        const d = this.demoAcc;
        this.demoAcc = 0;
        this.stepSim(this.demo, d, null);
        if (this.demo.player.z > this.demo.track.finishZ - 40 * VC.U_M) this.newDemo();
        this.renderer.render(this.demo, { dt: d, labels: false });
        if (this.screen === 'garage') this.drawGarage(now / 1000);
        return;
      }

      const race = this.race;
      if (!this.paused) {
        this.stepSim(race, dt, this.mode === 'race' ? Input.read() : null);
        this.handleEvents(race);
      }
      this.renderer.render(race, { dt: this.paused ? 0 : dt, labels: Save.state.settings.labels });
      if (this.mode === 'race') this.updateHud(race);
      if (this.mode === 'race' || this.mode === 'end') {
        const p = race.player;
        Audio.setWind(p.speed / p.sprintSpeed, p.offroad, !this.paused && race.state !== 'countdown');
      }
      if (this.mode === 'end' && this.endTimer > 0) {
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.showResults();
      }
    },

    stepSim(race, dt, input) {
      race.acc = (race.acc || 0) + dt;
      let n = 0;
      while (race.acc >= STEP && n < 6) {
        race.update(STEP, input);
        race.acc -= STEP;
        n++;
      }
      if (n === 6) race.acc = 0;
      if (race.demo) race.events.length = 0;
    },

    adaptResolution(dt) {
      // Résolution dynamique : on baisse la définition si l'appareil peine.
      this.fpsT += dt;
      this.fpsN++;
      if (this.fpsT < 2.5) return;
      const fps = this.fpsN / this.fpsT;
      this.fpsT = 0;
      this.fpsN = 0;
      let s = this.renderScale;
      if (fps < 42 && s > 0.55) s = Math.max(0.55, s - 0.12);
      else if (fps > 57 && s < 1) s = Math.min(1, s + 0.06);
      if (s !== this.renderScale) {
        this.renderScale = s;
        this.resize();
      }
    },

    newDemo() {
      const level = this.selLevel || Save.currentLevel();
      const stage = 1 + Math.floor(Math.random() * 10);
      this.demo = new VC.Race({ level, stage, bike: VC.bikeOfTier(level), demo: true, salt: Math.floor(Math.random() * 1e6) });
      // On démarre la démo un peu après le départ pour être au cœur du peloton.
      for (let k = 0; k < 120; k++) this.demo.update(STEP, null);
      this.demo.events.length = 0;
    },

    /* --------------------------------------------------------------------- */
    /* Navigation                                                            */
    /* --------------------------------------------------------------------- */

    show(name, root_) {
      if (this.screen && !root_) this.history.push(this.screen);
      if (root_) this.history = [];
      this.screen = name;
      for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === 'scr-' + name);
      $('hud').classList.toggle('on', name === 'race');
      if (name === 'home') this.renderHome();
      if (name === 'levels') this.renderLevels();
      if (name === 'stages') this.renderStages();
      if (name === 'garage') this.renderGarage();
      if (name === 'settings') this.renderSettings();
      Native.setBack(name !== 'home');
    },

    back() {
      if (!$('modal').classList.contains('hidden')) {
        if (this.modalCancel) this.modalCancel();
        else this.closeModal();
        return true;
      }
      if (this.mode === 'race') {
        if (this.paused) this.resume();
        else this.pause();
        return true;
      }
      if (this.mode === 'end') {
        this.leaveRace('stages');
        return true;
      }
      if (this.screen === 'results') {
        this.leaveRace('stages');
        return true;
      }
      if (this.screen === 'home') return false;
      const prev = this.history.pop() || 'home';
      this.screen = null;
      this.show(prev, prev === 'home');
      Audio.click();
      return true;
    },

    bind() {
      document.addEventListener('click', (e) => {
        const go = e.target.closest('[data-go]');
        if (go) {
          Audio.click();
          if (go.dataset.go === 'garage') this.garageSel = null;
          this.show(go.dataset.go);
          return;
        }
        if (e.target.closest('[data-back]')) this.back();
      });
      $('btn-play').addEventListener('click', () => {
        Audio.click();
        const L = Save.currentLevel();
        this.selLevel = L;
        this.selStage = Save.nextStage(L);
        if (!Save.levelPlayable(L)) {
          this.garageSel = VC.bikeOfTier(VC.LEVELS[L - 1].bike).id;
          this.show('garage');
          return;
        }
        this.show('stages');
      });
      $('btn-race').addEventListener('click', () => {
        Audio.click();
        this.startRace(this.selLevel, this.selStage);
      });
      $('btn-pause').addEventListener('click', () => this.pause());
      $('gb-action').addEventListener('click', () => this.garageAction());
    },

    toast(text) {
      const t = $('toast');
      t.textContent = text;
      t.classList.add('on');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
    },

    modal(opts) {
      const m = $('modal');
      m.innerHTML = '';
      const card = el('div', 'modal-card panel');
      card.appendChild(el('h3', '', opts.title));
      if (opts.text) card.appendChild(el('p', '', opts.text));
      const acts = el('div', 'modal-actions' + (opts.row ? ' row' : ''));
      for (const b of opts.buttons || [{ label: 'OK' }]) {
        const btn = el('button', 'btn ' + (b.cls || ''), (b.icon ? icon(b.icon) : '') + b.label);
        btn.addEventListener('click', () => {
          Audio.click();
          this.closeModal();
          if (b.action) b.action();
        });
        acts.appendChild(btn);
      }
      card.appendChild(acts);
      m.appendChild(card);
      m.classList.remove('hidden');
      this.modalCancel = opts.cancel || null;
      Native.setBack(true);
    },

    closeModal() {
      $('modal').classList.add('hidden');
      this.modalCancel = null;
      Native.setBack(this.screen !== 'home' || this.mode !== 'menu');
    },

    /* --------------------------------------------------------------------- */
    /* Accueil                                                               */
    /* --------------------------------------------------------------------- */

    renderHome() {
      const L = Save.currentLevel();
      $('home-level').textContent = L;
      $('home-stage').textContent = Save.nextStage(L);
      $('home-bike').textContent = VC.bike(Save.state.bike).name;
      $('home-wins').textContent = Save.state.stats.wins;
      if (this.selLevel !== L && this.mode === 'menu') {
        this.selLevel = L;
        this.newDemo();
        Audio.playSong(this.currentTheme());
      }
    },

    /* --------------------------------------------------------------------- */
    /* Niveaux                                                               */
    /* --------------------------------------------------------------------- */

    renderLevels() {
      const list = $('level-list');
      list.innerHTML = '';
      for (const c of document.querySelectorAll('.cur-bike')) c.textContent = VC.bike(Save.state.bike).name;
      const cur = Save.currentLevel();
      for (const L of VC.LEVELS) {
        const reached = Save.levelReached(L.n);
        const playable = Save.levelPlayable(L.n);
        const bike = VC.bikeOfTier(L.bike);
        const wins = Save.levelWins(L.n);
        const card = el('button', 'level-card' + (L.n === cur ? ' current' : ''));
        const art = el('canvas', 'lv-art');
        art.width = 520;
        art.height = 200;
        card.appendChild(art);
        setTimeout(() => VC.Art.drawPreview(art, L.theme), 40 + L.n * 60);
        const body = el('div', 'lv-body');
        body.appendChild(el('div', 'lv-num', 'NIVEAU ' + L.n));
        body.appendChild(el('div', 'lv-name', L.name));
        body.appendChild(el('div', 'lv-place', L.place));
        const pips = el('div', 'pips');
        for (let s = 1; s <= 10; s++) pips.appendChild(el('i', 'pip' + (Save.isWon(L.n, s) ? ' on' : '')));
        body.appendChild(pips);
        body.appendChild(el('div', 'lv-meta', '<span><b>' + wins + '</b>/10 étapes</span><span>' + icon('bike') + ' ' + bike.name + '</span>'));
        card.appendChild(body);
        if (!playable) {
          const lock = el('div', 'lv-lock');
          if (!reached) {
            lock.innerHTML = icon('lock') + 'Gagne l’étape 10 du niveau ' + (L.n - 1);
          } else {
            lock.innerHTML = icon('lock') + 'Il faut le vélo ' + bike.name;
            const b = el('button', 'btn buy lv-action', icon('cart') + 'Obtenir · ' + Store.priceOf(bike));
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              Audio.click();
              this.garageSel = bike.id;
              this.show('garage');
            });
            body.appendChild(b);
          }
          card.appendChild(lock);
        }
        card.addEventListener('click', () => {
          Audio.click();
          if (!reached) {
            this.modal({ title: 'Niveau verrouillé', text: 'Gagne les 10 étapes du niveau ' + (L.n - 1) + ' pour accéder au niveau ' + L.n + ' (' + L.name + ').' });
            return;
          }
          if (!playable) {
            this.garageSel = bike.id;
            this.show('garage');
            return;
          }
          this.selLevel = L.n;
          this.selStage = Save.nextStage(L.n);
          this.newDemo();
          Audio.playSong(this.currentTheme());
          this.show('stages');
        });
        list.appendChild(card);
      }
      requestAnimationFrame(() => {
        const c = list.children[cur - 1];
        if (c) list.scrollLeft = Math.max(0, c.offsetLeft - 20);
      });
    },

    /* --------------------------------------------------------------------- */
    /* Étapes                                                                */
    /* --------------------------------------------------------------------- */

    renderStages() {
      const L = this.selLevel;
      const level = VC.LEVELS[L - 1];
      $('st-title').textContent = 'Niveau ' + L + ' · ' + level.name;
      $('st-wins').textContent = Save.levelWins(L);
      const map = $('stage-map');
      map.innerHTML = '';
      // Parcours en serpentin : 5 étapes par ligne.
      const pts = [];
      for (let s = 1; s <= 10; s++) {
        const row = s <= 5 ? 0 : 1;
        const col = row === 0 ? s - 1 : 10 - s;
        pts.push([8 + col * 21, row === 0 ? 27 : 72]);
      }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'route');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      let d = 'M' + pts[0][0] + ' ' + pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        if (y0 !== y1) d += ' C' + (x0 + 10) + ' ' + y0 + ' ' + (x1 + 10) + ' ' + y1 + ' ' + x1 + ' ' + y1;
        else d += ' L' + x1 + ' ' + y1;
      }
      svg.innerHTML = '<path d="' + d + '" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="7" vector-effect="non-scaling-stroke" stroke-linecap="round"/>' +
        '<path d="' + d + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-dasharray="8 8" vector-effect="non-scaling-stroke"/>';
      map.appendChild(svg);
      for (let s = 1; s <= 10; s++) {
        const res = Save.result(L, s);
        const open = Save.stageUnlocked(L, s);
        let cls = 'node';
        let inner = String(s);
        if (!open) {
          cls += ' locked';
          inner = icon('lock');
        } else if (res && res.pos === 1) cls += ' won';
        else {
          cls += ' open';
          if (res && res.pos === 2) cls += ' silver';
          if (res && res.pos === 3) cls += ' bronze';
        }
        if (s === this.selStage) cls += ' sel';
        const n = el('button', cls, inner + '<span class="tl">' + VC.TIERS[s - 1].name + '</span>');
        n.style.left = pts[s - 1][0] + '%';
        n.style.top = pts[s - 1][1] + '%';
        n.addEventListener('click', () => {
          Audio.click();
          if (!open) {
            this.toast('Gagne l’étape ' + (s - 1) + ' pour débloquer celle-ci');
            return;
          }
          this.selStage = s;
          this.renderStages();
        });
        map.appendChild(n);
      }
      this.renderStageInfo();
    },

    renderStageInfo() {
      const L = this.selLevel;
      const S = this.selStage;
      const info = VC.stageInfo(L, S);
      const opps = VC.makeOpponents(L, S);
      const fav = opps.find((o) => o.favorite);
      const bike = Save.bikeFor(L);
      $('si-num').textContent = 'ÉTAPE ' + S;
      const tier = $('si-tier');
      tier.textContent = info.tier.name;
      tier.style.background = info.tier.color;
      $('si-dist').textContent = VC.fmtDist(info.distance);
      const avg = opps.reduce((s, o) => s + o.cruise, 0) / opps.length;
      $('si-opp').textContent = '10 · ~' + Math.round(avg) + ' km/h';
      $('si-fav').textContent = fav.name + ' (n°' + fav.num + ')';
      $('si-bike').textContent = bike.name + ' · ' + bike.cruise + ' km/h';
      const res = Save.result(L, S);
      $('si-best').textContent = res ? VC.ordinal(res.pos) + ' · ' + VC.fmtTime(res.time) : '—';
      const canvas = $('si-profile');
      const track = new VC.Track(info);
      requestAnimationFrame(() => this.drawProfile(canvas, track, info));
      $('btn-race').disabled = !Save.levelPlayable(L) || !Save.stageUnlocked(L, S);
    },

    drawProfile(canvas, track, info) {
      const w = canvas.clientWidth * 2 || 400;
      const h = canvas.clientHeight * 2 || 100;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const a = Math.floor(track.startZ / VC.SEG);
      const b = Math.floor(track.finishZ / VC.SEG);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = a; i <= b; i++) {
        lo = Math.min(lo, track.segments[i].y1);
        hi = Math.max(hi, track.segments[i].y1);
      }
      const span = Math.max(6000, hi - lo);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 2) {
        const i = Math.floor(a + (b - a) * x / w);
        const y = track.segments[i].y1;
        ctx.lineTo(x, h - 6 - (y - lo) / span * (h - 16));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      const tier = info.tier.color;
      g.addColorStop(0, tier);
      g.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = '700 ' + Math.round(h * 0.2) + 'px Inter, sans-serif';
      ctx.fillText('Profil', 8, h * 0.26);
    },

    /* --------------------------------------------------------------------- */
    /* Course                                                                */
    /* --------------------------------------------------------------------- */

    startRace(level, stage) {
      if (!Save.levelPlayable(level) || !Save.stageUnlocked(level, stage)) return;
      const bike = Save.bikeFor(level);
      this.race = new VC.Race({ level, stage, bike });
      this.selLevel = level;
      this.selStage = stage;
      this.mode = 'race';
      this.paused = false;
      this.endTimer = 0;
      this.lastMark = null;
      this.hudCache = {};
      Input.reset();
      Input.calibrate();
      this.renderer.camX = 0;
      this.renderer.particles.length = 0;
      this.buildHudDots();
      const info = this.race.info;
      $('hud-stage').textContent = 'Niv. ' + level + ' · Étape ' + stage + ' · ' + info.tier.name;
      $('hud-of').textContent = '/' + this.race.riders.length;
      $('hud-center').textContent = '';
      this.show('race');
      this.history = ['home', 'stages'];
      Native.keepAwake(true);
      Native.setBack(true);
      Audio.unlock();
      Audio.playSong(info.theme);
      this.showCoach();
    },

    showCoach() {
      const c = $('coach');
      c.innerHTML = '';
      if (Save.state.stats.races > 1) return;
      const tilt = Save.state.settings.controls === 'tilt';
      c.appendChild(el('div', 'coach l', tilt ? 'Incline le téléphone ou utilise ces flèches pour te diriger' : 'Maintiens pour te diriger et dépasser'));
      c.appendChild(el('div', 'coach r', 'Maintiens SPRINT pour accélérer : ça vide l’énergie'));
      c.appendChild(el('div', 'coach c', 'Roule derrière un adversaire : l’aspiration te fait gagner vitesse et énergie. Finis 1er pour débloquer l’étape suivante !'));
    },

    buildHudDots() {
      const box = $('hud-dots');
      box.innerHTML = '';
      this.dots = this.race.riders.map((r) => {
        const d = el('i', 'hud-dot' + (r.isPlayer ? ' me' : ''));
        if (!r.isPlayer) d.style.background = r.kit[0];
        box.appendChild(d);
        return d;
      });
    },

    updateHud(race) {
      const p = race.player;
      const c = this.hudCache;
      const set = (id, v) => {
        if (c[id] !== v) {
          c[id] = v;
          $(id).textContent = v;
        }
      };
      const prog = race.progressOf(p);
      set('hud-pos', String(p.rank));
      set('hud-suf', p.rank === 1 ? 'er' : 'e');
      $('hud-rank').classList.toggle('first', p.rank === 1);
      set('hud-speed', String(Math.round(VC.toKmh(p.speed))));
      set('hud-time', VC.fmtTime(race.time));
      const left = Math.max(0, (race.track.finishZ - p.z) / VC.U_M);
      set('hud-left', left >= 1000 ? VC.fmtDist(Math.round(left / 10) * 10) : Math.ceil(left / 10) * 10 + ' m');
      const fill = (prog * 100).toFixed(1) + '%';
      if (c.fill !== fill) {
        c.fill = fill;
        $('hud-fill').style.width = fill;
      }
      race.riders.forEach((r, i) => {
        this.dots[i].style.left = (race.progressOf(r) * 100).toFixed(2) + '%';
      });
      // Énergie de sprint
      const ring = $('sprint-ring');
      const off = (289 * (1 - p.stamina / 100)).toFixed(1);
      if (c.ring !== off) {
        c.ring = off;
        ring.setAttribute('stroke-dashoffset', off);
      }
      const sp = $('ctl-sprint');
      sp.classList.toggle('empty', p.tired);
      sp.classList.toggle('low', p.stamina < 30);
      $('tag-draft').classList.toggle('on', p.draft > 0.25 && race.state === 'racing');
      $('tag-tired').classList.toggle('on', p.tired);
      // Repères de distance
      const marks = [[1000, 'Dernier kilomètre !'], [500, '500 m'], [200, '200 m — sprint !']];
      for (const [m, label] of marks) {
        if (left <= m && left > m - 60 && this.lastMark !== m && race.info.distance > m + 100) {
          this.lastMark = m;
          this.flash(label);
          if (m === 200) Audio.cheer(1.5);
        }
      }
    },

    flash(text, ms) {
      const m = $('hud-msg');
      m.textContent = text;
      m.classList.add('on');
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => m.classList.remove('on'), ms || 1600);
    },

    center(text, cls) {
      const c = $('hud-center');
      c.className = 'hud-center';
      void c.offsetWidth;
      c.textContent = text;
      if (cls) c.classList.add(...cls.split(' '));
      c.classList.add('anim');
    },

    handleEvents(race) {
      for (const e of race.events) {
        switch (e.type) {
          case 'count':
            this.center(String(e.data));
            Audio.count();
            Native.haptic('tick');
            if (e.data === 3) Input.calibrate();
            break;
          case 'go':
            this.center('GO !', 'go');
            Audio.go();
            Audio.cheer(1.2);
            Native.haptic('confirm');
            $('coach').innerHTML = '';
            setTimeout(() => {
              if ($('hud-center').textContent === 'GO !') $('hud-center').textContent = '';
            }, 900);
            break;
          case 'bump':
            if (e.data.hard && (!this.bumpT || race.time - this.bumpT > 0.4)) {
              this.bumpT = race.time;
              this.renderer.shake = 0.7;
              Audio.bump();
              Native.haptic('heavy');
            }
            break;
          case 'rub':
            if (!this.rubT || race.time - this.rubT > 0.6) {
              this.rubT = race.time;
              this.renderer.shake = Math.max(this.renderer.shake, 0.25);
              Native.haptic('tick');
            }
            break;
          case 'gain':
            this.rankFlash('up');
            Audio.gain();
            break;
          case 'lose':
            this.rankFlash('down');
            break;
          case 'sprint':
            Audio.sprint();
            break;
          case 'tired':
            this.flash('Plus d’énergie : récupère dans l’aspiration');
            Native.haptic('reject');
            break;
          case 'finish':
            this.onFinish(e.data);
            break;
        }
      }
      race.events.length = 0;
    },

    rankFlash(kind) {
      const r = $('hud-rank');
      r.classList.remove('up', 'down');
      void r.offsetWidth;
      r.classList.add(kind);
      clearTimeout(this.rankTimer);
      this.rankTimer = setTimeout(() => r.classList.remove('up', 'down'), 500);
    },

    onFinish(results) {
      const race = this.race;
      this.mode = 'end';
      this.endTimer = 3.2;
      Input.reset();
      this.outcome = Save.record(race.info.level, race.info.stage, results.position, results.time);
      this.results = results;
      if (results.won) {
        this.center('VICTOIRE !', 'go big-text');
        this.renderer.confetti();
        Audio.win();
        Native.haptic('confirm');
      } else {
        this.center(VC.ordinal(results.position) + ' place', 'big-text');
        Audio.lose();
      }
      $('tag-draft').classList.remove('on');
      $('tag-tired').classList.remove('on');
    },

    showResults() {
      const race = this.race;
      const res = this.results;
      const out = this.outcome;
      const L = race.info.level;
      const S = race.info.stage;
      $('hud').classList.remove('on');
      Native.keepAwake(false);
      const medal = $('res-medal');
      medal.className = 'medal ' + (res.position === 1 ? 'gold' : res.position === 2 ? '' : res.position === 3 ? 'bronze' : 'none');
      medal.textContent = res.position;
      const title = $('res-title');
      title.className = 'res-title' + (res.won ? ' win' : '');
      title.textContent = res.won ? 'VICTOIRE !' : VC.ordinal(res.position) + ' place';
      let sub;
      const actions = [];
      const lastLevel = L === VC.LEVELS.length;
      if (res.won) {
        if (S < VC.STAGES_PER_LEVEL) {
          sub = out.firstWin ? 'Étape ' + (S + 1) + ' débloquée : 10 adversaires ' + VC.TIERS[S].name.toLowerCase() + ' t’attendent.' : 'Bravo, encore une victoire !';
          actions.push({ label: 'Étape suivante', icon: 'play', cls: 'primary', action: () => this.startRace(L, S + 1) });
        } else if (!lastLevel) {
          const nextL = VC.LEVELS[L];
          const bike = VC.bikeOfTier(nextL.bike);
          if (Save.levelPlayable(L + 1)) {
            sub = 'Niveau ' + L + ' terminé ! Direction le niveau ' + (L + 1) + ' : ' + nextL.name + '.';
            actions.push({ label: 'Niveau ' + (L + 1), icon: 'play', cls: 'primary', action: () => this.startRace(L + 1, 1) });
          } else {
            sub = 'Niveau ' + L + ' terminé ! Pour le niveau ' + (L + 1) + ' (' + nextL.name + '), les adversaires vont plus vite : il te faut le vélo ' + bike.name + '.';
            actions.push({ label: 'Obtenir le ' + bike.name, icon: 'cart', cls: 'buy', action: () => { this.garageSel = bike.id; this.leaveRace('garage'); } });
          }
        } else {
          sub = 'Tu as gagné les 50 étapes : tu es le Vélo Champion absolu !';
        }
        actions.push({ label: 'Rejouer', action: () => this.startRace(L, S) });
      } else {
        const tips = [
          'Garde ton sprint pour les 200 derniers mètres.',
          'Colle-toi derrière un adversaire : l’aspiration recharge ton énergie.',
          'Évite l’herbe et les chocs : ils te ralentissent beaucoup.',
          'Dans les virages, contre-braque pour rester sur la route.'
        ];
        sub = 'Il faut finir 1er pour débloquer l’étape suivante. Astuce : ' + tips[(S + res.position) % tips.length];
        actions.push({ label: 'Réessayer', icon: 'play', cls: 'primary', action: () => this.startRace(L, S) });
      }
      actions.push({ label: 'Étapes', action: () => this.leaveRace('stages') });
      $('res-sub').textContent = sub;
      const avg = VC.toKmh(race.info.distance * VC.U_M / res.time);
      $('res-stats').innerHTML = '<span class="chip">Temps <b>' + VC.fmtTime(res.time) + '</b></span>' +
        '<span class="chip">Moyenne <b>' + avg.toFixed(1).replace('.', ',') + ' km/h</b></span>' +
        (out.best ? '<span class="chip"><svg><use href="#i-trophy"/></svg><b>Record</b></span>' : '');
      const box = $('res-actions');
      box.innerHTML = '';
      for (const a of actions) {
        const b = el('button', 'btn ' + (a.cls || ''), (a.icon ? icon(a.icon) : '') + a.label);
        b.addEventListener('click', () => {
          Audio.click();
          a.action();
        });
        box.appendChild(b);
      }
      const list = $('res-list');
      list.innerHTML = '';
      for (const e of res.list) {
        const li = el('li', e.isPlayer ? 'me' : '');
        li.innerHTML = '<span class="p">' + e.pos + '</span><span class="k" style="background:' + e.kit[0] + '"></span>' +
          '<span class="n">' + (e.isPlayer ? 'Vous' : e.name) + '</span><span class="g">' + (e.pos === 1 ? VC.fmtTime(e.time) : VC.fmtGap(e.gap)) + '</span>';
        list.appendChild(li);
      }
      this.mode = 'end';
      this.endTimer = 0;
      this.screen = 'results';
      for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === 'scr-results');
      Native.setBack(true);
    },

    pause() {
      if (this.mode !== 'race' || this.paused) return;
      this.paused = true;
      Input.reset();
      Audio.setWind(0, false, false);
      this.modal({
        title: 'Pause',
        text: 'Étape ' + this.race.info.stage + ' · ' + this.race.info.tier.name,
        buttons: [
          { label: 'Reprendre', icon: 'play', cls: 'primary', action: () => this.resume() },
          { label: 'Recommencer', action: () => this.startRace(this.race.info.level, this.race.info.stage) },
          { label: 'Abandonner', action: () => this.leaveRace('stages') }
        ],
        cancel: () => {
          this.closeModal();
          this.resume();
        }
      });
    },

    resume() {
      this.paused = false;
      this.closeModal();
      this.last = performance.now();
    },

    leaveRace(to) {
      this.mode = 'menu';
      this.paused = false;
      this.race = null;
      Native.keepAwake(false);
      Audio.setWind(0, false, false);
      $('hud').classList.remove('on');
      $('coach').innerHTML = '';
      this.newDemo();
      this.screen = null;
      this.history = to === 'stages' ? ['home'] : to === 'garage' ? ['home'] : [];
      this.show(to);
    },

    /* --------------------------------------------------------------------- */
    /* Garage                                                                */
    /* --------------------------------------------------------------------- */

    renderGarage() {
      if (!this.garageSel) this.garageSel = Save.state.bike;
      const mode = $('gb-mode');
      mode.textContent = Store.mode === 'play' ? 'Google Play' : 'Version de test · achats simulés';
      const thumbs = $('bike-thumbs');
      thumbs.innerHTML = '';
      for (const b of VC.BIKES) {
        const t = el('button', 'thumb' + (b.id === this.garageSel ? ' sel' : ''));
        const c = el('canvas');
        c.width = 220;
        c.height = 130;
        t.appendChild(c);
        const ctx = c.getContext('2d');
        VC.Art.drawBikeSide(ctx, b, 52, 84, 70, 0);
        if (b.id === Save.state.bike) t.insertAdjacentHTML('beforeend', '<svg class="badge"><use href="#i-check"/></svg>');
        else if (!Save.state.owned.includes(b.id)) t.insertAdjacentHTML('beforeend', '<svg class="lock"><use href="#i-lock"/></svg>');
        t.addEventListener('click', () => {
          Audio.click();
          this.garageSel = b.id;
          this.renderGarage();
        });
        thumbs.appendChild(t);
      }
      const bike = VC.bike(this.garageSel);
      $('gb-name').textContent = bike.name;
      $('gb-tier').textContent = 'Niveau ' + bike.tier + ' · ' + VC.LEVELS[bike.tier - 1].name;
      $('gb-tag').textContent = bike.tag;
      const max = VC.BIKES[VC.BIKES.length - 1];
      const stats = [
        ['Vitesse', bike.cruise / max.cruise, bike.cruise + ' km/h'],
        ['Sprint', bike.sprint / max.sprint, bike.sprint + ' km/h'],
        ['Accélération', (2.3 - bike.tau) / (2.3 - max.tau), Math.round((2.3 - bike.tau) / (2.3 - max.tau) * 100) + ' %'],
        ['Maniabilité', bike.handling / 1.2, Math.round(bike.handling / 1.2 * 100) + ' %']
      ];
      $('gb-stats').innerHTML = stats.map((s) => '<div class="stat"><span>' + s[0] + '</span><div class="meter"><i style="width:' +
        Math.round(VC.clamp(s[1], 0.05, 1) * 100) + '%"></i></div><b>' + s[2] + '</b></div>').join('');
      const btn = $('gb-action');
      const owned = Save.state.owned.includes(bike.id);
      const note = $('gb-note');
      btn.disabled = false;
      if (bike.id === Save.state.bike) {
        btn.className = 'btn';
        btn.innerHTML = icon('check') + 'Équipé';
        btn.disabled = true;
        note.textContent = 'Ce vélo est utilisé pour tes courses.';
      } else if (owned) {
        btn.className = 'btn primary';
        btn.innerHTML = icon('bike') + 'Équiper';
        note.textContent = 'Tu possèdes ce vélo.';
      } else {
        btn.className = 'btn buy';
        btn.innerHTML = icon('cart') + 'Acheter · ' + Store.priceOf(bike);
        note.textContent = Store.mode === 'play'
          ? 'Achat unique, paiement sécurisé par Google Play. Requis pour le niveau ' + bike.tier + '.'
          : 'Version de test : l’achat est simulé et gratuit. Requis pour le niveau ' + bike.tier + '.';
      }
      this.drawGarage(performance.now() / 1000);
    },

    drawGarage(t) {
      const c = $('garage-canvas');
      if (!c || !this.garageSel) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext('2d');
      const W = c.width;
      const H = c.height;
      ctx.clearRect(0, 0, W, H);
      const bike = VC.bike(this.garageSel);
      const g = ctx.createRadialGradient(W / 2, H * 0.62, 0, W / 2, H * 0.62, W * 0.55);
      g.addColorStop(0, VC.css(VC.rgb(bike.frame), 0.35));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(W / 2, H * 0.8, W * 0.36, H * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      const size = Math.min(W * 0.3, H * 0.46);
      const wb = size * 1.45;
      VC.Art.drawBikeSide(ctx, bike, W / 2 - wb / 2, H * 0.8 - size / 2, size, t || 0);
      if (!Save.state.owned.includes(bike.id)) {
        ctx.fillStyle = 'rgba(5,7,15,.25)';
        ctx.fillRect(0, 0, W, H);
      }
    },

    garageAction() {
      const bike = VC.bike(this.garageSel);
      if (Save.state.owned.includes(bike.id)) {
        Save.equip(bike.id);
        Audio.click();
        this.toast(bike.name + ' équipé');
        this.renderGarage();
        return;
      }
      const buy = () => {
        const btn = $('gb-action');
        btn.disabled = true;
        Store.buy(bike).then((r) => {
          btn.disabled = false;
          this.onPurchaseResult(bike, r);
        });
      };
      if (Store.mode !== 'play') {
        this.modal({
          title: 'Achat simulé',
          text: 'Cette version de test débloque ' + bike.name + ' gratuitement. Dans la version Google Play, ce vélo coûte ' + bike.price + '.',
          row: true,
          buttons: [{ label: 'Annuler' }, { label: 'Débloquer', cls: 'buy', action: buy }]
        });
        return;
      }
      buy();
    },

    onPurchaseResult(bike, r) {
      switch (r.state) {
        case 'purchased':
          Save.equip(bike.id);
          Audio.purchase();
          Native.haptic('confirm');
          this.toast(bike.name + ' débloqué et équipé !');
          break;
        case 'pending':
          this.modal({ title: 'Paiement en attente', text: 'Ton vélo sera débloqué automatiquement dès que Google Play aura validé le paiement.' });
          break;
        case 'cancelled':
          break;
        case 'unavailable':
          this.modal({ title: 'Achat indisponible', text: 'Google Play n’est pas accessible. Vérifie ta connexion et que Vélo Champion a bien été installé depuis le Play Store, puis réessaie.' });
          break;
        default:
          this.modal({ title: 'Achat impossible', text: r.message || 'Une erreur est survenue. Aucun montant n’a été débité.' });
      }
      if (this.screen === 'garage') this.renderGarage();
    },

    onStore(evt) {
      if (evt.type === 'owned' || evt.type === 'products' || evt.type === 'purchase') {
        if (evt.type === 'purchase' && evt.state === 'purchased' && !Store.pending && this.screen === 'garage') {
          this.toast('Achat validé !');
        }
        if (this.screen === 'garage') this.renderGarage();
        if (this.screen === 'levels') this.renderLevels();
        if (this.screen === 'home') this.renderHome();
      }
    },

    /* --------------------------------------------------------------------- */
    /* Réglages                                                              */
    /* --------------------------------------------------------------------- */

    renderSettings() {
      const st = Save.state.settings;
      const box = $('settings');
      box.innerHTML = '';
      const toggle = (key, label, hint, after) => {
        const row = el('div', 'set-row');
        row.appendChild(el('label', '', label + (hint ? '<small>' + hint + '</small>' : '')));
        const t = el('button', 'toggle' + (st[key] ? ' on' : ''));
        t.setAttribute('aria-label', label);
        t.addEventListener('click', () => {
          st[key] = !st[key];
          t.classList.toggle('on', st[key]);
          Save.save();
          if (after) after();
          Audio.click();
        });
        row.appendChild(t);
        box.appendChild(row);
      };
      const seg = (key, label, hint, options, after) => {
        const row = el('div', 'set-row');
        row.appendChild(el('label', '', label + (hint ? '<small>' + hint + '</small>' : '')));
        const s = el('div', 'seg');
        for (const [val, text] of options) {
          const b = el('button', st[key] === val ? 'on' : '', text);
          b.addEventListener('click', () => {
            st[key] = val;
            Save.save();
            for (const x of s.children) x.classList.toggle('on', x === b);
            if (after) after();
            Audio.click();
          });
          s.appendChild(b);
        }
        row.appendChild(s);
        box.appendChild(row);
      };
      const applyAudio = () => {
        Audio.set(st.sound, st.music);
        if (st.music) Audio.playSong(this.currentTheme());
      };
      toggle('sound', 'Effets sonores', '', applyAudio);
      toggle('music', 'Musique', '', applyAudio);
      toggle('haptics', 'Vibrations', 'Chocs, départ et dépassements');
      seg('controls', 'Direction', 'Inclinaison : tourne le téléphone comme un guidon', [['buttons', 'Boutons'], ['tilt', 'Inclinaison']]);
      seg('quality', 'Graphismes', 'Économie : plus fluide sur les petits téléphones', [['high', 'Élevés'], ['low', 'Économie']], () => {
        this.renderer.setQuality(st.quality);
        this.renderer.themeId = null;
        this.resize();
      });
      toggle('labels', 'Classement au-dessus des coureurs', 'Affiche la place des adversaires proches');
      const acts = el('div', 'set-actions');
      if (Store.mode === 'play') {
        const r = el('button', 'btn', icon('cart') + 'Restaurer mes achats');
        r.addEventListener('click', () => {
          Store.restore();
          this.toast('Achats en cours de vérification…');
        });
        acts.appendChild(r);
      }
      const reset = el('button', 'btn', 'Réinitialiser la progression');
      reset.addEventListener('click', () => {
        this.modal({
          title: 'Tout recommencer ?',
          text: 'Tes victoires et records seront effacés. Les vélos achetés sont conservés.',
          row: true,
          buttons: [{ label: 'Annuler' }, { label: 'Effacer', cls: 'primary', action: () => { Save.reset(); this.toast('Progression effacée'); } }]
        });
      });
      acts.appendChild(reset);
      box.appendChild(acts);
      const n = native();
      const version = n && n.appVersion ? n.appVersion() : 'web';
      box.appendChild(el('p', 'fine', 'Vélo Champion ' + version + ' · ' + Save.state.stats.races + ' courses, ' + Save.state.stats.wins + ' victoires'));
    }
  };

  /* Aperçu d'un décor pour les cartes de niveau. */
  VC.Art.drawPreview = function (canvas, themeId) {
    const key = themeId + canvas.width + 'x' + canvas.height;
    VC.Art.previews = VC.Art.previews || {};
    let img = VC.Art.previews[key];
    if (!img) {
      const r = new VC.Renderer(document.createElement('canvas'));
      r.setQuality('low');
      r.resize(canvas.width, canvas.height);
      const L = VC.LEVELS.find((l) => l.theme === themeId).n;
      const race = new VC.Race({ level: L, stage: 3, bike: VC.bikeOfTier(L), demo: true });
      for (let k = 0; k < 600; k++) race.update(STEP, null);
      r.render(race, { dt: 0, labels: false, effects: false });
      img = VC.Art.previews[key] = r.canvas;
    }
    canvas.getContext('2d').drawImage(img, 0, 0);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => UI.init());
  else UI.init();
})(window);
