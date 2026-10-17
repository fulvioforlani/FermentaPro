/* Fermentati — motore della ricerca per ingredienti.
   Codice puro (niente DOM, niente rete): lo usano la pagina (app.js) e i test (tests/test_ricerca.js).
   Riconosce plurali, nomi uniti, sinonimi, errori di battitura e SOSTITUZIONI tra verdure simili. */

/* sinonimi: parole diverse per la STESSA verdura del ricettario */
const ING_SYN = {
  'cavolo': 'Cavolo cappuccio', 'cavolo bianco': 'Cavolo cappuccio', 'cappuccio': 'Cavolo cappuccio', 'crauti': 'Cavolo cappuccio',
  'verza': 'Cavolo verza', 'rapa rossa': 'Barbabietola', 'bietola rossa': 'Barbabietola', 'barbabietola rossa': 'Barbabietola',
  'cetriolino': 'Cetriolo', 'cornichon': 'Cetriolo', 'zucchino': 'Zucchina', 'cipollotto': 'Cipolla',
  'fagiolo verde': 'Fagiolino', 'cavolo cinese': 'Pak choi', 'bok choy': 'Pak choi', 'pakchoi': 'Pak choi', 'mais': 'Mais (chicchi)', 'granoturco': 'Mais (chicchi)',
  'bietola': 'Bietola costa', 'biete': 'Bietola costa', 'coste': 'Bietola costa', 'celeriaco': 'Sedano rapa', 'sedano di verona': 'Sedano rapa',
  'rafano giapponese': 'Daikon', 'pepe': 'Pepe nero', 'pepe in grani': 'Pepe nero', 'origano': 'Origano (secco)', 'senape': 'Semi di senape',
  'pane nero': 'Pane di segale', 'segale': 'Pane di segale', 'rapa bianca': 'Rapa', 'pomodori verdi': 'Pomodoro verde', 'cavolini': 'Cavolini di Bruxelles',
  'cavolo viola': 'Cavolo rosso', 'cavolo cappuccio rosso': 'Cavolo rosso', 'cavolo riccio': 'Cavolo nero', 'cavolo toscano': 'Cavolo nero'
};
/* verdure che NON sono nel ricettario ma si possono cercare: usano i dati (tempo base, sale, taglio) della verdura simile */
const ING_EXTRA = {
  'Cavolo nero': { like: 'Cavolo verza' },
  'Cavolo rosso': { like: 'Cavolo cappuccio' },
  'Navone': { like: 'Rapa' },
  'Pastinaca': { like: 'Carota' },
  'Pera': { like: 'Mela' },
  'Scalogno': { like: 'Cipolla' }
};
/* gruppi di sostituibilita': verdure che in fermentazione si usano allo stesso modo (taglio, tempi, sale simili).
   "cautela" = differenza da sapere; "solo" = vale solo per quel metodo. Niente indicazioni di salute. */
