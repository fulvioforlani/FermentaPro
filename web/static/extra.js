/* Fermentati — extra: da provare, croccantezza, etichette, scorta, stagione. Usa le utilita' di app.js. */
'use strict';

/* giorni a 20 C in cui la verdura resta croccante (stima prudente; oltre ammorbidisce) */
const CRISP20 = [['cetriolo', 5], ['zucchin', 5], ['ravanell', 5], ['asparag', 5], ['erbett', 5], ['pak choi', 6], ['bietola', 6], ['fagiolin', 7], ['pomodor', 7], ['melanzan', 7], ['mela', 7],
  ['peperon', 8], ['radicchio', 8], ['finocchi', 9], ['porr', 9], ['cavolfior', 10], ['broccol', 10], ['cavolini', 10], ['cavolo cinese', 10], ['sedano', 10], ['cipoll', 10], ['daikon', 10],
  ['peperoncin', 10], ['jalape', 10], ['habanero', 10], ['topinambur', 10], ['rapa', 12], ['olive', 14], ['carot', 14], ['cavolo', 14], ['verza', 14], ['barbabiet', 21], ['aglio', 21]];
const CRISP_SKIP = /limon|aranc|pompelm|zenzero|goji|rafano|curcuma/i;
function crisp20(r) {
  if (r.kind === 'scorta') return null;
  let m = null;
  for (const i of r.items) {
    if (i.type !== 'vegetable' || CRISP_SKIP.test(i.name)) continue;
    const n = i.name.toLowerCase(), hit = CRISP20.find(([k]) => n.includes(k));
    const d = hit ? hit[1] : 10;
    m = m == null ? d : Math.min(m, d);
  }
  return m;
}
const crispAt = r => { const c = crisp20(r); return c == null ? null : Math.round(adjDays(c, r.target_temp_c, r.q10) * 10) / 10; };

/* ---------- stagioni ---------- */
const SEAS_EXTRA = [['limon', [11, 12, 1, 2, 3, 4]], ['aranc', [11, 12, 1, 2, 3, 4]], ['pompelm', [11, 12, 1, 2, 3]], ['peperoncin', [7, 8, 9, 10]], ['jalape', [7, 8, 9, 10]], ['habanero', [7, 8, 9, 10]],
  ['topinambur', [11, 12, 1, 2, 3]], ['radicchio', [10, 11, 12, 1, 2, 3]], ['cavolo cinese', [10, 11, 12, 1, 2, 3]], ['pomodor', [6, 7, 8, 9]], ['cipollotto', [3, 4, 5, 6, 7, 8, 9, 10]], ['olive', [10, 11]]];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
