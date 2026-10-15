#!/usr/bin/env node
/* Prono — sonde des sources de données : vérifie que les API répondent et
 * affiche la forme des réponses (chemins JSON, exemples de valeurs).
 * Usage : node tools/prono-probe.js  (Node 18+, accès internet requis)
 */
'use strict';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const UA = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) PronoProbe/1.0', Accept: 'application/json,text/csv,*/*' };

async function get(url, asText) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    let json = null;
    if (!asText) {
      try {
        json = JSON.parse(body);
      } catch (e) {
        // pas du JSON
      }
    }
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, body, json };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: String(e), json: null };
  }
}

/** Plan d'un objet JSON : chemins, types et exemples (premier élément des tableaux). */
function outline(v, path, depth, out, max) {
  if (out.length >= max) return out;
  const p = path || '$';
  if (Array.isArray(v)) {
    out.push(p + ' : array[' + v.length + ']');
    if (v.length && depth > 0) outline(v[0], p + '[0]', depth - 1, out, max);
  } else if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth <= 0) out.push(p + ' : {' + keys.slice(0, 12).join(',') + (keys.length > 12 ? ',…' : '') + '}');
    else for (const k of keys) outline(v[k], p + '.' + k, depth - 1, out, max);
  } else {
    let s = JSON.stringify(v);
    if (s && s.length > 70) s = s.slice(0, 67) + '…';
    out.push(p + ' = ' + s);
  }
  return out;
}

