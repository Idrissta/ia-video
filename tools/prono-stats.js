#!/usr/bin/env node
/* Prono — étude des données ESPN pour les paris « hors score » :
 * minutes des buts, cartons, penaltys (détails du tableau des matchs) et
 * statistiques d'équipe (corners, fautes, tirs, arrêts…) des résumés de match.
 * Affiche les formats rencontrés et les moyennes servant de référence au modèle.
 *
 * Usage : node tools/prono-stats.js [jours=35]   (accès internet requis)
 */
'use strict';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const DAYS = parseInt(process.argv[2] || '35', 10);

async function get(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 PronoFoot-stats' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return await r.json();
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
    }
  }
  throw last;
}
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const lid = (ev) => ((/~l:(\d+)/.exec(ev.uid || '') || [])[1] || '');
const hist = {};
const bump = (k, n) => { hist[k] = (hist[k] || 0) + (n || 1); };
const short = (o, n) => JSON.stringify(o).slice(0, n || 900);

/** Minute d'une action : « 45'+2' » → { base: 45, extra: 2 }. */
function minuteOf(clock) {
  const s = String((clock && clock.displayValue) || '');
  const m = /^(\d+)'?(?:\s*\+\s*(\d+))?/.exec(s);
  if (m) return { base: +m[1], extra: m[2] ? +m[2] : 0, raw: s };
  if (clock && isFinite(clock.value)) return { base: Math.ceil(clock.value / 60), extra: 0, raw: String(clock.value) };
  return null;
}