function seasonOf(text) {
  const t = text || ''; if (t.includes("Tutto l'anno")) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const m = new Set();
  if (t.includes('Primavera')) [3, 4, 5].forEach(x => m.add(x));
  if (t.includes('Estate')) [6, 7, 8].forEach(x => m.add(x));
  if (t.includes('Autunno')) [9, 10, 11].forEach(x => m.add(x));
  if (t.includes('Inverno')) [12, 1, 2].forEach(x => m.add(x));
  return [...m];
}
function vegMonths(name) {
  const n = name.toLowerCase();
  const x = SEAS_EXTRA.find(([k]) => n.includes(k)); if (x) return x[1];
  const vs = DATA.vegetables.filter(v => v.seasons && v.seasons !== '—');
  const v = vs.find(v => v.name.toLowerCase() === n) || vs.filter(v => n.startsWith(v.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  return v ? seasonOf(v.seasons) : null;
}
function recipeInSeason(r, mo) {
  const vs = r.items.filter(i => i.type === 'vegetable'); let known = 0;
  for (const i of vs) { const m = vegMonths(i.name); if (!m) continue; known++; if (!m.includes(mo)) return false; }
  return known > 0;
}

/* ---------- da provare ---------- */
const wantBtn = (r, cls = "") => `<span role="button" tabindex="0" class="want-btn ${cls}${r.want ? " on" : ""}" data-want="${r.id}" aria-pressed="${!!r.want}" aria-label="Da provare" title="Da provare"><svg><use href="#i-heart"/></svg></span>`;
async function toggleWant(id) {
  const r = RBY.get(id); if (!r) return;
  try {
    const out = await api('/api/recipes/' + id, { method: 'POST', body: { want: !r.want } });
    r.want = out.want;
    $$(`[data-want="${id}"]`).forEach(b => { b.classList.toggle('on', !!r.want); b.setAttribute('aria-pressed', String(!!r.want)); });
    if (F.want) renderRecipes();
    renderSeasonPanel();
    toast(r.want ? 'Segnata da provare' : 'Tolta da "da provare"');
  } catch (e) { toast(e.message, true); }
}

/* ---------- etichette ---------- */
function labelData(o) {
  const r = o.r, t = o.start || isoToday(), tmp = o.temp ?? r.target_temp_c;
  const ready = Math.round(adjDays(rBase(r), tmp, r.q10) * 10) / 10;
  const c20 = crisp20(r), cr = c20 == null ? null : Math.round(adjDays(c20, tmp, r.q10) * 10) / 10;
  return { name: cleanName(r.name).replace(/ \(stile .*\)$/, ''), start: t, pct: rPct(r), method: r.method, ready, cr, scorta: r.kind === 'scorta', shelf: r.shelf_days, veg: r.items.filter(i => i.type === 'vegetable').map(i => i.name).join(', ') };
}
function labelHTML(L) {
  const d = n => dIT(addDays(L.start, n));
  const rows = [`<div><span>Fatto il</span><b>${dIT(L.start)}</b></div>`, `<div><span>Sale</span><b>${fp(Math.round(L.pct * 10) / 10)}% ${L.method === 'secco' ? 'sulle verdure' : "sull'acqua"}</b></div>`];
  if (L.scorta) rows.push(`<div><span>Da consumare entro</span><b>${dIT(addDays(L.start, L.shelf || 180))}</b></div>`);
  else {
    rows.push(`<div><span>Pronto da</span><b>${d(L.ready)}</b></div>`);
    if (L.cr != null) rows.push(`<div class="warn"><span>In frigo entro (croccante)</span><b>${d(Math.max(L.cr, L.ready))}</b></div>`);
  }
  return `<div class="lbl"><h3>${esc(L.name)}</h3><p>${esc(L.veg)}</p>${rows.join('')}</div>`;
}
function openLabel(o) {
  const L = labelData(o);
  $('#dl-body').innerHTML = `<div class="sheet-top"><h2 id="dl-title">Etichetta</h2><button class="icon-btn" type="button" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <div class="sheet-scroll"><div class="lbl-prev">${labelHTML(L)}</div>
    <div class="mrow" style="margin:14px 0"><label class="hint" for="dl-start">Data preparazione</label><input type="date" id="dl-start" value="${L.start}"><label class="hint" for="dl-n">Copie</label><span class="inp"><input id="dl-n" type="number" min="1" max="24" value="2"></span></div>
    <p class="hint">Stampa su carta adesiva A4 (etichette 6×4 cm): le copie si dispongono in griglia.</p>
    <div class="actions"><button class="btn primary" type="button" id="dl-print">${icon('check')}Stampa</button></div></div>`;
  const d = $('#dlg-l'); if (!d.open) d.showModal();
  const redraw = () => { const L2 = labelData({ ...o, start: $('#dl-start').value || L.start }); $('.lbl-prev').innerHTML = labelHTML(L2); return L2; };
  $('#dl-start').addEventListener('input', redraw);
  $('#dl-print').addEventListener('click', () => {
    const L2 = redraw(), n = clamp(parseInt($('#dl-n').value, 10) || 1, 1, 24);
    let pa = $('#print-area'); if (!pa) { pa = document.createElement('div'); pa.id = 'print-area'; document.body.appendChild(pa); }
    pa.innerHTML = Array(n).fill(labelHTML(L2)).join(''); window.print();
  });
}

/* ---------- pannello stagione ---------- */
let SEASON_MO = new Date().getMonth() + 1;
function renderSeasonPanel() {
  const el = $('#r-season'); if (!el) return;
  const mo = SEASON_MO, vegs = [...new Set(DATA.recipes.flatMap(r => r.items.filter(i => i.type === 'vegetable').map(i => i.name)))];
  const inS = vegs.filter(n => (vegMonths(n) || []).includes(mo)).sort((a, b) => a.localeCompare(b, 'it'));
  const rec = DATA.recipes.filter(r => r.kind !== 'scorta' && recipeInSeason(r, mo)).sort((a, b) => (b.want || 0) - (a.want || 0) || (b.rating || 0) - (a.rating || 0) || a.id - b.id).slice(0, 8);
  const sc = DATA.recipes.filter(r => r.kind === 'scorta' && recipeInSeason(r, mo)).slice(0, 4);
  const mini = r => `<button type="button" class="mini" data-id="${r.id}">${r.want ? '<svg class="hrt"><use href="#i-heart"/></svg>' : ''}<b>${esc(cleanName(r.name).replace(/ \(stile .*\)$/, ''))}</b><small>${r.kind === 'scorta' ? 'scorta ' + Math.round((r.shelf_days || 0) / 30) + ' mesi' : (crispAt(r) != null ? 'croccante ' + nf(crispAt(r), crispAt(r) % 1 ? 1 : 0) + ' gg' : nf(rMin(r)) + ' gg')}</small></button>`;
  const open = el.querySelector('details') ? el.querySelector('details').open : true;
  el.innerHTML = `<details${open ? ' open' : ''}><summary><b>Cosa fermentare a ${MESI[mo - 1]}</b> <small>${inS.length} verdure e frutta di stagione</small></summary>
    <div class="mo-tabs">${MESI.map((m, i) => `<button type="button" class="chip${i + 1 === mo ? ' on' : ''}" data-mo="${i + 1}">${m.slice(0, 3)}</button>`).join('')}</div>
    <div class="vdots season">${inS.map(n => `<span><i style="background:${vegColor(n)}"></i>${esc(n)}</span>`).join('') || '<span>—</span>'}</div>
    <h4>Proposte del mese</h4><div class="minis">${rec.map(mini).join('') || '<small>Nessuna ricetta con sole verdure di stagione.</small>'}</div>
    ${sc.length ? `<h4>Da mettere in dispensa</h4><div class="minis">${sc.map(mini).join('')}</div>` : ''}</details>`;
}
function initExtra() {
  $('#r-season').addEventListener('click', e => {
    const b = e.target.closest('[data-mo]'); if (b) { e.preventDefault(); SEASON_MO = +b.dataset.mo; renderSeasonPanel(); return; }
    const m = e.target.closest('.mini'); if (m) openRecipe(+m.dataset.id);
  });
  $('#r-grid').addEventListener('click', e => { const b = e.target.closest('[data-want]'); if (b) { e.stopPropagation(); toggleWant(+b.dataset.want); } }, true);
  renderSeasonPanel();
}

/* ---------- taglio: dire quale, non rimandare ---------- */
const CUT_FIX = { 'Ananas': 'a cubetti di 2 cm', 'Cavolini di Bruxelles': 'dimezzati (grandi in quarti)', 'Cavolo rapa': 'a bastoncini o fettine sottili',
  'Erba cipollina': 'tritata fine', 'Mela': 'a spicchi sottili o fettine', 'Olive': 'intere', 'Pane di segale': 'a cubetti di 2 cm', 'Zenzero': 'a fettine sottili o julienne' };
function cutList(r) {
  const out = [];
  for (const i of r.items) {
    if (i.type !== 'vegetable') continue;
    const v = DATA.vegetables.find(x => x.name === i.name);
    let c = CUT_FIX[i.name] || (v && v.cut_style && !/a piacere/i.test(v.cut_style) ? v.cut_style.charAt(0).toLowerCase() + v.cut_style.slice(1) : null);
    if (!c) { const g = DATA.vegetables.find(x => i.name.toLowerCase().startsWith(x.name.toLowerCase()) && x.cut_style); c = g ? (CUT_FIX[g.name] || g.cut_style.charAt(0).toLowerCase() + g.cut_style.slice(1)) : 'a pezzi o fettine di spessore regolare'; }
    out.push(`${i.name}: ${c}`);
  }
  return out;
}
function fixCut(step, r) {
  if (!/taglio macrobiotico/i.test(step)) return step;
  const l = cutList(r);
  return l.length ? `Pulisci e taglia le verdure — ${l.join('; ')}. Tagli regolari: fermentano in modo uniforme e restano croccanti.` : step;
}
