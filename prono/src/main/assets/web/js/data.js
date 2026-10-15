/* Prono — données des matchs (API publique ESPN, sans clé).
 *
 * - Liste des matchs d'une journée, toutes compétitions : /all/scoreboard
 * - Analyse d'un match : /all/summary?event=ID, qui contient les 5 derniers
 *   matchs de chaque équipe (lastFiveGames), les 5 dernières confrontations
 *   directes (seasonseries « Last 5 Matchups »), le classement et des cotes
 *   de référence.
 *
 * Dans l'application Android, les requêtes passent par /net/ (proxy natif,
 * pas de restriction CORS) ; ailleurs (navigateur, tests Node) on appelle
 * l'API directement.
 */
(function (root) {
  'use strict';
  const P = root.PRONO || (root.PRONO = {});
  const D = P.Data = {};
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

  D.native = !!(root.location && root.location.host === 'appassets.androidplatform.net');
  D.wrap = (url) => (D.native ? '/net/?u=' + encodeURIComponent(url) : url);

  const cache = new Map();

  /** GET JSON avec cache mémoire (ttl en secondes), délai maximal et nouvel essai. */
  D.get = async function (url, ttl) {
    const now = Date.now();
    const hit = cache.get(url);
    if (hit && now - hit.t < (ttl || 60) * 1000) return hit.v;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
        const r = await fetch(D.wrap(url), { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: 'application/json' } });
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const v = await r.json();
        cache.set(url, { t: Date.now(), v });
        return v;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Réseau indisponible');
  };

  const ymd = (d) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const num = (v) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  };

  /** Cote américaine (+125, -135) → cote décimale. */
  D.american = function (v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'string' && /^even$/i.test(v.trim())) return 2;
    const n = parseFloat(String(v).replace('+', ''));
    if (!isFinite(n) || n === 0) return NaN;
    return n > 0 ? 1 + n / 100 : 1 + 100 / -n;
  };

  const logoOf = (team) => {
    if (!team) return '';
    if (team.logo) return team.logo;
    if (team.logos && team.logos[0] && team.logos[0].href) return team.logos[0].href;
    return team.id ? 'https://a.espncdn.com/i/teamlogos/soccer/500/' + team.id + '.png' : '';
  };

  const humanize = (slug) => (slug || '').replace(/^\d{4}(-\d{2})?-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  /** Compétition d'un évènement : identifiant (uid « l:700 ») et nom lisible. */
  D.leagueOf = function (ev) {
    const m = /~l:(\d+)/.exec(ev.uid || '');
    const id = m ? m[1] : '';
    const c = ev.competitions && ev.competitions[0];
    const known = P.Leagues && P.Leagues.byId[id];
    let name = (known && known.fr) || (c && c.altGameNote) || '';
    if (!name && ev.season && ev.season.slug && /\d{4}/.test(ev.season.slug)) name = humanize(ev.season.slug);
    if (!name && known) name = known.name;
    return { id, name: name || 'Autre compétition', rank: known ? known.rank : 999, country: known ? known.country : '' };
  };

  /** Cotes de référence d'un évènement ou d'un résumé (format ESPN). */
  D.parseOdds = function (o) {
    if (!o) return null;
    const out = { provider: (o.provider && (o.provider.displayName || o.provider.name)) || 'Bookmaker' };
    const ml = o.moneyline || {};
    const pick = (side) => {
      const s = ml[side];
      if (s && s.close && s.close.odds) return D.american(s.close.odds);
      if (s && s.open && s.open.odds) return D.american(s.open.odds);
      const t = side === 'home' ? o.homeTeamOdds : side === 'away' ? o.awayTeamOdds : o.drawOdds;
      return t && t.moneyLine != null ? D.american(t.moneyLine) : NaN;
    };
    const h = pick('home');
    const d = pick('draw');
    const a = pick('away');
    if (h > 1 && d > 1 && a > 1) {
      out['1'] = h;
      out.X = d;
      out['2'] = a;
    }
    const tot = o.total || {};
    const line = num(o.overUnder) || num(((tot.over && tot.over.close && tot.over.close.line) || '').replace(/[ou]/i, ''));
    const ov = tot.over && (tot.over.close || tot.over.open);
    const un = tot.under && (tot.under.close || tot.under.open);
    let over = ov && ov.odds ? D.american(ov.odds) : D.american(o.overOdds);
    let under = un && un.odds ? D.american(un.odds) : D.american(o.underOdds);
    if (line && over > 1 && under > 1) {
      out['O' + line] = over;
      out['U' + line] = under;
      out.line = line;
    }
    return out['1'] || out.line ? out : null;
  };

  const parseCompetitor = (c) => ({
    id: c.team ? String(c.team.id) : String(c.id || ''),
    name: c.team ? (c.team.displayName || c.team.name) : '?',
    short: c.team ? (c.team.shortDisplayName || c.team.displayName) : '?',
    abbr: c.team ? c.team.abbreviation : '',
    logo: logoOf(c.team),
    form: c.form || '',
    score: c.score != null && typeof c.score === 'object' ? num(c.score.value) : num(c.score)
  });

  /** Un évènement du tableau des matchs → objet simple. */
  D.parseEvent = function (ev) {
    const c = ev.competitions && ev.competitions[0];
    if (!c || !c.competitors || c.competitors.length < 2) return null;
    const home = c.competitors.find((x) => x.homeAway === 'home') || c.competitors[0];
    const away = c.competitors.find((x) => x.homeAway === 'away') || c.competitors[1];
    const st = (c.status || ev.status || {}).type || {};
    return {
      id: String(ev.id),
      date: new Date(ev.date),
      league: D.leagueOf(ev),
      state: st.state || 'pre',
      completed: !!st.completed,
      detail: st.shortDetail || st.detail || '',
      neutral: !!c.neutralSite,
      home: parseCompetitor(home),
      away: parseCompetitor(away),
      odds: D.parseOdds(c.odds && c.odds[0])
    };
  };

  /**
   * Matchs d'une journée (heure locale), toutes compétitions.
   * ESPN découpe ses journées selon l'heure de la côte Est des États-Unis :
   * on interroge les deux journées ESPN qui recouvrent la journée locale.
   */
  D.day = async function (date) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offsetMin = -day.getTimezoneOffset();
    const shift = offsetMin > -300 ? -1 : 1;
    const other = new Date(day.getTime() + shift * 864e5);
    const ttl = sameDay(day, new Date()) ? 90 : 900;
    const urls = [day, other].map((d) => ESPN + '/all/scoreboard?dates=' + ymd(d) + '&limit=1000');
    const res = await Promise.allSettled(urls.map((u) => D.get(u, ttl)));
    const seen = new Set();
    const out = [];
    let failures = 0;
    for (const r of res) {
      if (r.status !== 'fulfilled') {
        failures++;
        continue;
      }
      for (const ev of r.value.events || []) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        const e = D.parseEvent(ev);
        if (e && sameDay(e.date, day)) out.push(e);
      }
    }
    if (failures === res.length) throw new Error('Impossible de charger les matchs');
    out.sort((a, b) => a.league.rank - b.league.rank || a.league.name.localeCompare(b.league.name) || a.date - b.date);
    return out;
  };

  /* --------------------------------------------------------------------- */
  /* Analyse d'un match                                                     */
  /* --------------------------------------------------------------------- */

  /** Force d'une équipe d'après le classement (différence de buts par match). */
  const strengthFromStanding = (s, mu) => {
    if (!s || !(s.gp > 0)) return null;
    const k = s.gp / (s.gp + 6);
    const g = clampNum(s.gd / s.gp, -3, 3);
    return { att: 1 + k * g / (2 * mu), def: 1 - k * g / (2 * mu) };
  };
  const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  D.parseStandings = function (st) {
    const map = {};
    const groups = (st && st.groups) || [];
    for (const g of groups) {
      const entries = (g.standings && g.standings.entries) || [];
      for (const e of entries) {
        const stat = {};
        for (const x of e.stats || []) stat[x.name] = num(x.value != null ? x.value : x.displayValue);
        map[String(e.id || (e.team && e.team.id))] = {
          name: e.team && typeof e.team === 'object' ? e.team.displayName : e.team,
          gp: stat.gamesPlayed, gd: stat.pointDifferential, pts: stat.points, rank: stat.rank,
          w: stat.wins, d: stat.ties, l: stat.losses
        };
      }
    }
    return map;
  };

  /** Derniers matchs d'une équipe (format lastFiveGames) → entrées du moteur. */
  D.parseLastGames = function (block, teamId, ctx) {
    const evs = ((block && block.events) || []).slice().sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));
    return evs.map((g) => {
      const isHome = String(g.homeTeamId) === String(teamId);
      const hs = num(g.homeTeamScore);
      const as = num(g.awayTeamScore);
      if (!isFinite(hs) || !isFinite(as)) return null;
      const oppId = String(g.opponent && g.opponent.id);
      const sameComp = !ctx.leagueName || !g.leagueName || g.leagueName === ctx.leagueName;
      return {
        date: new Date(g.gameDate),
        isHome,
        gf: isHome ? hs : as,
        ga: isHome ? as : hs,
        opponent: (g.opponent && g.opponent.displayName) || '?',
        oppLogo: g.opponent ? logoOf(g.opponent) : '',
        competition: g.leagueName || g.competitionName || '',
        opp: strengthFromStanding(ctx.table[oppId], ctx.mu),
        w: sameComp ? 1 : 0.75
      };
    }).filter(Boolean);
  };

  /** Confrontations directes, vues depuis l'équipe qui reçoit aujourd'hui. */
  D.parseH2H = function (series, homeId, now) {
    const list = [];
    const seen = new Set();
    for (const s of series || []) {
      for (const ev of s.events || []) {
        if (seen.has(ev.id)) continue;
        const comps = ev.competitors || [];
        const me = comps.find((c) => c.team && String(c.team.id) === String(homeId));
        const other = comps.find((c) => c !== me);
        const done = ev.status === 'post' || (ev.statusType && ev.statusType.completed);
        if (!me || !other || !done) continue;
        const hg = num(me.score);
        const ag = num(other.score);
        if (!isFinite(hg) || !isFinite(ag)) continue;
        seen.add(ev.id);
        const date = new Date(ev.date);
        list.push({
          date,
          ageYears: Math.max(0, (now - date) / (365.25 * 864e5)),
          hg, ag,
          homeAtHome: me.homeAway === 'home',
          neutral: !!ev.neutralSite,
          competition: ev.competitionName || ''
        });
      }
    }
    list.sort((a, b) => b.date - a.date);
    return list.slice(0, 5);
  };

  /** Résumé ESPN → données prêtes pour le moteur et l'affichage. */
  D.parseSummary = function (j, eventId) {
    const hc = j.header && j.header.competitions && j.header.competitions[0];
    if (!hc) throw new Error('Match introuvable');
    const home = parseCompetitor(hc.competitors.find((x) => x.homeAway === 'home') || hc.competitors[0]);
    const away = parseCompetitor(hc.competitors.find((x) => x.homeAway === 'away') || hc.competitors[1]);
    const lg = (j.header && j.header.league) || {};
    const st = (hc.status && hc.status.type) || {};
    const date = new Date(hc.date);
    const table = D.parseStandings(j.standings);
    const mu = (P.Engine.DEFAULTS.homeAvg + P.Engine.DEFAULTS.awayAvg) / 2;
    const ctxL = { table, mu, leagueName: lg.name || '' };
    const last = j.lastFiveGames || [];
    const blockOf = (id) => last.find((b) => b.team && String(b.team.id) === String(id));
    const homeGames = D.parseLastGames(blockOf(home.id), home.id, ctxL);
    const awayGames = D.parseLastGames(blockOf(away.id), away.id, ctxL);
    const series = (j.seasonseries || []).filter((s) => !s.type || /head/i.test(s.type) || /head|matchup/i.test(s.shortSummary || s.seriesLabel || ''));
    const h2h = D.parseH2H(series.length ? series : j.seasonseries, home.id, date.getTime() || Date.now());
    let odds = null;
    const pc = j.pickcenter && j.pickcenter[0];
    odds = D.parseOdds(pc) || D.parseOdds(j.odds && j.odds[0]);
    return {
      id: String(eventId || (j.header && j.header.id)),
      date,
      league: { id: String(lg.id || ''), name: lg.name || lg.abbreviation || '' },
      state: st.state || 'pre',
      completed: !!st.completed,
      detail: st.shortDetail || st.detail || '',
      neutral: !!hc.neutralSite,
      home: Object.assign(home, { games: homeGames, standing: table[home.id] || null }),
      away: Object.assign(away, { games: awayGames, standing: table[away.id] || null }),
      h2h,
      odds,
      venue: j.gameInfo && j.gameInfo.venue ? j.gameInfo.venue.fullName : ''
    };
  };

  D.match = async function (eventId) {
    const j = await D.get(ESPN + '/all/summary?event=' + encodeURIComponent(eventId), 300);
    return D.parseSummary(j, eventId);
  };

  /** Entrée du moteur à partir des données d'un match. */
  D.engineInput = function (m, extraOdds) {
    const odds = Object.assign({}, extraOdds || {});
    return {
      neutral: m.neutral,
      names: { home: m.home.short || m.home.name, away: m.away.short || m.away.name },
      home: { matches: m.home.games },
      away: { matches: m.away.games },
      h2h: m.h2h,
      odds
    };
  };

  /** Score final d'un match terminé (pour l'historique des pronostics). */
  D.result = async function (eventId) {
    const j = await D.get(ESPN + '/all/summary?event=' + encodeURIComponent(eventId), 120);
    const hc = j.header && j.header.competitions && j.header.competitions[0];
    if (!hc) return null;
    const st = (hc.status && hc.status.type) || {};
    if (!st.completed) return { completed: false, state: st.state, detail: st.shortDetail || '' };
    const h = hc.competitors.find((x) => x.homeAway === 'home');
    const a = hc.competitors.find((x) => x.homeAway === 'away');
    const ls = (c) => (c.linescores || []).map((l) => num(l.displayValue != null ? l.displayValue : l.value));
    const lh = ls(h);
    const la = ls(a);
    return {
      completed: true,
      hg: num(h.score), ag: num(a.score),
      hthg: lh.length >= 2 ? lh[0] : NaN, htag: la.length >= 2 ? la[0] : NaN,
      detail: st.shortDetail || 'Terminé'
    };
  };

  D.ESPN = ESPN;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