const ING_SUBS = [
  { id: 'cavoli', items: ['Cavolo cappuccio', 'Cavolo verza', 'Cavolo rosso', { n: 'Cavolo nero', cautela: 'foglie più dure: taglia fine' }, { n: 'Pak choi', cautela: 'più tenero: fermenta prima' }, { n: 'Cavolo rapa', cautela: 'è il fusto: taglialo a julienne' }] },
  { id: 'radici', items: ['Rapa', 'Navone', 'Ravanello', 'Daikon', 'Cavolo rapa'] },
  { id: 'carote', items: ['Carota', { n: 'Pastinaca', cautela: 'più dolce' }] },
  { id: 'sedani', items: ['Sedano', 'Sedano rapa', { n: 'Finocchio', cautela: 'sa di anice' }] },
  { id: 'alliacee', items: ['Cipolla', 'Porro', 'Scalogno', { n: 'Erba cipollina', cautela: 'aromatica: usane poca' }] },
  { id: 'cucurbitacee', solo: 'salamoia', items: ['Cetriolo', 'Zucchina'] },
  { id: 'frutta', items: ['Mela', 'Pera'] },
  { id: 'foglie', items: ['Spinaci', 'Erbette', 'Bietola costa'] },
  { id: 'cimette', items: ['Cavolfiore', 'Broccolo'] },
  { id: 'baccelli', solo: 'salamoia', items: ['Fagiolino', 'Asparago'] },
  { id: 'coriandolo', items: ['Coriandolo', 'Semi di coriandolo'] },
  { id: 'cumino', items: ['Cumino', 'Semi di cumino'] },
  { id: 'pepe', items: ['Pepe nero', 'Pepe rosa'] },
  { id: 'peperoncino', items: ['Peperoncino', 'Peperoncino affumicato'] },
  { id: 'aglio', items: ['Aglio', 'Aglio secco'] }
];
const ING_STOP = new Set(['e', 'ed', 'di', 'con', 'il', 'la', 'le', 'i', 'gli', 'lo', 'un', 'una', 'g', 'gr', 'grammi', 'kg', 'ho', 'del', 'della', 'dei', 'delle', 'piu', 'poi']);
const n2 = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stemW = w => w.length > 3 ? w.replace(/(io|ie|ia|a|e|i|o)$/, '') : w;
const stemP = words => words.map(stemW).join(' ');
const isNum = w => /^\d+([.,]\d+)?(g|gr|kg)?$/.test(w);
function osa(a, b) {   // distanza di Damerau-Levenshtein (versione OSA)
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

/* vocabolario: verdure + spezie del db + extra; VMAP: dati verdura (anche per gli extra, presi dalla simile) */
let VOC = null, VMAP = null;
function buildVoc(data, colorOf) {
  const vegNames = new Set(data.vegetables.map(v => v.name));
  const names = new Map();
  data.vegetables.forEach(v => names.set(v.name, 'vegetable'));
  Object.entries(ING_EXTRA).forEach(([n, x]) => { if (vegNames.has(x.like) && !names.has(n)) names.set(n, 'vegetable'); });
  data.spices.forEach(s => { if (!names.has(s)) names.set(s, 'spice'); });
  data.recipes.forEach(r => r.items.forEach(i => { if (!names.has(i.name)) names.set(i.name, vegNames.has(i.name) ? 'vegetable' : i.type); }));
  const list = [...names].map(([name, type]) => ({ name, type, extra: !!ING_EXTRA[name] && !vegNames.has(name), color: colorOf ? colorOf(name, type) : '' }));
  const keys = new Map();
  const add = (k, name) => { if (k && !keys.has(k)) keys.set(k, name); };
  for (const e of list) { const w = n2(e.name).split(' '); add(stemP(w), e.name); add(stemW(w.join('')), e.name); }
  for (const [s, t] of Object.entries(ING_SYN)) if (names.has(t)) { const w = n2(s).split(' '); add(stemP(w), t); add(stemW(w.join('')), t); }
  VOC = { list, keys, byName: new Map(list.map(e => [e.name, e])) };
  VMAP = new Map(data.vegetables.map(v => [v.name, v]));
  for (const [n, x] of Object.entries(ING_EXTRA)) if (!VMAP.has(n) && VMAP.has(x.like)) VMAP.set(n, { ...VMAP.get(x.like), name: n, like: x.like });
  return VOC;
}
const vegData = n => (VMAP && VMAP.get(n)) || null;

function suggest(w) {
  const st = stemW(w), thr = st.length <= 4 ? 1 : st.length <= 7 ? 2 : 3, best = new Map();
  for (const [k, name] of VOC.keys) {
    for (const p of [k, ...k.split(' ')]) {
      if (Math.abs(p.length - st.length) > thr) continue;
      const d = osa(st, p);
      if (d <= thr && (!best.has(name) || best.get(name) > d)) best.set(name, d);
    }
  }
  return [...best].sort((a, b) => a[1] - b[1]).slice(0, 2).map(x => x[0]);
}
function parseIng(text) {
  const words = n2(text).split(' ').filter(Boolean), found = [], unknown = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (isNum(w)) {
      const v = parseFloat(w.replace(',', '.')) * (/kg$/.test(w) || words[i + 1] === 'kg' ? 1000 : 1);
      if (found.length && v > 0) found[found.length - 1].g = v;
      i++; continue;
    }
    if (ING_STOP.has(w)) { i++; continue; }
    let hit = null;
    for (let L = Math.min(3, words.length - i); L >= 1 && !hit; L--) {
      const span = words.slice(i, i + L);
      if (span.some(x => isNum(x) || (L > 1 && ING_STOP.has(x) && x !== 'di'))) continue;
      const name = VOC.keys.get(stemP(span)) || VOC.keys.get(stemW(span.join('')));
      if (name) hit = { name, L };
    }
    if (!hit) {   // inizio di un nome composto, solo se univoco ("cavolini" -> Cavolini di Bruxelles)
      const st = stemW(w), cands = VOC.list.filter(e => stemW(n2(e.name).split(' ')[0]) === st);
      if (cands.length === 1) hit = { name: cands[0].name, L: 1 };
    }
    if (hit) { if (!found.some(f => f.name === hit.name)) found.push({ name: hit.name }); i += hit.L; continue; }
    unknown.push({ word: w, sugg: suggest(w) });
    i++;
  }
  return { found, unknown };
}