function show(title, res, depth, max) {
  console.log('\n### ' + title + ' → HTTP ' + res.status + ' (' + res.ms + ' ms, ' + res.body.length + ' o)');
  if (res.json) console.log(outline(res.json, '$', depth || 6, [], max || 120).join('\n'));
  else console.log(res.body.slice(0, 600));
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

(async () => {
  const now = new Date();
  const past = new Date(now.getTime() - 8 * 864e5);
  const future = new Date(now.getTime() + 6 * 864e5);

  // 1. ESPN : tableau des matchs (plusieurs formes d'appel).
  const variants = [
    ESPN + '/eng.1/scoreboard',
    ESPN + '/eng.1/scoreboard?dates=' + ymd(past),
    ESPN + '/eng.1/scoreboard?dates=' + ymd(past) + '-' + ymd(future),
    ESPN + '/eng.1/scoreboard?dates=' + ymd(new Date('2026-10-04')),
    ESPN + '/eng.1/scoreboard?dates=20261003-20261005',
    ESPN + '/eng.1/scoreboard?dates=2026',
    'https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261004',
    ESPN + '/all/scoreboard?dates=20261004',
    ESPN + '/uefa.champions/scoreboard?dates=20261001'
  ];
  let sb = null;
  for (const u of variants) {
    const r = await get(u);
    const n = r.json && r.json.events ? r.json.events.length : '-';
    console.log('ESPN ' + u.replace(ESPN, '') + ' → HTTP ' + r.status + ' events=' + n + (r.json && r.json.message ? ' ' + r.json.message : ''));
    if (!sb && r.json && r.json.events && r.json.events.some((e) => e.status && e.status.type && e.status.type.completed)) sb = r;
  }
  if (!sb) sb = { json: { events: [] }, status: 0, ms: 0, body: '' };
  else show('ESPN scoreboard retenu', sb, 7, 140);
  const events = (sb.json && sb.json.events) || [];
  const done = events.find((e) => e.status && e.status.type && e.status.type.completed);
  const next = events.find((e) => e.status && e.status.type && e.status.type.state === 'pre');
  console.log('\nÉvènements : ' + events.length + ' ; terminé=' + (done && done.id) + ' ; à venir=' + (next && next.id));

  // 2. ESPN : résumé d'un match (forme, confrontations, cotes).
  for (const [label, ev] of [['terminé', done], ['à venir', next]]) {
    if (!ev) continue;
    const s = await get(ESPN + '/eng.1/summary?event=' + ev.id);
    console.log('\n### ESPN summary ' + label + ' ' + ev.id + ' → HTTP ' + s.status + ' clés : ' + (s.json ? Object.keys(s.json).join(', ') : ''));
    if (s.json) {
      for (const k of ['boxscore', 'headToHeadGames', 'odds', 'pickcenter', 'header', 'gameInfo', 'standings', 'lastFiveGames', 'form']) {
        if (s.json[k] !== undefined) console.log(outline(s.json[k], '$.' + k, 7, [], 70).join('\n'));
      }
    }
  }

  // 3. ESPN : calendrier d'une équipe.
  const team = done && done.competitions[0].competitors[0].team;
  if (team) {
    const ts = await get(ESPN + '/eng.1/teams/' + team.id + '/schedule');
    show('ESPN schedule équipe ' + team.id + ' ' + team.displayName, ts, 7, 90);
    const ts2 = await get(ESPN + '/all/teams/' + team.id + '/schedule');
    console.log('ESPN schedule via /all → HTTP ' + ts2.status + ' events=' + (ts2.json && ts2.json.events ? ts2.json.events.length : '-'));
  }

  // 4. ESPN : couverture des ligues (Afrique, Europe, Amérique…).
  const slugs = ['all', 'uefa.champions', 'uefa.europa', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'fra.2', 'por.1', 'ned.1', 'bel.1', 'tur.1',
    'sau.1', 'usa.1', 'bra.1', 'arg.1', 'mex.1', 'rsa.1', 'nga.1', 'gha.1', 'egy.1', 'mar.1', 'tun.1', 'alg.1', 'civ.1', 'sen.1',
    'cmr.1', 'caf.champions', 'caf.nations', 'fifa.world', 'fifa.worldq.caf', 'uefa.nations', 'eng.2', 'eng.fa', 'esp.copa_del_rey'];
  console.log('\n### Couverture ESPN (scoreboard sur 15 jours)');
  for (const slug of slugs) {
    const r = await get(ESPN + '/' + slug + '/scoreboard?dates=20261001-20261020');
    const ev = r.json && r.json.events ? r.json.events.length : '-';
    const name = r.json && r.json.leagues && r.json.leagues[0] ? r.json.leagues[0].name : '';
    console.log(slug.padEnd(20) + ' HTTP ' + r.status + ' matchs=' + ev + ' ' + name);
  }
  const lg = await get('https://site.api.espn.com/apis/site/v2/sports/soccer/leagues');
  console.log('\nListe des ligues /leagues → HTTP ' + lg.status + ' ' + (lg.json ? JSON.stringify(Object.keys(lg.json)) : lg.body.slice(0, 200)));
  const core = await get('https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=400');
  console.log('core leagues → HTTP ' + core.status + ' count=' + (core.json && core.json.count));
  if (core.json && core.json.items) console.log(core.json.items.slice(0, 5).map((i) => i.$ref).join('\n'));

  // 5. Autres sources.
  for (const u of ['https://api.football-data.org/v4/teams/57/matches?status=FINISHED&limit=5',
    'https://api.football-data.org/v4/competitions/PL/matches?matchday=7',
    'https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=Arsenal_vs_Chelsea',
    'https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=2026-10-04&s=Soccer',
    'https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=4328']) {
    const r = await get(u);
    const j = r.json || {};
    const arr = j.matches || j.event || j.events || j.results || [];
    console.log('\n' + u + ' → HTTP ' + r.status + ' éléments=' + (Array.isArray(arr) ? arr.length : '-') + ' ' + (j.message || j.errorCode || ''));
  }
  show('TheSportsDB eventslast (clé publique 3)', await get('https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=133604'), 4, 40);
  show('API-Football /status sans clé', await get('https://v3.football.api-sports.io/status'), 4, 20);
  show('football-data.org sans clé', await get('https://api.football-data.org/v4/matches'), 3, 20);
  const csv = await get('https://www.football-data.co.uk/mmz4281/2526/E0.csv', true);
  console.log('\n### football-data.co.uk E0 2025/26 → HTTP ' + csv.status + '\n' + csv.body.split('\n').slice(0, 3).join('\n').slice(0, 1500));
  const csv2 = await get('https://www.football-data.co.uk/new/BRA.csv', true);
  console.log('\n### football-data.co.uk new/BRA → HTTP ' + csv2.status + '\n' + csv2.body.split('\n').slice(0, 2).join('\n').slice(0, 600));
})();