(async () => {
  const t0 = Date.now();
  const now = new Date();
  const events = [];
  const seen = new Set();
  for (let k = 1; k <= DAYS; k++) {
    const d = new Date(now.getTime() - k * 864e5);
    try {
      const sb = await get(ESPN + '/all/scoreboard?dates=' + ymd(d) + '&limit=1000');
      for (const ev of sb.events || []) {
        const c = ev.competitions && ev.competitions[0];
        const st = (c && c.status && c.status.type) || {};
        if (!st.completed || seen.has(ev.id)) continue;
        seen.add(ev.id);
        events.push(ev);
      }
    } catch (e) {
      console.log('jour ' + ymd(d) + ' : ' + e.message);
    }
  }
  console.log('Matchs terminés : ' + events.length + ' sur ' + DAYS + ' jours');

  /* --- Détails du tableau des matchs ------------------------------------ */
  let withDetails = 0;
  const samples = {};
  const goalMin = [];
  const perMatch = [];
  for (const ev of events) {
    const c = ev.competitions[0];
    const det = c.details || [];
    if (det.length) withDetails++;
    const home = (c.competitors || []).find((x) => x.homeAway === 'home') || {};
    const away = (c.competitors || []).find((x) => x.homeAway === 'away') || {};
    const hg = parseFloat(home.score);
    const ag = parseFloat(away.score);
    const rec = { id: ev.id, league: lid(ev), hg, ag, goals: [], yh: 0, ya: 0, rh: 0, ra: 0, pens: 0, penMiss: 0, det: det.length, shootout: false };
    for (const x of det) {
      const ty = (x.type && x.type.text) || '?';
      bump('type:' + ty);
      const flags = ['scoringPlay', 'yellowCard', 'redCard', 'penaltyKick', 'ownGoal', 'shootout'].filter((f) => x[f]).join('+') || '-';
      bump('flags:' + flags);
      if (!samples[ty]) samples[ty] = x;
      const side = x.team && String(x.team.id) === String(home.id) ? 'h' : x.team && String(x.team.id) === String(away.id) ? 'a' : '?';
      if (x.shootout) {
        rec.shootout = true;
        continue;
      }
      const mn = minuteOf(x.clock);
      if (x.scoringPlay && mn) rec.goals.push({ side, base: mn.base, extra: mn.extra });
      if (x.yellowCard) rec[side === 'h' ? 'yh' : 'ya']++;
      if (x.redCard) rec[side === 'h' ? 'rh' : 'ra']++;
      if (x.penaltyKick && x.scoringPlay) rec.pens++;
      if (/penalty/i.test(ty) && !x.scoringPlay) rec.penMiss++;
    }
    perMatch.push(rec);
  }
  console.log('Avec détails : ' + withDetails + '/' + events.length);
  console.log('Types : ' + JSON.stringify(Object.entries(hist).filter(([k]) => k.startsWith('type:')).sort((a, b) => b[1] - a[1])));
  console.log('Drapeaux : ' + JSON.stringify(Object.entries(hist).filter(([k]) => k.startsWith('flags:')).sort((a, b) => b[1] - a[1])));
  for (const [ty, x] of Object.entries(samples)) console.log('EXEMPLE ' + ty + ' : ' + short(x, 700));

  // Matchs dont les détails couvrent tous les buts (sinon ignorés).
  const full = perMatch.filter((r) => isFinite(r.hg) && r.det > 0 && r.goals.length === r.hg + r.ag);
  console.log('Matchs aux buts complets : ' + full.length + ' / avec buts ' + perMatch.filter((r) => r.hg + r.ag > 0).length);
  const n = full.length;
  const goals = full.reduce((s, r) => s + r.goals.length, 0);
  const bins = [0, 0, 0, 0, 0, 0];
  let stoppage1 = 0;
  let stoppage2 = 0;
  for (const r of full) for (const g of r.goals) {
    const m = g.base;
    const b = m <= 15 ? 0 : m <= 30 ? 1 : m <= 45 ? 2 : m <= 60 ? 3 : m <= 75 ? 4 : 5;
    bins[Math.min(5, b)]++;
    if (g.base === 45 && g.extra > 0) stoppage1++;
    if (g.base >= 90 && g.extra > 0) stoppage2++;
    goalMin.push(m + g.extra / 10);
  }
  console.log('Buts/match ' + (goals / n).toFixed(3) + ' (n=' + n + ')');
  console.log('Part des buts par tranche 1-15/16-30/31-45+/46-60/61-75/76-90+ : ' + bins.map((b) => (b / goals).toFixed(4)).join(' / '));
  console.log('Buts dans le temps additionnel : 1re ' + (stoppage1 / goals).toFixed(4) + ', 2e ' + (stoppage2 / goals).toFixed(4));
  const firstBy = (lim) => full.filter((r) => r.goals.some((g) => g.base <= lim)).length / n;
  for (const lim of [1, 2, 3, 5, 10, 15, 20, 30, 45]) console.log('  au moins un but avant la ' + lim + 'e minute (incluse) : ' + (100 * firstBy(lim)).toFixed(2) + ' %');
  const lateBy = (from) => full.filter((r) => r.goals.some((g) => g.base >= from)).length / n;
  for (const f of [76, 81, 86, 90]) console.log('  au moins un but à partir de la ' + f + 'e : ' + (100 * lateBy(f)).toFixed(2) + ' %');
  const byMinute = new Array(91).fill(0);
  for (const r of full) for (const g of r.goals) byMinute[Math.min(90, g.base)]++;
  console.log('Buts par minute (1..90) : ' + byMinute.slice(1).join(','));

  const withCards = perMatch.filter((r) => r.det > 0);
  const nc = withCards.length;
  const yh = withCards.reduce((s, r) => s + r.yh, 0) / nc;
  const ya = withCards.reduce((s, r) => s + r.ya, 0) / nc;
  const red = withCards.filter((r) => r.rh + r.ra > 0).length / nc;
  const yt = withCards.map((r) => r.yh + r.ya);
  const ym = yt.reduce((a, b) => a + b, 0) / nc;
  const yv = yt.reduce((a, b) => a + (b - ym) ** 2, 0) / nc;
  console.log('Cartons jaunes/match : domicile ' + yh.toFixed(3) + ', extérieur ' + ya.toFixed(3) + ', variance/moyenne total ' + (yv / ym).toFixed(3) + ' ; match avec carton rouge ' + (100 * red).toFixed(2) + ' % (n=' + nc + ')');
  const pen = withCards.filter((r) => r.pens + r.penMiss > 0).length / nc;
  console.log('Penalty (marqué ou raté visible) : ' + (100 * pen).toFixed(2) + ' % des matchs ; marqué ' + (100 * withCards.filter((r) => r.pens > 0).length / nc).toFixed(2) + ' %');
  const byLeague = {};
  for (const r of withCards) {
    const b = byLeague[r.league] || (byLeague[r.league] = { n: 0, y: 0, red: 0, pen: 0, g: 0 });
    b.n++;
    b.y += r.yh + r.ya;
    b.red += r.rh + r.ra > 0 ? 1 : 0;
    b.pen += r.pens + r.penMiss > 0 ? 1 : 0;
    b.g += r.hg + r.ag;
  }
  console.log('LEAGUE_CARDS=' + JSON.stringify(Object.fromEntries(Object.entries(byLeague).filter(([, b]) => b.n >= 15).map(([k, b]) => [k, [b.n, +(b.y / b.n).toFixed(2), +(b.red / b.n).toFixed(3), +(b.pen / b.n).toFixed(3), +(b.g / b.n).toFixed(2)]]))));

  /* --- Résumés de match : statistiques d'équipe, actions clés ----------- */
  const TOP = new Set(['700', '740', '730', '720', '710', '715', '725', '3901', '3946', '735', '2391', '3914', '775', '776', '770', '760', '745', '630', '21231', '3937']);
  const pick = events.filter((ev) => TOP.has(lid(ev))).slice(0, 80).concat(events.filter((ev) => !TOP.has(lid(ev))).slice(0, 40));
  const statNames = {};
  const statSum = {};
  const keyTypes = {};
  let withBox = 0;
  let shown = 0;
  const penFromKey = { matches: 0, withPen: 0 };
  for (const ev of pick) {
    let j;
    try {
      j = await get(ESPN + '/all/summary?event=' + ev.id);
    } catch (e) {
      console.log('résumé ' + ev.id + ' : ' + e.message);
      continue;
    }
    if (!shown) {
      console.log('CLÉS DU RÉSUMÉ : ' + Object.keys(j).join(', '));
      console.log('EXEMPLE boxscore : ' + short(j.boxscore, 1500));
      console.log('EXEMPLE keyEvents[0..2] : ' + short((j.keyEvents || []).slice(0, 3), 1500));
      console.log('EXEMPLE commentary[0..1] : ' + short((j.commentary || []).slice(0, 2), 800));
      console.log('EXEMPLE rosters : ' + short(j.rosters, 1200));
      console.log('EXEMPLE leaders : ' + short(j.leaders, 800));
      shown++;
    }
    const teams = (j.boxscore && j.boxscore.teams) || [];
    if (teams.length === 2 && teams.every((t) => (t.statistics || []).length)) withBox++;
    for (const t of teams) {
      for (const s of t.statistics || []) {
        statNames[s.name] = (statNames[s.name] || 0) + 1;
        const v = parseFloat(s.displayValue != null ? s.displayValue : s.value);
        if (isFinite(v)) {
          const k = s.name + ':' + (t.homeAway || '?');
          statSum[k] = statSum[k] || { s: 0, s2: 0, n: 0 };
          statSum[k].s += v;
          statSum[k].s2 += v * v;
          statSum[k].n++;
        }
      }
    }
    let pen = false;
    for (const k of j.keyEvents || []) {
      const ty = (k.type && (k.type.type || k.type.text)) || '?';
      keyTypes[ty] = (keyTypes[ty] || 0) + 1;
      if (/penalty/i.test(ty) || /penalty/i.test(k.text || '')) pen = true;
    }
    penFromKey.matches++;
    if (pen) penFromKey.withPen++;
  }
  console.log('Résumés lus : ' + penFromKey.matches + ', avec statistiques des deux équipes : ' + withBox);
  console.log('Statistiques disponibles : ' + JSON.stringify(statNames));
  console.log('Moyennes (domicile/extérieur, variance/moyenne) :');
  for (const [k, s] of Object.entries(statSum).sort()) {
    const m = s.s / s.n;
    console.log('  ' + k + ' = ' + m.toFixed(3) + ' (v/m ' + ((s.s2 / s.n - m * m) / Math.max(1e-9, m)).toFixed(2) + ', n=' + s.n + ')');
  }
  console.log('Types d’actions clés : ' + JSON.stringify(keyTypes));
  console.log('Matchs avec penalty (actions clés) : ' + penFromKey.withPen + '/' + penFromKey.matches);

  /* --- Calendrier d'une équipe : les détails y sont-ils ? --------------- */
  const sample = pick[0];
  if (sample) {
    const tid = sample.competitions[0].competitors[0].id;
    try {
      const sch = await get(ESPN + '/all/teams/' + tid + '/schedule');
      const done = (sch.events || []).filter((e) => e.competitions && e.competitions[0].status && e.competitions[0].status.type && e.competitions[0].status.type.completed);
      console.log('Calendrier équipe ' + tid + ' : ' + done.length + ' matchs terminés ; clés compétition : ' + Object.keys((done[0] && done[0].competitions[0]) || {}).join(', '));
      console.log('EXEMPLE compétition calendrier : ' + short(done[0] && done[0].competitions[0], 1200));
    } catch (e) {
      console.log('calendrier : ' + e.message);
    }
  }

  /* --- Résumé d'un match à venir : effectifs, meneurs ------------------- */
  try {
    const sb = await get(ESPN + '/all/scoreboard?dates=' + ymd(new Date(now.getTime() + 2 * 864e5)) + '&limit=1000');
    const up = (sb.events || []).find((e) => lid(e) === '700') || (sb.events || [])[0];
    if (up) {
      const j = await get(ESPN + '/all/summary?event=' + up.id);
      console.log('MATCH À VENIR ' + up.name + ' : clés ' + Object.keys(j).join(', '));
      console.log('  rosters : ' + short(j.rosters, 600));
      console.log('  leaders : ' + short(j.leaders, 600));
      console.log('  pickcenter : ' + short(j.pickcenter, 1200));
      console.log('  odds : ' + short(j.odds, 600));
    }
  } catch (e) {
    console.log('match à venir : ' + e.message);
  }
  console.log('Durée : ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
