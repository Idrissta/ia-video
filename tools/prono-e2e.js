#!/usr/bin/env node
/* Prono — test de bout en bout sur de vrais matchs à venir (API ESPN) :
 * chargement de la journée, lecture des résumés, analyse par le moteur.
 * Usage : node tools/prono-e2e.js   (accès internet requis)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dir = path.join(__dirname, '..', 'prono', 'src', 'main', 'assets', 'web', 'js');
const ctx = { console, Math, fetch, AbortController, setTimeout, clearTimeout, URLSearchParams };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['leagues.js', 'engine.js', 'data.js']) {
  if (fs.existsSync(path.join(dir, f))) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
}
const P = ctx.PRONO;
const pct = (x) => (100 * x).toFixed(0) + ' %';

(async () => {
  let failures = 0;
  const today = new Date();
  const sat = new Date(today.getTime() + ((6 - today.getDay() + 7) % 7) * 864e5);
  for (const d of [today, sat]) {
    const list = await P.Data.day(d);
    const leagues = {};
    for (const e of list) leagues[e.league.name] = (leagues[e.league.name] || 0) + 1;
    console.log(d.toDateString() + ' : ' + list.length + ' matchs, ' + Object.keys(leagues).length + ' compétitions. Premières : ' +
      Object.entries(leagues).slice(0, 12).map(([k, v]) => k + ' (' + v + ')').join(', '));
    const unnamed = list.filter((e) => e.league.name === 'Autre compétition').length;
    console.log('  sans nom de compétition : ' + unnamed);
    const pre = list.filter((e) => e.state === 'pre').slice(0, 4);
    for (const e of pre) {
      try {
        const m = await P.Data.match(e.id);
        const res = P.Engine.analyze(P.Data.engineInput(m, m.odds || {}));
        const main = res.picks.main;
        console.log('  ' + e.league.name + ' · ' + m.home.name + ' – ' + m.away.name + ' : forme ' + m.home.games.length + '/' + m.away.games.length +
          ' (historique ' + m.home.recent.length + '/' + m.away.recent.length + ')' +
          ' matchs, face-à-face ' + m.h2h.length + ', classement ' + (m.home.standing ? 'oui' : 'non') + ', cotes ' + (m.odds ? m.odds.provider : 'non') +
          ' → buts attendus ' + res.lh.toFixed(2) + '–' + res.la.toFixed(2) + ' ; 1X2 ' + pct(res.markets[0].sels[0].p) + '/' + pct(res.markets[0].sels[1].p) + '/' + pct(res.markets[0].sels[2].p) +
          ' ; pronostic : ' + (main ? main.label + ' (' + main.market + ') ' + pct(main.p) : '—'));
        if (!m.home.games.length || !m.away.games.length) failures++;
      } catch (err) {
        failures++;
        console.log('  ÉCHEC ' + e.id + ' : ' + err.message);
      }
    }
  }
  console.log(failures ? failures + ' anomalie(s)' : 'OK');
})();
