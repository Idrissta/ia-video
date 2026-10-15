/* Prono — interface : matchs du jour, analyse, cotes, analyse manuelle, suivi. */
(function (root) {
  'use strict';
  const P = root.PRONO;
  const E = P.Engine;
  const D = P.Data;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => '<svg><use href="#i-' + id + '"/></svg>';
  const pct = (p) => (p == null || !isFinite(p) ? '—' : Math.round(p * 100) + ' %');
  const odd = (o) => (o == null || !isFinite(o) ? '—' : o >= 100 ? '99+' : o.toFixed(2).replace('.', ','));
  const dec = (v, n) => (v == null || !isFinite(v) ? '—' : v.toFixed(n == null ? 2 : n).replace('.', ','));
  const native = () => root.PronoNative;
  /** Libellé complet d'un pari : marché + sélection (« Total individuel 2 · Lille : Moins de 1,5 »). */
  const full = (p) => (p.market ? p.market + ' : ' : '') + p.label;
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ');
  const LS = {
    get(k, d) {
      try {
        const v = root.localStorage.getItem('prono-' + k);
        return v ? JSON.parse(v) : d;
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        root.localStorage.setItem('prono-' + k, JSON.stringify(v));
      } catch (e) {
        // stockage plein ou indisponible
      }
    }
  };

  const fmtTime = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (d) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtDay = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const logo = (url, name, cls) => url
    ? '<img class="logo ' + (cls || '') + '" loading="lazy" src="' + esc(url) + '" alt="" onerror="this.outerHTML=\'<span class=&quot;ini ' + (cls || '') + '&quot;>' + esc(initials(name)) + '</span>\'">'
    : '<span class="ini ' + (cls || '') + '">' + esc(initials(name)) + '</span>';
  const formDots = (f) => '<span class="form">' + (f || '').slice(-5).split('').map((c) => '<i class="' + (c === 'W' ? 'W' : c === 'L' ? 'L' : 'D') + '"></i>').join('') + '</span>';
  const levelTag = (p) => (p >= 0.75 ? '<span class="tag t1">Très probable</span>' : p >= 0.62 ? '<span class="tag t2">Probable</span>' : '<span class="tag t3">Risqué</span>');

  /* Marges système (barre d'état, barre de navigation, clavier) envoyées par l'application. */
  root.pronoInsets = (top, bottom) => {
    const st = document.documentElement.style;
    st.setProperty('--sa-t', Math.max(0, +top || 0) + 'px');
    st.setProperty('--sa-b', Math.max(0, +bottom || 0) + 'px');
  };

  const UI = P.UI = {
    tab: 'matches',
    screen: 'matches',
    dayOffset: 0,
    filter: LS.get('filter', 'top'),
    query: '',
    events: [],
    cur: null,
    matchTab: 'prono',
    mkFilter: 'all',
    mkQuery: '',
    settings: Object.assign({ blend: true, women: false }, LS.get('settings', {})),

    init() {
      this.bind();
      this.renderDates();
      this.loadDay();
      this.updateChrome();
      root.pronoBack = () => this.back();
      if (native() && native().setBackEnabled) native().setBackEnabled(true);
    },

    /* ----------------------------------------------------------------- */
    /* Navigation                                                        */
    /* ----------------------------------------------------------------- */

    bind() {
      document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.tab)));
      $('btn-back').addEventListener('click', () => this.back());
      $('btn-refresh').addEventListener('click', () => this.refresh());
      $('btn-share').addEventListener('click', () => this.share());
      $('q').addEventListener('input', (e) => {
        this.query = e.target.value.trim().toLowerCase();
        this.renderList();
      });
      document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
        this.filter = b.dataset.filter;
        LS.set('filter', this.filter);
        document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
        this.renderList();
      }));
      document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x.dataset.filter === this.filter));
    },

    show(screen) {
      this.screen = screen;
      document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === 'scr-' + screen));
      this.updateChrome();
    },

    go(tab) {
      this.tab = tab;
      document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      if (tab === 'manual') this.renderManual();
      if (tab === 'history') this.renderHistory(true);
      if (tab === 'info') this.renderInfo();
      this.show(tab);
    },

    back() {
      if (this.screen === 'match') {
        this.show(this.tab);
        return true;
      }
      if (this.tab !== 'matches') {
        this.go('matches');
        return true;
      }
      return false;
    },

    updateChrome() {
      const inMatch = this.screen === 'match';
      $('btn-back').classList.toggle('hidden', !inMatch);
      $('brand').classList.toggle('hidden', inMatch);
      $('btn-share').classList.toggle('hidden', !inMatch || !this.cur || !this.cur.res);
      $('btn-refresh').classList.toggle('hidden', !(this.screen === 'matches' || this.screen === 'history' || (inMatch && this.cur && this.cur.m && !this.cur.m.manual)));
      const titles = { matches: 'PronoFoot', manual: 'Analyse manuelle', history: 'Pronostics suivis', info: 'Infos et réglages' };
      $('title').textContent = inMatch ? (this.cur ? this.cur.title : 'Analyse') : titles[this.screen] || 'PronoFoot';
    },

    refresh() {
      if (this.screen === 'matches') this.loadDay(true);
      else if (this.screen === 'history') this.renderHistory(true);
      else if (this.screen === 'match' && this.cur && this.cur.m && !this.cur.m.manual) this.openMatch(this.cur.m.id, null, true);
    },

    toast(text) {
      const t = $('toast');
      t.textContent = text;
      t.classList.add('on');
      clearTimeout(this.toastT);
      this.toastT = setTimeout(() => t.classList.remove('on'), 2400);
    },

    haptic() {
      if (native() && native().haptic) native().haptic('tick');
    },

    /* ----------------------------------------------------------------- */
    /* Matchs du jour                                                    */
    /* ----------------------------------------------------------------- */

    dayDate(offset) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + offset);
      return d;
    },

    renderDates() {
      const box = $('dates');
      box.innerHTML = '';
      for (let o = -2; o <= 6; o++) {
        const d = this.dayDate(o);
        const label = o === -1 ? 'Hier' : o === 0 ? 'Aujourd’hui' : o === 1 ? 'Demain' : d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
        const b = document.createElement('button');
        b.className = 'chip' + (o === this.dayOffset ? ' on' : '');
        b.textContent = label;
        b.addEventListener('click', () => {
          this.dayOffset = o;
          this.renderDates();
          this.loadDay();
        });
        box.appendChild(b);
        if (o === this.dayOffset) setTimeout(() => b.scrollIntoView({ inline: 'center', block: 'nearest' }), 0);
      }
    },

    async loadDay(force) {
      const list = $('list');
      list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
      $('count').textContent = '';
      const token = (this.loadToken = (this.loadToken || 0) + 1);
      try {
        const evs = await D.day(this.dayDate(this.dayOffset), force);
        if (token !== this.loadToken) return;
        this.events = evs;
        this.renderList();
      } catch (e) {
        if (token !== this.loadToken) return;
        list.innerHTML = '<div class="empty"><b>Impossible de charger les matchs</b>Vérifie ta connexion internet puis réessaie.<br><br><button class="btn small" id="retry">' + icon('refresh') + 'Réessayer</button></div>';
        $('retry').addEventListener('click', () => this.loadDay(true));
      }
    },

    visibleEvents() {
      const q = this.query;
      return this.events.filter((e) => {
        if (!this.settings.women && e.league.women) return false;
        if (this.filter === 'top' && !e.league.top) return false;
        if (this.filter === 'pre' && e.state !== 'pre') return false;
        if (q) {
          const hay = (e.home.name + ' ' + e.away.name + ' ' + e.league.name).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
    },

    renderList() {
      const list = $('list');
      const evs = this.visibleEvents();
      $('count').textContent = evs.length + ' match' + (evs.length > 1 ? 's' : '');
      if (!evs.length) {
        const more = this.filter !== 'all' && this.events.length ? '<br><br><button class="btn small" id="show-all">Voir toutes les compétitions</button>' : '';
        list.innerHTML = '<div class="empty"><b>Aucun match</b>' + (this.events.length ? 'Aucun match ne correspond à ce filtre.' : 'Pas de match prévu ce jour-là.') + more + '</div>';
        const b = $('show-all');
        if (b) b.addEventListener('click', () => document.querySelector('[data-filter="all"]').click());
        return;
      }
      const groups = [];
      const byKey = {};
      for (const e of evs) {
        const k = e.league.id + '|' + e.league.name;
        if (!byKey[k]) {
          byKey[k] = { league: e.league, items: [] };
          groups.push(byKey[k]);
        }
        byKey[k].items.push(e);
      }
      const html = [];
      for (const g of groups) {
        html.push('<div class="league"><div class="league-h"><span class="flag">' + esc(g.league.flag) + '</span><span>' + esc(g.league.name) + '</span><span class="n">' + g.items.length + '</span></div>');
        for (const e of g.items) html.push(this.matchRow(e));
        html.push('</div>');
      }
      list.innerHTML = html.join('');
      list.querySelectorAll('.match').forEach((b) => b.addEventListener('click', () => {
        const e = this.events.find((x) => x.id === b.dataset.id);
        this.openMatch(b.dataset.id, e);
      }));
    },

    matchRow(e) {
      let time;
      if (e.state === 'pre') time = '<div class="time">' + fmtTime(e.date) + '</div>';
      else if (e.state === 'in') time = '<div class="time live">' + esc(e.detail || 'En cours') + '</div>';
      else time = '<div class="time">' + fmtTime(e.date) + '<small>' + esc(e.detail || 'Fin') + '</small></div>';
      const sc = (v) => (e.state !== 'pre' && isFinite(v) ? '<span class="sc">' + v + '</span>' : '');
      const o = e.odds && e.odds['1'] ? '<div class="odds-mini"><span>' + odd(e.odds['1']) + '</span><span>' + odd(e.odds.X) + '</span><span>' + odd(e.odds['2']) + '</span></div>' : '';
      return '<button class="match" data-id="' + esc(e.id) + '">' + time +
        '<div class="teams"><div class="team">' + logo(e.home.logo, e.home.name) + '<span class="nm">' + esc(e.home.name) + '</span>' + sc(e.home.score) + '</div>' +
        '<div class="team">' + logo(e.away.logo, e.away.name) + '<span class="nm">' + esc(e.away.name) + '</span>' + sc(e.away.score) + '</div></div>' +
        '<div class="side">' + o + '<div class="row">' + formDots(e.home.form) + formDots(e.away.form) + '</div></div></button>';
    },

    /* ----------------------------------------------------------------- */
    /* Analyse d'un match                                                */
    /* ----------------------------------------------------------------- */

    async openMatch(id, ev, force) {
      this.matchTab = 'prono';
      this.cur = { m: null, res: null, loading: id, title: ev ? ev.home.short + ' – ' + ev.away.short : 'Analyse' };
      this.show('match');
      const box = $('match');
      box.innerHTML = (ev ? this.headerHtml(ev) : '') + '<div class="spinner"></div><p class="sub" style="text-align:center">Analyse des derniers matchs et des confrontations…</p>';
      $('scr-match').scrollTop = 0;
      try {
        if (force) D.clearCache && D.clearCache();
        const m = await D.match(id);
        if (!this.cur || this.cur.loading !== id || this.screen !== 'match') return;
        this.setMatch(m);
      } catch (e) {
        box.innerHTML = (ev ? this.headerHtml(ev) : '') + '<div class="empty"><b>Analyse impossible</b>' + esc(e.message || 'Erreur réseau') + '<br><br><button class="btn small" id="retry-m">' + icon('refresh') + 'Réessayer</button></div>';
        $('retry-m').addEventListener('click', () => this.openMatch(id, ev, true));
      }
    },

    setMatch(m) {
      this.cur = { m, res: null, title: (m.home.short || m.home.name) + ' – ' + (m.away.short || m.away.name) };
      this.cur.userOdds = LS.get('odds-' + m.id, {});
      this.cur.statsState = m.manual ? 'none' : 'loading';
      this.compute();
      this.renderMatch();
      if (!m.manual) this.loadStats();
      this.updateChrome();
    },

    compute() {
      const c = this.cur;
      const ref = this.settings.blend && c.m.odds ? c.m.odds : {};
      c.input = D.engineInput(c.m, ref, c.userOdds);
      c.res = E.analyze(c.input);
      if (P.Stats) {
        // Corners, cartons, penalty… : moyennes générales tant que les statistiques
        // des derniers matchs ne sont pas chargées.
        const st = c.stats || { teams: { home: {}, away: {} }, scorers: null };
        c.statsRes = P.Stats.analyze(st.teams, c.input.names, c.m.neutral, { lh: c.res.lh, la: c.res.la, scorers: st.scorers });
        c.res.markets = c.res.markets.concat(c.statsRes.markets);
        E.applyOdds(c.res, c.userOdds);
      }
    },

    /** Charge en arrière-plan les statistiques des derniers matchs (corners, cartons, buteurs…). */
    async loadStats() {
      const c = this.cur;
      if (!c || !c.m || c.m.manual || !D.stats || !P.Stats) return;
      c.statsState = 'loading';
      try {
        const st = await D.stats(c.m);
        if (this.cur !== c) return;
        c.stats = st;
        c.statsState = st && (st.n.home || st.n.away) ? 'ok' : 'none';
      } catch (e) {
        if (this.cur !== c) return;
        c.statsState = 'error';
      }
      this.compute();
      if (this.screen === 'match') {
        const sc = $('scr-match');
        const y = sc ? sc.scrollTop : 0;
        const active = document.activeElement;
        if (active && active.closest && active.closest('#mt-body') && active.tagName === 'INPUT') return this.updateStatsNote();
        this.renderMatchTab();
        if (sc) sc.scrollTop = y;
      }
    },

    updateStatsNote() {
      const n = $('stats-note');
      if (n) n.innerHTML = this.statsNote();
    },

    statsNote() {
      const c = this.cur;
      const st = c.statsState;
      if (!P.Stats || (c.m && c.m.manual)) return 'Corners, cartons et penalty : moyennes générales (analyse manuelle).';
      if (st === 'loading') return '<span class="spin-s"></span> Chargement des statistiques des derniers matchs (corners, cartons, tirs, buteurs)…';
      if (st === 'ok') return 'Corners, cartons, tirs, penalty et buteurs : ' + c.stats.n.home + ' et ' + c.stats.n.away + ' derniers matchs analysés.';
      if (st === 'error') return 'Statistiques indisponibles pour le moment : corners, cartons et penalty selon les moyennes générales.';
      return 'Pas de statistiques détaillées pour cette compétition : corners, cartons et penalty selon les moyennes générales.';
    },

    headerHtml(m) {
      const status = m.state === 'pre'
        ? '<div class="big">' + fmtTime(m.date) + '</div><div class="sub">' + fmtDate(m.date) + '</div>'
        : '<div class="big">' + (isFinite(m.home.score) ? m.home.score : '–') + ' - ' + (isFinite(m.away.score) ? m.away.score : '–') + '</div><div class="sub">' + esc(m.detail || '') + '</div>';
      const rank = (t) => (t.standing && t.standing.rank ? t.standing.rank + 'e · ' + t.standing.pts + ' pts' : t.form ? formDots(t.form) : '');
      return '<div class="card mhead"><div class="comp">' + esc((m.league.flag ? m.league.flag + ' ' : '') + (m.league.name || '')) + '</div>' +
        '<div class="vs"><div class="t">' + logo(m.home.logo, m.home.name) + '<b>' + esc(m.home.name) + '</b><small>' + rank(m.home) + '</small></div>' +
        '<div class="mid">' + status + '</div>' +
        '<div class="t">' + logo(m.away.logo, m.away.name) + '<b>' + esc(m.away.name) + '</b><small>' + rank(m.away) + '</small></div></div>' +
        (m.venue ? '<div class="sub">' + esc(m.venue) + '</div>' : '') + '</div>';
    },

    renderMatch() {
      const c = this.cur;
      const box = $('match');
      const tabs = [['prono', 'Pronostic'], ['markets', 'Paris'], ['form', 'Forme'], ['h2h', 'Face-à-face']];
      box.innerHTML = this.headerHtml(c.m) +
        '<div class="tabs">' + tabs.map(([k, l]) => '<button data-mt="' + k + '" class="' + (k === this.matchTab ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
        '<div id="mt-body"></div>';
      box.querySelectorAll('[data-mt]').forEach((b) => b.addEventListener('click', () => {
        this.matchTab = b.dataset.mt;
        box.querySelectorAll('[data-mt]').forEach((x) => x.classList.toggle('on', x === b));
        this.renderMatchTab();
      }));
      this.renderMatchTab();
    },

    renderMatchTab() {
      const body = $('mt-body');
      if (this.matchTab === 'prono') body.innerHTML = this.pronoHtml();
      else if (this.matchTab === 'markets') body.innerHTML = this.marketsHtml();
      else if (this.matchTab === 'form') body.innerHTML = this.formHtml();
      else body.innerHTML = this.h2hHtml();
      this.bindMatchTab();
    },

    pronoHtml() {
      const c = this.cur;
      const r = c.res;
      const m = c.m;
      const main = r.picks.main;
      const H = m.home.short || m.home.name;
      const A = m.away.short || m.away.name;
      const b = E.basic(r.ft);
      const circ = 2 * Math.PI * 30;
      const html = [];
      if (main) {
        html.push('<div class="card hero"><div class="ring"><svg viewBox="0 0 74 74"><circle class="bg" cx="37" cy="37" r="30"/><circle class="fg" cx="37" cy="37" r="30" stroke-dasharray="' +
          circ.toFixed(1) + '" stroke-dashoffset="' + (circ * (1 - main.p)).toFixed(1) + '"/></svg><b>' + pct(main.p) + '</b></div>' +
          '<div class="lbl">PRONOSTIC</div><div class="pick" style="padding-right:84px">' + esc(main.label) + '</div><div class="mk">' + esc(main.market) + '</div>' +
          '<div class="stats"><div><b>' + odd(main.fair) + '</b><span>Cote juste</span></div><div><b>' + esc(r.confidence.label) + '</b><span>Confiance (' + r.confidence.score + '/100)</span></div>' +
          (main.odd ? '<div><b class="' + (main.ev > 0 ? 'ev pos' : 'ev neg') + '">' + (main.ev > 0 ? '+' : '') + Math.round(main.ev * 100) + ' %</b><span>Value à ' + odd(main.odd) + '</span></div>' : '') +
          '</div><div style="margin-top:12px">' + levelTag(main.p) + ' <span class="sub">perd environ ' + Math.round((1 - main.p) * 10) + ' fois sur 10 à long terme</span></div></div>');
      }
      html.push('<div class="card"><h3>Autres pronostics</h3><div class="plist">' + r.picks.list.slice(1).map((pk) =>
        '<div class="it"><div class="grow"><div class="lb">' + esc(pk.label) + '</div><div class="mk">' + esc(pk.market) + ' · cote juste ' + odd(pk.fair) + '</div><div class="bar" style="margin-top:6px"><i style="width:' + Math.round(pk.p * 100) + '%"></i></div></div><div class="pv">' + pct(pk.p) + '</div></div>').join('') + '</div></div>');
      {
        const csm = r.markets.find((x) => x.id === 'cs');
        const top = csm ? csm.sels.filter((x) => x.key !== 'CSO').slice(0, 6) : [];
        html.push('<div class="card"><h3>Score exact</h3><div class="scores">' + top.map((x, i) => '<div class="scx' + (i === 0 ? ' top' : '') + '"><b>' + esc(x.label) + '</b><span>' + pct(x.p) + '</span></div>').join('') +
          '</div><button class="link" data-goto="Score exact">Tous les scores exacts' + icon('down') + '</button></div>');
      }
      html.push('<div class="card"><h3>Pronostics par catégorie</h3><p class="sub stats-note" id="stats-note">' + this.statsNote() + '</p><div class="plist">' + this.categoryPicks().map((cp) =>
        '<button class="it" data-goto="' + esc(cp.group) + '"><div class="grow"><div class="mk">' + esc(cp.cat) + '</div><div class="lb">' + esc(cp.label) + '</div><div class="bar" style="margin-top:6px"><i style="width:' + Math.round(cp.p * 100) + '%"></i></div></div><div class="pv">' + pct(cp.p) + '</div></button>').join('') +
        '</div><p class="sub" style="margin:8px 0 0">Touchez une catégorie pour voir tous ses paris.</p></div>');
      if (r.picks.values.length) {
        html.push('<div class="card"><h3>Value bets avec tes cotes</h3><div class="plist">' + r.picks.values.map((v) =>
          '<div class="it"><div class="grow"><div class="lb">' + esc(v.label) + '</div><div class="mk">' + esc(v.market) + ' · ta cote ' + odd(v.odd) + ' / juste ' + odd(v.fair) + '</div></div><div class="pv ev pos">+' + Math.round(v.ev * 100) + ' %</div></div>').join('') +
          '</div><p class="notice" style="margin:10px 0 0">Une value positive signifie que la cote proposée est supérieure à la cote juste estimée. Mise prudente conseillée : 1 à 2 % de ton capital au maximum.</p></div>');
      }
      const tri = (h, d, a) => '<div class="tri"><div class="h" style="width:' + (h * 100).toFixed(1) + '%">' + pct(h) + '</div><div class="d" style="width:' + (d * 100).toFixed(1) + '%">' + pct(d) + '</div><div class="a" style="width:' + (a * 100).toFixed(1) + '%">' + pct(a) + '</div></div>';
      html.push('<div class="card"><h3>Résultat (1X2)</h3>' + tri(b.h, b.d, b.a) + '<div class="tri-l"><span>' + esc(H) + '</span><span>Nul</span><span>' + esc(A) + '</span></div>');
      if (r.market) {
        const mb = E.basic(E.matrix(r.model.lh, r.model.la, r.base.params.rho, 10));
        html.push('<table class="cmp" style="margin-top:12px"><tr><th>Source</th><th>1</th><th>X</th><th>2</th></tr>' +
          '<tr><td>Forme + face-à-face</td><td>' + pct(mb.h) + '</td><td>' + pct(mb.d) + '</td><td>' + pct(mb.a) + '</td></tr>' +
          '<tr><td>Cotes ' + esc(m.odds ? m.odds.provider : 'de référence') + '</td><td>' + pct(r.market.probs.h) + '</td><td>' + pct(r.market.probs.d) + '</td><td>' + pct(r.market.probs.a) + '</td></tr>' +
          '<tr><td><b>Pronostic final</b></td><td><b>' + pct(b.h) + '</b></td><td><b>' + pct(b.d) + '</b></td><td><b>' + pct(b.a) + '</b></td></tr></table>');
      }
      html.push('</div>');
      const cs = r.markets.find((x) => x.id === 'cs').sels.slice(0, 3);
      html.push('<div class="card"><h3>Buts</h3><div class="tiles">' +
        '<div class="tile"><b>' + dec(r.lh) + ' – ' + dec(r.la) + '</b><span>Buts attendus</span></div>' +
        '<div class="tile"><b>' + pct(b.o15) + '</b><span>Plus de 1,5</span></div>' +
        '<div class="tile"><b>' + pct(b.o25) + '</b><span>Plus de 2,5</span></div>' +
        '<div class="tile"><b>' + pct(b.btts) + '</b><span>Les deux marquent</span></div>' +
        '<div class="tile"><b>' + pct(1 - b.o35) + '</b><span>Moins de 3,5</span></div>' +
        '<div class="tile"><b>' + esc(cs[0].label.replace(/ /g, '')) + '</b><span>Score probable (' + pct(cs[0].p) + ')</span></div>' +
        '</div><p class="sub" style="margin:10px 0 0">Scores les plus probables : ' + cs.map((x) => esc(x.label) + ' (' + pct(x.p) + ')').join(' · ') + '</p></div>');
      const nh = c.input.home.matches.length;
      const na = c.input.away.matches.length;
      html.push('<div class="card"><h3>Base de l’analyse</h3>' +
        '<div class="kv"><span>Derniers matchs analysés</span><b>' + Math.min(nh, 20) + ' · ' + Math.min(na, 20) + '</b></div>' +
        '<div class="kv"><span>Confrontations directes</span><b>' + m.h2h.length + '</b></div>' +
        '<div class="kv"><span>Cotes de référence</span><b>' + (r.market ? esc(m.odds.provider) : this.settings.blend ? 'non disponibles' : 'désactivées') + '</b></div>' +
        '<div class="kv"><span>Confiance</span><b>' + esc(r.confidence.label) + '</b></div>' +
        '</div>');
      html.push('<button class="btn primary" id="btn-follow" style="width:100%;margin-bottom:12px">' + icon('star') + 'Suivre ce pronostic</button>');
      html.push('<p class="notice">Les probabilités sont des estimations, pas des certitudes. Joue de façon responsable, réservé aux plus de 18 ans.</p>');
      return html.join('');
    },

    /** Le pari le plus intéressant de chaque grande catégorie. */
    categoryPicks() {
      const r = this.cur.res;
      const names = this.cur.input.names;
      const cats = [
        ['Buts', ['total'], 'Buts'], ['Les deux équipes marquent', ['btts'], 'Principaux'], ['Double chance', ['dc'], 'Principaux'],
        ['Buts de ' + names.home, ['it1'], 'Buts'], ['Buts de ' + names.away, ['it2'], 'Buts'],
        ['1re mi-temps', ['httotal', 'ht1x2', 'htdc'], 'Mi-temps'], ['Minutes', ['gb15', 'gb10', 'gb5', 'goalint', 'late', 'res15'], 'Minutes'],
        ['Corners', ['corners:total', 'corners:1x2'], 'Corners'], ['Cartons jaunes', ['yellow:total', 'yellow:1x2'], 'Cartons jaunes'],
        ['Carton rouge', ['red'], 'Cartons rouges'], ['Penalty', ['pen'], 'Penalty'], ['Tirs cadrés', ['shotsOn:total', 'shotsOn:1x2'], 'Tirs cadrés'],
        ['Fautes', ['fouls:total'], 'Fautes'], ['Hors-jeu', ['offsides:total'], 'Hors-jeu'], ['Arrêts du gardien', ['saves:total'], 'Arrêts du gardien'],
        ['Buteur', ['scorer1', 'scorer2'], 'Buteurs']
      ];
      const out = [];
      for (const [cat, ids, group] of cats) {
        let best = null;
        let top = null;
        for (const mk of r.markets) {
          if (ids.indexOf(mk.id) < 0) continue;
          for (const x of mk.sels) {
            if (!top || x.p > top.s.p) top = { s: x, mk };
            if (x.p < 0.55) continue;
            const fair = x.fair || 1 / x.p;
            const score = x.p * (fair < 1.18 ? 0.55 : fair < 1.3 ? 0.85 : 1);
            if (!best || score > best.score) best = { s: x, mk, score };
          }
        }
        const pick = best || top;
        if (!pick) continue;
        const name = pick.mk.name.replace(/^(Corners|Cartons jaunes|Tirs cadrés|Fautes|Hors-jeu|Arrêts du gardien) · /, '');
        out.push({ cat, group, label: (name === 'Total' || /^Total/.test(name) ? '' : name + ' : ') + pick.s.label, p: pick.s.p });
      }
      return out;
    },

    marketsHtml() {
      const c = this.cur;
      const showOdds = LS.get('showOdds', true);
      const groups = this.marketGroups();
      if (this.mkFilter !== 'all' && !groups.some((g) => g.name === this.mkFilter)) this.mkFilter = 'all';
      const n = c.res.markets.reduce((a, mk) => a + mk.sels.length, 0);
      return '<div class="card"><div class="odds-toggle"><button class="switch' + (showOdds ? ' on' : '') + '" id="sw-odds" aria-label="Saisir mes cotes"></button><div class="grow"><b>Saisir mes cotes (1xBet…)</b><div class="sub">Compare chaque cote à la cote juste et repère la value.</div></div></div>' +
        '<p class="notice" style="margin:0">' + c.res.markets.length + ' marchés, ' + n + ' paris. Probabilité estimée · cote juste (= 1 / probabilité) · ta cote. Une cote supérieure à la cote juste est une value.</p></div>' +
        '<div class="search mk-search">' + icon('search') + '<input id="mk-q" type="search" placeholder="Chercher : penalty, corners, 15 minutes, 2-1…" value="' + esc(this.mkQuery || '') + '" autocomplete="off"></div>' +
        '<div class="dates mk-chips"><button class="chip' + (this.mkFilter === 'all' ? ' on' : '') + '" data-mf="all">Tous</button>' +
        groups.map((g) => '<button class="chip' + (this.mkFilter === g.name ? ' on' : '') + '" data-mf="' + esc(g.name) + '">' + esc(g.name) + '</button>').join('') + '</div>' +
        '<p class="sub stats-note" id="stats-note">' + this.statsNote() + '</p>' +
        '<div id="mk-list">' + this.marketListHtml() + '</div>';
    },

    marketGroups() {
      const groups = [];
      for (const mk of this.cur.res.markets) {
        let g = groups.find((x) => x.name === mk.group);
        if (!g) groups.push(g = { name: mk.group, items: [] });
        g.items.push(mk);
      }
      return groups;
    },

    marketListHtml() {
      const c = this.cur;
      const showOdds = LS.get('showOdds', true);
      const q = norm(this.mkQuery || '');
      let groups = this.marketGroups();
      if (this.mkFilter && this.mkFilter !== 'all') groups = groups.filter((g) => g.name === this.mkFilter);
      if (q) {
        const words = q.split(/\s+/).filter(Boolean);
        groups = groups.map((g) => ({
          name: g.name,
          items: g.items.filter((mk) => {
            const text = norm(g.name + ' ' + mk.name + ' ' + (mk.info || '') + ' ' + mk.sels.map((x) => x.label).join(' '));
            return words.every((w) => text.indexOf(w) >= 0);
          })
        })).filter((g) => g.items.length);
        if (!groups.length) return '<div class="card empty"><b>Aucun pari trouvé</b>Essaie un autre mot : « buts », « mi-temps », « corners », « cartons », « penalty », « minutes », « score »…</div>';
      }
      const open = LS.get('openGroups', { Principaux: true, Buts: true });
      const forceOpen = !!q || (this.mkFilter && this.mkFilter !== 'all');
      const html = [];
      for (const g of groups) {
        html.push('<div class="mk-group' + (forceOpen || open[g.name] ? ' open' : '') + '" data-g="' + esc(g.name) + '"><button>' + esc(g.name) + ' <span class="sub">(' + g.items.length + ')</span>' + icon('down') + '</button><div class="body">');
        for (const mk of g.items) {
          const best = mk.sels.reduce((a, s) => (s.p > a.p ? s : a), mk.sels[0]);
          html.push('<div class="mkt"><h4>' + esc(mk.name) + '</h4>' + (mk.info ? '<div class="info">' + esc(mk.info) + '</div>' : ''));
          for (const s of mk.sels) {
            const u = c.userOdds[s.key];
            html.push('<div class="sel' + (showOdds ? ' odds' : '') + (s === best ? ' best' : '') + '" data-key="' + esc(s.key) + '"><div class="l">' + esc(s.label) + '<div class="bar"><i style="width:' + Math.round(s.p * 100) + '%"></i></div></div>' +
              '<div class="p">' + pct(s.p) + '</div><div class="f">' + odd(s.fair) + '</div>' +
              (showOdds ? '<input inputmode="decimal" placeholder="cote" value="' + (u ? String(u).replace('.', ',') : '') + '">' : '') +
              '<div class="ev ' + (s.ev > 0 ? 'pos' : 'neg') + '">' + this.evText(s) + '</div></div>');
          }
          html.push('</div>');
        }
        html.push('</div></div>');
      }
      return html.join('');
    },

    evText(s) {
      if (s.ev == null) return '';
      return s.ev > 0 ? 'Value +' + Math.round(s.ev * 100) + ' % à ' + odd(s.odd) : 'Pas de value (' + Math.round(s.ev * 100) + ' %)';
    },

    formHtml() {
      const m = this.cur.m;
      const team = (t) => {
        const games = (t.games && t.games.length ? t.games : t.recent || []).slice(0, 5);
        const st = E.describe(games);
        const n = Math.max(1, st.n);
        const rows = games.map((g) => {
          const r = g.gf > g.ga ? 'W' : g.gf === g.ga ? 'D' : 'L';
          return '<div class="game"><div class="d">' + (g.date ? fmtDay(g.date) : '') + '</div><span class="venue">' + (g.isHome ? 'DOM' : 'EXT') + '</span>' +
            '<div class="o"><b>' + esc(g.opponent || 'Adversaire') + '</b><small>' + esc(g.competition || '') + '</small></div><div class="s">' + g.gf + '-' + g.ga + '</div><span class="res ' + r + '">' + (r === 'W' ? 'V' : r === 'D' ? 'N' : 'D') + '</span></div>';
        }).join('');
        const longN = (t.recent || []).length;
        return '<div class="card"><div class="row" style="margin-bottom:10px">' + logo(t.logo, t.name) + '<div class="grow"><b>' + esc(t.name) + '</b><div class="sub">' +
          (t.standing && t.standing.rank ? t.standing.rank + 'e du classement · ' + t.standing.pts + ' pts · ' : '') + st.w + 'V ' + st.d + 'N ' + st.l + 'D</div></div></div>' +
          '<div class="tiles" style="margin-bottom:10px"><div class="tile"><b>' + dec(st.gf / n, 1) + '</b><span>Buts marqués / match</span></div><div class="tile"><b>' + dec(st.ga / n, 1) + '</b><span>Buts encaissés / match</span></div><div class="tile"><b>' + st.o15 + '/' + st.n + '</b><span>Plus de 1,5</span></div>' +
          '<div class="tile"><b>' + st.o25 + '/' + st.n + '</b><span>Plus de 2,5</span></div><div class="tile"><b>' + st.btts + '/' + st.n + '</b><span>Les deux marquent</span></div><div class="tile"><b>' + st.cs + '/' + st.n + '</b><span>Sans encaisser</span></div></div>' +
          (rows || '<div class="sub">Aucun match récent disponible.</div>') +
          (longN > 5 ? '<p class="sub" style="margin:8px 0 0">L’estimation utilise aussi les ' + Math.min(20, longN) + ' derniers matchs (pondérés).</p>' : '') + '</div>';
      };
      return team(m.home) + team(m.away);
    },

    h2hHtml() {
      const m = this.cur.m;
      const list = m.h2h || [];
      if (!list.length) return '<div class="card empty"><b>Aucune confrontation récente</b>Ces deux équipes ne se sont pas affrontées récemment (ou les données manquent).</div>';
      let hw = 0;
      let dr = 0;
      let aw = 0;
      let goals = 0;
      let btts = 0;
      let o25 = 0;
      for (const g of list) {
        if (g.hg > g.ag) hw++;
        else if (g.hg === g.ag) dr++;
        else aw++;
        goals += g.hg + g.ag;
        if (g.hg > 0 && g.ag > 0) btts++;
        if (g.hg + g.ag > 2.5) o25++;
      }
      const H = m.home.short || m.home.name;
      const A = m.away.short || m.away.name;
      const rows = list.map((g) => {
        const home = g.homeAtHome ? H : A;
        const away = g.homeAtHome ? A : H;
        const s = g.homeAtHome ? g.hg + '-' + g.ag : g.ag + '-' + g.hg;
        const r = g.hg > g.ag ? 'W' : g.hg === g.ag ? 'D' : 'L';
        return '<div class="game"><div class="d">' + (g.date ? fmtDay(g.date) + '<br>' + g.date.getFullYear() : '') + '</div><div class="o"><b>' + esc(home) + ' – ' + esc(away) + '</b><small>' + esc(g.competition || '') + '</small></div><div class="s">' + s + '</div><span class="res ' + r + '">' + (r === 'W' ? 'V' : r === 'D' ? 'N' : 'D') + '</span></div>';
      }).join('');
      return '<div class="card"><h3>' + list.length + ' dernières confrontations</h3><div class="tiles" style="margin-bottom:10px">' +
        '<div class="tile"><b>' + hw + '</b><span>Victoires ' + esc(H) + '</span></div><div class="tile"><b>' + dr + '</b><span>Nuls</span></div><div class="tile"><b>' + aw + '</b><span>Victoires ' + esc(A) + '</span></div>' +
        '<div class="tile"><b>' + dec(goals / list.length, 1) + '</b><span>Buts / match</span></div><div class="tile"><b>' + o25 + '/' + list.length + '</b><span>Plus de 2,5</span></div><div class="tile"><b>' + btts + '/' + list.length + '</b><span>Les deux marquent</span></div></div>' +
        rows + '<p class="sub" style="margin:8px 0 0">V/N/D du point de vue de ' + esc(H) + '. Les confrontations anciennes comptent moins dans l’analyse.</p></div>';
    },

    bindMatchTab() {
      const body = $('mt-body');
      const f = $('btn-follow');
      if (f) f.addEventListener('click', () => this.follow());
      const sw = $('sw-odds');
      if (sw) sw.addEventListener('click', () => {
        LS.set('showOdds', !LS.get('showOdds', true));
        this.renderMatchTab();
      });
      const q = $('mk-q');
      if (q) q.addEventListener('input', () => {
        this.mkQuery = q.value;
        this.refreshMarketList();
      });
      body.querySelectorAll('[data-mf]').forEach((b) => b.addEventListener('click', () => {
        this.mkFilter = b.dataset.mf;
        body.querySelectorAll('[data-mf]').forEach((x) => x.classList.toggle('on', x === b));
        this.refreshMarketList();
      }));
      body.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
        this.mkFilter = b.dataset.goto;
        this.mkQuery = '';
        this.matchTab = 'markets';
        $('match').querySelectorAll('[data-mt]').forEach((x) => x.classList.toggle('on', x.dataset.mt === 'markets'));
        this.renderMatchTab();
      }));
      this.bindMarketList();
    },

    refreshMarketList() {
      const list = $('mk-list');
      if (!list) return;
      list.innerHTML = this.marketListHtml();
      this.bindMarketList();
    },

    bindMarketList() {
      const body = $('mk-list');
      if (!body) return;
      body.querySelectorAll('.mk-group > button').forEach((b) => b.addEventListener('click', () => {
        const g = b.parentElement;
        g.classList.toggle('open');
        const open = LS.get('openGroups', { Principaux: true, Buts: true });
        open[g.dataset.g] = g.classList.contains('open');
        LS.set('openGroups', open);
      }));
      body.querySelectorAll('.sel input').forEach((inp) => inp.addEventListener('input', () => {
        const row = inp.closest('.sel');
        const key = row.dataset.key;
        const v = parseFloat(inp.value.replace(',', '.'));
        if (v > 1 && v < 1000) this.cur.userOdds[key] = v;
        else delete this.cur.userOdds[key];
        LS.set('odds-' + this.cur.m.id, this.cur.userOdds);
        for (const mk of this.cur.res.markets) for (const s of mk.sels) {
          delete s.odd;
          delete s.ev;
        }
        E.applyOdds(this.cur.res, this.cur.userOdds);
        this.cur.res.picks = E.picks(this.cur.res);
        let sel = null;
        for (const mk of this.cur.res.markets) for (const s of mk.sels) if (s.key === key) sel = s;
        const ev = row.querySelector('.ev');
        ev.textContent = sel ? this.evText(sel) : '';
        ev.className = 'ev ' + (sel && sel.ev > 0 ? 'pos' : 'neg');
      }));
    },

    shareText() {
      const c = this.cur;
      const r = c.res;
      const b = E.basic(r.ft);
      const lines = ['⚽ ' + c.m.home.name + ' – ' + c.m.away.name, (c.m.league.name || '') + (c.m.manual ? '' : ' · ' + fmtDate(c.m.date) + ' ' + fmtTime(c.m.date))];
      if (r.picks.main) lines.push('✅ Pronostic : ' + full(r.picks.main) + ' (' + pct(r.picks.main.p) + ')');
      lines.push('1X2 : ' + pct(b.h) + ' / ' + pct(b.d) + ' / ' + pct(b.a));
      lines.push('Plus de 2,5 : ' + pct(b.o25) + ' · Les deux marquent : ' + pct(b.btts));
      for (const pk of r.picks.list.slice(1, 4)) lines.push('• ' + full(pk) + ' (' + pct(pk.p) + ')');
      const csm = r.markets.find((x) => x.id === 'cs');
      if (csm) lines.push('🎯 Score exact probable : ' + csm.sels.slice(0, 3).map((x) => x.label.replace(/ /g, '') + ' (' + pct(x.p) + ')').join(', '));
      lines.push('— PronoFoot');
      return lines.join('\n');
    },

    share() {
      if (!this.cur || !this.cur.res) return;
      const text = this.shareText();
      if (native() && native().share) native().share(text);
      else if (navigator.share) navigator.share({ text }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => this.toast('Pronostic copié'));
    },

    /* ----------------------------------------------------------------- */
    /* Suivi des pronostics                                              */
    /* ----------------------------------------------------------------- */

    follow() {
      const c = this.cur;
      const items = LS.get('history', []);
      const id = c.m.id;
      if (items.some((x) => x.id === id)) {
        this.toast('Déjà dans tes pronostics suivis');
        return;
      }
      const picks = c.res.picks.list.slice(0, 4).map((p) => ({ key: p.key, label: p.label, market: p.market, p: p.p, odd: c.userOdds[p.key] || null }));
      items.unshift({
        id, manual: !!c.m.manual, savedAt: Date.now(), date: c.m.date ? c.m.date.getTime() : Date.now(),
        league: c.m.league.name || '', home: c.m.home.name, away: c.m.away.name, homeLogo: c.m.home.logo || '', awayLogo: c.m.away.logo || '',
        picks, result: null
      });
      LS.set('history', items.slice(0, 300));
      this.haptic();
      this.toast(c.m.manual ? 'Ajouté (à vérifier toi-même)' : 'Ajouté aux pronostics suivis');
    },

    async renderHistory(refresh) {
      const box = $('history');
      const items = LS.get('history', []);
      const draw = () => {
        const its = LS.get('history', []);
        let won = 0;
        let lost = 0;
        let wait = 0;
        for (const it of its) {
          const st = it.picks[0] && it.picks[0].status;
          if (st === 'won' || st === 'half-won') won++;
          else if (st === 'lost' || st === 'half-lost') lost++;
          else if (!st) wait++;
        }
        const rate = won + lost ? Math.round(100 * won / (won + lost)) + ' %' : '—';
        const html = ['<div class="hstats"><div class="tile"><b>' + its.length + '</b><span>Suivis</span></div><div class="tile"><b class="st-won">' + won + '</b><span>Gagnés</span></div><div class="tile"><b class="st-lost">' + lost + '</b><span>Perdus</span></div><div class="tile"><b>' + rate + '</b><span>Réussite</span></div></div>'];
        if (!its.length) html.push('<div class="empty"><b>Aucun pronostic suivi</b>Ouvre un match puis touche « Suivre ce pronostic ». Les résultats sont vérifiés automatiquement après le match.</div>');
        for (const it of its) {
          const main = it.picks[0] || {};
          const st = main.status;
          const badge = st === 'won' ? '<span class="tag t1">Gagné</span>' : st === 'half-won' ? '<span class="tag t1">½ gagné</span>' : st === 'lost' ? '<span class="tag t3">Perdu</span>' : st === 'half-lost' ? '<span class="tag t3">½ perdu</span>' : st === 'push' ? '<span class="tag info">Remboursé</span>' : it.manual ? '<span class="tag info">Manuel</span>' : '<span class="tag t2">En attente</span>';
          const score = it.result && it.result.completed ? '<b>' + it.result.hg + '-' + it.result.ag + '</b>' : '';
          html.push('<div class="card hitem"><div class="grow"><div class="sub">' + esc(it.league) + ' · ' + new Date(it.date).toLocaleDateString('fr-FR') + '</div><div style="font-weight:800;margin:3px 0">' + esc(it.home) + ' – ' + esc(it.away) + ' ' + score + '</div>' +
            '<div>' + esc(main.label ? full(main) : '') + ' <span class="sub">(' + pct(main.p) + ')</span></div>' +
            '<div class="sub" style="margin-top:4px">' + it.picks.slice(1).map((p) => esc(full(p)) + (p.status === 'won' ? ' ✓' : p.status === 'lost' ? ' ✗' : '')).join(' · ') + '</div></div>' +
            '<div class="st">' + badge + '<br><button class="icon-btn" data-del="' + esc(it.id) + '" aria-label="Supprimer" style="margin-top:6px">' + icon('trash') + '</button></div></div>');
        }
        box.innerHTML = html.join('');
        box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
          LS.set('history', LS.get('history', []).filter((x) => x.id !== b.dataset.del));
          draw();
        }));
      };
      draw();
      if (!refresh) return;
      const pending = items.filter((it) => !it.manual && (!it.result || !it.result.completed) && it.date < Date.now() + 3600e3);
      for (const it of pending) {
        try {
          const r = await D.result(it.id);
          if (!r) continue;
          const all = LS.get('history', []);
          const cur = all.find((x) => x.id === it.id);
          if (!cur) continue;
          cur.result = r;
          if (r.completed) for (const p of cur.picks) p.status = E.settle(p.key, r);
          LS.set('history', all);
          if (this.screen === 'history') draw();
        } catch (e) {
          // résultat indisponible pour l'instant
        }
      }
    },

    /* ----------------------------------------------------------------- */
    /* Analyse manuelle                                                  */
    /* ----------------------------------------------------------------- */

    renderManual() {
      const st = LS.get('manual', null) || {
        home: '', away: '',
        hg: Array.from({ length: 5 }, (_, i) => ({ v: i % 2 ? 'E' : 'D', gf: '', ga: '' })),
        ag: Array.from({ length: 5 }, (_, i) => ({ v: i % 2 ? 'D' : 'E', gf: '', ga: '' })),
        h2h: Array.from({ length: 5 }, (_, i) => ({ v: i % 2 ? 'E' : 'D', hg: '', ag: '' })),
        o1: '', ox: '', o2: ''
      };
      this.manual = st;
      const team = (key, label) => '<div class="card"><h3>' + label + '</h3><p class="sub" style="margin:-4px 0 10px">5 derniers matchs, du plus récent au plus ancien : lieu, buts marqués – buts encaissés.</p>' +
        st[key].map((r, i) => '<div class="mrow"><span class="n">' + (i + 1) + '</span><span class="seg" data-seg="' + key + ':' + i + '"><button class="' + (r.v === 'D' ? 'on' : '') + '" data-v="D">Dom</button><button class="' + (r.v === 'E' ? 'on' : '') + '" data-v="E">Ext</button></span>' +
          '<input inputmode="numeric" maxlength="2" data-f="' + key + ':' + i + ':gf" value="' + esc(r.gf) + '" placeholder="0"><span class="dash">–</span><input inputmode="numeric" maxlength="2" data-f="' + key + ':' + i + ':ga" value="' + esc(r.ga) + '" placeholder="0"></div>').join('') + '</div>';
      $('manual').innerHTML = '<div class="card mform"><h3>Les deux équipes</h3><label>Équipe qui reçoit</label><input type="text" data-t="home" value="' + esc(st.home) + '" placeholder="Ex. : Raja Casablanca">' +
        '<label>Équipe qui se déplace</label><input type="text" data-t="away" value="' + esc(st.away) + '" placeholder="Ex. : Wydad AC"></div>' +
        team('hg', 'Forme de l’équipe qui reçoit') + team('ag', 'Forme de l’équipe qui se déplace') +
        '<div class="card"><h3>5 dernières confrontations</h3><p class="sub" style="margin:-4px 0 10px">Score vu de l’équipe qui reçoit aujourd’hui (ses buts – buts adverses) et lieu du match pour elle. Laisse vide si inconnu.</p>' +
        st.h2h.map((r, i) => '<div class="mrow"><span class="n">' + (i + 1) + '</span><span class="seg" data-seg="h2h:' + i + '"><button class="' + (r.v === 'D' ? 'on' : '') + '" data-v="D">Dom</button><button class="' + (r.v === 'E' ? 'on' : '') + '" data-v="E">Ext</button></span>' +
          '<input inputmode="numeric" maxlength="2" data-f="h2h:' + i + ':hg" value="' + esc(r.hg) + '" placeholder="–"><span class="dash">–</span><input inputmode="numeric" maxlength="2" data-f="h2h:' + i + ':ag" value="' + esc(r.ag) + '" placeholder="–"></div>').join('') + '</div>' +
        '<div class="card"><h3>Cotes de référence (facultatif)</h3><p class="sub" style="margin:-4px 0 10px">Cotes 1X2 d’un bookmaker fiable : elles affinent fortement les probabilités.</p><div class="mrow"><span class="n">1</span><input inputmode="decimal" data-o="o1" value="' + esc(st.o1) + '" placeholder="1,85"><span class="n">X</span><input inputmode="decimal" data-o="ox" value="' + esc(st.ox) + '" placeholder="3,40"><span class="n">2</span><input inputmode="decimal" data-o="o2" value="' + esc(st.o2) + '" placeholder="4,20"></div></div>' +
        '<button class="btn primary" id="btn-manual" style="width:100%;margin-bottom:10px">Analyser le match</button><button class="btn" id="btn-manual-reset" style="width:100%">Effacer</button>';
      const box = $('manual');
      box.querySelectorAll('[data-t]').forEach((inp) => inp.addEventListener('input', () => {
        st[inp.dataset.t] = inp.value;
        LS.set('manual', st);
      }));
      box.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('input', () => {
        const [k, i, f] = inp.dataset.f.split(':');
        st[k][+i][f] = inp.value.replace(/[^0-9]/g, '');
        LS.set('manual', st);
      }));
      box.querySelectorAll('[data-o]').forEach((inp) => inp.addEventListener('input', () => {
        st[inp.dataset.o] = inp.value;
        LS.set('manual', st);
      }));
      box.querySelectorAll('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const [k, i] = seg.dataset.seg.split(':');
        st[k][+i].v = b.dataset.v;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        LS.set('manual', st);
      })));
      $('btn-manual').addEventListener('click', () => this.runManual());
      $('btn-manual-reset').addEventListener('click', () => {
        LS.set('manual', null);
        this.renderManual();
      });
    },

    runManual() {
      const st = this.manual;
      const games = (rows) => rows.filter((r) => r.gf !== '' && r.ga !== '').map((r) => ({ isHome: r.v === 'D', gf: +r.gf, ga: +r.ga, opponent: r.v === 'D' ? 'Match à domicile' : 'Match à l’extérieur' }));
      const hg = games(st.hg);
      const ag = games(st.ag);
      if (!st.home.trim() || !st.away.trim()) return this.toast('Indique le nom des deux équipes');
      if (hg.length < 3 || ag.length < 3) return this.toast('Saisis au moins 3 matchs pour chaque équipe');
      const h2h = st.h2h.filter((r) => r.hg !== '' && r.ag !== '').map((r, i) => ({ hg: +r.hg, ag: +r.ag, homeAtHome: r.v === 'D', ageYears: 0.5 + i * 0.6 }));
      const n = (v) => parseFloat(String(v).replace(',', '.'));
      const o1 = n(st.o1);
      const ox = n(st.ox);
      const o2 = n(st.o2);
      const m = {
        id: 'manual-' + Date.now(), manual: true, date: new Date(), state: 'pre', neutral: false,
        league: { name: 'Analyse manuelle', flag: '✍️' },
        home: { name: st.home.trim(), short: st.home.trim(), games: hg, recent: hg },
        away: { name: st.away.trim(), short: st.away.trim(), games: ag, recent: ag },
        h2h, odds: o1 > 1 && ox > 1 && o2 > 1 ? { provider: 'tes cotes', 1: o1, X: ox, 2: o2 } : null
      };
      this.matchTab = 'prono';
      this.setMatch(m);
      this.show('match');
      $('scr-match').scrollTop = 0;
    },

    /* ----------------------------------------------------------------- */
    /* Infos et réglages                                                 */
    /* ----------------------------------------------------------------- */

    renderInfo() {
      const s = this.settings;
      const n = native();
      const version = n && n.appVersion ? n.appVersion() : 'web';
      $('info').innerHTML = '<div class="card"><h3>Réglages</h3>' +
        '<div class="setting"><div class="grow"><b>Combiner avec les cotes de référence</b><span>Recommandé : les cotes du marché améliorent nettement la précision.</span></div><button class="switch' + (s.blend ? ' on' : '') + '" data-set="blend"></button></div>' +
        '<div class="setting"><div class="grow"><b>Compétitions féminines</b><span>Afficher aussi les championnats féminins.</span></div><button class="switch' + (s.women ? ' on' : '') + '" data-set="women"></button></div>' +
        '<div class="setting"><div class="grow"><b>Vider le cache</b><span>Recharge toutes les données au prochain affichage.</span></div><button class="btn small" id="btn-clear">Vider</button></div></div>' +
        '<div class="card prose"><h3>Comment sont calculés les pronostics ?</h3>' +
        '<p>Pour chaque match, PronoFoot récupère <b>les 5 derniers matchs de chaque équipe</b> et <b>leurs 5 dernières confrontations directes</b>, complétés par jusqu’à 20 matchs récents pour mieux mesurer la force réelle des équipes.</p>' +
        '<p>Il en déduit l’attaque et la défense de chaque équipe (en tenant compte du domicile et de l’extérieur), puis le nombre de buts attendus. Une loi de Poisson corrigée (modèle de Dixon-Coles) donne la probabilité de chaque score, d’où sont tirés <b>plus de 120 marchés et près de 800 paris</b> comme chez 1xBet : 1X2, double chance, totaux, handicaps asiatiques, les deux équipes marquent, mi-temps/fin de match, score exact complet, buts minute par minute (2, 5, 10, 15 premières minutes…), ordre des buts…</p>' +
        '<p>Les <b>corners, cartons jaunes et rouges, penaltys, tirs, fautes, hors-jeu, arrêts du gardien et buteurs</b> sont calculés à partir des statistiques des 10 derniers matchs de chaque équipe. La répartition des buts minute par minute est mesurée sur des milliers de matchs réels.</p>' +
        '<p>Quand des cotes de référence sont disponibles, elles sont combinées au modèle : c’est ce qui donne les meilleurs résultats.</p></div>' +
        '<div class="card"><h3>Résultats mesurés</h3><p class="sub" style="margin-top:-4px">Test sur 7 943 matchs réels (12 championnats européens, saisons 2024-2025 et 2025-2026), jamais utilisés pour régler le modèle.</p>' +
        '<div class="kv"><span>Pronostic principal gagnant</span><b>78 %</b></div>' +
        '<div class="kv"><span>Bon résultat 1X2 (forme + face-à-face)</span><b>51 %</b></div>' +
        '<div class="kv"><span>Bon résultat 1X2 (avec les cotes)</span><b>53 %</b></div>' +
        '<div class="kv"><span>Probabilité annoncée 83 % → réalisée</span><b>83 %</b></div>' +
        '<div class="kv"><span>Cartons ±4,5 · fautes ±21,5 (avec les stats)</span><b>63 % · 70 %</b></div>' +
        '<p class="notice" style="margin:10px 0 0">Aucune méthode ne gagne à tous les coups : un pari à 80 % perd en moyenne 1 fois sur 5.</p></div>' +
        '<div class="card prose"><h3>Jeu responsable</h3><p>Les paris sportifs sont réservés aux plus de 18 ans. Ne mise que ce que tu peux te permettre de perdre, fixe-toi des limites et fais des pauses. Si le jeu devient un problème, parles-en et demande de l’aide à un service spécialisé de ton pays.</p></div>' +
        '<div class="card"><div class="kv"><span>Version</span><b>' + esc(version) + '</b></div><div class="kv"><span>Données des matchs</span><b>ESPN</b></div><div class="kv"><span>Données de test</span><b>football-data.co.uk</b></div></div>';
      $('info').querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.set;
        s[k] = !s[k];
        b.classList.toggle('on', s[k]);
        LS.set('settings', s);
        if (k === 'women') this.renderList();
      }));
      $('btn-clear').addEventListener('click', () => {
        if (D.clearCache) D.clearCache();
        this.toast('Cache vidé');
      });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => UI.init());
  else UI.init();
})(window);
