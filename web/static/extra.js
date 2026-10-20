/* Fermentati — extra: da provare, croccantezza, etichette, scorta, stagione. Usa le utilita' di app.js. */
'use strict';

/* giorni a 20 C in cui la verdura resta croccante (stima prudente; oltre ammorbidisce) */
const CRISP20 = [['cetriolo', 5], ['zucchin', 5], ['ravanell', 5], ['asparag', 5], ['erbett', 5], ['pak choi', 6], ['bietola', 6], ['fagiolin', 7], ['pomodor', 7], ['melanzan', 7], ['mela', 7],
  ['peperon', 8], ['radicchio', 8], ['finocchi', 9], ['porr', 9], ['cavolfior', 10], ['broccol', 10], ['cavolini', 10], ['cavolo cinese', 10], ['sedano', 10], ['cipoll', 10], ['daikon', 10],
  ['peperoncin', 10], ['jalape', 10], ['habanero', 10], ['topinambur', 10], ['rapa', 12], ['olive', 14], ['carot', 14], ['cavolo', 14], ['verza', 14], ['barbabiet', 21], ['aglio', 21]];
const CRISP_SKIP = /limon|aranc|pompelm|zenzero|goji|rafano|curcuma/i;
function crispInfo(r) {
  if (r.kind === 'scorta' || NOMAIN.includes(r.kind)) return null;
  let m = null, key = '';
  for (const i of r.items) {
    if (i.type !== 'vegetable' || CRISP_SKIP.test(i.name)) continue;
    const n = i.name.toLowerCase(), hit = CRISP20.find(([k]) => n.includes(k));
    const d = hit ? hit[1] : 10;
    if (m == null || d < m) { m = d; key = hit ? hit[0] : n; }
  }
  return m == null ? null : { d: m, key };
}
const crisp20 = r => { const c = crispInfo(r); return c ? c.d : null; };

/* giorni in frigo in cui resta croccante: stima di partenza, poi impara dalle tue osservazioni */
let OBS = [];
async function loadObs() { try { OBS = await api('/api/crisp'); } catch (e) { OBS = []; } }
const FRT_KEY = 'fermentati.fridgeT';
let FRT = null;   /* temperatura frigo: salvata sul server (vale per PC e telefono) */
function fridgeT() { if (FRT != null && isFinite(FRT)) return clamp(FRT, -2, 12); try { const v = parseFloat(localStorage.getItem(FRT_KEY)); if (isFinite(v)) return clamp(v, -2, 12); } catch (e) { /* default */ } return 4; }
function setFridgeT(v) { FRT = v; try { localStorage.setItem(FRT_KEY, String(v)); } catch (e) { /* ignora */ } api('/api/fridge_t', { method: 'POST', body: { t: v } }).catch(() => {}); syncFridgeInput(); }
async function loadFridgeT() { try { const r = await api('/api/fridge_t'); FRT = r.t; } catch (e) { /* resta il valore locale */ } syncFridgeInput(); }
function syncFridgeInput() { const i = document.getElementById('j-ft'); if (i && document.activeElement !== i) i.value = fridgeT(); }
const rateAt = (t, q = 2.2) => Math.pow(q, (t - 20) / 10);   /* 1 giorno a t C = rateAt giorni a 20 C */
/* budget di croccantezza: giorni equivalenti a 20 C in totale (fuori + frigo); impara dalle osservazioni */
function crispBudget(r) {
  const c = crispInfo(r); if (!c) return null;
  const mine = OBS.filter(o => o.veg === c.key && o.warm_days != null).slice(0, 5);
  const tOf = o => { const m = /T=(-?[\d.]+)/.exec(o.note || ''); return m ? +m[1] : 4; };
  if (mine.length) return { c: mine.reduce((a, o) => a + o.warm_days + o.fridge_days * rateAt(tOf(o)), 0) / mine.length, n: mine.length, key: c.key };
  return { c: c.d, n: 0, key: c.key };
}
/* giorni di frigo (alla temperatura frigo) in cui resta croccante, se ci entra con e giorni equivalenti a 20 C gia' fatti */
function fridgeDays(r, e) {
  const b = crispBudget(r); if (!b) return null;
  const e0 = e != null ? e : (r.min_time_days != null ? rBase(r) : b.c * 0.7);
  return { d: Math.max(0, Math.round((b.c - e0) / rateAt(fridgeT()))), n: b.n, key: b.key, budget: b.c };
}
const crispAt = r => { const c = crisp20(r); return c == null ? null : Math.round(adjDays(c, r.target_temp_c, r.q10) * 10) / 10; };

