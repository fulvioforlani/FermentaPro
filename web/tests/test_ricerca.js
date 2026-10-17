/* Test automatico della ricerca per ingredienti (node >= 18, nessuna dipendenza).
   Uso:  node web/tests/test_ricerca.js [http://localhost:8954]
   Per OGNI verdura del db: la cerca da sola e in coppia con tutte le altre, e controlla che
   si trovi almeno una ricetta (esatta o con sostituzione) oppure che si possa generare una ricetta.
   Confronta "prima" (solo nomi esatti) e "dopo" (con i gruppi di sostituzione). */
'use strict';
const path = require('path');
const R = require(path.join(__dirname, '..', 'static', 'ricerca.js'));

const BASE = process.argv[2] || 'http://localhost:8954';
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('  ERRORE: ' + msg); } };

(async () => {
  const data = await (await fetch(BASE + '/api/data')).json();
  R.buildVoc(data);
  const vegs = data.vegetables.map(v => v.name);
  console.log(`Ricette ${data.recipes.length}, verdure ${vegs.length}\n`);

  // 1) ogni verdura viene riconosciuta scrivendone il nome (anche minuscolo)
  for (const v of vegs) {
    const p = R.parseIng(v.toLowerCase());
    check(p.found.length === 1 && p.found[0].name === v, `"${v}" non riconosciuta (trovato: ${p.found.map(f => f.name).join(', ') || 'niente'})`);
  }

  // 2) da sola e in coppia: prima (esatte) e dopo (con sostituzioni)
  const stats = { prima: { soloNo: [], coppie: 0 }, dopo: { soloNo: [], coppie: 0 } }, pairs = [];
  for (let i = 0; i < vegs.length; i++) for (let j = i + 1; j < vegs.length; j++) pairs.push([vegs[i], vegs[j]]);
  const perVeg = Object.fromEntries(vegs.map(v => [v, { prima: 0, dopo: 0, gen: 0, tot: 0 }]));
  for (const mode of ['prima', 'dopo']) {
    const opt = { subs: mode === 'dopo' };
    for (const v of vegs) {
      const r = R.rankRecipes([v], data.recipes, opt);
      if (!r.exact.length && !r.withSubs.length) stats[mode].soloNo.push(v);
    }
    for (const [a, b] of pairs) {
      const r = R.rankRecipes([a, b], data.recipes, opt);
      const ok = r.exact.length + r.withSubs.length > 0;
      if (ok) { stats[mode].coppie++; perVeg[a][mode]++; perVeg[b][mode]++; }
      if (mode === 'dopo') {
        perVeg[a].tot++; perVeg[b].tot++;
        const gen = R.canGenerate([a, b]);
        if (!ok && gen) { perVeg[a].gen++; perVeg[b].gen++; }
        check(ok || gen, `coppia ${a} + ${b}: nessuna ricetta e nessuna ricetta generabile`);
      }
    }
  }

  // 3) casi noti
  const top = (q, opt) => { const s = R.parseIng(q).found.map(f => f.name); const r = R.rankRecipes(s, data.recipes, opt); return { s, r }; };
  let t = top('rape carote sedano rapa');
  check(t.r.exact[0] && t.r.exact[0].r.id === 202, 'rape carote sedano rapa -> la prima deve essere la ricetta 202');
  t = top('verza mela');
  check(!t.r.exact.length && t.r.withSubs.some(m => m.r.id === 75), 'verza mela -> ricetta 75 (crauti con mele) con sostituzione');
  check(t.r.withSubs[0] && t.r.withSubs[0].subs[0].use === 'Cavolo verza', 'verza mela -> badge "Cavolo verza al posto di Cavolo cappuccio"');
  t = top('cetriolo aneto');
  check(t.r.exact.length > 0, 'cetriolo aneto -> ricette esatte');
  t = top('zucchina aneto');
  check(t.r.withSubs.every(m => m.r.method === 'salamoia' || !m.subs.some(x => x.group === 'cucurbitacee')), 'cetriolo/zucchina solo in salamoia');
  t = top('cavolo nero mela');
  check(t.r.withSubs.length > 0 && R.canGenerate(t.s), 'cavolo nero (extra) -> sostituzione e generabile');

  // riepilogo
  const P = stats.prima, D = stats.dopo, N = pairs.length;
  console.log(`Da sola, senza ricetta: prima ${P.soloNo.length}/${vegs.length}, dopo ${D.soloNo.length}/${vegs.length}`);
  console.log(`Coppie con una ricetta: prima ${P.coppie}/${N}, dopo ${D.coppie}/${N}; le altre ${N - D.coppie} -> ricetta generata`);
  const weak = vegs.map(v => ({ v, ...perVeg[v] })).filter(x => x.dopo === 0).map(x => x.v);
  console.log(`Verdure che in coppia non trovano MAI una ricetta (solo ricetta generata): ${weak.length ? weak.join(', ') : 'nessuna'}`);
  const why = v => { const g = R.subsGroups(v).map(g => g.id); return `${data.recipes.filter(r => r.items.some(i => i.name === v)).length} ricette, gruppi: ${g.join('/') || 'nessuno'}`; };
  for (const v of weak) console.log(`  - ${v}: ${why(v)}`);
  console.log(fails ? `\nFALLITO: ${fails} errori` : '\nTUTTO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
