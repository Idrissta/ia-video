#!/usr/bin/env node
/* Prono — liste des compétitions ESPN (identifiant, code, nom) pour js/leagues.js.
 * Usage : node tools/prono-leagues.js   (accès internet requis)
 */
'use strict';
(async () => {
  const get = async (u) => (await fetch(u, { signal: AbortSignal.timeout(20000) })).json();
  const list = await get('https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=400');
  const slugs = list.items.map((i) => (i.$ref.match(/leagues\/([^?]+)/) || [])[1]).filter(Boolean);
  const out = [];
  for (let i = 0; i < slugs.length; i += 12) {
    const part = await Promise.all(slugs.slice(i, i + 12).map((s) => get('https://sports.core.api.espn.com/v2/sports/soccer/leagues/' + s).catch(() => null)));
    for (const l of part) if (l && l.id) out.push([l.id, l.slug, l.name, l.abbreviation || '']);
  }
  console.log('Compétitions : ' + out.length);
  console.log('LEAGUES_JSON=' + JSON.stringify(out));
})();