/* ---------- stagioni ---------- */
const SEAS_EXTRA = [['limon', [11, 12, 1, 2, 3, 4]], ['aranc', [11, 12, 1, 2, 3, 4]], ['pompelm', [11, 12, 1, 2, 3]], ['peperoncin', [7, 8, 9, 10]], ['jalape', [7, 8, 9, 10]], ['habanero', [7, 8, 9, 10]], ['fresno', [7, 8, 9, 10]], ['serrano', [7, 8, 9, 10]], ['cayenna', [7, 8, 9, 10]], ['scotch', [7, 8, 9, 10]],
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
    renderSeasonPanel(); updateWantCount();
    toast(r.want ? 'Segnata da provare' : 'Tolta da "da provare"');
  } catch (e) { toast(e.message, true); }
}

/* ---------- etichette: dimensioni a scelta, piu' vasi su un solo foglio ---------- */
const LBL_KEY = 'fermentati.label.v1';
const PAPER = { A4: [21, 29.7], Letter: [21.59, 27.94] };
function lblLoad() {
  const d = { w: 6, h: 4, margin: 1, gap: 0.2, paper: 'A4', skip: 0 };
  try { Object.assign(d, JSON.parse(localStorage.getItem(LBL_KEY) || '{}')); } catch (e) { /* senza memoria locale va bene lo stesso */ }
  d.skip = 0; return d;
}
function lblSave(s) { try { localStorage.setItem(LBL_KEY, JSON.stringify(s)); } catch (e) { /* ignora */ } }
function lblGrid(s) {
  const [pw, ph] = PAPER[s.paper] || PAPER.A4, m = s.margin, g = s.gap;
  const cols = Math.floor((pw - 2 * m + g + 1e-9) / (s.w + g)), rows = Math.floor((ph - 2 * m + g + 1e-9) / (s.h + g));
  return { cols: Math.max(0, cols), rows: Math.max(0, rows), pw, ph };
}
function pseudoRecipe(j) {
  const rr = j.recipe_id && RBY.get(j.recipe_id);
  if (rr) return rr;
  const names = String(j.name || '').split(/[,;+]| e /).map(x => x.trim()).filter(Boolean);
  return { kind: '', items: names.map(n => ({ type: 'vegetable', name: n, g: 0 })), target_temp_c: j.temp_c, q10: j.q10 || 2.2 };
}
function labelFromJar(j) {
  const pr = pseudoRecipe(j), kb = isKombu(j), r = j.ready || {};
  const den = j.method === 'salamoia' ? j.water_g : j.net_g;
  const pct = !kb && j.salt_g > 0 && den > 0 ? j.salt_g / den * 100 : null;
  let ready = r.date_ready || null, cr = null, fr = null;
  const b = kb ? null : crispBudget(pr);
  if (b && r.e != null) {
    if (j.status === 'attivo') {
      const rate = rateAt(r.temp_now && r.temp_now.t != null ? r.temp_now.t : j.temp_c, j.q10 || Q10);
      cr = addDays(isoToday(), Math.max(0, (b.c - r.e) / rate));
      if (ready && cr < ready) cr = ready;
      fr = addDays(ready || isoToday(), fridgeDays(pr, r.ready_at != null ? r.ready_at : r.e).d);   /* spostato in frigo quando e' pronto */
    } else if (j.status === 'frigo') {
      fr = addDays(j.fridge_date || isoToday(), fridgeDays(pr, r.e).d);
    }
  }
  return { name: j.name, veg: pr.items.map(i => i.name).join(', '), start: (j.start_date || '').slice(0, 10), pct, method: j.method, ready, cr, fr, kb };
}
function labelFromRecipe(r) {
  const t = isoToday(), c = crispAt(r), ready = addDays(t, rMin(r)), f = fridgeDays(r);
  return { name: cleanName(r.name).replace(/ \(stile .*\)$/, ''), veg: r.items.filter(i => i.type === 'vegetable').map(i => i.name).join(', '), start: t, pct: rPct(r), method: r.method,
    ready: r.kind === 'scorta' ? null : ready, cr: c == null ? null : addDays(t, Math.max(c, rMin(r))), fr: c == null || !f ? null : addDays(t, rMin(r) + f.d), scorta: r.kind === 'scorta' ? addDays(t, r.shelf_days || 180) : null };
}
function labelHTML(L, w, h) {
  const u = Math.min(w / 6, h / 4), fs = (k) => (k * u).toFixed(2) + 'mm';
  const row = (a, b, cls = '') => `<div class="${cls}" style="font-size:${fs(2.5)}"><span>${a}</span><b>${b}</b></div>`;
  const rows = [row('Fatto il', dIT(L.start))];
  if (L.pct != null) rows.push(row('Sale', fp(Math.round(L.pct * 10) / 10) + '% ' + (L.method === 'secco' ? 'sulle verdure' : "sull'acqua")));
  if (L.scorta) rows.push(row('Da consumare entro', dIT(L.scorta)));
  if (L.ready) rows.push(row(L.kb ? 'Pronto da' : 'Assaggia/pronto da', dIT(L.ready)));
  if (L.cr) rows.push(row('In frigo entro (croccante)', dIT(L.cr), 'warn'));
  if (L.fr) rows.push(row('Consuma entro (croccante)', dIT(L.fr)));
  return `<div class="lbl" style="width:${w}cm;height:${h}cm;padding:${(1.2 * u).toFixed(2)}mm ${(1.6 * u).toFixed(2)}mm"><h3 style="font-size:${fs(3.6)}">${esc(L.name)}</h3>${h >= 3 && L.veg && L.veg !== L.name ? `<p style="font-size:${fs(2.2)}">${esc(L.veg)}</p>` : ''}${rows.join('')}</div>`;
}
/* le pagine: ogni etichetta e' posizionata in cm, cosi' la stampa e' esatta */
function sheetsHTML(s, labels) {
  const g = lblGrid(s), per = g.cols * g.rows; if (!per) return { html: '', pages: 0, per: 0 };
  const cells = Array(s.skip).fill(null).concat(labels), pages = Math.max(1, Math.ceil(cells.length / per));
  const ox = (g.pw - (g.cols * s.w + (g.cols - 1) * s.gap)) / 2;
  const arr = [];
  for (let p = 0; p < pages; p++) {
    let inner = '';
    cells.slice(p * per, (p + 1) * per).forEach((L, i) => {
      if (!L) return;
      const c = i % g.cols, r = Math.floor(i / g.cols);
      inner += `<div class="lbl-pos" style="left:${(ox + c * (s.w + s.gap)).toFixed(3)}cm;top:${(s.margin + r * (s.h + s.gap)).toFixed(3)}cm">${labelHTML(L, s.w, s.h)}</div>`;
    });
    arr.push(`<div class="sheet-pg" style="width:${g.pw}cm;height:${g.ph}cm">${inner}</div>`);
  }
  return { html: arr.join(''), arr, pages, per };
}
function openLabel(o = {}) {
  const S = lblLoad(), jars = JARS.filter(j => j.status !== 'finito');
  const rows = jars.map(j => ({ key: 'j' + j.id, title: j.name, sub: dIT(j.start_date), on: (o.jars || []).includes(j.id), n: 1, mk: () => labelFromJar(j) }));
  if (o.recipe) rows.unshift({ key: 'r' + o.recipe.id, title: cleanName(o.recipe.name), sub: 'ricetta', on: true, n: 1, mk: () => labelFromRecipe(o.recipe) });
  if (!rows.some(r => r.on) && rows.length) rows[0].on = true;
  const num = (id, v, step, min, max) => `<span class="inp"><input id="${id}" type="number" inputmode="decimal" step="${step}" min="${min}" max="${max}" value="${v}"></span>`;
  $('#dl-body').innerHTML = `<div class="sheet-top"><h2 id="dl-title">Etichette</h2><button class="icon-btn" type="button" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <div class="sheet-scroll"><div class="lbl-wrap">
      <div>
        <h4>Dimensioni etichetta (cm)</h4>
        <div class="lbl-dim"><label>Larghezza ${num('dl-w', S.w, 0.1, 2, 20)}</label><label>Altezza ${num('dl-h', S.h, 0.1, 1.5, 20)}</label></div>
        <div class="lbl-dim"><label>Margine foglio ${num('dl-m', S.margin, 0.1, 0, 3)}</label><label>Spazio tra etichette ${num('dl-g', S.gap, 0.1, 0, 2)}</label></div>
        <div class="lbl-dim"><label>Foglio <select id="dl-p"><option>A4</option><option>Letter</option></select></label><label>Salta le prime ${num('dl-s', 0, 1, 0, 200)}<small>gia' usate</small></label></div>
        <p class="lbl-fit" id="dl-fit"></p>
        <h4>Quali etichette</h4>
        <ul class="lbl-list">${rows.map((r, i) => `<li><label><input type="checkbox" data-i="${i}"${r.on ? ' checked' : ''}> <b>${esc(r.title)}</b> <small>${esc(r.sub)}</small></label><span class="inp"><input type="number" min="1" max="60" value="1" data-n="${i}" aria-label="Copie"></span></li>`).join('') || '<li><small>Nessun vaso attivo.</small></li>'}</ul>
        <p class="lbl-fit" id="dl-tot"></p>
        <p class="hint">Metti un foglio di etichette adesive. In stampa scegli "Scala 100%" (non "Adatta alla pagina") e nessun margine; per avere un file scegli "Salva come PDF".</p>
        <div class="actions"><button class="btn primary" type="button" id="dl-print">${icon('check')}Stampa / salva PDF</button></div>
      </div>
      <div><h4>Anteprima primo foglio</h4><div class="lbl-prev" id="dl-prev"></div></div>
    </div></div>`;
  $('#dl-p').value = S.paper;
  const d = $('#dlg-l'); if (!d.open) d.showModal();
  const read = () => {
    const f = (id, def) => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : def; };
    return { w: clamp(f('#dl-w', 6), 2, 20), h: clamp(f('#dl-h', 4), 1.5, 20), margin: clamp(f('#dl-m', 1), 0, 3), gap: clamp(f('#dl-g', 0.2), 0, 2), paper: $('#dl-p').value, skip: Math.max(0, parseInt($('#dl-s').value, 10) || 0) };
  };
  const labels = () => { const out = []; rows.forEach((r, i) => { if (!$(`[data-i="${i}"]`).checked) return; const n = clamp(parseInt($(`[data-n="${i}"]`).value, 10) || 1, 1, 60), L = r.mk(); for (let k = 0; k < n; k++) out.push(L); }); return out; };
  const redraw = () => {
    const s = read(), g = lblGrid(s), ls = labels(), sh = sheetsHTML(s, ls);
    $('#dl-fit').innerHTML = g.cols ? `Entrano <b>${g.cols} × ${g.rows} = ${g.cols * g.rows} etichette</b> per foglio ${s.paper}.` : '<b style="color:var(--amber)">Troppo grande per il foglio: riduci le dimensioni o il margine.</b>';
    $('#dl-tot').innerHTML = g.cols ? `Totale <b>${ls.length}</b> etichette = <b>${sh.pages} ${sh.pages === 1 ? 'foglio' : 'fogli'}</b>${s.skip ? ` (saltate ${s.skip})` : ''}.` : '';
    const pv = $('#dl-prev'), first = sh.arr ? sh.arr[0] : '';
    const wcm = g.pw, scale = Math.min(1, (pv.clientWidth || 300) / (wcm * 37.8));
    pv.innerHTML = first ? `<div class="pg-box" style="width:${wcm * 37.8 * scale}px;height:${g.ph * 37.8 * scale}px"><div style="transform:scale(${scale});transform-origin:0 0;width:${wcm}cm">${first}</div></div>` : '';
    return { s, sh };
  };
  d.querySelector('.lbl-wrap').addEventListener('input', redraw);
  d.querySelector('.lbl-wrap').addEventListener('change', redraw);
  redraw();
  $('#dl-print').addEventListener('click', () => {
    const { s, sh } = redraw(); if (!sh.pages || !sh.html) { toast('Dimensioni non valide', true); return; }
    lblSave(s);
    let st = $('#print-page-style'); if (!st) { st = document.createElement('style'); st.id = 'print-page-style'; document.head.appendChild(st); }
    const g = lblGrid(s); st.textContent = `@media print{@page{size:${g.pw}cm ${g.ph}cm;margin:0}}`;
    let pa = $('#print-area'); if (!pa) { pa = document.createElement('div'); pa.id = 'print-area'; document.body.appendChild(pa); }
    pa.innerHTML = sh.html; window.print();
  });
}
/* riquadro nel dettaglio del vaso: due temperature (ambiente + frigo), osservazioni, etichetta */
function jarLabelBox(j, r) {
  const lb = `<button class="btn ghost" type="button" data-jlabel="${j.id}">${icon('book')}Etichetta</button>`;
  const pr = pseudoRecipe(j), ci = isKombu(j) ? null : crispInfo(pr);
  if (!ci) return `<div class="box">${lb}</div>`;
  const T = fridgeT(), rf = rateAt(T), b = crispBudget(pr), src = b.n ? `media di ${b.n} tuoi vasi` : 'stima';
  const ftIn = `<label class="ftrow">Temperatura frigo <span class="inp"><input id="dd-ft" type="number" inputmode="decimal" step="0.5" min="-2" max="12" value="${T}"><i>°C</i></span></label>`;
  let txt = '', form = '';
  if (j.status === 'attivo') {
    const rate = rateAt(r.temp_now && r.temp_now.t != null ? r.temp_now.t : 20, j.q10 || Q10), left = (b.c - r.e) / rate;
    const f = fridgeDays(pr, r.ready_at != null ? r.ready_at : r.e);
    txt = `<b>${left > 0 ? 'Frigo entro ' + dIT(addDays(isoToday(), left)) + ' (' + nf(left, 1) + ' gg)' : 'Oltre il tempo croccante: in frigo subito'}</b>.<br>Se lo sposti in frigo quando è pronto (${T} °C) resta croccante ancora ~<b>${f.d} gg</b> (${src}).`;
  } else if (j.status === 'frigo') {
    const fd = j.fridge_date || j.start_date, inF = Math.max(0, daysBetween(fd, isoToday())), eTot = r.e + inF * rf, f = fridgeDays(pr, r.e);
    const fin = eTot >= r.ready_at ? 'già completa' : 'completa tra ~' + Math.ceil((r.ready_at - eTot) / rf) + ' gg';
    txt = `Spostato in frigo il <b>${dIT(fd)}</b> (dopo ${nf(r.e, 1)} gg equivalenti a 20 °C): da allora <b>${inF} gg a ${T} °C</b> = ${nf(inF * rf, 1)} gg equivalenti.<br>Fermentazione ${fin}. Croccante fino a ~<b>${dIT(addDays(fd, f.d))}</b> (${src}).`;
    form = `<div class="mrow" style="margin-top:10px"><span class="inp"><input id="dd-cf" type="number" inputmode="decimal" min="0" max="365" step="1" placeholder="${inF}"><i>gg in frigo</i></span><button class="btn ghost" type="button" data-crisp-save="${j.id}">${icon('check')}Ha ceduto qui</button></div><p class="hint">Quando inizia ad ammorbidirsi, scrivi quanti giorni sono passati in frigo: la stima per ${esc(ci.key)} si corregge.</p>`;
  }
  const mine = OBS.filter(o => o.jar_id === j.id);
  return `<div class="box"><h4>Croccantezza · ambiente + frigo</h4><p class="hint">${txt}</p>${ftIn}${mine.length ? `<p class="hint">Annotato: ${mine.map(o => o.fridge_days + ' gg').join(', ')}</p>` : ''}${form}<div style="margin-top:8px">${lb}</div></div>`;
}
async function saveCrisp(jid) {
  const j = JARS.find(x => x.id === jid); if (!j || !j.ready) return;
  const pr = pseudoRecipe(j), ci = crispInfo(pr), v = parseFloat(String($('#dd-cf').value).replace(',', '.'));
  const days = isFinite(v) ? v : Math.max(0, daysBetween(j.fridge_date || j.start_date, isoToday()));
  try {
    await api('/api/crisp', { method: 'POST', body: { jar_id: jid, veg: ci.key, warm_days: j.ready.e, fridge_days: days, note: 'T=' + fridgeT() } });
    await loadObs(); toast(`Annotato: ${ci.key}, ${days} gg a ${fridgeT()} °C`); openDetail(jid);
  } catch (e) { toast(e.message, true); }
}