/* --- sostituzioni --- */
const memberName = m => typeof m === 'string' ? m : m.n;
const memberNote = (g, n) => { const m = g.items.find(x => memberName(x) === n); return m && typeof m === 'object' ? m.cautela : ''; };
function subsGroups(name) { return ING_SUBS.filter(g => g.items.some(m => memberName(m) === name)); }
/* confronta i dati della verdura scelta con quella della ricetta: righe corte solo se diversi */
function subsDiff(use, instead, method) {
  const a = vegData(use), b = vegData(instead), out = [];
  if (a && b && a.base_days_20c && b.base_days_20c && a.base_days_20c !== b.base_days_20c) out.push(`tempo base ${fmtN(a.base_days_20c)} gg invece di ${fmtN(b.base_days_20c)}`);
  if (method === 'secco' && a && b && a.default_dry_pct && b.default_dry_pct && a.default_dry_pct !== b.default_dry_pct) out.push(`sale ${fmtN(a.default_dry_pct)} % invece di ${fmtN(b.default_dry_pct)} %`);
  return out;
}
const fmtN = x => String(Math.round(x * 10) / 10).replace('.', ',');
/* quanto una ricetta copre gli ingredienti scelti: prima gli esatti, poi le sostituzioni (una per ingrediente della ricetta) */
function matchRecipe(sel, r) {
  const have = new Set(r.items.map(i => i.name)), used = new Set();
  const left = [];
  let exact = 0;
  for (const s of sel) { if (have.has(s)) { exact++; used.add(s); } else left.push(s); }
  const subs = [];
  for (const s of left) {
    let hit = null;
    for (const g of subsGroups(s)) {
      if (g.solo && g.solo !== r.method) continue;
      for (const m of g.items) {
        const x = memberName(m);
        if (x !== s && have.has(x) && !used.has(x)) { hit = { use: s, instead: x, group: g.id, cautela: memberNote(g, s) || memberNote(g, x) || (g.solo ? `solo in ${g.solo}` : ''), diff: subsDiff(s, x, r.method) }; break; }
      }
      if (hit) break;
    }
    if (hit) { subs.push(hit); used.add(hit.instead); }
  }
  const extra = r.items.filter(i => i.type === 'vegetable' && !used.has(i.name)).length;
  return { r, exact, subs, cov: exact + subs.length, extra };
}
/* classifica: esatte sopra, poi con sostituzione, poi quasi, poi le altre */
function rankRecipes(sel, recipes, opts = {}) {
  const useSubs = opts.subs !== false;
  const scored = [];
  for (const r of recipes) {
    const m = useSubs ? matchRecipe(sel, r) : (() => { const have = new Set(r.items.map(i => i.name)); const exact = sel.filter(s => have.has(s)).length; return { r, exact, subs: [], cov: exact, extra: r.items.filter(i => i.type === 'vegetable' && !sel.includes(i.name)).length }; })();
    if (m.cov) scored.push(m);
  }
  scored.sort((a, b) => b.cov - a.cov || a.subs.length - b.subs.length || a.extra - b.extra || (b.r.rating || 0) - (a.r.rating || 0) || a.r.id - b.r.id);
  const n = sel.length;
  const exact = scored.filter(s => s.cov === n && !s.subs.length);
  const withSubs = scored.filter(s => s.cov === n && s.subs.length);
  const near = n >= 2 ? scored.filter(s => s.cov === n - 1) : [];
  const rest = scored.filter(s => s.cov < n && !near.includes(s));
  return { exact, withSubs, near, rest, all: scored };
}
/* si puo' generare una ricetta se c'e' almeno una verdura (del db o extra) */
const canGenerate = sel => sel.some(n => !!vegData(n));

if (typeof module !== 'undefined') module.exports = { ING_SYN, ING_EXTRA, ING_SUBS, buildVoc, parseIng, suggest, matchRecipe, rankRecipes, canGenerate, vegData, subsGroups };
