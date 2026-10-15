#!/usr/bin/env node
/* Prono — sonde des sources de données : vérifie que les API utilisées par
 * l'application répondent toujours et affiche la forme des réponses.
 * Usage : node tools/prono-probe.js  (Node 18+, accès internet requis)
 */
'use strict';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) PronoProbe/1.0', Accept: 'application/json,text/csv,*/*' };

async function get(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    let json = null;
    try {
      json = JSON.parse(body);
    } catch (e) {
      // pas du JSON
    }
    return { status: r.status, ms: Date.now() - t0, body, json };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: String(e), json: null };
  }
}

/** Plan d'un objet JSON : chemins, types et exemples (premier élément des tableaux). */
function outline(v, path, depth, out, max) {
  if (out.length >= max) return out;
  if (Array.isArray(v)) {
    out.push(path + ' : array[' + v.length + ']');
    if (v.length && depth > 0) outline(v[0], path + '[0]', depth - 1, out, max);
  } else if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth <= 0) out.push(path + ' : {' + keys.slice(0, 14).join(',') + (keys.length > 14 ? ',…' : '') + '}');
    else for (const k of keys) outline(v[k], path + '.' + k, depth - 1, out, max);
  } else {
    let s = JSON.stringify(v);
    if (s && s.length > 60) s = s.slice(0, 57) + '…';
    out.push(path + ' = ' + s);
  }
  return out;
}