/* ---------- consigli: per restare croccanti ---------- */
function crispTips(r) {
  const names = r.items.filter(i => i.type === 'vegetable').map(i => i.name.toLowerCase()), has = (...k) => names.some(n => k.some(x => n.includes(x)));
  const t = [];
  if (r.kind === 'scorta' || NOMAIN.includes(r.kind)) return t;
  if (has('cetriol', 'zucchin')) t.push('Taglia via l\'estremita\' del fiore: contiene enzimi che ammorbidiscono. Sono tra le verdure che cedono prima.');
  if (has('cetriol', 'zucchin', 'peperon', 'fagiolin', 'melanzan', 'pomodor')) t.push('Verdura che cede presto: metti in frigo appena e\' acida al punto giusto, senza aspettare.');
  if (r.method === 'secco') t.push('A secco e grattugiato/affettato sottile resta morbido per natura. Per piu\' croccantezza tieni pezzi piu\' grossi o passa alla salamoia al 3-5%.');
  else t.push('Salamoia al 3-5% sul peso dell\'acqua e verdure completamente sommerse (peso o foglia sopra): l\'aria e i lieviti le ammorbidiscono.');
  t.push('Tannini nel barattolo: una foglia di vite, ciliegio, quercia o rafano, oppure un cucchiaino di te\' nero in foglie.');
  if (r.method === 'salamoia') t.push('Cloruro di calcio alimentare ("pickle crisp"): circa 1 g per litro di salamoia, seguendo il dosaggio della confezione.');
  t.push('Fermenta piu\' fresco (15-18 °C se puoi): piu\' lento e piu\' soda. Poi frigo a 2-4 °C.');
  t.push('Sale marino integrale: le tracce di calcio e magnesio rinforzano le pectine. Per i cetrioli aggiungi foglie di vite, quercia, ciliegio o rafano (o una bustina di te\'), usa cetrioli di dimensioni simili e mettili in acqua fredda prima.');
  t.push('Usa verdura fresca, fredda e appena raccolta; taglio grosso invece di fettine.');
  return t;
}

