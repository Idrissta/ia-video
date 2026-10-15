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
  D.clearCache = () => cache.clear();

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
    const known = (P.Leagues && P.Leagues.byId[id]) || null;
    const note = (c && c.altGameNote) || '';
    const stage = note.indexOf(',') > 0 ? note.slice(note.indexOf(',') + 1).trim() : '';
    let name = (known && known.fr) || note.split(',')[0].trim();
    if (!name && ev.season && ev.season.slug && /\d{4}/.test(ev.season.slug)) name = humanize(ev.season.slug);
    return {
      id, name: name || 'Autre compétition', stage, flag: (known && known.flag) || '⚽',
      rank: known ? known.rank : 300, top: known ? known.top : false, women: !!(known && known.women)
    };
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
  D.day = async function (date, force) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offsetMin = -day.getTimezoneOffset();
    const shift = offsetMin > -300 ? -1 : 1;
    const other = new Date(day.getFullYear(), day.getMonth(), day.getDate() + shift);
    const ttl = sameDay(day, new Date()) ? 90 : 900;
    const urls = [day, other].map((d) => ESPN + '/all/scoreboard?dates=' + ymd(d) + '&limit=1000');
    if (force) urls.forEach((u) => cache.delete(u));
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
      if (/friendl|amical/i.test((g.leagueName || '') + ' ' + (g.leagueAbbreviation || ''))) return null;
      const oppId = String(g.opponent && g.opponent.id);
      const sameComp = !ctx.leagueName || !g.leagueName || g.leagueName === ctx.leagueName;
      return {
        id: g.id != null ? String(g.id) : '',
        date: new Date(g.gameDate),
        isHome,
        gf: isHome ? hs : as,
        ga: isHome ? as : hs,
        opponent: (g.opponent && g.opponent.displayName) || '?',
        oppLogo: g.opponent ? logoOf(g.opponent) : '',
        competition: g.leagueName || g.competitionName || '',
        oppId,
        opp: strengthFromStanding(ctx.table[oppId], ctx.mu),
        w: sameComp ? 1 : 0.75
      };
    }).filter(Boolean);
  };

  /** Confrontations directes, vues depuis l'équipe qui reçoit aujourd'hui. */
  D.parseH2H = function (series, homeId, now, before) {
    const list = [];
    const seen = new Set();
    for (const s of series || []) {
      for (const ev of s.events || []) {
        if (seen.has(ev.id)) continue;
        const comps = ev.competitors || [];
        const me = comps.find((c) => c.team && String(c.team.id) === String(homeId));
        const other = comps.find((c) => c !== me);
        const done = ev.statusType ? ev.statusType.completed === true : ev.status === 'post';
        if (!me || !other || !done) continue;
        if (before && new Date(ev.date).getTime() >= before) continue;
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
    const kick = date.getTime() || Date.now();
    const h2h = D.parseH2H(series.length ? series : j.seasonseries, home.id, kick, kick - 3 * 3600e3);
    let odds = null;
    const pc = j.pickcenter && j.pickcenter[0];
    odds = D.parseOdds(pc) || D.parseOdds(j.odds && j.odds[0]);
    const known = (P.Leagues && P.Leagues.byId[String(lg.id || '')]) || null;
    return {
      id: String(eventId || (j.header && j.header.id)),
      date,
      league: {
        id: String(lg.id || ''), espnName: lg.name || '',
        name: (known && known.fr) || lg.name || lg.abbreviation || '', flag: (known && known.flag) || '⚽'
      },
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

  /** Matchs terminés d'une équipe dans un calendrier ESPN (toutes compétitions). */
  D.parseSchedule = function (j, teamId, ctx) {
    const out = [];
    for (const ev of (j && j.events) || []) {
      const c = ev.competitions && ev.competitions[0];
      if (!c || !c.status || !c.status.type || !c.status.type.completed) continue;
      const slug = ev.league && ev.league.slug;
      if (slug === 'club.friendly' || slug === 'nonfifa') continue;
      const me = c.competitors.find((x) => String((x.team && x.team.id) || x.id) === String(teamId));
      const op = c.competitors.find((x) => x !== me);
      if (!me || !op) continue;
      const sc = (x) => (x.score && typeof x.score === 'object' ? num(x.score.value) : num(x.score));
      const gf = sc(me);
      const ga = sc(op);
      if (!isFinite(gf) || !isFinite(ga)) continue;
      const lname = (ev.league && ev.league.name) || '';
      out.push({
        id: String(ev.id),
        date: new Date(ev.date),
        isHome: me.homeAway === 'home',
        neutral: !!c.neutralSite,
        gf, ga,
        opponent: (op.team && op.team.displayName) || '?',
        oppLogo: logoOf(op.team),
        competition: lname,
        w: !ctx.leagueName || !lname || lname === ctx.leagueName ? 1 : 0.75
      });
    }
    return out;
  };

  /** Jusqu'à 20 matchs récents d'une équipe (saison en cours puis précédente). */
  D.history = async function (teamId, ctx) {
    const base = ESPN + '/all/teams/' + encodeURIComponent(teamId) + '/schedule';
    const cur = await D.get(base, 1800);
    let games = D.parseSchedule(cur, teamId, ctx);
    const year = cur && cur.season && cur.season.year;
    if (games.length < 20 && year) {
      try {
        const prev = await D.get(base + '?season=' + (year - 1), 86400);
        games = games.concat(D.parseSchedule(prev, teamId, ctx));
      } catch (e) {
        // saison précédente indisponible : on garde la saison en cours
      }
    }
    games.sort((a, b) => b.date - a.date);
    return games;
  };

  /** Fusionne deux listes de matchs (sans doublons), du plus récent au plus ancien. */
  const mergeGames = (a, b, before) => {
    const seen = new Set();
    const out = [];
    for (const g of a.concat(b)) {
      if (!g || !(g.date < before)) continue;
      const key = g.date.toISOString().slice(0, 10) + '|' + g.gf + '-' + g.ga;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(g);
    }
    out.sort((x, y) => y.date - x.date);
    return out;
  };

  D.match = async function (eventId) {
    const j = await D.get(ESPN + '/all/summary?event=' + encodeURIComponent(eventId), 300);
    const m = D.parseSummary(j, eventId);
    const ctx = { leagueName: m.league.espnName };
    const before = m.completed ? m.date : new Date(Date.now() + 864e5);
    const [hh, ah] = await Promise.all([
      D.history(m.home.id, ctx).catch(() => []),
      D.history(m.away.id, ctx).catch(() => [])
    ]);
    // Le calendrier passe en premier : il connaît les terrains neutres et exclut les amicaux.
    m.home.recent = mergeGames(hh, m.home.games, m.completed ? m.date : before);
    m.away.recent = mergeGames(ah, m.away.games, m.completed ? m.date : before);
    return m;
  };

  /** Entrée du moteur à partir des données d'un match. */
  D.engineInput = function (m, refOdds, userOdds) {
    return {
      refOdds: refOdds || {},
      odds: userOdds || {},
      neutral: m.neutral,
      names: { home: m.home.short || m.home.name, away: m.away.short || m.away.name },
      home: { matches: m.home.recent && m.home.recent.length ? m.home.recent : m.home.games },
      away: { matches: m.away.recent && m.away.recent.length ? m.away.recent : m.away.games },
      h2h: m.h2h
    };
  };

  /* --------------------------------------------------------------------- */
  /* Détails d'un match terminé : statistiques, buts minute par minute,      */
  /* cartons, penaltys, buteurs (résumé ESPN : boxscore + keyEvents).        */
  /* --------------------------------------------------------------------- */

  const STAT_MAP = {
    corners: 'wonCorners', yellow: 'yellowCards', red: 'redCards', shotsOn: 'shotsOnTarget',
    shots: 'totalShots', fouls: 'foulsCommitted', offsides: 'offsides', saves: 'saves'
  };
  D.STAT_MAP = STAT_MAP;

  /** « 45'+2' » → { min: 45, extra: 2 }. */
  D.minuteOf = function (clock) {
    const s = String((clock && clock.displayValue) || '');
    const m = /^(\d+)'?(?:\s*\+\s*(\d+))?/.exec(s);
    if (m) return { min: +m[1], extra: m[2] ? +m[2] : 0 };
    if (clock && clock.value > 0) return { min: Math.ceil(clock.value / 60), extra: 0 };
    return null;
  };

  D.parseDetail = function (j) {
    const hc = j && j.header && j.header.competitions && j.header.competitions[0];
    if (!hc) return null;
    const hcomp = hc.competitors.find((x) => x.homeAway === 'home') || hc.competitors[0];
    const acomp = hc.competitors.find((x) => x.homeAway === 'away') || hc.competitors[1];
    const homeId = String((hcomp.team && hcomp.team.id) || hcomp.id);
    const awayId = String((acomp.team && acomp.team.id) || acomp.id);
    const sideOf = (team, fallback) => {
      const id = team && team.id != null ? String(team.id) : '';
      return id === homeId ? 'h' : id === awayId ? 'a' : fallback || null;
    };
    const st = (hc.status && hc.status.type) || {};
    const out = {
      id: String(j.header.id || ''), homeId, awayId, completed: !!st.completed, detail: st.shortDetail || '',
      hgAll: num(hcomp.score), agAll: num(acomp.score), stats: {}, statsH1: {}, goals: null, pens: null, hasEvents: false
    };
    // Statistiques d'équipe.
    const box = {};
    for (const t of (j.boxscore && j.boxscore.teams) || []) {
      const side = sideOf(t.team, t.homeAway === 'home' ? 'h' : t.homeAway === 'away' ? 'a' : null);
      if (!side) continue;
      const v = {};
      for (const x of t.statistics || []) v[x.name] = num(x.displayValue != null ? x.displayValue : x.value);
      box[side] = v;
    }
    if (box.h && box.a) {
      for (const [id, name] of Object.entries(STAT_MAP)) {
        if (isFinite(box.h[name]) && isFinite(box.a[name])) out.stats[id] = [box.h[name], box.a[name]];
      }
    }
    // Actions clés : buts, cartons, penaltys (séance de tirs au but exclue).
    const ke = Array.isArray(j.keyEvents) ? j.keyEvents : [];
    if (ke.length) {
      out.hasEvents = true;
      const goals = [];
      const pens = { h: 0, a: 0, scored: 0 };
      const y = { h: 0, a: 0 };
      const yh1 = { h: 0, a: 0 };
      const r = { h: 0, a: 0 };
      for (const e of ke) {
        if (e.shootout) continue;
        const ty = String((e.type && (e.type.type || e.type.text)) || '').toLowerCase();
        const side = sideOf(e.team);
        const mn = D.minuteOf(e.clock);
        const period = e.period && e.period.number;
        if (/penalty/.test(ty) && side) {
          pens[side]++;
          if (e.scoringPlay) pens.scored++;
        }
        if (/yellow/.test(ty) && side) {
          y[side]++;
          if (period === 1) yh1[side]++;
        }
        if (/red-card|red card/.test(ty) && side) r[side]++;
        if (e.scoringPlay && side && mn) {
          const p0 = e.participants && e.participants[0] && e.participants[0].athlete;
          goals.push({
            min: mn.min, extra: mn.extra, period: period || (mn.min > 90 ? 3 : mn.min > 45 ? 2 : 1), side,
            type: /own/.test(ty) ? 'OG' : /penalty/.test(ty) ? 'PG' : /header/.test(ty) ? 'HD' : /free/.test(ty) ? 'FK' : '',
            scorer: p0 && p0.id != null ? String(p0.id) : '', name: (p0 && p0.displayName) || ''
          });
        }
      }
      // Buts cohérents avec le score (contre son camp parfois attribué à l'autre équipe).
      const count = (gs) => [gs.filter((g) => g.side === 'h').length, gs.filter((g) => g.side === 'a').length];
      let c = count(goals);
      if ((c[0] !== out.hgAll || c[1] !== out.agAll) && goals.some((g) => g.type === 'OG')) {
        for (const g of goals) if (g.type === 'OG') g.side = g.side === 'h' ? 'a' : 'h';
        c = count(goals);
      }
      if (c[0] === out.hgAll && c[1] === out.agAll) out.goals = goals;
      out.pens = pens;
      // Cartons : on préfère le boxscore s'il existe, sinon les actions clés.
      if (!out.stats.yellow) out.stats.yellow = [y.h, y.a];
      if (!out.stats.red) out.stats.red = [r.h, r.a];
      out.statsH1.yellow = [yh1.h, yh1.a];
    }
    return out;
  };

  /** Détails d'un match (mis en cache longtemps une fois terminé). */
  D.detail = async function (eventId) {
    const j = await D.get(ESPN + '/all/summary?event=' + encodeURIComponent(eventId), 7 * 86400);
    return D.parseDetail(j);
  };

  /** Exécute f sur chaque élément, au plus n à la fois. */
  const pool = async (items, n, f) => {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = await f(items[i], i);
        } catch (e) {
          out[i] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  };
  D.pool = pool;

  /**
   * Statistiques des derniers matchs des deux équipes (corners, cartons, tirs,
   * fautes, hors-jeu, arrêts, penaltys) et buteurs, pour PRONO.Stats.
   */
  D.stats = async function (m, nGames) {
    const N = nGames || 10;
    const side = async (team) => {
      const games = (team.recent && team.recent.length ? team.recent : team.games || []).filter((g) => g && g.id).slice(0, N);
      const det = await pool(games, 4, (g) => D.detail(g.id));
      const hist = { pen: [] };
      for (const id of Object.keys(STAT_MAP)) hist[id] = [];
      const scorers = {};
      let teamGoals = 0;
      let used = 0;
      let withEvents = 0;
      games.forEach((g, i) => {
        const d = det[i];
        if (!d || !d.completed) return;
        const me = d.homeId === String(team.id) ? 'h' : d.awayId === String(team.id) ? 'a' : null;
        if (!me) return;
        const k = me === 'h' ? 0 : 1;
        const op = me === 'h' ? 'a' : 'h';
        let any = false;
        for (const id of Object.keys(STAT_MAP)) {
          const v = d.stats[id];
          if (!v) continue;
          hist[id].push({ isHome: me === 'h', for: v[k], against: v[1 - k], w: g.w || 1 });
          any = true;
        }
        if (d.pens) hist.pen.push({ isHome: me === 'h', for: d.pens[me], against: d.pens[op] });
        if (d.goals) {
          withEvents++;
          for (const gl of d.goals) {
            if (gl.side !== me || gl.period > 2) continue;
            teamGoals++;
            if (gl.type === 'OG' || !gl.scorer) continue;
            const s = scorers[gl.scorer] || (scorers[gl.scorer] = { id: gl.scorer, name: gl.name, goals: 0 });
            s.goals++;
          }
        }
        if (any) used++;
      });
      const list = Object.values(scorers).sort((a, b) => b.goals - a.goals);
      return { hist, n: used, scorers: withEvents >= 3 ? { list, teamGoals, matches: withEvents } : null };
    };
    const [h, a] = await Promise.all([side(m.home), side(m.away)]);
    return {
      teams: { home: h.hist, away: a.hist },
      scorers: h.scorers || a.scorers ? { home: h.scorers, away: a.scorers } : null,
      n: { home: h.n, away: a.n }
    };
  };

  /** Score final d'un match terminé et détails pour régler les paris suivis. */
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
    const out = {
      completed: true,
      hg: num(h.score), ag: num(a.score),
      hthg: lh.length >= 2 ? lh[0] : NaN, htag: la.length >= 2 ? la[0] : NaN,
      detail: st.shortDetail || 'Terminé'
    };
    const d = D.parseDetail(j);
    if (d) {
      // Paris réglés sur le temps réglementaire (90 minutes + temps additionnel).
      const extraTime = lh.length > 2 || la.length > 2 || /AET|Pens|prol|t\.a\.b/i.test(out.detail);
      if (extraTime) {
        if (lh.length >= 2 && la.length >= 2) {
          out.hg = lh[0] + lh[1];
          out.ag = la[0] + la[1];
        }
        out.aet = true;
      }
      if (d.goals) out.goals = d.goals.filter((g) => g.period <= 2);
      if (out.goals && out.goals.length !== out.hg + out.ag) delete out.goals;
      out.stats = extraTime ? {} : d.stats;
      out.statsH1 = d.statsH1;
      if (d.pens && !extraTime) out.pens = d.pens;
    }
    return out;
  };

  D.ESPN = ESPN;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