const SKIP = /logo|links|href|uid|guid|color|alternateColor|\$ref|broadcast|isPremium|rel\b|language|shortText|lastUpdated|width|height|alt\b/i;
function brief(v, path, depth, max) {
  return outline(v, path, depth, [], max * 3).filter((l) => !SKIP.test(l.split(/ [:=] /)[0])).slice(0, max).join('\n');
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

(async () => {
  const today = new Date();
  const sat = new Date(today.getTime() + ((6 - today.getUTCDay() + 7) % 7) * 864e5);

  console.log('## 1. Matchs du jour toutes ligues (/all/scoreboard)');
  for (const q of ['?dates=' + ymd(sat), '?dates=' + ymd(sat) + '&limit=1000', '?dates=' + ymd(today)]) {
    const r = await get(ESPN + '/all/scoreboard' + q);
    const ev = (r.json && r.json.events) || [];
    const leagues = {};
    for (const e of ev) {
      const k = (e.league && (e.league.slug || e.league.abbreviation)) || (e.season && e.season.slug) || '?';
      leagues[k] = (leagues[k] || 0) + 1;
    }
    console.log('/all/scoreboard' + q + ' → HTTP ' + r.status + ' events=' + ev.length + ' ligues=' + JSON.stringify(leagues).slice(0, 900));
    if (q.includes('limit') && ev[0]) {
      console.log('clés event : ' + Object.keys(ev[0]).join(','));
      console.log(brief(ev[0], '$.ev', 6, 70));
    }
  }

  console.log('\n## 2. Match à venir : résumé (forme, confrontations, cotes)');
  const sb = await get(ESPN + '/eng.1/scoreboard');
  const evs = (sb.json && sb.json.events) || [];
  console.log('/eng.1/scoreboard → ' + sb.status + ' events=' + evs.length + ' états=' + evs.map((e) => e.status.type.state).join(','));
  const pre = evs.find((e) => e.status.type.state === 'pre') || evs[0];
  if (pre) {
    const s = await get(ESPN + '/eng.1/summary?event=' + pre.id);
    const j = s.json || {};
    console.log('summary ' + pre.id + ' (' + pre.name + ') → ' + s.status + ' clés : ' + Object.keys(j).join(', '));
    if (j.headToHeadGames) console.log(brief(j.headToHeadGames, '$.headToHeadGames', 6, 50));
    if (j.lastFiveGames) console.log('lastFiveGames : ' + j.lastFiveGames.map((t) => t.team.displayName + '=' + t.events.length).join(' ; '));
    if (j.seasonseries) console.log(brief(j.seasonseries, '$.seasonseries', 5, 25));
    if (j.pickcenter) console.log('pickcenter : ' + j.pickcenter.length + ' fournisseurs ' + j.pickcenter.map((p) => p.provider && p.provider.name).join(','));
    if (j.boxscore) console.log(brief(j.boxscore, '$.boxscore', 4, 20));
  }

  console.log('\n## 3. Mi-temps d\'un match terminé (linescores)');
  const done = await get(ESPN + '/eng.1/scoreboard?dates=20260101');
  const d0 = done.json && done.json.events && done.json.events[0];
  if (d0) {
    const c = d0.competitions[0];
    console.log(d0.name + ' : ' + c.competitors.map((x) => x.homeAway + ' ' + x.score + ' linescores=' + JSON.stringify((x.linescores || []).map((l) => l.value))).join(' | '));
    console.log('clés competitor : ' + Object.keys(c.competitors[0]).join(','));
  }

  console.log('\n## 4. Calendriers d\'équipe sur plusieurs saisons (confrontations directes)');
  for (const q of ['', '?season=2025', '?season=2024', '?season=2022']) {
    const r = await get(ESPN + '/all/teams/384/schedule' + q);
    const ev = (r.json && r.json.events) || [];
    const comps = [...new Set(ev.map((e) => e.league && e.league.slug))];
    const sample = ev[0] ? ev[0].competitions[0].competitors.map((x) => x.team.displayName + ' ' + (x.score && x.score.displayValue)).join(' - ') : '';
    console.log('/all/teams/384/schedule' + q + ' → ' + r.status + ' events=' + ev.length + ' compétitions=' + comps.join(',') + ' ex: ' + sample);
  }

  console.log('\n## 5. Ligues ESPN (core) et couverture');
  const core = await get('https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=400');
  const slugs = ((core.json && core.json.items) || []).map((i) => (i.$ref.match(/leagues\/([^?]+)/) || [])[1]).filter(Boolean);
  console.log('core leagues → ' + core.status + ' ' + slugs.length + ' : ' + slugs.join(' '));
  for (const slug of ['rsa.1', 'nga.1', 'egy.1', 'mar.1', 'alg.1', 'tun.1', 'civ.1', 'sen.1', 'cmr.1', 'caf.champions', 'caf.confed', 'caf.nations', 'fifa.worldq.caf', 'fra.1', 'uefa.champions']) {
    const r = await get(ESPN + '/' + slug + '/scoreboard');
    const n = r.json && r.json.events ? r.json.events.length : '-';
    const name = r.json && r.json.leagues && r.json.leagues[0] ? r.json.leagues[0].name : (r.json && r.json.message) || '';
    console.log(slug.padEnd(18) + ' → ' + r.status + ' events=' + n + ' ' + name);
  }

  console.log('\n## 7. Correspondance ligue ↔ match dans /all et résumé sans ligue');
  const all = await get(ESPN + '/all/scoreboard?dates=' + ymd(sat) + '&limit=1000');
  const aj = all.json || {};
  console.log('clés /all : ' + Object.keys(aj).join(','));
  if (aj.leagues) {
    console.log('leagues[] : ' + aj.leagues.length + ' ex: ' + aj.leagues.slice(0, 6).map((l) => l.id + '=' + l.slug + '|' + l.name + '|' + l.abbreviation).join(' ; '));
    console.log(brief(aj.leagues[0], '$.leagues[0]', 3, 25));
  }
  const evs2 = aj.events || [];
  console.log('uid ex : ' + evs2.slice(0, 3).map((e) => e.uid + ' note=' + e.competitions[0].altGameNote).join(' ; '));
  const small = evs2.find((e) => /nga|rsa|caf|nigeria|south africa/i.test(JSON.stringify(e.season) + e.competitions[0].altGameNote)) || evs2[evs2.length - 1];
  for (const ev of [evs2[0], small].filter(Boolean)) {
    for (const lg of ['all', 'soccer']) {
      const s = await get(ESPN + '/' + lg + '/summary?event=' + ev.id);
      const j = s.json || {};
      const ss = j.seasonseries && j.seasonseries[0];
      console.log('/' + lg + '/summary ' + ev.id + ' ' + ev.name + ' → ' + s.status + ' last5=' + (j.lastFiveGames ? j.lastFiveGames.map((t) => t.events.length).join('/') : '-') +
        ' h2h=' + (ss ? ss.events.length + ' (' + ss.shortSummary + ')' : '-') + ' cotes=' + (j.pickcenter ? j.pickcenter.length : 0) + ' classement=' + (j.standings ? 'oui' : 'non'));
    }
  }
  const sm = await get(ESPN + '/all/summary?event=' + (evs2[0] && evs2[0].id));
  const sj = sm.json || {};
  if (sj.standings) {
    const e = sj.standings.groups && sj.standings.groups[0] && sj.standings.groups[0].standings.entries[0];
    if (e) console.log('stats classement : ' + e.stats.map((x) => x.name + '=' + x.displayValue).join(', '));
  }
  if (sj.seasonseries) console.log(brief(sj.seasonseries[0].events[0], '$.h2h[0]', 4, 20));
  if (sj.lastFiveGames) console.log(brief(sj.lastFiveGames[0].events[0], '$.last5[0]', 3, 30));

  console.log('\n## 8. Découpage des journées ESPN et classements complets');
  const dd = await get(ESPN + '/all/scoreboard?dates=' + ymd(sat) + '&limit=1000');
  const ts = ((dd.json && dd.json.events) || []).map((e) => e.date).sort();
  console.log('dates=' + ymd(sat) + ' → ' + ts.length + ' matchs de ' + ts[0] + ' à ' + ts[ts.length - 1] + ' (' + dd.body.length + ' o)');
  const sum = await get(ESPN + '/all/summary?event=' + (evs2[0] && evs2[0].id));
  console.log('header.league : ' + JSON.stringify(sum.json && sum.json.header && sum.json.header.league).slice(0, 300));
  for (const u of ['https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings', 'https://site.web.api.espn.com/apis/v2/sports/soccer/eng.1/standings']) {
    const r = await get(u);
    const ch = r.json && r.json.children && r.json.children[0];
    const e = ch && ch.standings && ch.standings.entries && ch.standings.entries[0];
    console.log(u + ' → ' + r.status + (e ? ' stats : ' + e.stats.map((x) => x.name + '=' + x.displayValue).join(', ') : ' clés=' + Object.keys(r.json || {}).join(',')));
  }

  console.log('\n## 6. Données historiques (football-data.co.uk)');
  for (const f of ['mmz4281/2526/E0.csv', 'mmz4281/2526/F1.csv', 'new/BRA.csv']) {
    const r = await get('https://www.football-data.co.uk/' + f);
    console.log(f + ' → ' + r.status + ' lignes=' + r.body.split('\n').length);
  }
})();