/* ---------- pannello stagione ---------- */
let SEASON_MO = new Date().getMonth() + 1;
function renderSeasonPanel() {
  const el = $('#r-season'); if (!el) return;
  const mo = SEASON_MO, vegs = [...new Set(DATA.recipes.flatMap(r => r.items.filter(i => i.type === 'vegetable').map(i => i.name)))];
  const inS = vegs.filter(n => (vegMonths(n) || []).includes(mo)).sort((a, b) => a.localeCompare(b, 'it'));
  const rec = DATA.recipes.filter(r => r.kind !== 'scorta' && !NOMAIN.includes(r.kind) && recipeInSeason(r, mo)).sort((a, b) => (b.want || 0) - (a.want || 0) || (b.rating || 0) - (a.rating || 0) || a.id - b.id).slice(0, 8);
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
  initSections();
  updateWantCount();
  ['#r-chips', '#r-reset'].forEach(s => $(s).addEventListener('click', () => setTimeout(updateWantCount, 0)));
  $('#r-wantbtn').addEventListener('click', () => {
    const n = DATA.recipes.filter(r => r.want).length;
    if (!n) { toast('Nessuna ricetta segnata: tocca il cuore su una ricetta'); return; }
    F.q = ''; F.m = F.s = F.kind = null; F.veg = ''; F.want = F.want ? null : '1';
    $('#r-q').value = ''; $('#r-veg').value = ''; renderChips(); renderRecipes(); updateWantCount();
    (F.want ? $('#r-grid') : $('#r-hero')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const lb = $('#j-labels'); if (lb) lb.addEventListener('click', () => openLabel({}));
  $('#dlg-d').addEventListener('click', e => { const b = e.target.closest('[data-crisp-save]'); if (b) saveCrisp(+b.dataset.crispSave); });
  $('#dlg-d').addEventListener('change', e => { if (e.target.id !== 'dd-ft') return; const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v)) { setFridgeT(clamp(v, -2, 12)); if (typeof DD === 'number') openDetail(DD); } });
  const ft = $('#j-ft'); if (ft) ft.addEventListener('change', () => { const v = parseFloat(String(ft.value).replace(',', '.')); if (isFinite(v)) { setFridgeT(clamp(v, -2, 12)); toast('Temperatura frigo: ' + fridgeT() + ' °C'); } else syncFridgeInput(); });
  loadFridgeT();
  loadObs().then(() => { renderRecipes(); renderSeasonPanel(); });
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

function updateWantCount() {
  const n = DATA.recipes.filter(r => r.want).length, b = $('#r-wantbtn'); if (!b) return;
  $('#r-wantn').textContent = n; b.classList.toggle('on', !!F.want); b.classList.toggle('has', n > 0);
}


/* ---------- sezioni Bevande e Salse ---------- */
const isSalsa = r => r.kind === 'salsa' || /\b(salsa|sriracha|harissa|ketchup)\b/i.test(r.name);
const isBevanda = r => r.kind === 'bevanda';
const isJiang = r => r.kind === 'jiang';
const isKind = k => r => r.kind === k;
const CATS = [['ricette', 'Tutte'], ['bevande', 'Bevande'], ['salse', 'Salse'], ['jiang', 'Jiàng 酱'], ['latticini', 'Latticini'], ['cereali', 'Cereali'], ['alcolici', 'Idromele e alcolici']];
const NEWSEC = {
  latticini: ['Latticini', 'fermentati', 'Latte fermentato: yogurt, kefir, burro e formaggi freschi. Usa latte fresco di qualità, pastorizzato o di fonte sicura, utensili puliti e rispetta le temperature: il latte crudo comporta rischi. Quantità in grammi.', 'Cerca: yogurt, kefir, burro…'],
  cereali: ['Cereali', 'e tuberi', 'Cereali fermentati: pane, porridge, pancake, bevande e impasti. Le fermentazioni sono spesso brevi (12-48 ore) e a temperatura ambiente. Quantità in grammi.', 'Cerca: lievito madre, porridge, idli…'],
  alcolici: ['Idromele e', 'alcolici', 'Idromele, sidro, vino e bevande di riso: fermentazioni alcoliche per uso personale. Non chiudere mai ermeticamente un recipiente in fermentazione (usa il gorgogliatore), pulisci bene tutto. La vendita è vietata e la distillazione casalinga è illegale in Italia: qui non ci sono ricette di distillati. Quantità in grammi.', 'Cerca: idromele, sidro, makgeolli…']
};
function buildSections() {
  const main = $('#main');
  for (const [v, [t1, t2, intro, ph]] of Object.entries(NEWSEC)) {
    if ($('#v-' + v)) continue;
    const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'v-' + v; sec.setAttribute('aria-labelledby', 't-' + v);
    sec.innerHTML = `<div class="catbar" data-catbar></div><div class="vhead"><p class="eyebrow">Ricettario</p><h1 id="t-${v}">${t1} <em>${t2}</em></h1></div>
      <p class="how"><svg><use href="#i-info"/></svg><span>${esc(intro)}</span></p>
      <div class="filters panel"><label class="search"><svg><use href="#i-search"/></svg><input id="${v}-q" type="search" placeholder="${esc(ph)}" aria-label="Cerca"></label><span class="count" id="${v}-count"></span></div>
      <div class="grid" id="${v}-grid"></div>`;
    main.appendChild(sec);
  }
  $$('[data-catbar]').forEach(b => { b.innerHTML = CATS.map(([v, t]) => `<a class="chip" href="#${v}" data-v="${v}">${t}</a>`).join(''); });
  const cur = (location.hash || '').slice(1); if (cur) go(cur);
}
function renderSection(gridId, countId, qId, pred) {
  const q = norm($(qId).value || ''), all = DATA.recipes.filter(pred);
  const L = all.filter(r => !q || norm(r.name + ' ' + r.items.map(i => i.name).join(' ')).includes(q)).sort((a, b) => (b.want || 0) - (a.want || 0) || (b.rating || 0) - (a.rating || 0) || a.id - b.id);
  $(countId).textContent = `${L.length} / ${all.length}`;
  $(gridId).innerHTML = L.map(rCard).join('') || '<p class="hint">Nessuna ricetta.</p>';
}
function initSections() {
  buildSections();
  const defs = [['#b-grid', '#b-count', '#b-q', isBevanda, 'bevande'], ['#s-grid', '#s-count', '#s-q', isSalsa, 'salse'], ['#j-grid2', '#j-count2', '#j-q2', isJiang, 'jiang'], ...['latticini', 'cereali', 'alcolici'].map(v => ['#' + v + '-grid', '#' + v + '-count', '#' + v + '-q', isKind(v), v])];
  for (const [g, c, q, pred, view] of defs) {
    const draw = () => renderSection(g, c, q, pred);
    draw();
    let t; $(q).addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 120); });
    $(g).addEventListener('click', e => {
      const w = e.target.closest('[data-want]'); if (w) { e.stopPropagation(); toggleWant(+w.dataset.want).then(draw); return; }
      const card = e.target.closest('.rcard'); if (card) openRecipe(+card.dataset.id);
    }, true);
    onView[view] = draw;
  }
}
