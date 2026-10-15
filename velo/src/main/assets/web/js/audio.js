/* Vélo Champion — sons et musique synthétisés (Web Audio, aucun fichier). */
(function (root) {
  'use strict';
  const VC = root.VC;

  const SONGS = {
    campagne: { bpm: 116, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], wave: 'triangle' },
    cote: { bpm: 108, chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], wave: 'sine' },
    canyon: { bpm: 112, chords: [[52, 55, 59], [50, 54, 57], [48, 52, 55], [50, 54, 57]], wave: 'triangle' },
    alpes: { bpm: 120, chords: [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]], wave: 'triangle' },
    nuit: { bpm: 126, chords: [[54, 57, 61], [50, 54, 57], [57, 61, 64], [52, 56, 59]], wave: 'sawtooth' }
  };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const A = VC.Audio = {
    ctx: null,
    sound: true,
    music: true,
    song: null,

    unlock() {
      if (!this.ctx) {
        const Ctx = root.AudioContext || root.webkitAudioContext;
        if (!Ctx) return;
        const c = this.ctx = new Ctx();
        this.master = c.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(c.destination);
        this.sfx = c.createGain();
        this.sfx.connect(this.master);
        this.mus = c.createGain();
        this.mus.gain.value = 0.0;
        this.mus.connect(this.master);
        const len = c.sampleRate * 2;
        this.noise = c.createBuffer(1, len, c.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.apply();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    set(sound, music) {
      this.sound = sound;
      this.music = music;
      this.apply();
    },

    apply() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.sfx.gain.setTargetAtTime(this.sound ? 1 : 0, t, 0.05);
      this.mus.gain.setTargetAtTime(this.music && this.song ? 0.16 : 0, t, 0.3);
    },

    suspend(on) {
      if (!this.ctx) return;
      if (on) this.ctx.suspend();
      else this.ctx.resume();
    },

    /* Bruit du vent et du roulement --------------------------------------- */
    setWind(ratio, offroad, active) {
      if (!this.ctx) return;
      const c = this.ctx;
      if (!this.wind) {
        const src = c.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 0.7;
        const g = c.createGain();
        g.gain.value = 0;
        src.connect(bp).connect(g).connect(this.sfx);
        src.start();
        this.wind = { bp, g };
      }
      const t = c.currentTime;
      const r = active ? VC.clamp(ratio, 0, 1.3) : 0;
      this.wind.bp.frequency.setTargetAtTime(offroad ? 900 : 300 + 1500 * r, t, 0.1);
      this.wind.g.gain.setTargetAtTime(active ? (offroad ? 0.22 : 0.02 + 0.13 * r * r) : 0, t, 0.15);
    },

    tone(freq, dur, type, vol, when, slide) {
      if (!this.ctx || !this.sound) return;
      const c = this.ctx;
      const t = (when || c.currentTime) + 0.005;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + dur + 0.05);
    },

    noiseBurst(dur, freq, q, vol, when) {
      if (!this.ctx || !this.sound) return;
      const c = this.ctx;
      const t = (when || c.currentTime) + 0.005;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.sfx);
      src.start(t, Math.random());
      src.stop(t + dur + 0.05);
    },

    click() { this.tone(880, 0.06, 'triangle', 0.08); },
    count() { this.tone(660, 0.18, 'square', 0.12); },
    go() {
      this.tone(1320, 0.45, 'square', 0.14);
      this.tone(990, 0.45, 'triangle', 0.1);
    },
    bump() {
      this.tone(140, 0.18, 'sine', 0.35, 0, 60);
      this.noiseBurst(0.12, 1800, 2, 0.18);
    },
    whoosh() { this.noiseBurst(0.35, 1400, 1.2, 0.12); },
    sprint() { this.tone(300, 0.25, 'sawtooth', 0.05, 0, 600); },
    gain() { this.tone(988, 0.09, 'triangle', 0.1); this.tone(1318, 0.12, 'triangle', 0.1, this.ctx && this.ctx.currentTime + 0.08); },
    cheer(dur) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      for (let k = 0; k < 6; k++) this.noiseBurst(dur * (0.6 + Math.random() * 0.4), 900 + Math.random() * 1800, 0.9, 0.06, t + k * 0.08);
    },
    win() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [72, 76, 79, 84, 79, 84].forEach((m, i) => this.tone(hz(m), i === 5 ? 0.9 : 0.22, 'square', 0.09, t + i * 0.14));
      [60, 64, 67, 72].forEach((m) => this.tone(hz(m), 1.4, 'triangle', 0.07, t + 0.7));
      this.cheer(2.4);
    },
    lose() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [67, 65, 64, 60].forEach((m, i) => this.tone(hz(m), i === 3 ? 0.7 : 0.25, 'triangle', 0.1, t + i * 0.22));
    },
    purchase() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [76, 81, 88].forEach((m, i) => this.tone(hz(m), 0.3, 'triangle', 0.1, t + i * 0.09));
    },

    /* Musique ----------------------------------------------------------------- */
    playSong(themeId) {
      if (!this.ctx) return;
      const song = SONGS[themeId] || SONGS.campagne;
      if (this.song === song) return;
      this.song = song;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.1;
      this.apply();
      if (!this.timer) this.timer = setInterval(() => this.schedule(), 30);
    },

    stopSong() {
      this.song = null;
      this.apply();
    },

    schedule() {
      const c = this.ctx;
      if (!c || !this.song || c.state !== 'running') return;
      const song = this.song;
      const stepDur = 60 / song.bpm / 4;
      while (this.nextTime < c.currentTime + 0.15) {
        const s = this.step % 16;
        const bar = Math.floor(this.step / 16) % song.chords.length;
        const chord = song.chords[bar];
        const t = this.nextTime;
        if (this.music) {
          if (s % 4 === 0) this.drum('kick', t);
          if (s === 4 || s === 12) this.drum('snare', t);
          if (s % 2 === 1) this.drum('hat', t);
          if (s === 0 || s === 6 || s === 8 || s === 11 || s === 14) this.note(hz(chord[0] - 24), stepDur * 1.8, 'triangle', 0.5, t);
          if (s % 2 === 0) {
            const arp = [0, 1, 2, 1, 2, 0, 1, 2];
            const m = chord[arp[(s / 2) % 8]] + (Math.floor(this.step / 64) % 2 ? 12 : 0);
            this.note(hz(m), stepDur * 1.4, song.wave, 0.16, t);
          }
        }
        this.nextTime += stepDur;
        this.step++;
      }
    },

    note(f, dur, type, vol, t) {
      const c = this.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = type === 'sawtooth' ? 1800 : 3000;
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp).connect(g).connect(this.mus);
      o.start(t);
      o.stop(t + dur + 0.05);
    },

    drum(kind, t) {
      const c = this.ctx;
      if (kind === 'kick') {
        const o = c.createOscillator();
        const g = c.createGain();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(0.7, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(this.mus);
        o.start(t);
        o.stop(t + 0.2);
        return;
      }
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const g = c.createGain();
      const dur = kind === 'hat' ? 0.04 : 0.14;
      g.gain.setValueAtTime(kind === 'hat' ? 0.12 : 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.mus);
      src.start(t, Math.random());
      src.stop(t + dur + 0.02);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
