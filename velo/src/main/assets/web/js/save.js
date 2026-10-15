/* Vélo Champion — progression et réglages (sauvegardés sur l'appareil). */
(function (root) {
  'use strict';
  const VC = root.VC;
  const KEY = 'velo-champion-save-v1';

  const fresh = () => ({
    v: 1,
    results: {},            // "niveau-étape" → { pos, time }
    owned: ['rouleur'],
    bike: 'rouleur',
    last: { level: 1, stage: 1 },
    stats: { races: 0, wins: 0 },
    settings: { sound: true, music: true, haptics: true, controls: 'buttons', quality: 'high', labels: true }
  });

  const Save = VC.Save = {
    state: fresh(),

    load() {
      try {
        const raw = root.localStorage && root.localStorage.getItem(KEY);
        if (raw) {
          const data = JSON.parse(raw);
          const base = fresh();
          this.state = Object.assign(base, data);
          this.state.settings = Object.assign(fresh().settings, data.settings || {});
          this.state.stats = Object.assign(fresh().stats, data.stats || {});
          if (!this.state.owned.includes('rouleur')) this.state.owned.unshift('rouleur');
          if (!this.state.owned.includes(this.state.bike)) this.state.bike = 'rouleur';
        }
      } catch (e) {
        this.state = fresh();
      }
      return this.state;
    },

    save() {
      try {
        if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(this.state));
      } catch (e) {
        // stockage indisponible : la partie continue sans sauvegarde
      }
    },

    reset() {
      const keep = { owned: this.state.owned.slice(), settings: Object.assign({}, this.state.settings) };
      this.state = fresh();
      this.state.owned = keep.owned;
      this.state.settings = keep.settings;
      this.save();
    },

    key: (level, stage) => level + '-' + stage,
    result(level, stage) {
      return this.state.results[this.key(level, stage)] || null;
    },
    isWon(level, stage) {
      const r = this.result(level, stage);
      return !!(r && r.pos === 1);
    },

    /** Le niveau est atteint quand l'étape 10 du niveau précédent est gagnée. */
    levelReached(level) {
      return level === 1 || this.isWon(level - 1, VC.STAGES_PER_LEVEL);
    },
    ownsTier(tier) {
      return this.state.owned.some((id) => VC.bike(id).tier >= tier);
    },
    levelPlayable(level) {
      return this.levelReached(level) && this.ownsTier(VC.LEVELS[level - 1].bike);
    },
    stageUnlocked(level, stage) {
      if (!this.levelReached(level)) return false;
      return stage === 1 || this.isWon(level, stage - 1);
    },
    levelWins(level) {
      let n = 0;
      for (let s = 1; s <= VC.STAGES_PER_LEVEL; s++) if (this.isWon(level, s)) n++;
      return n;
    },
    /** Prochaine étape à jouer dans un niveau (première non gagnée). */
    nextStage(level) {
      for (let s = 1; s <= VC.STAGES_PER_LEVEL; s++) if (!this.isWon(level, s)) return s;
      return VC.STAGES_PER_LEVEL;
    },
    /** Niveau le plus avancé atteint. */
    currentLevel() {
      let L = 1;
      for (let l = 2; l <= VC.LEVELS.length; l++) if (this.levelReached(l)) L = l;
      return L;
    },

    /** Vélo utilisé pour un niveau : celui équipé s'il est assez rapide, sinon le meilleur possédé. */
    bikeFor(level) {
      const need = VC.LEVELS[level - 1].bike;
      const cur = VC.bike(this.state.bike);
      if (cur.tier >= need) return cur;
      const ok = this.state.owned.map(VC.bike).filter((b) => b.tier >= need).sort((a, b) => a.tier - b.tier);
      return ok[0] || cur;
    },

    record(level, stage, pos, time) {
      const st = this.state;
      const k = this.key(level, stage);
      const prev = st.results[k];
      const wasWon = !!(prev && prev.pos === 1);
      const levelWasDone = this.isWon(level, VC.STAGES_PER_LEVEL);
      st.stats.races++;
      if (pos === 1) st.stats.wins++;
      const better = !prev || pos < prev.pos || (pos === prev.pos && time < prev.time);
      if (better) st.results[k] = { pos, time: Math.round(time * 100) / 100 };
      const out = { firstWin: pos === 1 && !wasWon, best: better, next: null, levelDone: false };
      if (pos === 1) {
        if (stage < VC.STAGES_PER_LEVEL) out.next = { level, stage: stage + 1 };
        else {
          out.levelDone = !levelWasDone;
          if (level < VC.LEVELS.length) out.next = { level: level + 1, stage: 1 };
        }
      }
      st.last = { level, stage };
      this.save();
      return out;
    },

    own(id) {
      if (!this.state.owned.includes(id)) this.state.owned.push(id);
      this.save();
    },
    /** Synchronise les vélos achetés avec la boutique (achats restaurés ou remboursés). */
    setPurchased(ids) {
      const owned = ['rouleur'];
      for (const b of VC.BIKES) if (b.product && ids.includes(b.product)) owned.push(b.id);
      this.state.owned = owned;
      if (!owned.includes(this.state.bike)) this.state.bike = owned[owned.length - 1];
      this.save();
    },
    equip(id) {
      if (this.state.owned.includes(id)) {
        this.state.bike = id;
        this.save();
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
