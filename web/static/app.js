/* Fermentati — logica della webapp (JS vanilla, nessuna dipendenza esterna).
   Regole e formule riprese da FermentaPro.py e GUIDA.md:
   - a secco: sale = peso verdure netto x % ; salamoia: sale = peso acqua x %
   - tempo minimo (Q10): T(t) = T20 * Q10^((20 - t)/10), Q10 = 2.2
   - adatta al vaso: verdure = (vaso - spazio in cima) x riempimento; acqua = vaso x (1 - riempimento) - spazio */
'use strict';

/* ---------- utilita' ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, d = 0) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const fp = p => nf(p, Math.abs(p * 10 - Math.round(p * 10)) > 1e-6 ? 2 : 1);
const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : NaN; };
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoToday = () => isoOf(new Date());
const dIT = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}-${m}-${y.slice(2)}`; };
const addDays = (iso, n) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + Math.round(n)); return isoOf(d); };
const daysBetween = (a, b) => Math.round((new Date(b.slice(0, 10) + 'T12:00:00') - new Date(a.slice(0, 10) + 'T12:00:00')) / 864e5);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const icon = (n, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const Q10 = 2.2;
const adjDays = (base, t, q = Q10) => Math.max(0.1, base * Math.pow(q || Q10, (20 - t) / 10));
const base20 = (min, t, q = Q10) => min / Math.pow(q || Q10, (20 - t) / 10);
const LS = {
  get(k, d) { try { const v = localStorage.getItem('ferm.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ferm.' + k, JSON.stringify(v)); } catch (e) { /* niente */ } }
};
async function api(path, opt = {}) {
  const r = await fetch(path, { method: opt.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('errore ' + r.status));
  return j;
}
let tT;
function toast(msg, err) {
  const t = $('#toast'); t.innerHTML = (err ? '' : icon('check', '')) + esc(msg);
  const s = t.querySelector('svg'); if (s) { s.style.width = '18px'; s.style.height = '18px'; }
  t.classList.toggle('err', !!err); t.classList.add('on');
  clearTimeout(tT); tT = setTimeout(() => t.classList.remove('on'), 2300);
}
function rng(seed) { let a = (seed * 2654435761) >>> 0 || 7; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function countTo(el, to, dec = 0) {
  const from = parseFloat(el.dataset.v || '0'); el.dataset.v = to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(to - from) < 0.01) { el.textContent = nf(to, dec); return; }
  const t0 = performance.now(), dur = 520;
  const step = now => { const k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = nf(from + (to - from) * e, dec); if (k < 1 && el.dataset.v == to) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ---------- colori delle verdure ---------- */
const VEG_C = { 'Cavolo cappuccio': '#c5e17a', 'Cavolo verza': '#93c95a', 'Cavolfiore': '#efe4c2', 'Carota': '#ff8a2b', 'Cetriolo': '#4fae4a', 'Zucchina': '#6cbf4f', 'Peperone': '#e5402f', 'Barbabietola': '#b0124f', 'Ravanello': '#ec4f86', 'Cipolla': '#e8cfa6', 'Aglio': '#f2ead6', 'Fagiolino': '#55b54a', 'Melanzana': '#6a2f7e', 'Finocchio': '#dcefb4', 'Porro': '#b4d886', 'Broccolo': '#3c8f3a', 'Pomodoro verde': '#9ccc48', 'Asparago': '#86b043', 'Sedano': '#a7d36b', 'Cavolo rapa': '#cfe6a6', 'Daikon': '#f1eee2', 'Pak choi': '#7cc960', 'Erba cipollina': '#559f3f', 'Cavolini di Bruxelles': '#76a83f', 'Mais (chicchi)': '#f5c632', 'Bietola costa': '#d23a4b', 'Erbette': '#6dbf5d', 'Spinaci': '#2f8a3c', 'Mela': '#eac45c', 'Olive': '#6b7a35', 'Pane di segale': '#8f5a2c', 'Ananas': '#f7d24a', 'Zenzero': '#e3b770', 'Rapa': '#dcb6e6', 'Sedano rapa': '#ecdcb0', 'Cavolo nero': '#3f5f3c', 'Cavolo rosso': '#7b3fa0', 'Navone': '#e6cfe0', 'Pastinaca': '#efe2bd', 'Pera': '#d8d070', 'Scalogno': '#c98f86' };
const SP_C = { 'Pepe nero': '#2a2420', 'Pepe rosa': '#e0607e', 'Coriandolo': '#c9a46a', 'Semi di coriandolo': '#c9a46a', 'Cumino': '#8b6b3d', 'Semi di cumino': '#8b6b3d', 'Aneto': '#6f9a2a', 'Alloro': '#4f6b2a', 'Ginepro': '#3d3f6e', 'Peperoncino': '#e0302a', 'Peperoncino affumicato': '#9c2a1c', 'Zenzero': '#e3b770', 'Curcuma': '#f2a900', 'Semi di senape': '#d8b44a', 'Aglio secco': '#efe5cc', 'Origano (secco)': '#5d6b2f', 'Cannella': '#9a5a2a', 'Chiodi di garofano': '#4a2c1c', 'Basilico': '#3f9a3a', 'Limone': '#f5e04a', 'Zucchero': '#f5f2ea', 'Sale': '#f5f5f5', 'Pane di segale': '#8f5a2c' };
const FALLBACK = ['#9ccc65', '#ffb74d', '#f06292', '#ba68c8', '#4db6ac', '#e57373'];
const hashI = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const vegColor = n => VEG_C[n] || FALLBACK[hashI(n) % FALLBACK.length];
const spColor = n => SP_C[n] || '#8a7a5a';
const toRgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
const toHex = a => '#' + a.map(x => pad(Math.round(x).toString(16)).slice(-2)).join('');
function mix(list) { let t = 0, a = [0, 0, 0]; for (const { c, f } of list) { const v = toRgb(c); a = a.map((x, i) => x + v[i] * f); t += f; } return t ? a.map(x => x / t) : [139, 227, 107]; }
const rgba = (a, al) => `rgba(${a.map(Math.round).join(',')},${al})`;
const SWATCHES = [['Cavolo', '#b9dc6e'], ['Carota', '#ff8a2b'], ['Rapa rossa', '#b0124f'], ['Cavolo rosso', '#7b3fa0'], ['Curcuma', '#f2b01e'], ['Cetriolo', '#4fae4a'], ['Rapa bianca', '#dcb6e6'], ['Peperoncino', '#e0302a']];

function recipeLook(r) {
  const v = (r.items || []).filter(i => i.type === 'vegetable' && i.g > 0);
  const tot = v.reduce((s, i) => s + i.g, 0) || 1;
  const layers = v.map(i => ({ c: vegColor(i.name), f: i.g / tot }));
  if (!layers.length) layers.push({ c: '#9ccc65', f: 1 });
  const m = mix(layers);
  const brine = r.method === 'salamoia' ? mix([{ c: toHex(m), f: .5 }, { c: '#f3d27a', f: .5 }]) : m;
  return { layers, mode: r.method, liquid: rgba(brine, r.method === 'salamoia' ? .42 : .5), tint: rgba(m, .2), spices: (r.items || []).filter(i => i.type === 'spice').map(i => spColor(i.name)) };
}
function colorLook(c, mode) {
  const lite = toHex(mix([{ c, f: .7 }, { c: '#ffffff', f: .3 }]));
  const layers = [{ c, f: .55 }, { c: lite, f: .45 }];
  const m = toRgb(c);
  const brine = mode === 'salamoia' ? mix([{ c, f: .5 }, { c: '#f3d27a', f: .5 }]) : m;
  return { layers, mode, liquid: rgba(brine, mode === 'salamoia' ? .42 : .5), tint: rgba(m, .2), spices: [] };
}

/* ---------- il vaso SVG ---------- */
const JAR_P = 'M34 22h52v6c0 4 4 6 10 8c8 3 10 8 10 16v86c0 10-6 16-16 16H30c-10 0-16-6-16-16V52c0-8 2-13 10-16c6-2 10-4 10-8z';
let JN = 0;
function jarSVG(o = {}) {
  const id = 'jr' + (++JN), R = rng(o.seed || 7);
  const fill = clamp(o.fill ?? .82, 0, 1), mode = o.mode || 'secco';
  const BOT = 154, U = 118, lvl = BOT - fill * U;
  const layers = o.layers && o.layers.length ? o.layers : [{ c: '#9ccc65', f: 1 }];
  const liquid = o.liquid || 'rgba(200,220,150,.4)';
  const nb = o.bubbles ?? 6;
  let c = '';
  if (fill > 0.01) {
    c += `<rect x="0" y="${lvl}" width="120" height="${BOT + 140 - lvl}" fill="${liquid}"/>`;
    if (mode === 'kombucha') {
      c += `<path d="M6 ${BOT - 4}q26 -5 54 -1t54 0V${BOT + 140}H6z" fill="#6e3f12" opacity=".6"/>`;
      for (let k = 0; k < 7; k++) {
        const x = 24 + R() * 72, len = 14 + R() * 34;
        c += `<path class="strand" style="animation-delay:${(-R() * 6).toFixed(2)}s" d="M${x.toFixed(1)} ${(lvl + 8).toFixed(1)}q${(R() * 8 - 4).toFixed(1)} ${(len / 2).toFixed(1)} ${(R() * 5 - 2.5).toFixed(1)} ${len.toFixed(1)}" stroke="#5e3410" stroke-opacity=".6" stroke-width="${(1 + R() * 1.5).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
      }
    } else if (mode === 'secco') {
      const vt = lvl + 4.5, hv = BOT - 2 - vt;
      let acc = 0; const tops = layers.map(L => { acc += L.f; return BOT - 2 - hv * acc; });
      for (let i = layers.length - 1; i >= 0; i--) {
        const yt = tops[i], a = i === layers.length - 1 ? 1.4 : 2.6, ph = R() * 10;
        c += `<path d="M-4 ${BOT + 140}V${(yt).toFixed(1)}Q${(12 + ph).toFixed(1)} ${(yt - a).toFixed(1)} ${(28 + ph).toFixed(1)} ${yt.toFixed(1)}T${(60 + ph).toFixed(1)} ${yt.toFixed(1)}T${(92 + ph).toFixed(1)} ${yt.toFixed(1)}T${(124 + ph).toFixed(1)} ${yt.toFixed(1)}V${BOT + 140}z" fill="${layers[i].c}"/>`;
      }
      c += `<rect x="0" y="${vt}" width="120" height="${hv + 140}" fill="url(#${id}p)"/>`;
      if (o.spices && o.spices.length) for (const sc of o.spices) for (let k = 0; k < 4; k++) c += `<circle cx="${(20 + R() * 80).toFixed(1)}" cy="${(vt + 4 + R() * (hv - 18)).toFixed(1)}" r="${(0.9 + R() * .8).toFixed(1)}" fill="${sc}"/>`;
      c += `<rect x="0" y="${lvl}" width="120" height="6" fill="${liquid}"/>`;
    } else {
      const vf = clamp(o.vegFrac ?? .78, .3, .95), vtop = BOT - (BOT - lvl) * vf;
      const n = Math.round(10 + 22 * vf * fill);
      let acc = 0; const cum = layers.map(L => (acc += L.f));
      const chunks = [];
      for (let k = 0; k < n; k++) {
        const pick = R(), li = cum.findIndex(x => pick <= x + 1e-9);
        chunks.push({ x: 20 + R() * 80, y: vtop + 5 + R() * (BOT - vtop - 6), rx: 5.5 + R() * 4, ry: 3.6 + R() * 2.6, a: (R() * 180) | 0, col: layers[li < 0 ? 0 : li].c });
      }
      chunks.sort((p, q) => p.y - q.y);
      for (const k of chunks) c += `<g transform="translate(${k.x.toFixed(1)} ${k.y.toFixed(1)}) rotate(${k.a})"><ellipse rx="${k.rx.toFixed(1)}" ry="${k.ry.toFixed(1)}" fill="${k.col}"/><ellipse rx="${(k.rx * .55).toFixed(1)}" ry="${(k.ry * .5).toFixed(1)}" fill="#fff" opacity=".22"/></g>`;
      if (o.spices && o.spices.length) for (const sc of o.spices) for (let k = 0; k < 3; k++) c += `<circle cx="${(20 + R() * 80).toFixed(1)}" cy="${(lvl + 8 + R() * (BOT - lvl - 12)).toFixed(1)}" r="${(1 + R() * .9).toFixed(1)}" fill="${sc}"/>`;
      c += `<rect x="0" y="${lvl}" width="120" height="${BOT + 140 - lvl}" fill="${liquid}" opacity=".35"/>`;
    }
    if (o.weight) c += `<ellipse cx="60" cy="${lvl + 7}" rx="30" ry="6" fill="#8d8f88"/><ellipse cx="60" cy="${lvl + 5.5}" rx="30" ry="5" fill="#b9bbb3"/><ellipse cx="52" cy="${lvl + 4.5}" rx="10" ry="1.6" fill="#fff" opacity=".35"/>`;
    const w = `M-40 ${lvl.toFixed(1)}q10 -2.4 20 0` + 't20 0'.repeat(9);
    if (mode !== 'kombucha') c += `<g class="wave"><path d="${w}V${(lvl + 5).toFixed(1)}H-40z" fill="#fff" fill-opacity=".13"/><path d="${w}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".8"/></g>`;
    if (mode !== 'kombucha') c += `<g class="wave w2"><path d="M-40 ${(lvl + 1.4).toFixed(1)}q10 1.6 20 0` + 't20 0'.repeat(9) + `" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width=".6"/></g>`;
    for (let k = 0; k < nb; k++) {
      const x = 22 + R() * 76, y0 = BOT - 4 - R() * 26, h = -(y0 - lvl - (mode === 'kombucha' ? 12 : 3));
      if (h > -6) continue;
      c += `<circle class="bub" cx="${x.toFixed(1)}" cy="${y0.toFixed(1)}" r="${(0.9 + R() * 1.8).toFixed(1)}" fill="#fff" fill-opacity=".28" stroke="#fff" stroke-opacity=".75" stroke-width=".45" style="--h:${h.toFixed(0)}px;--d:${(2.4 + R() * 2.8).toFixed(2)}s;--dl:${(R() * 4).toFixed(2)}s;--sx:${((R() - .5) * 8).toFixed(1)}px"/>`;
    }
  }
  if (fill > 0.01 && mode === 'kombucha') {
    let spots = '';
    for (let k = 0; k < 7; k++) spots += `<ellipse cx="${(18 + R() * 84).toFixed(1)}" cy="${(lvl + 3 + R() * 4).toFixed(1)}" rx="${(2 + R() * 5).toFixed(1)}" ry="${(0.8 + R()).toFixed(1)}" fill="#cdb685" opacity=".75"/>`;
    c += `<g class="scoby"><path d="M4 ${(lvl + 1).toFixed(1)}q14 -3.2 28 -.8t28 0t28 -1t28 .8V${(lvl + 10).toFixed(1)}q-14 2.6 -28 .4t-28 .6t-28 -.5t-28 .6z" fill="#ecdfc2"/><path d="M4 ${(lvl + 6).toFixed(1)}q28 2 56 0t56 0" stroke="#cdb98e" stroke-width="1" fill="none"/>${spots}<path d="M4 ${(lvl + 1).toFixed(1)}q14 -3.2 28 -.8t28 0t28 -1t28 .8" stroke="#fff" stroke-opacity=".6" stroke-width=".8" fill="none"/></g>`;
  }
  const start = o.animate ? (BOT - lvl) + 16 : o.startOff != null ? o.startOff : (o.off || 0);
  const lid = o.cold ? ['#eef6ff', '#a9c0d6', '#5d7389'] : ['#ffe7a6', '#d9a03a', '#8a5a14'];
  let ridges = ''; for (let x = 35; x <= 85; x += 4) ridges += `M${x} 10.5v11`;
  let label = '';
  if (o.label) label = `<g transform="rotate(-2.5 60 112)"><rect x="31" y="100" width="58" height="${o.label2 ? 25 : 18}" rx="2" fill="#efe2c4"/><rect x="31" y="100" width="58" height="${o.label2 ? 25 : 18}" rx="2" fill="none" stroke="#b89d6a" stroke-width=".6" stroke-dasharray="2 1.5"/><text x="60" y="${o.label2 ? 111 : 112.5}" text-anchor="middle" font-size="9.5" fill="#3b2a17" class="label-t">${esc(o.label)}</text>${o.label2 ? `<text x="60" y="120" text-anchor="middle" font-size="6" fill="#6b5536" font-family="Segoe UI,system-ui,sans-serif">${esc(o.label2)}</text>` : ''}</g>`;
  return `<svg class="jar${o.burp ? ' burping' : ''}" viewBox="0 -8 120 170" role="img" aria-label="${esc(o.alt || 'Vaso')}"${o.width ? ` style="width:${o.width}px"` : ''}>
<defs><clipPath id="${id}c"><path d="${JAR_P}"/></clipPath>
<linearGradient id="${id}g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".17"/><stop offset=".2" stop-color="#fff" stop-opacity=".03"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset=".87" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity=".15"/></linearGradient>
<linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".28" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".46"/></linearGradient>
<linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lid[0]}"/><stop offset=".5" stop-color="${lid[1]}"/><stop offset="1" stop-color="${lid[2]}"/></linearGradient>
<pattern id="${id}p" width="12" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)"><path d="M1 2.5h6M5 7h6" stroke="#fff" stroke-opacity=".22" stroke-width="1.1" stroke-linecap="round"/><path d="M3 5h4" stroke="#000" stroke-opacity=".18" stroke-width="1.1" stroke-linecap="round"/></pattern></defs>
<ellipse cx="60" cy="157" rx="47" ry="4.5" fill="#000" opacity=".5"/>
<path d="${JAR_P}" fill="rgba(6,12,8,.6)"/>
<g clip-path="url(#${id}c)"><g class="lvl" data-off="${o.off || 0}" style="transform:translateY(${start}px)">${c}</g><rect x="0" y="0" width="120" height="160" fill="url(#${id}s)"/></g>
${o.cold ? `<path class="frost" d="${JAR_P}" fill="rgba(175,215,255,.2)"/><g fill="#fff" opacity=".7"><circle cx="30" cy="70" r=".9"/><circle cx="88" cy="96" r="1.1"/><circle cx="44" cy="134" r=".8"/><circle cx="80" cy="58" r=".7"/></g>` : ''}
<path d="${JAR_P}" fill="url(#${id}g)" stroke="rgba(225,255,240,.4)" stroke-width="1.6"/>
<path d="M21 60V128" stroke="#fff" stroke-opacity=".32" stroke-width="3.2" stroke-linecap="round"/><path d="M27 64v22" stroke="#fff" stroke-opacity=".14" stroke-width="1.6" stroke-linecap="round"/><path d="M99 72v34" stroke="#fff" stroke-opacity=".1" stroke-width="2" stroke-linecap="round"/><path d="M30 35q-7 3-9 11" stroke="#fff" stroke-opacity=".28" stroke-width="1.4" fill="none" stroke-linecap="round"/>
${label}
${o.cloth ? `<g class="lid"><path d="M25 31Q21 15 33 9Q60 1 87 9Q99 15 95 31Q91 27 86 32Q80 28 73 32Q67 28 60 32Q53 28 47 32Q40 28 34 32Q29 27 25 31Z" fill="#efe5cf"/><path d="M33 12Q60 6 87 12M29 18Q60 12 91 18M27 26Q60 20 93 26" stroke="#d6c9a8" stroke-width=".8" fill="none"/><path d="M40 9V30M52 6V30M64 6V30M76 8V30" stroke="#d6c9a8" stroke-width=".6" opacity=".7"/><path d="M30 24Q60 28 90 24" stroke="#c0392b" stroke-width="2.6" fill="none" stroke-linecap="round"/></g>` : `<g class="lid"><rect x="33" y="3" width="54" height="6.5" rx="3" fill="${lid[0]}"/><rect x="31" y="8" width="58" height="15" rx="3.5" fill="url(#${id}l)"/><path d="${ridges}" stroke="#000" stroke-opacity=".16" stroke-width="1"/><path d="M34 11h52" stroke="#fff" stroke-opacity=".4" stroke-width="1"/></g>`}
${o.crystals ? '<g class="crystals"></g>' : ''}
</svg>`;
}
/* porta i contenuti al livello giusto (effetto "si riempie") */
function settle(root = document) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('.jar .lvl[data-off]', root).forEach(g => { g.style.transform = `translateY(${g.dataset.off}px)`; });
    $$('[data-w]', root).forEach(e => { e.style.width = e.dataset.w + '%'; });
    $$('[data-l]', root).forEach(e => { if (e.classList.contains('rdot')) e.style.left = e.dataset.l + '%'; });
  }));
}

/* ---------- stato globale ---------- */
let DATA = { recipes: [], vegetables: [], spices: [] }, JARS = [], RBY = new Map(), DUP = new Set();
const FEATURED = 202;

/* ---------- navigazione ---------- */
const VIEWS = ['sale', 'vasi', 'ricette', 'bevande', 'salse', 'kombucha', 'guida', 'adatta'];
const onView = {};
function go(v) {
  if (!VIEWS.includes(v)) v = 'sale';
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  $$('[data-v]').forEach(a => { const on = a.dataset.v === v; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  window.scrollTo(0, 0);
  if (onView[v]) onView[v]();
}
addEventListener('hashchange', () => go(location.hash.slice(1)));

/* ======================================================
   1. CALCOLATORE DEL SALE
   ====================================================== */
const CFG = {
  secco: { min: 1, max: 3.5, step: .05, lo: 1.5, hi: 2.5, def: 2, quick: [1.5, 2, 2.5], L: 'Vaso + verdure', T: 'Vaso vuoto', N: 'Verdure nette' },
  salamoia: { min: 2, max: 7, step: .1, lo: 3, hi: 5, def: 3, quick: [3, 4, 5], L: 'Contenitore + acqua', T: 'Contenitore vuoto', N: 'Acqua netta' }
};
const ZTXT = { low: 'poco', ok: 'giusto', high: 'alto' };
const ZCOL = { low: '#f5b544', ok: '#8be36b', high: '#ff5c7a' };
const zoneOf = (p, c) => { p = Math.round(p * 100) / 100; return p < c.lo ? 'low' : p > c.hi ? 'high' : 'ok'; };
let C = Object.assign({ m: 'secco', lordo: '', tara: '', pct: { secco: 2, salamoia: 3 }, real: '' }, LS.get('calc', {}));
let calcJarKey = '', calcFill = -1, lastSalt = 0, sprinkleT;

function calcSetMethod(m, first) {
  C.m = m; const c = CFG[m];
  $$('#c-method button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.m === m)));
  $('#c-method').classList.toggle('right', m === 'salamoia');
  $('#l-lordo').textContent = c.L; $('#l-tara').textContent = c.T; $('#l-netto').textContent = c.N;
  const s = $('#c-pct'); s.min = c.min; s.max = c.max; s.step = c.step; s.value = C.pct[m];
  const pos = p => ((p - c.min) / (c.max - c.min) * 100).toFixed(2) + '%';
  $('#c-track').style.background = `linear-gradient(90deg, rgba(245,181,68,.55) 0, #f5b544 calc(${pos(c.lo)} - 1px), #8be36b calc(${pos(c.lo)} + 1px), #6fd35a ${pos((c.lo + c.hi) / 2)}, #8be36b calc(${pos(c.hi)} - 1px), #ff5c7a calc(${pos(c.hi)} + 1px), rgba(255,92,122,.6) 100%)`;
  const tk = m === 'secco'
    ? [[1.5, 'dolce'], [2, 'standard'], [2.5, 'più sicuro']]
    : [[3, 'leggera'], [4, ''], [5, 'lunga']];
  $('#c-ticks').innerHTML = tk.map(([p, l]) => `<span style="left:${pos(p)}">${fp(p)}%${l ? `<small>${l}</small>` : ''}</span>`).join('');
  $('#c-quick').innerHTML = c.quick.map(p => `<button type="button" data-p="${p}">${fp(p)} %</button>`).join('');
  $('#c-gauge').innerHTML = gaugeSVG(c);
  calcJarKey = '';
  if (!first) calcRender(true);
}
function gaugeSVG(c) {
  const a = p => Math.PI * (1 - (p - c.min) / (c.max - c.min));
  const pt = (p, r) => [100 + r * Math.cos(a(p)), 100 - r * Math.sin(a(p))].map(v => v.toFixed(2));
  const arc = (p1, p2, col, w = 14, op = 1) => { const [x1, y1] = pt(p1, 78), [x2, y2] = pt(p2, 78); return `<path d="M${x1} ${y1}A78 78 0 0 1 ${x2} ${y2}" stroke="${col}" stroke-opacity="${op}" stroke-width="${w}" fill="none"/>`; };
  const lab = p => { const [x, y] = pt(p, 100); return `<text x="${x}" y="${(+y + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#93a398" font-family="Bahnschrift,Segoe UI,sans-serif">${fp(p)}</text>`; };
  return `<svg viewBox="0 0 200 140" role="img" aria-label="Percentuale reale">
    ${arc(c.min, c.max, '#fff', 16, .05)}${arc(c.min, c.lo - .01, ZCOL.low, 12, .9)}${arc(c.lo + .01, c.hi - .01, ZCOL.ok, 12, .95)}${arc(c.hi + .01, c.max, ZCOL.high, 12, .9)}
    ${lab(c.lo)}${lab(c.hi)}
    <g class="needle" id="g-needle" style="transform:rotate(-90deg)"><path d="M100 100L100 30" stroke="#f4f8f1" stroke-width="3.5" stroke-linecap="round"/><circle cx="100" cy="30" r="3" fill="#f4f8f1"/></g>
    <circle cx="100" cy="100" r="9" fill="#f4f8f1"/><circle cx="100" cy="100" r="4" fill="#0e1511"/>
    <text id="g-val" x="100" y="134" text-anchor="middle" font-size="22" font-weight="700" fill="#eef3ec" font-family="Bahnschrift,Segoe UI,sans-serif">— %</text>
  </svg>`;
}
function calcRender(fromUser) {
  const c = CFG[C.m];
  C.lordo = $('#c-lordo').value; C.tara = $('#c-tara').value; C.real = $('#c-real').value;
  const lordo = num(C.lordo) || 0, tara = num(C.tara) || 0, real = num(C.real);
  const net = Math.max(0, lordo - tara), pct = C.pct[C.m], salt = net * pct / 100, z = zoneOf(pct, c);
  LS.set('calc', C);
  const w = $('#c-warn');
  w.hidden = !(lordo > 0 && tara > lordo);
  if (!w.hidden) w.textContent = 'La tara è più pesante del lordo: controlla i numeri.';
  countTo($('#c-netto'), net, 0);
  countTo($('#c-salt'), salt, salt > 0 && salt < 10 ? 1 : 0);
  $('#c-pct-out').textContent = fp(pct) + ' %';
  const zc = $('#c-zone'); zc.className = 'zone ' + z; zc.textContent = ZTXT[z];
  $('#c-pct').style.setProperty('--zc', ZCOL[z]);
  $$('#c-quick button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.p - pct) < 1e-6));
  const out = $('.calc-out'); out.classList.remove('z-low', 'z-ok', 'z-high'); out.classList.add('z-' + z);
  // vaso: ricostruito al livello giusto, parte dal livello precedente (scorre)
  const key = C.m + z;
  const fill = net > 0 ? .3 + .58 * Math.min(1, net / 2500) : .04;
  if (key !== calcJarKey || Math.abs(fill - calcFill) > .001) {
    const first = calcFill < 0;
    const startOff = first ? null : ((fill - calcFill) * 118).toFixed(1);
    calcJarKey = key; calcFill = fill;
    const liq = { ok: [139, 227, 107], low: [245, 181, 68], high: [255, 92, 122] }[z];
    const look = C.m === 'secco'
      ? { mode: 'secco', layers: [{ c: '#ecdcb0', f: .34 }, { c: '#ff8a2b', f: .33 }, { c: '#dcb6e6', f: .33 }], liquid: rgba(mix([{ c: toHex(liq), f: .45 }, { c: '#e8d9a8', f: .55 }]), .55) }
      : { mode: 'salamoia', layers: [{ c: '#4fae4a', f: .6 }, { c: '#f2ead6', f: .2 }, { c: '#6f9a2a', f: .2 }], liquid: rgba(mix([{ c: toHex(liq), f: .4 }, { c: '#f3d27a', f: .6 }]), .45), vegFrac: .75 };
    $('#c-jar').innerHTML = jarSVG({ ...look, fill, bubbles: 9, seed: 11, crystals: true, animate: first, startOff, alt: 'Vaso del calcolo' });
    settle($('#c-jar'));
  }
  if (fromUser && Math.abs(salt - lastSalt) >= 1) { clearTimeout(sprinkleT); sprinkleT = setTimeout(sprinkle, 220); }
  lastSalt = salt;
  // verifica sale reale
  const v = $('#c-verdict'); const needle = $('#g-needle'), gv = $('#g-val');
  if (!(net > 0)) {
    v.className = 'verdict'; v.innerHTML = `<span class="muted">Scrivi lordo e tara: il resto lo calcolo io.</span>`;
    needle.style.transform = 'rotate(-90deg)'; gv.textContent = '— %'; return;
  }
  if (!(real >= 0) || C.real === '') {
    v.className = 'verdict'; v.innerHTML = `<span class="muted">Hai già salato? Scrivi i grammi messi: ti dico se va bene.</span>`;
    needle.style.transform = 'rotate(-90deg)'; gv.textContent = '— %'; return;
  }
  const rp = real / net * 100, rz = zoneOf(rp, c), t = clamp((rp - c.min) / (c.max - c.min), 0, 1);
  needle.style.transform = `rotate(${(-90 + 180 * t).toFixed(1)}deg)`;
  gv.textContent = fp(Math.round(rp * 100) / 100) + ' %'; gv.setAttribute('fill', ZCOL[rz]);
  const diff = real - salt;
  let msg;
  if (rz === 'ok') msg = `<b>${fp(Math.round(rp * 100) / 100)} %</b>&nbsp;nel range sicuro${Math.abs(diff) >= .5 ? ` <span class="muted">· ${diff > 0 ? '+' : '−'}${nf(Math.abs(diff), 0)} g rispetto al ${fp(pct)} %</span>` : ''}`;
  else if (rz === 'high') { const add = real / (pct / 100) - net; msg = `<b>${fp(Math.round(rp * 100) / 100)} %</b>&nbsp;troppo sale. Aggiungi ~<b>${nf(add, 0)} g</b> di ${C.m === 'secco' ? 'verdura' : 'acqua'}`; }
  else msg = `<b>${fp(Math.round(rp * 100) / 100)} %</b>&nbsp;poco sale. Aggiungi ~<b>${nf(Math.max(0, salt - real), 0)} g</b> di sale`;
  v.className = 'verdict ' + rz;
  v.innerHTML = `<span class="vi">${icon(rz === 'ok' ? 'check' : rz === 'high' ? 'x' : 'plus')}</span><span>${msg}</span>`;
}
function sprinkle() {
  const g = $('#c-jar .crystals'); if (!g || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const off = (.9 - Math.max(calcFill, 0)) * 118;
  const R = rng(Date.now() % 9973); let s = '';
  for (let k = 0; k < 14; k++) {
    const x = 46 + R() * 28, h = 30 + off + 10 + R() * 26;
    s += `<rect class="crystal" x="${x.toFixed(1)}" y="0" width="2.2" height="2.2" rx=".4" fill="#fff" style="--h:${h.toFixed(0)}px;--sx:${((R() - .5) * 26).toFixed(1)}px;animation-delay:${(R() * .35).toFixed(2)}s;transform-box:fill-box;transform-origin:center"/>`;
  }
  g.innerHTML = s;
  const jar = $('#c-jar .jar'); jar.classList.remove('burp'); void jar.offsetWidth; jar.classList.add('burp');
  setTimeout(() => { g.innerHTML = ''; }, 1700);
}
function initCalc() {
  $('#c-lordo').value = C.lordo; $('#c-tara').value = C.tara; $('#c-real').value = C.real;
  calcSetMethod(C.m, true);
  $('#c-method').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.m !== C.m) calcSetMethod(b.dataset.m); });
  $('#c-method').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { calcSetMethod(C.m === 'secco' ? 'salamoia' : 'secco'); $(`#c-method [data-m=${C.m}]`).focus(); } });
  ['#c-lordo', '#c-tara', '#c-real'].forEach(s => $(s).addEventListener('input', () => calcRender(true)));
  $('#c-pct').addEventListener('input', e => { C.pct[C.m] = Math.round(+e.target.value * 100) / 100; calcRender(true); });
  $('#c-quick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; C.pct[C.m] = +b.dataset.p; $('#c-pct').value = b.dataset.p; calcRender(true); });
  $('#c-example').addEventListener('click', () => {
    if (C.m !== 'secco') calcSetMethod('secco', true);
    $('#c-lordo').value = 2031; $('#c-tara').value = 174; $('#c-real').value = 42; C.pct.secco = 2; $('#c-pct').value = 2;
    calcRender(true); toast('Esempio del 17-10-26 caricato');
  });
  $('#c-start').addEventListener('click', () => {
    const net = Math.max(0, (num($('#c-lordo').value) || 0) - (num($('#c-tara').value) || 0));
    const salt = num($('#c-real').value) >= 0 && $('#c-real').value !== '' ? num($('#c-real').value) : Math.round(net * C.pct[C.m] / 100);
    openJar({ method: C.m, net_g: C.m === 'secco' ? net : 0, water_g: C.m === 'salamoia' ? net : 0, salt_g: salt || '' });
  });
  calcRender(false);
}

/* ======================================================
   2. I MIEI VASI  (segnalatore "pronto" calcolato dal server)
   ====================================================== */
const LV = { presto: ['Troppo presto', 'presto', 'jar'], assaggia: ['Si può assaggiare', 'assaggia', 'spoon'], pronto: ['Pronto', 'pronto', 'check'] };
const SRC = { arpa: 'ARPA', 'arpa-rt': 'ARPA oggi', 'open-meteo': 'previsione', misurata: 'misurata', casa: 'casa', fissa: 'fissa', stima: 'stima', sensore: 'sensore', 'sensore-sim': 'simulato', 'sensore-prev': 'sensore 24h' };
const SRC_C = { arpa: '#5ab8ff', 'arpa-rt': '#5ab8ff', 'open-meteo': '#ba68c8', misurata: '#f5b544', casa: '#8be36b', fissa: '#8be36b', stima: '#93a398', sensore: '#2ee6c8', 'sensore-sim': '#9aa7ff', 'sensore-prev': '#2ee6c8' };
const isKombu = j => (j.kind || 'verdure') === 'kombucha';
const lastEv = (j, t) => (j.events || []).filter(e => e.type === t).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).pop();
const phSafe = j => isKombu(j) ? 4.2 : 4.6;
function jarView(j) {
  const r = j.ready || { level: 'presto', e: 0, taste_at: 1, ready_at: 1, series: [], proj: [], temp_now: { t: j.temp_c, src: 'casa' } };
  const el = Math.max(0, daysBetween(j.start_date, isoToday()));
  let k, t, ic, lv = r.over ? 'over' : r.level;
  if (j.status === 'finito') { k = 'fin'; t = 'Finito'; ic = 'check'; }
  else if (j.status === 'frigo') { k = 'cold'; t = 'In frigo'; ic = 'snow'; }
  else if (r.over) { k = 'fridge-now'; t = isKombu(j) ? 'Imbottiglia o frigo' : 'Metti in frigo'; ic = 'snow'; }
  else [t, k, ic] = LV[r.level] || LV.presto;
  return { r, el, k, t, ic, lv };
}
function jarLook(j) {
  if (isKombu(j)) return kombuLook();
  if (j.color) return colorLook(j.color, j.method);
  const r = j.recipe_id && RBY.get(j.recipe_id);
  if (r) return { ...recipeLook(r), mode: j.method };
  return colorLook('#b9dc6e', j.method);
}
function readyMeter(v) {
  const r = v.r, max = r.ready_at * 1.3;
  const pT = r.taste_at / max * 100, pR = r.ready_at / max * 100, pE = clamp(r.e / max * 100, 0, 100);
  const on = l => (r.level === l ? 'on' : '');
  return `<div class="ready lv-${v.lv}" role="meter" aria-label="Prontezza" aria-valuemin="0" aria-valuemax="${r.ready_at}" aria-valuenow="${r.e}">
    <div class="rtrack"><span class="s1" style="width:${pT.toFixed(1)}%"></span><span class="s2" style="width:${(pR - pT).toFixed(1)}%"></span><span class="s3"></span>
      <i class="rfill" data-w="${pE.toFixed(1)}" style="background:linear-gradient(90deg,rgba(255,255,255,.06),var(--lc))"></i><b class="rdot" data-l="${pE.toFixed(1)}" style="left:0"></b></div>
    <div class="rlabels"><span class="${on('presto')}">presto</span><span class="${on('assaggia')}" style="left:${((pT + pR) / 2).toFixed(1)}%">assaggia</span><span class="${on('pronto')}">pronto</span></div></div>`;
}
function readyLine(j, v) {
  const r = v.r;
  if (j.status === 'frigo') return `In frigo${j.fridge_date ? ` dal <b>${dIT(j.fridge_date)}</b>` : ''}`;
  if (j.status === 'finito') return 'Finito';
  if (r.future) return `Inizia il <b>${dIT(j.start_date)}</b>`;
  const dr = r.date_ready ? dIT(r.date_ready) : '—', dt = r.date_taste ? dIT(r.date_taste) : '—';
  if (r.level === 'presto') return `<span>assaggia dal <b>${dt}</b></span><span>pronto ~<b>${dr}</b></span>`;
  if (r.level === 'assaggia') return `<span>pronto ~<b>${dr}</b></span>`;
  return `<span>pronto dal <b>${dr}</b></span>${r.over ? `<span>${isKombu(j) ? 'oltre: imbottiglia o frigo' : 'oltre: frigo'}</span>` : ''}`;
}
function sparkSVG(r, W = 220, H = 38) {
  const pts = [...(r.series || []), ...(r.proj || [])];
  if (pts.length < 2) return '';
  const ymax = Math.max(r.ready_at * 1.15, ...pts.map(p => p.e)), n = pts.length;
  const X = i => (i / (n - 1) * (W - 6) + 3).toFixed(1), Y = e => (H - 3 - e / ymax * (H - 6)).toFixed(1);
  const ns = (r.series || []).length;
  const path = (a, b) => pts.slice(a, b).map((p, i) => `${i ? 'L' : 'M'}${X(a + i)} ${Y(p.e)}`).join('');
  const today = ns ? `<circle cx="${X(ns - 1)}" cy="${Y(pts[ns - 1].e)}" r="3.2" fill="#f4f8f1"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 ${Y(r.taste_at)}H${W}" stroke="#f5b544" stroke-opacity=".5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    <path d="M0 ${Y(r.ready_at)}H${W}" stroke="#8be36b" stroke-opacity=".6" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    ${ns > 1 ? `<path d="${path(0, ns)}" fill="none" stroke="#8be36b" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : ''}
    <path d="${path(Math.max(0, ns - 1), n)}" fill="none" stroke="#c9d4cb" stroke-opacity=".6" stroke-width="1.6" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
    ${today}</svg>`;
}
function tempChip(r) {
  const tn = r.temp_now || {};
  return `<span class="tchip src-${tn.src}" title="Temperatura usata oggi: ${SRC[tn.src] || tn.src}">${icon('thermo')}${nf(tn.t, tn.t % 1 ? 1 : 0)} °C · ${SRC[tn.src] || tn.src}</span>`;
}
function phChip(j) {
  const p = lastEv(j, 'ph'); if (!p) return '';
  const ok = p.value <= phSafe(j);
  return `<span class="phchip ${ok ? 'ok' : 'hi'}" title="pH misurato il ${dIT(p.date)}">${icon('drop')}pH ${nf(p.value, 1)}</span>`;
}
function jarCard(j) {
  const v = jarView(j), r = v.r, look = jarLook(j), kb = isKombu(j);
  const cold = j.status !== 'attivo';
  const nb = cold ? 0 : r.level === 'presto' ? 9 : r.level === 'assaggia' ? 6 : 3;
  const burp = !kb && !cold && v.el <= 3 && !r.future;
  const meta = kb
    ? `kombucha${j.continuous ? ' · continuo' : ''}${j.water_g > 0 ? ` · ${nf(j.water_g)} g acqua` : ''}${j.sugar_g > 0 ? ` · ${nf(j.sugar_g)} g zucchero` : ''}`
    : `${j.method === 'secco' ? 'a secco' : 'salamoia'}${j.salt_g > 0 ? ` · ${nf(j.salt_g, j.salt_g % 1 ? 1 : 0)} g sale` : ''}${j.salt_g > 0 && (j.method === 'salamoia' ? j.water_g : j.net_g) > 0 ? ` · ${fp(Math.round(j.salt_g / (j.method === 'salamoia' ? j.water_g : j.net_g) * 1000) / 10)} %` : ''}`;
  const acts = j.status === 'attivo'
    ? `<button class="btn ghost" data-act="frigo">${icon('snow')}${kb ? 'Frigo' : 'In frigo'}</button>`
    : j.status === 'frigo' ? `<button class="btn ghost" data-act="finito">${icon('check')}Finito</button>`
      : `<button class="btn ghost" data-act="riapri">${icon('undo')}Riapri</button>`;
  return `<article class="jcard lv-${v.lv}" data-id="${j.id}" style="--tint:${look.tint}">
    <div class="jstage" data-act="detail" title="Dettagli">
      <span class="jstate ${v.k}">${icon(v.ic)}${v.t}</span>
      <div class="jdays"><b>${v.el}</b><small>${v.el === 1 ? 'giorno' : 'giorni'}</small></div>
      <div class="jarstage">${jarSVG({ ...look, fill: .84, bubbles: nb, cold, burp, cloth: kb, seed: j.id * 7 + 3, animate: true, label: dIT(j.start_date), alt: j.name })}</div>
    </div>
    <div class="jbody">
      <h3>${esc(j.name)}</h3>
      <div class="jmeta"><span>${icon('cal')}${dIT(j.start_date)}</span><span>${meta}</span></div>
      ${j.status !== 'finito' ? readyMeter(v) : ''}
      <div class="rline">${readyLine(j, v)}</div>
      ${j.status === 'attivo' ? `<div class="jinfo">${tempChip(r)}${phChip(j)}<div class="spark">${sparkSVG(r)}</div></div>` : phChip(j)}
      ${burp ? `<p class="jnote">Giorni 1–3: sfiata se si gonfia</p>` : ''}
      ${r.cycle_note ? `<p class="jnote">${esc(r.cycle_note)}</p>` : ''}
      ${j.notes ? `<p class="jnote" style="color:var(--mut)">${esc(j.notes)}</p>` : ''}
      <div class="jact">${acts}<button class="icon-btn" data-act="detail" aria-label="Dettagli e misure">${icon('chart')}</button>${kb && j.continuous && j.status === 'attivo' ? `<button class="icon-btn" data-act="detail" aria-label="Prelievo">${icon('pour')}</button>` : ''}<button class="icon-btn" data-act="edit" aria-label="Modifica">${icon('edit')}</button><button class="icon-btn" data-act="del" aria-label="Elimina">${icon('trash')}</button></div>
    </div>
  </article>`;
}
function renderJars() {
  const act = JARS.filter(j => j.status !== 'finito'), done = JARS.filter(j => j.status === 'finito');
  const rank = j => { const v = jarView(j); return { 'fridge-now': 0, pronto: 1, assaggia: 2, presto: 3, cold: 4 }[v.k] ?? 5; };
  act.sort((a, b) => rank(a) - rank(b) || b.start_date.localeCompare(a.start_date));
  $('#j-list').innerHTML = act.length ? act.map(jarCard).join('') : `<div class="empty"><div class="empty-jar">${jarSVG({ fill: 0, alt: 'Vaso vuoto' })}</div><p>Nessun vaso in cantina</p><button class="btn primary" type="button" onclick="openJar()">${icon('plus')}Riempi il primo</button></div>`;
  $('#j-done-wrap').hidden = !done.length; $('#j-done-n').textContent = done.length;
  $('#j-done').innerHTML = done.map(jarCard).join('');
  const rem = [];
  for (const j of act) {
    if (j.status !== 'attivo' || !j.ready || j.ready.future) continue;
    const v = jarView(j);
    if (v.k === 'fridge-now') rem.push(['fridge', 'snow', v.t, j]);
    else if (v.k === 'pronto') rem.push(['ready', 'check', 'Pronto', j]);
    else if (v.k === 'assaggia') rem.push(['taste', 'spoon', 'Assaggia', j]);
    else if (!isKombu(j) && v.el <= 3) rem.push(['burp', 'wind', 'Sfiata se gonfio', j]);
  }
  $('#j-rem').innerHTML = rem.length
    ? rem.map(([k, ic, t, j]) => `<button class="rem ${k}" type="button" data-go="${j.id}"><span class="ri">${icon(ic)}</span><span><b>${t}</b><small>${esc(j.name)} · giorno ${jarView(j).el}</small></span></button>`).join('')
    : (act.length ? `<div class="rem burp allok"><span class="ri">${icon('check')}</span><span><b>Tutto tranquillo</b><small>nessuna azione oggi</small></span></div>` : '');
  const due = rem.filter(r => r[0] !== 'burp').length;
  $$('[data-badge]').forEach(b => { b.hidden = !due; b.textContent = due; });
  settle($('#v-vasi'));
  renderKombuJars();
}
async function loadJars() { JARS = await api('/api/jars'); }
function upsertJar(j) { const i = JARS.findIndex(x => x.id === j.id); if (i >= 0) JARS[i] = j; else JARS.unshift(j); }
async function renderMeteo() {
  try {
    const m = await api('/api/meteo'), s = m.stato || {}, a = s.arpa_daily || {}, rt = s.arpa_rt || {}, om = s.open_meteo || {};
    const ok = a.ok || rt.ok;
    $('#j-meteo').innerHTML = `${icon('thermo')}<span>Estate: <b>ARPA ${esc(m.stazione.name)}</b> ${ok ? `<span class="ok">● collegata</span>${a.ultimo ? ` · ${dIT(a.ultimo)}` : ''}` : `<span class="ko">● non raggiungibile, uso la previsione</span>`}. Inverno: temperatura di casa.</span>`;
  } catch (e) { $('#j-meteo').textContent = ''; }
}
function jarActions(root) {
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.jcard'); if (!card) return;
    const id = +card.dataset.id, j = JARS.find(x => x.id === id); if (!j) return;
    const a = b.dataset.act;
    try {
      if (a === 'detail') return openDetail(id);
      if (a === 'edit') return openJar(j);
      if (a === 'del') {
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.innerHTML = 'Sicuro?'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.innerHTML = icon('trash'); } }, 3000); return; }
        await api('/api/jars/' + id, { method: 'DELETE' }); JARS = JARS.filter(x => x.id !== id); toast('Eliminato');
      } else if (a === 'frigo') { const nj = await api('/api/jars/' + id, { method: 'PUT', body: { status: 'frigo', fridge_date: isoToday() } }); upsertJar(nj); toast('In frigo'); renderJars(); offerRealBase(nj); return; }
      else if (a === 'finito') { upsertJar(await api('/api/jars/' + id, { method: 'PUT', body: { status: 'finito' } })); toast('Finito'); }
      else if (a === 'riapri') { upsertJar(await api('/api/jars/' + id, { method: 'PUT', body: { status: 'frigo' } })); toast('Riaperto'); }
      renderJars();
    } catch (err) { toast(err.message, true); }
  });
}
function initJars() {
  $('#j-new').addEventListener('click', () => openJar());
  $('#j-rem').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const card = $(`#j-list .jcard[data-id="${b.dataset.go}"]`); if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  });
  jarActions($('#v-vasi'));
  onView.vasi = () => { renderJars(); renderMeteo(); loadSensor(); };
}

/* ---------- dettaglio: grafico, temperature, misure ---------- */
function tempColor(t) { return t < 14 ? '#5ab8ff' : t < 18 ? '#7fd3c0' : t < 23 ? '#8be36b' : t < 27 ? '#f5b544' : '#ff6b3d'; }
function chartSVG(r) {
  const pts = [...(r.series || []), ...(r.proj || [])];
  if (!pts.length) return '<p class="hint" style="padding:10px">Ancora nessun giorno passato.</p>';
  const W = 560, H = 236, L = 34, Rr = 14, T = 12, lab = 22, band = 46, gap = 12;
  const yBot = H - lab - band - gap, n = pts.length, ns = (r.series || []).length;
  const xw = n > 1 ? (W - L - Rr) / (n - 1) : 0, X = i => L + i * xw + (n > 1 ? 0 : (W - L - Rr) / 2);
  const ymax = Math.max(r.ready_at * 1.2, ...pts.map(p => p.e));
  const Y = e => yBot - e / ymax * (yBot - T);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tempo equivalente a 20 gradi accumulato">
  <defs><linearGradient id="chg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8be36b" stop-opacity=".35"/><stop offset="1" stop-color="#8be36b" stop-opacity="0"/></linearGradient></defs>`;
  for (const [e, col, t] of [[r.taste_at, '#f5b544', 'assaggia'], [r.ready_at, '#8be36b', 'pronto']]) {
    s += `<path d="M${L} ${Y(e).toFixed(1)}H${W - Rr}" stroke="${col}" stroke-opacity=".55" stroke-dasharray="5 4"/><text x="${W - Rr}" y="${(Y(e) - 5).toFixed(1)}" text-anchor="end" font-size="11" font-weight="700" fill="${col}" font-family="Segoe UI,system-ui,sans-serif">${t} · ${nf(e, 1)} gg</text>`;
  }
  s += `<path d="M${L} ${yBot}H${W - Rr}" stroke="rgba(255,255,255,.12)"/><text x="${L - 6}" y="${yBot + 4}" text-anchor="end" font-size="10" fill="#6f8075" font-family="Bahnschrift,Segoe UI,sans-serif">0</text>`;
  if (ns) {
    const line = pts.slice(0, ns).map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.e).toFixed(1)}`).join('');
    s += `<path d="${line}L${X(ns - 1).toFixed(1)} ${yBot}L${X(0).toFixed(1)} ${yBot}Z" fill="url(#chg)"/><path d="${line}" fill="none" stroke="#8be36b" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (n > ns) {
    const st = Math.max(0, ns - 1);
    s += `<path d="${pts.slice(st).map((p, i) => `${i ? 'L' : 'M'}${X(st + i).toFixed(1)} ${Y(p.e).toFixed(1)}`).join('')}" fill="none" stroke="#c9d4cb" stroke-opacity=".7" stroke-width="2" stroke-dasharray="6 5"/>`;
  }
  if (ns) s += `<path d="M${X(ns - 1).toFixed(1)} ${T}V${H - lab}" stroke="rgba(255,255,255,.25)" stroke-dasharray="2 3"/><circle cx="${X(ns - 1).toFixed(1)}" cy="${Y(pts[ns - 1].e).toFixed(1)}" r="5" fill="#f4f8f1" stroke="#0e1511" stroke-width="2"/><text x="${X(ns - 1).toFixed(1)}" y="${T + 2}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#eef3ec" font-family="Segoe UI,system-ui,sans-serif">oggi</text>`;
  const bTop = H - lab - band, bw = Math.max(2, Math.min(16, xw * .7 || 16));
  s += `<text x="${L - 6}" y="${bTop + 10}" text-anchor="end" font-size="10" fill="#6f8075" font-family="Segoe UI,sans-serif">°C</text>`;
  pts.forEach((p, i) => {
    const h = clamp(p.t, 0, 35) / 35 * band, fut = i >= ns;
    s += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(bTop + band - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${SRC_C[p.src] || '#93a398'}" opacity="${fut ? .3 : .85}"><title>${dIT(p.d)} · ${nf(p.t, 1)} °C · ${SRC[p.src] || p.src}</title></rect>`;
    if (p.src === 'misurata') s += `<circle cx="${X(i).toFixed(1)}" cy="${(bTop + band - h - 5).toFixed(1)}" r="2.6" fill="#f5b544"/>`;
  });
  const step = Math.max(1, Math.ceil(n / 7));
  pts.forEach((p, i) => { if (i % step === 0 || (i === n - 1 && (n - 1) % step > step * .6)) s += `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="#93a398" font-family="Bahnschrift,Segoe UI,sans-serif">${p.d.slice(8, 10)}-${p.d.slice(5, 7)}</text>`; });
  return s + '</svg>';
}
let DD = null;
function openDetail(id) {
  const j = JARS.find(x => x.id === id); if (!j) return;
  DD = id;
  const v = jarView(j), r = v.r, kb = isKombu(j), look = jarLook(j);
  const last7 = (r.series || []).slice(-7);
  const evs = [...(j.events || [])].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const evTxt = e => e.type === 'temp' ? `${icon('thermo')}<b>${nf(e.value, 1)} °C</b>` : e.type === 'ph' ? `${icon('drop')}<b>pH ${nf(e.value, 1)}</b>` : `${icon('pour')}<b>${nf(e.value)} g</b> prelevati${e.value2 ? ` · ${nf(e.value2)} g rabbocco` : ''}`;
  $('#dd-body').innerHTML = `
    <div class="sheet-top"><h2 id="dd-title">${esc(j.name)}</h2><button class="icon-btn" type="button" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <div class="sheet-scroll"><div class="dd lv-${v.lv}">
      <div>
        <div class="dd-state"><div class="jarstage">${jarSVG({ ...look, fill: .84, bubbles: j.status === 'attivo' ? 6 : 0, cold: j.status !== 'attivo', cloth: kb, seed: j.id * 7 + 3, alt: '' })}</div>
          <div><div class="lvbig">${v.t}</div><div class="rline" style="margin-top:8px">${readyLine(j, v)}</div></div></div>
        ${j.status !== 'finito' ? readyMeter(v) : ''}
        <p class="how" style="margin:14px 0 16px">${icon('info')}<span>Stima: ${nf(r.base, r.base % 1 ? 1 : 0)} giorni a 20 °C, corretti giorno per giorno con la temperatura (Q10 2,2): assaggio al 55 %, pronto al 100 %, mai prima di 3 giorni. <b>È una stima: decidono assaggio e odore.</b></span></p>
        <h4>Tempo equivalente a 20 °C · ${nf(r.e, 1)} di ${nf(r.ready_at, 1)} gg</h4>
        <div class="chart">${chartSVG(r)}</div>
        <div class="legend"><span><i style="background:#8be36b"></i>accumulato</span><span><i style="background:#c9d4cb;opacity:.6"></i>previsto</span>${Object.entries({ sensore: '#2ee6c8', ARPA: '#5ab8ff', casa: '#8be36b', misurata: '#f5b544', previsione: '#ba68c8' }).map(([k, c]) => `<span><i style="background:${c};border-radius:50%"></i>${k}</span>`).join('')}</div>
        <div class="box" id="dd-real" style="margin-top:14px"></div>
      </div>
      <div>
        ${j.base_info ? `<div class="box">${baseEditor('jar:' + j.id, j.base_info.eff, j.base_info.default, j.base_info.mode === 'tuo', j.base_info.src === 'ricetta' ? 'dalla ricetta' : j.base_info.src === 'kombucha' ? 'dal kombucha' : 'generico')}</div>` : ''}
        ${jarLabelBox(j, r)}
        <div class="box"><h4>Temperatura usata</h4>
          <div class="days7">${last7.map(p => `<div title="${SRC[p.src] || p.src}"><span>${p.d.slice(8, 10)}-${p.d.slice(5, 7)}</span><b>${nf(p.t, p.t % 1 ? 1 : 0)}°</b><i style="background:${SRC_C[p.src] || '#93a398'}"></i></div>`).join('') || '<span class="hint">—</span>'}</div>
          <p class="hint">${j.temp_mode === 'fissa' ? 'Fissa: sempre la tua temperatura.' : 'Auto: estate (giu–set) media del giorno ARPA Torino Alenia; inverno la tua temperatura di casa.'} Ordine: tua misura (vale 7 gg) › sensore › ARPA › casa.</p></div>
        ${j.status === 'attivo' ? `<div class="box"><h4>Misura a mano</h4><div class="mrow"><span class="inp"><input id="dd-t" type="number" inputmode="decimal" step="0.5" min="-10" max="45" placeholder="${nf(r.temp_now?.t ?? 20, 0)}"><i>°C</i></span><input type="date" id="dd-td" value="${isoToday()}" aria-label="Data misura"><button class="btn ghost" type="button" data-ev="temp">${icon('check')}Salva</button></div></div>` : ''}
        <div class="box"><h4>pH · facoltativo</h4><div class="mrow"><span class="inp"><input id="dd-p" type="number" inputmode="decimal" step="0.1" min="1" max="9" placeholder="${kb ? '3,0' : '4,0'}"><i>pH</i></span><button class="btn ghost" type="button" data-ev="ph">${icon('check')}Salva</button></div>
          <p class="hint">${kb ? 'Obiettivo 2,5–3,5 · sicuro sotto 4,2.' : 'Striscia pH: 4,6 o meno · meglio 4,2–3,8.'}</p></div>
        ${kb && j.continuous && j.status === 'attivo' ? `<div class="box"><h4>Prelievo · lotto continuo</h4><div class="mrow"><span class="inp"><input id="dd-pr" type="number" inputmode="decimal" min="0" step="10" placeholder="${nf(Math.round(((j.water_g || 0) + (j.starter_g || 0)) / 3 / 10) * 10)}"><i>g presi</i></span><span class="inp"><input id="dd-rb" type="number" inputmode="decimal" min="0" step="10" placeholder="= presi"><i>g rabbocco</i></span><button class="btn ghost" type="button" data-ev="prelievo">${icon('check')}Salva</button></div><p class="hint">Rabbocchi con tè dolce: il conto riparte, più corto.</p></div>` : ''}
        <div class="box"><h4>Registro</h4><ul class="evlist">${evs.map(e => `<li>${evTxt(e)}<small>${dIT(e.date)}</small><button class="icon-btn" type="button" data-del-ev="${e.id}" aria-label="Elimina">${icon('trash')}</button></li>`).join('') || '<li><small>Nessuna misura</small></li>'}</ul></div>
      </div>
    </div></div>`;
  const d = $('#dlg-d'); if (!d.open) d.showModal(); settle(d);
  const jl = $('[data-jlabel]', d); if (jl) jl.addEventListener('click', () => { d.close(); openLabel({ jars: [j.id] }); });
  fillRealChart(j);
}
function initDetail() {
  const d = $('#dlg-d');
  d.addEventListener('click', async e => {
    const b = e.target.closest('[data-ev],[data-del-ev]'); if (!b || DD == null) return;
    try {
      let j;
      if (b.dataset.delEv) j = await api('/api/events/' + b.dataset.delEv, { method: 'DELETE' });
      else {
        const t = b.dataset.ev, body = { type: t, date: isoToday() };
        if (t === 'temp') { body.value = num($('#dd-t').value); body.date = $('#dd-td').value || isoToday(); }
        if (t === 'ph') body.value = num($('#dd-p').value);
        if (t === 'prelievo') { body.value = num($('#dd-pr').value); const rb = num($('#dd-rb').value); body.value2 = isFinite(rb) ? rb : body.value; }
        if (!isFinite(body.value)) { toast('Scrivi un numero', true); return; }
        j = await api(`/api/jars/${DD}/events`, { method: 'POST', body });
        toast(t === 'temp' ? 'Temperatura salvata: stima ricalcolata' : t === 'ph' ? 'pH salvato' : 'Prelievo salvato: nuovo ciclo');
      }
      if (j && j.id) upsertJar(j);
      openDetail(DD); renderJars();
    } catch (err) { toast(err.message, true); }
  });
}

/* ---------- tempo base modificabile ---------- */
function baseEditor(key, eff, def, custom, note) {
  return `<div class="basebox" data-key="${key}">
    <div class="bb-head"><span>Tempo base a 20 °C</span><span class="bb-tag ${custom ? 'tuo' : 'def'}">${custom ? 'tuo' : 'default'}</span></div>
    <div class="mrow"><span class="inp"><input type="number" inputmode="decimal" min="1" max="120" step="0.5" value="${Math.round(eff * 10) / 10}" aria-label="Giorni base a 20 gradi"><i>giorni</i></span>
      <button class="btn ghost" type="button" data-base="save">${icon('check')}Salva</button>
      <button class="btn ghost" type="button" data-base="reset"${custom ? '' : ' disabled'}>${icon('undo')}Ripristina</button></div>
    <p class="hint">Default ${nf(def, def % 1 ? 1 : 0)} gg${note ? ' · ' + note : ''}. Assaggio al 55 %, pronto al 100 %, minimo 3 giorni.</p></div>`;
}
async function refreshAll() {
  const [d, j] = await Promise.all([api('/api/data'), api('/api/jars')]);
  DATA = d; JARS = j; RBY = new Map(DATA.recipes.map(r => [r.id, r]));
  renderJars(); renderKombuStatic();
  if ($('#v-ricette').classList.contains('on')) { renderHero(); renderRecipes(); }
  if ($('#v-adatta').classList.contains('on')) adaptRender(false);
}
async function saveBase(key, days) {
  if (key.startsWith('jar:')) {
    const id = +key.slice(4), body = days == null ? { base_mode: 'auto' } : { base_mode: 'tuo', base_days: days };
    upsertJar(await api('/api/jars/' + id, { method: 'PUT', body }));
  } else await api('/api/base', { method: 'POST', body: { key, days } });
  await refreshAll();
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-base]'); if (!b) return;
  const box = b.closest('.basebox'), key = box.dataset.key;
  let days = null;
  if (b.dataset.base === 'save') {
    days = num(box.querySelector('input').value);
    if (!(days >= 1 && days <= 120)) { toast('Da 1 a 120 giorni', true); return; }
  }
  b.disabled = true;
  try {
    await saveBase(key, days);
    toast(days == null ? 'Ripristinato il default' : 'Tempo base salvato: date ricalcolate');
    if ($('#dlg-r').open && key.startsWith('recipe:')) openRecipe(+key.slice(7));
    if ($('#dlg-d').open && DD != null) openDetail(DD);
  } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
});
function ask(text, yes = 'Sì', no = 'No') {
  return new Promise(res => {
    const d = $('#dlg-ask');
    $('#ask-t').innerHTML = text; $('#ask-y').textContent = yes; $('#ask-n').textContent = no;
    const done = v => { d.close(); res(v); };
    $('#ask-y').onclick = () => done(true); $('#ask-n').onclick = () => done(false);
    d.showModal();
  });
}
async function offerRealBase(j) {
  const bi = j.base_info, r = j.ready;
  if (!bi || !r || bi.src === 'vaso' || j.continuous || !(r.e >= 1)) return;
  const real = Math.round(r.e * 2) / 2;
  if (real < 3.5 || Math.abs(real - bi.default) < .5) return;   // mai sotto il minimo della guida
  const what = bi.src === 'kombucha' ? 'del kombucha' : 'di questa ricetta';
  const ok = await ask(`È andato in frigo dopo <b>${nf(real, real % 1 ? 1 : 0)} giorni</b> equivalenti a 20 °C.<br>Uso questo come tempo base ${what}? <small style="color:var(--mut)">(ora ${nf(bi.default, bi.default % 1 ? 1 : 0)} gg)</small>`, 'Sì, aggiorna', 'No');
  if (!ok) return;
  try { await saveBase(bi.src === 'kombucha' ? 'kombucha' : `recipe:${j.recipe_id}`, real); toast('Tempo base aggiornato'); } catch (err) { toast(err.message, true); }
}

/* ---------- modale nuovo / modifica vaso ---------- */
let JF = null;
function recipeOptions(sel, withNone) {
  const by = m => DATA.recipes.filter(r => r.method === m).sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const opt = r => `<option value="${r.id}"${r.id === sel ? ' selected' : ''}>${esc(r.name)}${DUP.has(r.name) ? ` (#${r.id})` : ''}</option>`;
  return (withNone ? `<option value="">— nessuna —</option>` : '') + `<optgroup label="A secco">${by('secco').map(opt).join('')}</optgroup><optgroup label="In salamoia">${by('salamoia').map(opt).join('')}</optgroup>`;
}
const segSet = (sel, m) => { $$(sel + ' button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.m === m))); $(sel).classList.toggle('right', $$(sel + ' button')[1].dataset.m === m); };
function openJar(pre = {}) {
  const edit = !!pre.id;
  JF = { id: pre.id || null, kind: pre.kind || 'verdure', method: pre.method || 'secco', tmode: pre.temp_mode || 'auto', color: pre.color || '', recipe_id: pre.recipe_id || null };
  $('#jf-name').value = pre.name || '';
  $('#jf-recipe').innerHTML = recipeOptions(JF.recipe_id, true);
  $('#jf-date').value = (pre.start_date || isoToday()).slice(0, 10);
  $('#jf-temp').value = pre.temp_c ?? 20;
  const r = JF.recipe_id && RBY.get(JF.recipe_id);
  $('#jf-base').value = pre.base_mode === 'tuo' && pre.base_days ? pre.base_days : jfDefault();
  const g = (v, d = 0) => (v ? Math.round(v * Math.pow(10, d)) / Math.pow(10, d) : '');
  $('#jf-net').value = g(pre.net_g); $('#jf-water').value = g(pre.water_g); $('#jf-salt').value = g(pre.salt_g, 1);
  $('#jf-kw').value = g(pre.water_g); $('#jf-ks').value = g(pre.sugar_g); $('#jf-kt').value = g(pre.tea_g, 1); $('#jf-kst').value = g(pre.starter_g); $('#jf-ksc').value = g(pre.scoby_g);
  $('#jf-cont').checked = !!pre.continuous;
  $('#jf-notes').value = pre.notes || '';
  $('#jf-colors').innerHTML = SWATCHES.map(([n, c]) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="${n}" title="${n}" aria-pressed="${JF.color === c}"></button>`).join('');
  jfKind(JF.kind, true); jfMethod(JF.method); segSet('#jf-tmode', JF.tmode);
  $('#dj-title').textContent = edit ? 'Modifica' : JF.kind === 'kombucha' ? 'Nuovo lotto' : 'Nuovo vaso';
  jfUpdate(true);
  $('#dlg-j').showModal();
  if (!edit) setTimeout(() => $('#jf-name').focus(), 60);
}
function jfKind(k, keep) {
  JF.kind = k; $('#j-form').dataset.kind = k; segSet('#jf-kind', k);
  if (!keep) {
    const b = num($('#jf-base').value);
    $('#jf-base').value = jfDefault();
    if (k === 'kombucha' && !$('#jf-name').value.trim()) $('#jf-name').value = 'Kombucha ' + dIT($('#jf-date').value || isoToday());
  }
  $('#jf-name').placeholder = k === 'kombucha' ? 'Es. Kombucha zenzero' : 'Es. Crauti di ottobre';
}
function jfDefault() {
  if (JF.kind === 'kombucha') return KBD().base_eff ?? 12;
  const r = (+$('#jf-recipe').value && RBY.get(+$('#jf-recipe').value)) || (JF.recipe_id && RBY.get(JF.recipe_id));
  return r ? Math.round(rBase(r) * 2) / 2 : 7;
}
function jfMethod(m) { JF.method = m; segSet('#jf-method', m); $('#jf-water-f').hidden = m !== 'salamoia'; }
function jfUpdate(anim) {
  const T = num($('#jf-temp').value), base = num($('#jf-base').value) || 7, f = Math.pow(Q10, (T - 20) / 10);
  const def = jfDefault(), mine = Math.abs(base - def) > .01;
  $('#jf-base-l').innerHTML = `Giorni base a 20 °C <small class="bb-tag ${mine ? 'tuo' : 'def'}">${mine ? 'tuo' : 'default'}</small>`;
  $('#jf-base-h').textContent = `default ${nf(def, def % 1 ? 1 : 0)} gg`;
  const ready = Math.max(3, Math.max(base, 3.5) / f), taste = Math.max(.55 * base, 2) / f;
  $('#jf-temp-o').textContent = nf(T, T % 1 ? 1 : 0) + ' °C';
  $('#jf-temp').style.setProperty('--p', ((T - 12) / 18 * 100) + '%');
  const date = $('#jf-date').value || isoToday();
  $('#jf-min').innerHTML = `<b>~${nf(ready, ready < 10 ? 1 : 0)} gg</b>pronto a ${nf(T, T % 1 ? 1 : 0)} °C<br><small style="color:var(--mut)">assaggia dal ~${dIT(addDays(date, taste))} · stima</small>`;
  const salt = num($('#jf-salt').value), sb = JF.method === 'salamoia' ? num($('#jf-water').value) : num($('#jf-net').value);
  $('#jf-pct').textContent = salt > 0 && sb > 0 ? fp(Math.round(salt / sb * 1000) / 10) + ' %' : '';
  const rid = +$('#jf-recipe').value || null, r = rid && RBY.get(rid);
  const look = JF.kind === 'kombucha' ? kombuLook() : JF.color ? colorLook(JF.color, JF.method) : r ? { ...recipeLook(r), mode: JF.method } : colorLook('#b9dc6e', JF.method);
  $('#jf-jar').closest('.jf-vis').style.setProperty('--tint', look.tint);
  $('#jf-jar').innerHTML = jarSVG({ ...look, fill: .84, bubbles: 7, seed: 5, cloth: JF.kind === 'kombucha', animate: anim, label: dIT(date), alt: 'Anteprima' });
  if (anim) settle($('#jf-jar'));
}
function initJarForm() {
  const d = $('#dlg-j');
  $('#jf-kind').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { jfKind(b.dataset.m); jfUpdate(true); } });
  $('#jf-method').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { jfMethod(b.dataset.m); jfUpdate(); } });
  $('#jf-tmode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { JF.tmode = b.dataset.m; segSet('#jf-tmode', JF.tmode); } });
  $('#jf-recipe').addEventListener('change', e => {
    const r = RBY.get(+e.target.value); JF.recipe_id = r ? r.id : null;
    if (r) {
      jfMethod(r.method); JF.color = '';
      $$('#jf-colors button').forEach(b => b.setAttribute('aria-pressed', 'false'));
      if (!$('#jf-name').value.trim()) $('#jf-name').value = r.name;
      $('#jf-base').value = jfDefault();
      $('#jf-net').value = Math.round(r.total_weight_g); $('#jf-salt').value = Math.round(r.salt_g * 10) / 10;
      $('#jf-water').value = r.water_ml ? Math.round(r.water_ml) : '';
    }
    jfUpdate(true);
  });
  $('#jf-colors').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    JF.color = JF.color === b.dataset.c ? '' : b.dataset.c;
    $$('#jf-colors button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.c === JF.color)));
    jfUpdate();
  });
  ['#jf-temp', '#jf-base', '#jf-net', '#jf-water', '#jf-salt', '#jf-date'].forEach(s => $(s).addEventListener('input', () => jfUpdate()));
  $('#j-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#jf-name').value.trim();
    if (!name) { $('#jf-name').focus(); toast('Dai un nome', true); return; }
    const kb = JF.kind === 'kombucha', n0 = s => num($(s).value) || 0;
    const body = {
      name, kind: JF.kind, temp_mode: JF.tmode, start_date: $('#jf-date').value || isoToday(),
      temp_c: num($('#jf-temp').value), base_days: num($('#jf-base').value) || jfDefault(), q10: Q10,
      base_mode: Math.abs((num($('#jf-base').value) || jfDefault()) - jfDefault()) > .01 ? 'tuo' : 'auto', notes: $('#jf-notes').value.trim(),
      ...(kb
        ? { method: 'secco', recipe_id: null, color: '', water_g: n0('#jf-kw'), sugar_g: n0('#jf-ks'), tea_g: n0('#jf-kt'), starter_g: n0('#jf-kst'), scoby_g: n0('#jf-ksc'), continuous: $('#jf-cont').checked ? 1 : 0, net_g: 0, salt_g: 0 }
        : { method: JF.method, recipe_id: +$('#jf-recipe').value || null, color: JF.color, net_g: n0('#jf-net'), water_g: JF.method === 'salamoia' ? n0('#jf-water') : 0, salt_g: n0('#jf-salt') })
    };
    const btn = $('#jf-save'); btn.disabled = true;
    try {
      const saved = JF.id ? await api('/api/jars/' + JF.id, { method: 'PUT', body }) : await api('/api/jars', { method: 'POST', body });
      upsertJar(saved);
      d.close(); toast(JF.id ? 'Aggiornato' : kb ? 'Lotto avviato' : 'Vaso in cantina');
      const target = kb && location.hash === '#kombucha' ? 'kombucha' : 'vasi';
      if (location.hash !== '#' + target) go(target); else { renderJars(); }
      setTimeout(() => { const c = $(`#v-${target} .jcard[data-id="${saved.id}"]`); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); } }, 350);
    } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  });
}

/* ======================================================
   SENSORE  (es. Raspberry Pi + DS18B20, anche letture simulate)
   ====================================================== */
let SENS = null, SRANGE = 'h24';
const hhmm = ts => ts ? ts.slice(11, 16) : '';
const ago = m => m == null ? '' : m < 60 ? `${m} min fa` : m < 1440 ? `${Math.round(m / 60)} h fa` : `${Math.round(m / 1440)} gg fa`;
function sensState(s = SENS) {
  if (!s || !s.last) return { k: 'off', t: 'Sensore non collegato' };
  const real = s.last_real, rm = s.last_real_min;
  if (real && rm <= 180) return { k: 'on', t: `Sensore attivo · ${hhmm(real.ts)}` };
  if (real) return { k: 'mute', t: `Nessuna lettura da ${ago(rm).replace(' fa', '')}` };
  return { k: 'sim', t: `Solo letture simulate · ${hhmm(s.last.ts)}` };
}
async function loadSensor() { try { SENS = await api('/api/sensor'); } catch (e) { SENS = null; } renderSensorStrip(); }
function renderSensorStrip() {
  const el = $('#j-sensor'); if (!el) return;
  const st = sensState(), l = SENS && SENS.last;
  el.className = 'sens-strip ' + st.k;
  el.innerHTML = `<span class="sdot"></span><span class="stxt"><b>${st.t}</b>${l && l.temp != null ? `<small>${nf(l.temp, 1)} °C${l.hum != null ? ` · ${nf(l.hum, 0)} %` : ''}${l.source === 'simulato' ? ' · simulato' : ''}</small>` : '<small>tocca per collegare il sensore</small>'}</span>${icon('arrow')}`;
}
function sensChart(points, hours) {
  const W = 560, H = 210, L = 36, R = 12, T = 12, B = 26;
  const now = Date.now(), t0 = now - hours * 3600e3;
  const pts = points.filter(p => p.t != null).map(p => ({ x: new Date(p.h + ':30:00').getTime(), t: p.t, rh: p.rh, sim: !!p.allsim }));
  if (!pts.length) return `<div class="chart-empty">${icon('chart')}Nessuna lettura in questo periodo</div>`;
  const lo = Math.floor(Math.min(...pts.map(p => p.t)) - .5), hi = Math.ceil(Math.max(...pts.map(p => p.t)) + .5);
  const X = x => L + (x - t0) / (now - t0) * (W - L - R), Y = t => T + (hi - t) / (hi - lo || 1) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperatura del sensore">`;
  for (let v = lo; v <= hi; v += Math.max(1, Math.round((hi - lo) / 4))) s += `<path d="M${L} ${Y(v).toFixed(1)}H${W - R}" stroke="rgba(255,255,255,.07)"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#6f8075" font-family="Bahnschrift,Segoe UI,sans-serif">${v}°</text>`;
  const segs = []; let cur = null;
  for (const p of pts) {
    if (!cur || p.sim !== cur.sim || p.x - cur.pts[cur.pts.length - 1].x > 2.5 * 3600e3) { cur = { sim: p.sim, pts: [] }; segs.push(cur); }
    cur.pts.push(p);
  }
  for (const g of segs) {
    const d = g.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.t).toFixed(1)}`).join('');
    const col = g.sim ? '#9aa7ff' : '#2ee6c8';
    if (g.pts.length > 1) s += `<path d="${d}L${X(g.pts[g.pts.length - 1].x).toFixed(1)} ${H - B}L${X(g.pts[0].x).toFixed(1)} ${H - B}Z" fill="${col}" opacity=".08"/>`;
    s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"${g.sim ? ' stroke-dasharray="6 4"' : ''}/>`;
    if (g.pts.length === 1) s += `<circle cx="${X(g.pts[0].x).toFixed(1)}" cy="${Y(g.pts[0].t).toFixed(1)}" r="3.5" fill="${col}"/>`;
  }
  const lp = pts[pts.length - 1];
  s += `<circle cx="${X(lp.x).toFixed(1)}" cy="${Y(lp.t).toFixed(1)}" r="5" fill="#f4f8f1" stroke="#0e1511" stroke-width="2"/>`;
  const step = hours <= 24 ? 6 : 24;
  for (let k = 0; k <= hours; k += step) {
    const x = now - (hours - k) * 3600e3, d = new Date(x);
    const lab = hours <= 24 ? `${pad(d.getHours())}:00` : `${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
    s += `<text x="${X(x).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="#93a398" font-family="Bahnschrift,Segoe UI,sans-serif">${k === hours ? 'ora' : lab}</text>`;
  }
  return s + '</svg>';
}
function sensorBase() {
  const ip = (SENS && SENS.lan_ip) || location.hostname, port = (SENS && SENS.port) || 8954;
  return `http://${ip}:${port}/api/temp`;
}
function renderSensorSheet() {
  const s = SENS || {}, l = s.last, st = sensState(s), nsim = (s.counts && s.counts.simulato) || 0;
  const pts = SRANGE === 'h24' ? (s.h24 || []) : (s.d7 || []);
  const ip = s.lan_ip || location.hostname;
  $('#ds-body').innerHTML = `
    <div class="sheet-top"><h2 id="ds-title">Sensore</h2><button class="icon-btn" type="button" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <div class="sheet-scroll"><div class="sens">
      <div>
        <div class="sens-now ${st.k}">
          <div class="sbig">${l && l.temp != null ? nf(l.temp, 1) : '—'}<i>°C</i></div>
          <div class="sside"><b>${l && l.hum != null ? nf(l.hum, 0) + ' %' : '— %'}</b><small>umidità</small></div>
          <div class="sbadge"><span class="sdot"></span>${st.t}${l ? `<small>${l.source === 'simulato' ? 'simulata · ' : ''}${dIT(l.ts)} ${hhmm(l.ts)} · ${ago(s.last_min)}</small>` : ''}</div>
        </div>
        ${st.k === 'mute' ? `<p class="warn">Nessuna lettura reale da più di 3 ore: controlla il Raspberry e la rete.</p>` : ''}
        <div class="seg small${SRANGE === 'd7' ? ' right' : ''}" id="s-range" role="radiogroup" aria-label="Periodo" style="max-width:320px;margin:16px 0 12px">
          <button type="button" role="radio" data-m="h24" aria-checked="${SRANGE === 'h24'}"><b>24 ore</b></button>
          <button type="button" role="radio" data-m="d7" aria-checked="${SRANGE === 'd7'}"><b>7 giorni</b></button>
        </div>
        <div class="chart">${sensChart(pts, SRANGE === 'h24' ? 24 : 168)}</div>
        <div class="legend"><span><i style="background:#2ee6c8"></i>sensore</span><span><i style="background:#9aa7ff"></i>simulato</span><span>media oraria</span></div>
      </div>
      <div>
        <div class="box"><h4>Prova senza sensore</h4>
          <div class="mrow"><span class="inp"><input id="s-t" type="number" inputmode="decimal" step="0.1" min="-10" max="50" value="21"><i>°C</i></span><span class="inp"><input id="s-h" type="number" inputmode="decimal" step="1" min="0" max="100" value="55"><i>%</i></span><button class="btn ghost" type="button" data-s="one">${icon('plus')}Simula lettura</button></div>
          <div class="mrow" style="margin-top:8px"><button class="btn ghost" type="button" data-s="gen">${icon('chart')}Genera 7 giorni</button><button class="btn danger" type="button" data-s="del"${nsim ? '' : ' disabled'}>${icon('trash')}Cancella simulate (${nsim})</button></div>
          <label class="toggle" style="margin-top:12px"><input type="checkbox" id="s-use"${s.use_simulated ? ' checked' : ''}><span></span>Usa anche le simulate nei calcoli</label>
          <p class="hint">${s.use_simulated ? '<b style="color:var(--amber)">Attenzione: i vasi ora usano anche letture finte.</b>' : 'Spento: i vasi usano solo letture reali.'}</p>
        </div>
        <div class="box howto"><h4>Come collegare il sensore</h4>
          <ol>
            <li>Il Raspberry chiama <code id="s-url">${esc(sensorBase())}?t=21.4</code> <button class="btn ghost mini" type="button" data-s="copy">Copia</button> · facoltativi <code>&h=55</code> <code>&ts=2026-10-17T13:00</code> <code>&src=nome</code></li>
            <li>Letture arretrate (PC spento): POST JSON <code>{"readings":[{"t":21.4,"ts":"…"}]}</code> allo stesso URL.</li>
            <li>Fissa nel router l'IP del PC <b>${esc(ip)}</b> e apri la porta ${s.port || 8954} nel firewall di Windows.</li>
          </ol></div>
        <div class="box"><h4>Token · facoltativo</h4><div class="mrow"><span class="inp"><input id="s-tok" type="text" maxlength="40" placeholder="${s.token_set ? 'impostato' : 'nessuno'}" autocomplete="off"><i>token</i></span><button class="btn ghost" type="button" data-s="tok">${icon('check')}Salva</button></div>
          <p class="hint">Se lo imposti, aggiungi <code>&token=…</code> all'URL. Vuoto = chiunque in casa può inviare.</p></div>
      </div>
    </div></div>`;
}
async function openSensor() { await loadSensor(); renderSensorSheet(); const d = $('#dlg-s'); if (!d.open) d.showModal(); }
async function sensorChanged(msg) {
  await loadSensor(); if ($('#dlg-s').open) renderSensorSheet();
  try { await loadJars(); renderJars(); } catch (e) { /* niente */ }
  if (msg) toast(msg);
}
function initSensor() {
  $('#j-sensor').addEventListener('click', openSensor);
  const d = $('#dlg-s');
  d.addEventListener('click', async e => {
    const r = e.target.closest('#s-range button'); if (r) { SRANGE = r.dataset.m; renderSensorSheet(); return; }
    const b = e.target.closest('[data-s]'); if (!b) return;
    try {
      if (b.dataset.s === 'one') {
        const t = num($('#s-t').value), h = num($('#s-h').value);
        if (!(t >= -10 && t <= 50)) { toast('Temperatura da -10 a 50 °C', true); return; }
        await api(`/api/temp?t=${t}${isFinite(h) ? `&h=${h}` : ''}&src=simulato`, { method: 'POST' });
        await sensorChanged(SENS && SENS.use_simulated ? 'Lettura simulata salvata' : 'Lettura simulata salvata (non usata nei calcoli)');
      } else if (b.dataset.s === 'gen') {
        b.disabled = true; const r2 = await api('/api/sensor/simulate', { method: 'POST', body: { days: 7 } });
        await sensorChanged(`${r2.letture} letture simulate create`);
      } else if (b.dataset.s === 'del') {
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.innerHTML = `${icon('trash')}Sicuro? Tocca ancora`; return; }
        const r3 = await api('/api/sensor/simulated', { method: 'DELETE' }); await sensorChanged(`${r3.cancellate} letture simulate cancellate`);
      } else if (b.dataset.s === 'copy') {
        const txt = sensorBase() + '?t=21.4';
        try { await navigator.clipboard.writeText(txt); } catch (err) { const a = document.createElement('textarea'); a.value = txt; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
        toast('URL copiato');
      } else if (b.dataset.s === 'tok') {
        SENS = { ...SENS, ...(await api('/api/sensor/settings', { method: 'POST', body: { token: $('#s-tok').value.trim() } })) };
        renderSensorSheet(); toast($('#s-tok') && SENS.token_set ? 'Token salvato' : 'Token tolto');
      }
    } catch (err) { toast(err.message, true); b.disabled = false; }
  });
  d.addEventListener('change', async e => {
    if (e.target.id !== 's-use') return;
    try { await api('/api/sensor/settings', { method: 'POST', body: { use_simulated: e.target.checked } }); await sensorChanged(e.target.checked ? 'Simulate usate nei calcoli' : 'Calcoli solo con letture reali'); }
    catch (err) { toast(err.message, true); }
  });
  setInterval(() => { if (document.visibilityState === 'visible') loadSensor(); }, 60000);
}
/* grafico temperatura reale nel dettaglio vaso */
async function fillRealChart(j) {
  const box = $('#dd-real'); if (!box) return;
  const r = j.ready || {}, start = new Date((r.cycle_start || j.start_date) + 'T00:00:00');
  const from = new Date(Math.max(start.getTime(), Date.now() - 7 * 864e5));
  try {
    const pts = await api('/api/sensor/series?from=' + isoOf(from) + 'T' + pad(from.getHours()) + ':00:00');
    const st = sensState();
    box.innerHTML = `<div class="real-head"><h4>Temperatura reale · sensore</h4><span class="sbadge mini ${st.k}"><span class="sdot"></span>${st.t}</span></div>
      ${st.k === 'mute' ? '<p class="warn" style="margin:0 0 8px">Nessuna lettura da più di 3 ore.</p>' : ''}
      <div class="chart">${realChart(pts, r, from)}</div>
      <div class="legend"><span><i style="background:#2ee6c8"></i>temperatura (media oraria)</span><span><i style="background:#8be36b"></i>giorni a 20 °C accumulati</span></div>`;
  } catch (e) { box.innerHTML = ''; }
}
function realChart(pts, r, from) {
  pts = pts.filter(p => p.t != null);
  if (!pts.length) return `<div class="chart-empty">${icon('thermo')}Nessuna lettura del sensore per questo vaso${SENS && !SENS.use_simulated && SENS.counts && SENS.counts.simulato ? ' (le simulate sono escluse dai calcoli)' : ''}</div>`;
  const W = 560, H = 200, L = 34, R = 34, T = 12, B = 24, t0 = from.getTime(), t1 = Date.now();
  const lo = Math.floor(Math.min(...pts.map(p => p.t)) - .5), hi = Math.ceil(Math.max(...pts.map(p => p.t)) + .5);
  const X = x => L + (x - t0) / (t1 - t0 || 1) * (W - L - R), Y = t => T + (hi - t) / (hi - lo || 1) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperatura reale e tempo equivalente">`;
  for (let v = lo; v <= hi; v += Math.max(1, Math.round((hi - lo) / 4))) s += `<path d="M${L} ${Y(v).toFixed(1)}H${W - R}" stroke="rgba(255,255,255,.07)"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6f8075" font-family="Bahnschrift,Segoe UI,sans-serif">${v}°</text>`;
  const P = pts.map(p => ({ x: new Date(p.h + ':30:00').getTime(), t: p.t, sim: !!p.allsim })).filter(p => p.x >= t0);
  let d = '', prev = null;
  for (const p of P) { d += `${!prev || p.x - prev.x > 2.5 * 3600e3 ? 'M' : 'L'}${X(p.x).toFixed(1)} ${Y(p.t).toFixed(1)}`; prev = p; }
  s += `<path d="${d}" fill="none" stroke="#2ee6c8" stroke-width="2.2" stroke-linejoin="round"/>`;
  const ser = (r.series || []).map(q => ({ x: new Date(q.d + 'T00:00:00').getTime() + (q.oggi ? (Date.now() - new Date(q.d + 'T00:00:00').getTime()) : 864e5), e: q.e })).filter(q => q.x >= t0);
  if (ser.length) {
    const emax = Math.max(r.ready_at * 1.2, ...ser.map(q => q.e)), YE = e => T + (1 - e / emax) * (H - T - B);
    s += `<path d="M${L} ${YE(r.ready_at).toFixed(1)}H${W - R}" stroke="#8be36b" stroke-opacity=".5" stroke-dasharray="5 4"/><text x="${W - R + 4}" y="${(YE(r.ready_at) + 4).toFixed(1)}" font-size="10" fill="#8be36b" font-family="Bahnschrift,Segoe UI,sans-serif">${nf(r.ready_at, 1)}</text>`;
    s += `<path d="${ser.map((q, i) => `${i ? 'L' : 'M'}${X(Math.min(q.x, t1)).toFixed(1)} ${YE(q.e).toFixed(1)}`).join('')}" fill="none" stroke="#8be36b" stroke-width="2.4" stroke-linecap="round"/>`;
    s += `<text x="${W - R + 4}" y="${T + 8}" font-size="10" fill="#8be36b" font-family="Bahnschrift,Segoe UI,sans-serif">gg</text>`;
  }
  const days = Math.ceil((t1 - t0) / 864e5), step = days <= 2 ? .25 : 1;
  for (let k = 0; k <= days; k += step) {
    const x = t0 + k * 864e5; if (x > t1) break; const dt = new Date(x);
    s += `<text x="${X(x).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="#93a398" font-family="Bahnschrift,Segoe UI,sans-serif">${step < 1 ? pad(dt.getHours()) + ':00' : pad(dt.getDate()) + '-' + pad(dt.getMonth() + 1)}</text>`;
  }
  return s + '</svg>';
}

/* ======================================================
   3. RICETTARIO
   ====================================================== */
const SEASONS = [['now', 'Adesso'], ['Primavera', 'Primavera', [3, 4, 5]], ['Estate', 'Estate', [6, 7, 8]], ['Autunno', 'Autunno', [9, 10, 11]], ['Inverno', 'Inverno', [12, 1, 2]]];
const F = { q: '', m: null, s: null, veg: '', want: null, kind: null };
const rBase = r => (r.base_eff ?? base20(r.min_time_days, r.target_temp_c, r.q10));
const rMin = r => Math.round(adjDays(rBase(r), r.target_temp_c, r.q10) * 10) / 10;
const rPct = r => r.method === 'salamoia' ? (r.brine_pct || (r.water_ml ? r.salt_g / r.water_ml * 100 : 0)) : (r.total_weight_g ? r.salt_g / r.total_weight_g * 100 : 0);
const cleanName = n => n.replace(/\s+\d{2}-\d{2}-\d{2}$/, '');
const starsHTML = n => `<span class="stars" aria-label="${n} stelle su 5">${[1, 2, 3, 4, 5].map(i => `<svg class="${i <= n ? 'on' : ''}"><use href="#i-star"/></svg>`).join('')}</span>`;
function rCard(r) {
  const look = recipeLook(r), v = r.items.filter(i => i.type === 'vegetable');
  return `<button class="rcard" type="button" data-id="${r.id}" style="--tint:${look.tint}">
    <div class="rtop"><span class="mbadge ${r.method}">${r.kind === 'bevanda' ? 'bevanda' : r.method === 'secco' ? 'a secco' : 'salamoia'}</span>${wantBtn(r, 'card')}${r.id === FEATURED ? `<span class="feat" title="In evidenza"><svg><use href="#i-star"/></svg></span>` : ''}
      <div class="jarstage">${jarSVG({ ...look, fill: .82, bubbles: 4, seed: r.id, alt: '' })}</div></div>
    <div class="rb"><h3>${esc(r.name)}${DUP.has(r.name) ? ` <small style="color:var(--mut2);font:500 12px var(--f-sans)">#${r.id}</small>` : ''}</h3>
      ${r.kind === 'bevanda' && !(r.salt_g > 0) ? `<div class="rnums"><span>${nf(r.total_weight_g)}<small>g</small></span><span>${nf(rMin(r), rMin(r) % 1 ? 1 : 0)}<small>gg</small></span>` : `<div class="rnums"><span>${nf(r.total_weight_g)}<small>g</small></span><span>${nf(r.salt_g, r.salt_g < 10 && r.salt_g % 1 ? 1 : 0)}<small>g sale</small></span><span>${fp(Math.round(rPct(r) * 10) / 10)}<small>%</small></span><span>${nf(rMin(r), rMin(r) % 1 ? 1 : 0)}<small>gg</small></span>`}</div>
      ${r.kind === 'scorta' ? `<div class="crisp">scorta · ~${Math.round((r.shelf_days || 0) / 30)} mesi in dispensa</div>` : crispAt(r) != null ? `<div class="crisp">croccante fino a ~${nf(crispAt(r), crispAt(r) % 1 ? 1 : 0)} gg</div>` : ''}
      <div class="vdots">${v.slice(0, 4).map(i => `<span><i style="background:${vegColor(i.name)}"></i>${esc(i.name)}</span>`).join('')}</div>
      ${starsHTML(r.rating || 0)}</div></button>`;
}
function renderHero() {
  const r = RBY.get(FEATURED); if (!r) { $('#r-hero').innerHTML = ''; return; }
  const look = recipeLook(r), p = rPct(r), date = (r.name.match(/(\d{2}-\d{2}-\d{2})$/) || [])[1];
  const nm = esc(cleanName(r.name)).replace(/ a secco$/, '');
  $('#r-hero').innerHTML = `<div class="hero" role="button" tabindex="0" data-id="${r.id}">
    <div class="jarstage">${jarSVG({ ...look, fill: .86, bubbles: 8, seed: 202, animate: true, label: date || '', alt: r.name })}</div>
    <div><span class="ribbon"><svg><use href="#i-star"/></svg>In evidenza</span>
      <h2>${nm.replace(/(sedano rapa)$/i, '<em>$1</em>')}</h2>
      <p>${r.method === 'secco' ? 'A secco' : 'In salamoia'}${date ? ` · fatta il ${date}` : ''}</p>
      <div class="stats"><div class="stat"><b>${nf(r.total_weight_g)} g</b><small>verdure</small></div><div class="stat"><b>${nf(r.salt_g)} g</b><small>sale</small></div><div class="stat ok"><b>${fp(Math.round(p * 100) / 100)} %</b><small>nel range</small></div><div class="stat"><b>${nf(r.target_temp_c)} °C</b><small>temperatura</small></div><div class="stat"><b>${nf(rMin(r))}+ gg</b><small>minimo</small></div></div>
    </div></div>`;
  settle($('#r-hero'));
}
function rFilter() {
  const q = norm(F.q), mNow = new Date().getMonth() + 1;
  const ss = F.s && SEASONS.find(s => s[0] === F.s);
  return DATA.recipes.filter(r =>
    (!F.m || r.method === F.m) &&
    (!F.s || (F.s === 'now' ? r.months.includes(mNow) : ss[2].some(m => r.months.includes(m)))) &&
    (!F.veg || r.items.some(i => i.name === F.veg)) &&
    (!F.want || r.want) && (!F.kind || r.kind === F.kind) && r.kind !== 'bevanda' &&
    (!q || norm(r.name + ' ' + r.items.map(i => i.name).join(' ')).includes(q))
  ).sort((a, b) => (b.id === FEATURED) - (a.id === FEATURED) || (b.rating || 0) - (a.rating || 0) || a.id - b.id);
}
function renderRecipes() {
  const L = rFilter();
  $('#r-count').textContent = `${L.length} / ${DATA.recipes.length}`;
  $('#r-grid').innerHTML = L.map(rCard).join('');
  $('#r-empty').hidden = !!L.length;
  if (!L.length) $('#r-empty .empty-jar').innerHTML = jarSVG({ fill: 0 });
}
function renderChips() {
  const ch = (k, v, t, cls = '') => `<button type="button" class="chip ${cls}${F[k] === v ? ' on' : ''}" data-k="${k}" data-v="${v}" aria-pressed="${F[k] === v}">${t}</button>`;
  $('#r-chips').innerHTML = ch('m', 'secco', '<i class="dot" style="background:var(--green)"></i>A secco') + ch('m', 'salamoia', '<i class="dot" style="background:var(--amber)"></i>Salamoia', 'am') + ch('want', '1', '<svg style="width:14px;height:14px"><use href="#i-heart"/></svg>Da provare') + ch('kind', 'scorta', 'Scorta') + '<span class="chip-sep"></span>' + SEASONS.map(s => ch('s', s[0], s[1])).join('');
}
function initRecipes() {
  const vegs = [...new Set(DATA.recipes.flatMap(r => r.items.filter(i => i.type === 'vegetable').map(i => i.name)))].sort((a, b) => a.localeCompare(b, 'it'));
  $('#r-veg').innerHTML = `<option value="">Tutte le verdure</option>` + vegs.map(v => `<option>${esc(v)}</option>`).join('');
  renderChips(); renderHero(); renderRecipes(); initExtra();
  let qt; $('#r-q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { F.q = e.target.value; renderRecipes(); }, 120); });
  $('#r-veg').addEventListener('change', e => { F.veg = e.target.value; renderRecipes(); });
  $('#r-chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const k = b.dataset.k; F[k] = F[k] === b.dataset.v ? null : b.dataset.v; renderChips(); renderRecipes(); });
  $('#r-reset').addEventListener('click', () => { F.q = ''; F.m = F.s = F.want = F.kind = null; F.veg = ''; $('#r-q').value = ''; $('#r-veg').value = ''; renderChips(); renderRecipes(); });
  $('#r-grid').addEventListener('click', e => { const c = e.target.closest('.rcard'); if (c) openRecipe(+c.dataset.id); });
  const h = $('#r-hero');
  h.addEventListener('click', e => { const c = e.target.closest('.hero'); if (c) openRecipe(+c.dataset.id); });
  h.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.hero')) { e.preventDefault(); openRecipe(FEATURED); } });
  onView.ricette = () => { renderHero(); };
}
function parseNotes(r) {
  const steps = [], extra = [];
  for (const raw of String(r.notes || '').split('\n')) {
    const l = raw.trim(); if (!l) continue;
    const m = l.match(/^\d+\)\s*(.*)$/);
    if (m) steps.push(fixCut(m[1], r));
    else if (!/^(Ingredienti|Spezie)\s*:/i.test(l)) extra.push(l);
  }
  return { steps, extra };
}
function openRecipe(id) {
  const r = RBY.get(id); if (!r) return;
  const look = recipeLook(r), p = rPct(r), z = zoneOf(p, CFG[r.method]);
  const veg = r.items.filter(i => i.type === 'vegetable'), sp = r.items.filter(i => i.type === 'spice');
  const maxg = Math.max(1, ...veg.map(i => i.g)), { steps, extra } = parseNotes(r);
  const tile = (b, s, cls = '') => `<div class="stat ${cls}"><b>${b}</b><small>${s}</small></div>`;
  $('#dr-body').innerHTML = `
    <div class="sheet-top"><span class="mbadge ${r.method}" style="position:static">${r.method === 'secco' ? 'a secco' : 'salamoia'}</span><h2 id="dr-title">${esc(r.name)}</h2><button class="icon-btn" type="button" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <div class="sheet-scroll"><div class="rd">
      <div class="rd-vis">
        <div class="jarstage" style="background:radial-gradient(160px 130px at 50% 60%,${look.tint},transparent 75%)">${jarSVG({ ...look, fill: .86, bubbles: 9, seed: r.id + 1, animate: true, alt: r.name })}</div>
        <div class="stats">
          ${r.kind === 'bevanda' && !(r.salt_g > 0) ? tile(nf(r.total_weight_g) + ' g', 'totale') + (r.water_ml ? tile(nf(r.water_ml) + ' g', 'acqua') : '') : tile(nf(r.total_weight_g) + ' g', 'verdure') + tile(nf(r.salt_g, r.salt_g % 1 && r.salt_g < 10 ? 1 : 0) + ' g', 'sale') + tile(fp(Math.round(p * 100) / 100) + ' %', r.method === 'secco' ? 'sulle verdure' : "sull'acqua", z === 'ok' ? 'ok' : '') + (r.method === 'salamoia' ? tile(nf(r.water_ml) + ' ml', 'acqua') : '')}
          ${tile(nf(r.target_temp_c) + ' °C', 'temperatura')}${tile(nf(rMin(r), rMin(r) % 1 ? 1 : 0) + '+ gg', 'minimo')}
          ${crispAt(r) != null ? tile(nf(crispAt(r), crispAt(r) % 1 ? 1 : 0) + ' gg', 'croccante fino a', crispAt(r) <= rMin(r) + 2 ? 'warn' : '') : ''}${r.kind === 'scorta' ? tile('~' + Math.round((r.shelf_days || 0) / 30) + ' mesi', 'in dispensa') : ''}
        </div>
        <div class="actions" style="margin-top:0"><button class="btn primary" type="button" id="dr-start" style="flex:1;margin-left:0">${icon('jar')}Avvia vaso</button><button class="btn ghost" type="button" id="dr-adapt" style="flex:1">${icon('resize')}Adatta</button></div>
        <div class="actions" style="margin-top:8px"><button class="btn ghost${r.want ? ' on' : ''}" type="button" data-want="${r.id}" style="flex:1" id="dr-want"><svg><use href="#i-heart"/></svg>Da provare</button><button class="btn ghost" type="button" id="dr-label" style="flex:1">${icon('book')}Etichetta</button></div>
        ${crispAt(r) != null ? `<p class="how" style="margin-top:10px">${icon('info')}<span>Croccantezza: dopo il <b>pronto</b> (${nf(rMin(r), rMin(r) % 1 ? 1 : 0)} gg) passa in frigo entro <b>${nf(crispAt(r), crispAt(r) % 1 ? 1 : 0)} gg</b> a ${nf(r.target_temp_c)} °C: oltre ammorbidisce. Stima prudente per la verdura piu' delicata; poi in frigo (${fridgeT()} °C) ancora circa <b>${fridgeDays(r).d} gg</b> croccante${fridgeDays(r).n ? ` (media di ${fridgeDays(r).n} tuoi vasi)` : ''}.</span></p>` : ''}
        ${crispTips(r).length ? `<details class="tips"><summary>Per restare croccanti</summary><ul>${crispTips(r).map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
      </div>
      <div>
        <section class="rd-sec"><h4>Il tuo voto</h4><div class="rate"><div class="rate-stars" id="dr-stars" role="radiogroup" aria-label="Voto">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-s="${i}" role="radio" aria-checked="${i === (r.rating || 0)}" aria-label="${i} stelle" class="${i <= (r.rating || 0) ? 'on' : ''}"><svg><use href="#i-star"/></svg></button>`).join('')}</div><span class="saved" id="dr-rs">Salvato</span></div></section>
        <section class="rd-sec">${baseEditor('recipe:' + r.id, rBase(r), r.base_default ?? rBase(r), !!r.base_custom, 'vale anche per i vasi in corso')}</section>
        <section class="rd-sec"><h4>Verdure</h4><ul class="ing">${veg.map(i => `<li><i style="background:${vegColor(i.name)}"></i><span>${esc(i.name)}</span><em>${nf(i.g)} g</em><div class="bar"><b data-w="${(i.g / maxg * 100).toFixed(1)}" style="width:0;background:${vegColor(i.name)}"></b></div></li>`).join('') || '<li><span class="extra">—</span></li>'}</ul></section>
        ${sp.length ? `<section class="rd-sec"><h4>Spezie</h4><div class="spices">${sp.map(i => `<span><i style="background:${spColor(i.name)}"></i>${esc(i.name)}${i.g > 0 ? ` <b style="color:var(--mut);font-weight:600">${nf(i.g)} g</b>` : ''}</span>`).join('')}</div></section>` : ''}
        ${steps.length ? `<section class="rd-sec"><h4>Come si fa</h4><ol class="steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>${extra.length ? `<p class="extra" style="margin-top:10px">${extra.map(esc).join('<br>')}</p>` : ''}</section>` : ''}
        <section class="rd-sec taste"><h4>Note di assaggio</h4><textarea id="dr-notes" maxlength="4000" placeholder="Com'era? Acidità, croccantezza, sale…">${esc(r.tasted_notes || '')}</textarea>
          <div class="actions" style="margin-top:10px"><button class="btn ghost" type="button" id="dr-save">${icon('check')}Salva note</button><span class="saved" id="dr-ns">Salvate</span></div></section>
      </div>
    </div></div>`;
  const d = $('#dlg-r'); d.showModal(); settle(d);
  const flash = id_ => { const e = $(id_); e.classList.add('on'); setTimeout(() => e.classList.remove('on'), 1600); };
  const stars = $('#dr-stars');
  stars.addEventListener('mouseover', e => { const b = e.target.closest('button'); if (!b) return; $$('button', stars).forEach(x => x.classList.toggle('hov', +x.dataset.s <= +b.dataset.s)); });
  stars.addEventListener('mouseleave', () => $$('button', stars).forEach(x => x.classList.remove('hov')));
  stars.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const v = +b.dataset.s === r.rating ? 0 : +b.dataset.s;
    try {
      await api('/api/recipes/' + r.id, { method: 'POST', body: { rating: v } }); r.rating = v;
      $$('button', stars).forEach(x => { x.classList.toggle('on', +x.dataset.s <= v); x.setAttribute('aria-checked', String(+x.dataset.s === v)); });
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); flash('#dr-rs');
      const card = $(`.rcard[data-id="${r.id}"] .stars`); if (card) card.outerHTML = starsHTML(v);
    } catch (err) { toast(err.message, true); }
  });
  const saveNotes = async () => {
    const t = $('#dr-notes').value;
    if (t === (r.tasted_notes || '')) return;
    try { await api('/api/recipes/' + r.id, { method: 'POST', body: { tasted_notes: t } }); r.tasted_notes = t; flash('#dr-ns'); } catch (err) { toast(err.message, true); }
  };
  $('#dr-save').addEventListener('click', saveNotes);
  $('#dr-want').addEventListener('click', () => toggleWant(r.id));
  $('#dr-label').addEventListener('click', () => openLabel({ recipe: r }));
  $('#dr-notes').addEventListener('blur', saveNotes);
  $('#dr-start').addEventListener('click', () => { d.close(); openJar({ recipe_id: r.id, name: r.name, method: r.method, net_g: r.total_weight_g, water_g: r.water_ml, salt_g: r.salt_g }); });
  $('#dr-adapt').addEventListener('click', () => { d.close(); A.rid = r.id; adaptPickRecipe(r, true); go('adatta'); });
}

/* ======================================================
   RICERCA PER INGREDIENTI  (solo codice, istantanea, offline)
   ====================================================== */
/* il motore (sinonimi, errori di battitura, gruppi di sostituzione, classifica) e' in ricerca.js */
function buildVocApp() { buildVoc(DATA, (n, t) => t === 'vegetable' ? vegColor(n) : spColor(n)); }
/* --- stato e UI --- */
const IS = { items: [], live: [], unknown: [], lordo: '', tara: '', T: 20, method: null, saved: null };
const selNames = () => { const s = []; for (const x of [...IS.items, ...IS.live]) if (!s.includes(x.name)) s.push(x.name); return s; };
function ingChips() {
  const chip = (x, live) => {
    const e = VOC.byName.get(x.name) || { color: '#9ccc65', type: 'vegetable' };
    return `<span class="ichip${live ? ' live' : ''}" data-n="${esc(x.name)}"><i style="background:${e.color}"></i>${esc(x.name)}${!live && e.type === 'vegetable' ? `<input type="number" inputmode="decimal" min="0" step="10" placeholder="g" value="${x.g || ''}" aria-label="Grammi di ${esc(x.name)}">` : ''}${live ? '' : `<button type="button" aria-label="Togli ${esc(x.name)}">${icon('x')}</button>`}</span>`;
  };
  const liveOnly = IS.live.filter(l => !IS.items.some(x => x.name === l.name));
  $('#ing-chips').innerHTML = IS.items.map(x => chip(x, false)).join('') + liveOnly.map(x => chip(x, true)).join('');
  $('#ing-hints').innerHTML = IS.unknown.map(u => u.sugg.length
    ? `<span class="ihint">“${esc(u.word)}”? Intendevi ${u.sugg.map(s => `<button type="button" data-sugg="${esc(s)}" data-w="${esc(u.word)}">${esc(s)}</button>`).join(' o ')}?</span>`
    : `<span class="ihint ko">“${esc(u.word)}” non è nel ricettario: la ignoro</span>`).join('');
}
function ingAutocomplete() {
  const v = $('#ing-q').value, last = /\s$/.test(v) ? '' : n2(v).split(' ').pop() || '';
  const box = $('#ing-ac');
  if (last.length < 2 || isNum(last) || !IS.unknown.some(u => u.word === last)) { box.hidden = true; return; }
  const sel = selNames();
  let c = VOC.list.filter(e => !sel.includes(e.name) && n2(e.name).split(' ').some(w => w.startsWith(last)));
  if (c.length < 3) for (const s of suggest(last)) { const e = VOC.byName.get(s); if (e && !c.includes(e) && !sel.includes(s)) c.push(e); }
  c = c.slice(0, 7);
  if (!c.length) { box.hidden = true; return; }
  box.innerHTML = c.map((e, i) => `<button type="button" role="option" data-ac="${esc(e.name)}" class="${i ? '' : 'on'}"><i style="background:${e.color}"></i>${esc(e.name)}<small>${e.type === 'vegetable' ? 'verdura' : 'spezia'}</small></button>`).join('');
  box.hidden = false;
}
function ingParseLive() {
  const p = parseIng($('#ing-q').value);
  IS.live = p.found; IS.unknown = p.unknown;
  for (const f of p.found) if (f.g) { const it = IS.items.find(x => x.name === f.name); if (it) it.g = f.g; }
  IS.saved = null;
  ingChips(); ingAutocomplete(); ingResults(true);
}
function ingCommit(extraName, dropWord) {
  for (const f of IS.live) if (!IS.items.some(x => x.name === f.name)) IS.items.push({ name: f.name, g: f.g || '' });
  if (extraName && !IS.items.some(x => x.name === extraName)) IS.items.push({ name: extraName, g: '' });
  const rest = IS.unknown.map(u => u.word).filter(w => w !== dropWord);
  $('#ing-q').value = rest.length ? rest.join(' ') + ' ' : '';
  IS.live = []; IS.unknown = [];
  IS.method = null; IS.saved = null;
  const p = parseIng($('#ing-q').value); IS.unknown = p.unknown;
  ingChips(); $('#ing-ac').hidden = true; ingResults(true);
}
/* --- ricetta generata con le regole della guida --- */
function genRecipe() {
  const names = selNames(), vmap = { get: vegData, has: n => !!vegData(n) };
  const vegs = names.filter(n => vmap.has(n)), spices = names.filter(n => !vmap.has(n));
  if (!vegs.length) return null;
  const grams = n => num((IS.items.find(x => x.name === n) || IS.live.find(x => x.name === n) || {}).g) || 0;
  const gSum = vegs.reduce((s, n) => s + grams(n), 0), lordo = num(IS.lordo) || 0, tara = num(IS.tara) || 0;
  const net = lordo > 0 ? Math.max(0, lordo - tara) : gSum > 0 ? gSum : 1000;
  const example = !(lordo > 0) && !(gSum > 0);
  const share = n => gSum > 0 ? grams(n) / gSum : 1 / vegs.length;
  let sal = 0, sec = 0;
  for (const n of vegs) {
    const v = vmap.get(n), w = share(n);
    const cut = v.cut_style || '', thin = /sottil|fini|fettine|grattugi|julienne/i.test(cut);
    if (/salamoia/i.test(v.notes || '') || (!thin && /interi|cimette|spicchi|chicchi/i.test(cut))) sal += w;
    if (/secco|crauti|kimchi/i.test(v.notes || '') || thin) sec += w;
  }
  const auto = sal > sec ? 'salamoia' : 'secco', method = IS.method || auto;
  const base = Math.max(...vegs.map(n => vmap.get(n).base_days_20c || 7)), T = IS.T, f = Math.pow(Q10, (T - 20) / 10);
  const ready = Math.max(3, Math.max(base, 3.5) / f), taste = Math.max(.55 * base, 2) / f;
  // sale dai dati delle verdure scelte: media pesata, nel range della guida (secco 1,5-2,5 %, salamoia 3-5 %)
  const wPct = vegs.reduce((s, n) => s + (vmap.get(n).default_dry_pct || 2) * share(n), 0);
  const pct = method === 'secco' ? Math.min(2.5, Math.max(1.5, Math.round(wPct * 2) / 2)) : Math.min(5, Math.max(3, Math.round(wPct * 2) / 2));
  const water = method === 'salamoia' ? Math.round(net * (1 / .7 - 1) / 10) * 10 : 0;
  const salt = method === 'secco' ? net * pct / 100 : water * pct / 100;
  const low = s => s.charAt(0).toLowerCase() + s.slice(1);
  const lst = vegs.map((n, i) => i ? low(n) : n);
  const name = (lst.length > 1 ? lst.slice(0, -1).join(', ') + ' e ' + lst[lst.length - 1] : lst[0]) + (method === 'secco' ? ' a secco' : ' in salamoia');
  const sR = nf(salt, salt < 10 ? 1 : 0), dT = nf(taste, 0), dR = nf(ready, 0), pS = fp(pct);
  const steps = method === 'secco' ? [
    'Pela e taglia a fettine sottili o grattugia.',
    `Pesa le verdure al netto della tara: ${nf(net)} g.`,
    `Aggiungi ${sR} g di sale (${pS} %) e massaggia finché fanno liquido.`,
    'Pressa nel vaso: liquido sopra le verdure, 2–3 cm liberi in cima.',
    `Fermenta a ${nf(T)} °C: assaggia dal giorno ${dT}, pronto verso il giorno ${dR}. Poi frigo.`
  ] : [
    'Lava le verdure; lasciale intere o a pezzi grossi.',
    `Sciogli ${sR} g di sale in ${nf(water)} g d'acqua (${pS} %).`,
    `Metti nel vaso ${nf(net)} g di verdure${spices.length ? ' e le spezie' : ''} e copri con la salamoia.`,
    'Tienile sotto con un peso; lascia 2–3 cm liberi in cima.',
    `Fermenta a ${nf(T)} °C: assaggia dal giorno ${dT}, pronto verso il giorno ${dR}. Poi frigo.`
  ];
  const borrowed = vegs.filter(n => vmap.get(n).like).map(n => `${n}: tempi e sale come ${low(vmap.get(n).like)}.`).join(' ');
  const why = (auto === 'secco' ? 'A secco: verdure da tagliare fini o grattugiare.' : 'Salamoia: verdure intere o a pezzi grossi.') + (borrowed ? ' ' + borrowed : '');
  return { vegs, spices, net, example, method, auto, why, base, T, ready, taste, pct, water, salt, name, steps, share, grams };
}
function genLook(G) {
  const layers = G.vegs.map(n => ({ c: vegColor(n), f: G.share(n) }));
  const m = mix(layers), brine = G.method === 'salamoia' ? mix([{ c: toHex(m), f: .5 }, { c: '#f3d27a', f: .5 }]) : m;
  return { layers, mode: G.method, liquid: rgba(brine, G.method === 'salamoia' ? .42 : .5), tint: rgba(m, .2), spices: G.spices.map(spColor) };
}
function genCard() {
  const G = genRecipe();
  if (!G) return `<div class="gen empty-gen"><p>Aggiungi almeno una verdura: con le sole spezie non creo una ricetta.</p></div>`;
  const look = genLook(G);
  return `<article class="gen" id="gen" data-m="${G.method}" style="--tint:${look.tint}">
    <div class="gen-vis"><div class="jarstage" id="gen-jar">${jarSVG({ ...look, fill: .84, bubbles: 7, seed: 31, animate: true, alt: G.name })}</div></div>
    <div class="gen-body">
      <span class="ribbon"><svg><use href="#i-leaf"/></svg>Ricetta su misura</span>
      <h2 id="gen-name">${esc(G.name)}</h2>
      <p class="why">Nessuna ricetta le ha tutte: la creo con le regole della guida. ${G.why}</p>
      <div class="seg small${G.method === 'salamoia' ? ' right' : ''}" id="gen-m" role="radiogroup" aria-label="Metodo">
        <button type="button" role="radio" data-m="secco" aria-checked="${G.method === 'secco'}"><b>A secco</b><small>${G.auto === 'secco' ? 'consigliato' : '2 %'}</small></button>
        <button type="button" role="radio" data-m="salamoia" aria-checked="${G.method === 'salamoia'}"><b>Salamoia</b><small>${G.auto === 'salamoia' ? 'consigliato' : '3 %'}</small></button>
      </div>
      <div class="gen-w weigh">
        <label class="num"><span>Vaso + verdure</span><span class="inp"><input id="gen-lordo" type="number" inputmode="decimal" min="0" placeholder="0" value="${esc(IS.lordo)}"><i>g</i></span></label>
        <span class="op" aria-hidden="true">−</span>
        <label class="num"><span>Vaso vuoto</span><span class="inp"><input id="gen-tara" type="number" inputmode="decimal" min="0" placeholder="0" value="${esc(IS.tara)}"><i>g</i></span></label>
      </div>
      <div class="field"><span>${icon('thermo', 'ic')}Temperatura <output id="gen-t-o">${nf(IS.T)} °C</output></span><input type="range" class="plain temp" id="gen-t" min="14" max="28" step="1" value="${IS.T}"></div>
      <div class="stats" id="gen-stats"></div>
      <ol class="steps" id="gen-steps"></ol>
      <div class="actions"><button class="btn primary" type="button" id="gen-start">${icon('jar')}Avvia vaso</button><button class="btn ghost" type="button" id="gen-save">${icon('book')}Salva ricetta</button></div>
    </div></article>`;
}
function genUpdate() {
  const G = genRecipe(); if (!G || !$('#gen')) return;
  if ($('#gen').dataset.m !== G.method) { $('#gen').outerHTML = genCard(); settle($('#gen')); }
  else $('#gen-jar').innerHTML = jarSVG({ ...genLook(G), fill: .84, bubbles: 7, seed: 31, alt: G.name });
  $('#gen').style.setProperty('--tint', genLook(G).tint);
  const tile = (b, s, cls = '') => `<div class="stat ${cls}"><b>${b}</b><small>${s}</small></div>`;
  $('#gen-name').textContent = G.name;
  $('#gen-stats').innerHTML = tile(nf(G.net) + ' g', G.example ? 'verdure · esempio' : 'verdure nette')
    + tile(nf(G.salt, G.salt < 10 ? 1 : 0) + ' g', `sale · ${fp(G.pct)} %`, 'ok')
    + (G.method === 'salamoia' ? tile(nf(G.water) + ' g', 'acqua') : '')
    + tile('~' + nf(G.taste, 0) + ' gg', 'assaggia') + tile('~' + nf(G.ready, 0) + ' gg', `pronto · base ${nf(G.base)} gg`);
  $('#gen-steps').innerHTML = G.steps.map(s => `<li>${esc(s)}</li>`).join('');
  $('#gen-t-o').textContent = nf(IS.T) + ' °C';
  $('#gen-t').style.setProperty('--p', ((IS.T - 14) / 14 * 100) + '%');
}
function ingResults(rebuildGen) {
  const sel = selNames(), on = sel.length > 0;
  $('#ing-res').hidden = !on; $('#r-hero').hidden = on; $('.filters').hidden = on; $('#r-grid').hidden = on; $('#r-empty').hidden = true;
  if (!on) { $('#r-empty').hidden = !!$('#r-grid').children.length; return; }
  const R = rankRecipes(sel, DATA.recipes);
  const full = R.exact, subsL = R.withSubs, near = R.near, rest = R.rest;
  const lordo = num(IS.lordo) || 0, gSum = IS.items.reduce((s, x) => s + (num(x.g) || 0), 0), net = lordo > 0 ? Math.max(0, lordo - (num(IS.tara) || 0)) : gSum;
  const card = s => {
    let h = rCard(s.r).replace('<div class="rtop">', `<div class="rtop"><span class="cover ${s.cov === sel.length ? (s.subs.length ? 'sub' : 'all') : ''}">copre ${s.cov}/${sel.length}</span>`);
    let extra = '';
    if (s.subs.length) extra += `<div class="subs">${s.subs.map(x => `<p>${icon('resize')}<span>con sostituzione: <b>${esc(x.use)}</b> al posto di ${esc(x.instead)}${[...x.diff, ...(x.cautela ? [x.cautela] : [])].length ? `<small>${esc([...x.diff, ...(x.cautela ? [x.cautela] : [])].join(' · '))}</small>` : ''}</span></p>`).join('')}</div>`;
    if (net > 0) { const p = rPct(s.r), salt = s.r.method === 'secco' ? net * p / 100 : null; if (salt) extra += `<div class="mysalt">con i tuoi ${nf(net)} g → <b>${nf(salt, salt < 10 ? 1 : 0)} g sale</b></div>`; }
    if (extra) h = h.replace('<div class="vdots">', extra + '<div class="vdots">');
    return h;
  };
  const head = (t, n) => `<h3 class="res-h">${t} <small>${n}</small></h3>`;
  const keepGen = !rebuildGen && $('#gen');
  let html = '';
  const anyFull = full.length + subsL.length > 0;
  if (!anyFull) html += `<div id="gen-slot"></div>`;
  if (full.length) html += head(full.length === 1 ? 'Ha tutto' : 'Hanno tutto', full.length) + `<div class="grid">${full.map(card).join('')}</div>`;
  if (subsL.length) html += head('Con sostituzione', subsL.length) + `<div class="grid">${subsL.map(card).join('')}</div>`;
  if (near.length) html += head('Quasi', near.length) + `<div class="grid">${near.map(card).join('')}</div>`;
  if (rest.length) html += `<details class="others"><summary>Altre <b>${rest.length}</b></summary><div class="grid">${rest.map(card).join('')}</div></details>`;
  if (anyFull) html += `<div class="gen-offer"><button class="btn ghost" type="button" id="gen-open">${icon('leaf')}Oppure creane una su misura</button></div><div id="gen-slot"></div>`;
  const oldGen = keepGen ? $('#gen') : null;
  $('#ing-res').innerHTML = html;
  const slot = $('#gen-slot');
  if (slot && (!anyFull || IS.genOpen)) {
    if (oldGen) slot.replaceWith(oldGen); else { slot.outerHTML = genCard(); settle($('#gen') || document); }
    genUpdate();
  }
}
async function genSave() {
  const G = genRecipe(); if (!G) return;
  const vegItems = G.vegs.map(n => ({ type: 'vegetable', name: n, g: Math.round(G.net * G.share(n)) }));
  const body = {
    name: G.name, method: G.method, total_weight_g: G.net, brine_pct: G.method === 'salamoia' ? G.pct : null, target_temp_c: G.T,
    min_time_days: Math.round(adjDays(G.base, G.T) * 10) / 10, salt_g: Math.round(G.salt * 10) / 10, water_ml: G.water,
    notes: `Ingredienti: ${G.vegs.join(', ')}${G.spices.length ? '. Spezie: ' + G.spices.join(', ') : ''}. Creata il ${dIT(isoToday())}.\n` + G.steps.map((s, i) => `${i + 1}) ${s}`).join('\n'),
    items: [...vegItems, ...G.spices.map(n => ({ type: 'spice', name: n, g: 0 }))]
  };
  const r = await api('/api/recipes', { method: 'POST', body });
  IS.saved = r.id; IS.genOpen = false;
  await refreshAll(); buildVocApp();
  toast('Salvata nel ricettario');
  ingResults(true);
  const c = $(`#ing-res .rcard[data-id="${r.id}"]`); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); }
}
function initIngSearch() {
  buildVocApp();
  const q = $('#ing-q');
  q.addEventListener('input', ingParseLive);
  q.addEventListener('keydown', e => {
    const box = $('#ing-ac'), opts = $$('button', box), cur = opts.findIndex(o => o.classList.contains('on'));
    if (!box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); const n = (cur + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.classList.toggle('on', i === n)); return;
    }
    if (e.key === 'Tab' && !box.hidden && opts[cur]) { e.preventDefault(); acPick(opts[cur].dataset.ac); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (IS.live.length || !(!box.hidden && opts[cur])) ingCommit(); else acPick(opts[cur].dataset.ac); }
    if (e.key === 'Backspace' && !q.value && IS.items.length) { IS.items.pop(); IS.method = null; ingChips(); ingResults(true); }
    if (e.key === 'Escape') $('#ing-ac').hidden = true;
  });
  const acPick = name => {
    const words = q.value.replace(/\S+$/, '');
    q.value = words; const p = parseIng(words); IS.live = p.found; IS.unknown = p.unknown; ingCommit(name);
    q.focus();
  };
  $('#ing-ac').addEventListener('mousedown', e => { const b = e.target.closest('[data-ac]'); if (b) { e.preventDefault(); acPick(b.dataset.ac); } });
  q.addEventListener('blur', () => setTimeout(() => { $('#ing-ac').hidden = true; }, 150));
  $('#ing-hints').addEventListener('click', e => { const b = e.target.closest('[data-sugg]'); if (b) ingCommit(b.dataset.sugg, b.dataset.w); });
  $('#ing-chips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const n = b.closest('.ichip').dataset.n; IS.items = IS.items.filter(x => x.name !== n); IS.method = null; ingChips(); ingResults(true);
  });
  $('#ing-chips').addEventListener('input', e => {
    const inp = e.target.closest('input'); if (!inp) return;
    const it = IS.items.find(x => x.name === inp.closest('.ichip').dataset.n); if (it) it.g = inp.value;
    ingResults(false);
  });
  $('#ing-clear').addEventListener('click', () => { IS.items = []; IS.live = []; IS.unknown = []; IS.lordo = IS.tara = ''; IS.method = null; IS.genOpen = false; q.value = ''; ingChips(); ingResults(true); q.focus(); });
  $('#ing-res').addEventListener('click', async e => {
    const c = e.target.closest('.rcard'); if (c) return openRecipe(+c.dataset.id);
    if (e.target.closest('#gen-open')) { IS.genOpen = true; ingResults(true); $('#gen')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const m = e.target.closest('#gen-m button'); if (m) { IS.method = m.dataset.m; ingResults(true); return; }
    if (e.target.closest('#gen-start')) {
      const G = genRecipe(); if (!G) return;
      openJar({ name: G.name, method: G.method, net_g: G.net, water_g: G.water, salt_g: Math.round(G.salt * 10) / 10, temp_c: G.T, base_days: G.base, base_mode: G.base !== 7 ? 'tuo' : 'auto', recipe_id: IS.saved || null, notes: G.vegs.join(', ') + (G.spices.length ? ' · ' + G.spices.join(', ') : '') });
      return;
    }
    if (e.target.closest('#gen-save')) { const b = e.target.closest('#gen-save'); b.disabled = true; try { await genSave(); } catch (err) { toast(err.message, true); b.disabled = false; } }
  });
  $('#ing-res').addEventListener('input', e => {
    if (e.target.id === 'gen-lordo') IS.lordo = e.target.value;
    else if (e.target.id === 'gen-tara') IS.tara = e.target.value;
    else if (e.target.id === 'gen-t') IS.T = +e.target.value;
    else return;
    genUpdate();
  });
  ingChips();
}

/* ======================================================
   4. GUIDA
   ====================================================== */
function scaleIll() {
  return `<svg viewBox="0 0 170 110" aria-hidden="true"><ellipse cx="85" cy="104" rx="66" ry="5" fill="#000" opacity=".4"/>
    <rect x="22" y="72" width="126" height="30" rx="10" fill="#2a3a30"/><rect x="22" y="72" width="126" height="8" rx="4" fill="#3d5245"/>
    <rect x="52" y="82" width="66" height="15" rx="4" fill="#0d1a12"/><text x="85" y="94" text-anchor="middle" font-size="12" font-weight="700" fill="#8be36b" font-family="Bahnschrift,Segoe UI,sans-serif">1857 g</text>
    <g transform="translate(55 6) scale(.5)">${jarSVG({ fill: .8, layers: [{ c: '#ecdcb0', f: .34 }, { c: '#ff8a2b', f: .33 }, { c: '#dcb6e6', f: .33 }], liquid: 'rgba(232,217,168,.5)', bubbles: 4, seed: 3 }).replace('<svg ', '<svg width="120" height="170" ')}</g>
    <rect x="136" y="8" width="30" height="16" rx="8" fill="rgba(245,181,68,.18)"/><text x="151" y="20" text-anchor="middle" font-size="10" font-weight="800" fill="#f5b544" font-family="Bahnschrift,Segoe UI,sans-serif">TARA</text></svg>`;
}
function thermoIll() {
  return `<svg viewBox="0 0 120 110" aria-hidden="true"><rect x="50" y="6" width="20" height="74" rx="10" fill="rgba(255,255,255,.08)" stroke="rgba(225,255,240,.4)"/><rect x="55" y="30" width="10" height="56" rx="5" fill="#f5b544"/><circle cx="60" cy="88" r="15" fill="#f5b544" stroke="rgba(225,255,240,.4)"/><circle cx="55" cy="84" r="4" fill="#fff" opacity=".4"/>
    <g font-family="Bahnschrift,Segoe UI,sans-serif" font-size="10" font-weight="700"><text x="78" y="26" fill="#ff6b3d">+10° ÷2</text><text x="78" y="50" fill="#8be36b">20°</text><text x="78" y="74" fill="#5ab8ff">−10° ×2</text></g>
    <g stroke="rgba(255,255,255,.35)"><path d="M70 22h5M70 46h5M70 70h5"/></g></svg>`;
}
function saltIll() {
  return `<svg viewBox="0 0 140 110" aria-hidden="true"><ellipse cx="70" cy="100" rx="46" ry="5" fill="#000" opacity=".4"/><path d="M28 98c6-26 22-40 42-40s36 14 42 40z" fill="#f2f0ea"/><path d="M40 92c5-14 16-24 30-24" stroke="#fff" stroke-width="3" fill="none" opacity=".7" stroke-linecap="round"/>
    <g fill="#fff">${[[44, 40], [60, 30], [82, 36], [96, 46], [70, 18]].map(([x, y]) => `<rect x="${x}" y="${y}" width="5" height="5" rx="1" transform="rotate(25 ${x} ${y})"/>`).join('')}</g>
    <circle cx="112" cy="26" r="16" fill="rgba(255,92,122,.15)" stroke="#ff5c7a" stroke-width="2.5"/><text x="112" y="31" text-anchor="middle" font-size="14" font-weight="800" fill="#ff5c7a" font-family="Bahnschrift,Segoe UI,sans-serif">I</text><path d="M101 15l22 22" stroke="#ff5c7a" stroke-width="2.5"/></svg>`;
}
function topView(kind) {
  const R = rng(kind.length * 13 + 5);
  let s = `<svg viewBox="0 0 140 130" aria-hidden="true"><ellipse cx="70" cy="122" rx="52" ry="5" fill="#000" opacity=".4"/><circle cx="70" cy="62" r="56" fill="#c9a24a"/><circle cx="70" cy="62" r="50" fill="#8a6a2a"/><circle cx="70" cy="62" r="47" fill="${kind === 'bad' ? '#6b6a3a' : '#c9b46a'}"/>`;
  for (let k = 0; k < 26; k++) { const a = R() * 6.28, d = R() * 40; s += `<path d="M${(70 + Math.cos(a) * d).toFixed(1)} ${(62 + Math.sin(a) * d).toFixed(1)}l${(R() * 10 - 5).toFixed(1)} ${(R() * 6 - 3).toFixed(1)}" stroke="${['#ff8a2b', '#c5e17a', '#dcb6e6', '#ecdcb0'][k % 4]}" stroke-width="3" stroke-linecap="round" opacity=".85"/>`; }
  s += `<circle cx="70" cy="62" r="47" fill="rgba(240,220,150,.25)"/>`;
  if (kind === 'ok') s += `<g fill="none" stroke="#8be36b" stroke-width="2.4" stroke-linecap="round" opacity=".9"><path d="M54 30c-6-6 6-10 0-18"/><path d="M70 26c-6-6 6-10 0-18"/><path d="M86 30c-6-6 6-10 0-18"/></g>`;
  if (kind === 'kahm') s += `<path d="M40 50c8-10 22-6 30-2s20-4 28 4 2 20-8 22-16 8-28 4-24-14-22-28z" fill="#fbf8ee" opacity=".82"/><path d="M50 56c10 2 20 0 32 4" stroke="#e8e2cc" stroke-width="1.5" fill="none"/><path d="M60 80c6 2 10 0 14 3" stroke="#e8e2cc" stroke-width="1.5" fill="none"/>`;
  if (kind === 'bad') for (const [x, y, r, c] of [[52, 48, 11, '#2f7d4a'], [86, 58, 13, '#3a5fa8'], [64, 80, 9, '#1f2a24'], [92, 84, 7, '#d0507a']]) {
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
    for (let k = 0; k < 18; k++) { const a = k / 18 * 6.28 + R() * .3, l = r + 2 + R() * 4; s += `<path d="M${(x + Math.cos(a) * r * .6).toFixed(1)} ${(y + Math.sin(a) * r * .6).toFixed(1)}L${(x + Math.cos(a) * l).toFixed(1)} ${(y + Math.sin(a) * l).toFixed(1)}" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/>`; }
    s += `<circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .3}" fill="#fff" opacity=".18"/>`;
  }
  return s + '</svg>';
}
function renderGuide() {
  const jar = o => jarSVG({ seed: 9, ...o }).replace('<svg ', '<svg style="height:104px;width:auto" ');
  const cab = [{ c: '#c5e17a', f: .6 }, { c: '#ff8a2b', f: .4 }];
  const cards = [
    { t: 'A secco', big: 'verdure × 2 %', p: 'Sale sul peso delle verdure, senza il vaso. Massaggia finché fanno liquido.', ill: jar({ layers: cab, liquid: 'rgba(200,225,140,.5)', fill: .82, bubbles: 5 }), tint: 'rgba(139,227,107,.16)' },
    { t: 'Salamoia', big: 'acqua × 3–5 %', p: 'Sale sul peso dell’acqua. Per verdure intere o a pezzi grossi.', ill: jar({ mode: 'salamoia', layers: [{ c: '#4fae4a', f: .7 }, { c: '#f2ead6', f: .3 }], liquid: 'rgba(230,205,120,.42)', fill: .84, bubbles: 5, vegFrac: .7 }), tint: 'rgba(245,181,68,.16)' },
    { t: 'La tara', big: '2031 − 174 = 1857 g', p: 'Pesa il vaso vuoto prima di riempirlo. Scrivilo sul coperchio.', ill: scaleIll(), tint: 'rgba(245,181,68,.12)' },
    { wide: true, t: 'Quanto sale', html: `<div class="scale"><span style="left:9%">1,5</span><span style="left:30%">2</span><span style="left:48%">2,5</span><span style="left:86%">3–5</span><em style="left:9%">dolce<br>veloce</em><em style="left:30%">standard</em><em style="left:48%">caldo<br>più sicuro</em><em style="left:86%">salamoia<br>mesi</em></div><p style="margin-top:44px">Meno sale: più veloce, più morbido. Più sale: più lento, croccante, sicuro. Sopra 2,5 % a secco: troppo salato.</p>` },
    { t: 'Sotto il liquido', p: 'Sempre coperte. Un peso o una foglia di cavolo fanno da tappo.', ill: jar({ layers: cab, liquid: 'rgba(200,225,140,.5)', fill: .8, weight: true, bubbles: 3 }), tint: 'rgba(139,227,107,.12)' },
    { t: '2–3 cm liberi', p: 'Lascia spazio in cima: fa bolle e il liquido sale.', ill: jar({ layers: [{ c: '#b0124f', f: .5 }, { c: '#ff8a2b', f: .5 }], liquid: 'rgba(200,60,110,.45)', fill: .7, bubbles: 6 }), tint: 'rgba(230,73,128,.14)' },
    { t: '18–22 °C', html: `<p>Ogni +10 °C il tempo si dimezza, ogni −10 °C raddoppia.</p><div class="tempplay field" style="margin:6px 0 0"><span>Temperatura <output id="g-t-o">20 °C</output></span><input type="range" class="plain temp" id="g-t" min="10" max="30" step="1" value="20"><div class="out">7 gg a 20 °C →<b id="g-t-d">7 gg</b></div></div>`, ill: thermoIll(), tint: 'rgba(245,181,68,.12)' },
    { t: 'Giorni 1–3: sfiata', p: 'Se il vaso si gonfia, apri un attimo e richiudi.', ill: jar({ layers: cab, liquid: 'rgba(200,225,140,.5)', fill: .84, bubbles: 10, burp: true }), tint: 'rgba(139,227,107,.14)' },
    { t: 'Sale giusto', p: 'Non iodato e senza antiagglomeranti.', ill: saltIll(), tint: 'rgba(255,92,122,.1)' },
    { t: 'Troppo sale?', big: 'fino a 2,5 % va bene', p: 'Oltre, prima di chiudere: aggiungi altra verdura. Il sapore si ammorbidisce col tempo.', ill: jar({ layers: [{ c: '#ecdcb0', f: .34 }, { c: '#ff8a2b', f: .33 }, { c: '#dcb6e6', f: .33 }], liquid: 'rgba(232,217,168,.5)', fill: .76, bubbles: 4, label: '2,26 %' }), tint: 'rgba(139,227,107,.12)' },
    { t: 'Poi al fresco', p: 'Finita la fermentazione: frigo o cantina.', ill: jar({ layers: cab, liquid: 'rgba(200,225,140,.5)', fill: .82, bubbles: 0, cold: true }), tint: 'rgba(120,190,255,.14)' }
  ];
  $('#g-cards').innerHTML = cards.map(c => `<article class="gcard${c.wide ? ' wide' : ''}"${c.tint ? ` style="--tint:${c.tint}"` : ''}>${c.ill ? `<div class="gill">${c.ill}</div>` : ''}<h3>${c.t}</h3>${c.big ? `<div class="big">${c.big}</div>` : ''}${c.p ? `<p>${c.p}</p>` : ''}${c.html || ''}</article>`).join('');
  $('#g-safe').innerHTML = [
    ['ok', 'check', 'Va bene', 'Odore acido e fresco', 'Profuma di crauti, di limone, di pulito: è la fermentazione.'],
    ['kahm', 'spoon', 'Togli', 'Patina bianca piatta', 'È il kahm: non pericoloso. Toglila con un cucchiaio.'],
    ['bad', 'trash', 'Butta', 'Muffa pelosa colorata', 'Anche odore putrido o verdure molli e viscide: butta tutto.']
  ].map(([k, ic, v, h, p]) => `<article class="scard ${k}"><div class="sill">${topView(k)}</div><div class="stx"><span class="verd">${icon(ic)}${v}</span><h3>${h}</h3><p>${p}</p></div></article>`).join('');
  const t = $('#g-t');
  const upd = () => { const T = +t.value, d = adjDays(7, T); $('#g-t-o').textContent = T + ' °C'; $('#g-t-d').textContent = nf(d, d < 10 ? 1 : 0) + ' gg'; t.style.setProperty('--p', ((T - 10) / 20 * 100) + '%'); };
  t.addEventListener('input', upd); upd();
}

/* ======================================================
   5. ADATTA AL VASO
   ====================================================== */
const A = Object.assign({ rid: FEATURED, L: 1, head: 60, pf: .7, spices: true }, LS.get('adapt', {}));
const LITERS = [.5, .75, 1, 1.5, 2, 3, 5];
let adaptLast = null;
function adaptPickRecipe(r, resetJar) {
  A.rid = r.id;
  if (resetJar) {
    if (r.packing_fraction) A.pf = r.packing_fraction;
    if (r.headspace_ml) A.head = r.headspace_ml;
    if (r.jar_volume_ml) A.L = r.jar_volume_ml / 1000;
  }
  $('#a-recipe').value = r.id; $('#a-l').value = A.L; $('#a-head').value = A.head; $('#a-pf').value = A.pf; $('#a-spices').checked = A.spices;
  adaptRender(true);
}
function adaptRender(anim) {
  const r = RBY.get(A.rid); if (!r) return;
  LS.set('adapt', A);
  const jarMl = A.L * 1000, pf = clamp(A.pf, .5, .9), head = clamp(A.head, 0, jarMl);
  const target = Math.max(0, jarMl - head) * pf;
  const veg = r.items.filter(i => i.type === 'vegetable'), sp = r.items.filter(i => i.type === 'spice');
  const cur = veg.reduce((s, i) => s + i.g, 0);
  const k = cur > 0 ? target / cur : 0;
  let water = 0, salt = 0, pct = rPct(r);
  if (r.method === 'salamoia') { water = Math.max(0, jarMl * (1 - pf) - head); salt = water * pct / 100; }
  else salt = target * pct / 100;
  adaptLast = { r, target, water, salt, k };
  $('#a-head-o').textContent = nf(head) + ' ml';
  $('#a-pf-o').textContent = Math.round(pf * 100) + ' %';
  $('#a-head').style.setProperty('--p', (head / 300 * 100) + '%');
  $('#a-pf').style.setProperty('--p', ((pf - .5) / .4 * 100) + '%');
  $$('#a-liters button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.l - A.L) < 1e-6));
  $('#a-factor').textContent = '×' + nf(k, k < 10 ? 2 : 1);
  const look = recipeLook(r);
  const w = clamp(80 + 60 * Math.log2(Math.max(.25, A.L) * 2), 70, 210);
  $('#a-jar').closest('.ad-vis').style.setProperty('--tint', look.tint);
  $('#a-jar').innerHTML = jarSVG({ ...look, fill: clamp(1 - head / jarMl, 0, 1) * .97, vegFrac: pf, bubbles: 6, seed: r.id, width: w, animate: anim, label: nf(A.L, A.L % 1 ? 2 : 0) + ' L', alt: 'Vaso da ' + A.L + ' litri' });
  if (anim) settle($('#a-jar'));
  const tile = (b, s, cls = '') => `<div class="stat ${cls}"><b>${b}</b><small>${s}</small></div>`;
  $('#a-tiles').innerHTML = tile(nf(target) + ' g', 'verdure') + tile(nf(salt, salt < 10 ? 1 : 0) + ' g', `sale · ${fp(Math.round(pct * 100) / 100)} %`, 'ok') + (r.method === 'salamoia' ? tile(nf(water) + ' ml', 'acqua') : '') + tile(nf(rMin(r), rMin(r) % 1 ? 1 : 0) + '+ gg', `a ${nf(r.target_temp_c)} °C`);
  const maxg = Math.max(1, ...veg.map(i => i.g * k));
  $('#a-items').innerHTML = veg.map(i => `<li><i style="background:${vegColor(i.name)}"></i><span>${esc(i.name)}</span><em><s>${nf(i.g)}</s>${nf(i.g * k)} g</em><div class="bar"><b style="width:${(i.g * k / maxg * 100).toFixed(1)}%;background:${vegColor(i.name)}"></b></div></li>`).join('')
    + sp.map(i => `<li><i style="background:${spColor(i.name)}"></i><span style="color:var(--tx2)">${esc(i.name)}</span><em>${i.g > 0 ? (A.spices ? `<s>${nf(i.g)}</s>${nf(i.g * k, i.g * k < 10 ? 1 : 0)} g` : `${nf(i.g)} g`) : 'a piacere'}</em></li>`).join('');
  needRender();
}
function needRender() {
  const g = num($('#n-g').value), pf = clamp(A.pf, .5, .9);
  if (!(g > 0)) { $('#n-out').textContent = '—'; return; }
  const ml = g / pf + A.head, std = [250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000].find(x => x >= ml);
  $('#n-out').innerHTML = `${ml >= 1000 ? nf(ml / 1000, 2) + ' L' : nf(ml) + ' ml'}${std ? ` <small style="font:600 14px var(--f-sans);color:var(--mut)">→ vaso da ${std >= 1000 ? nf(std / 1000, std % 1000 ? 1 : 0) + ' L' : std + ' ml'}</small>` : ''}`;
}
function initAdapt() {
  if (!RBY.get(A.rid)) A.rid = RBY.has(FEATURED) ? FEATURED : DATA.recipes[0]?.id;
  $('#a-recipe').innerHTML = recipeOptions(A.rid, false);
  $('#a-liters').innerHTML = LITERS.map(l => `<button type="button" data-l="${l}">${nf(l, l % 1 ? 2 : 0).replace(/0$/, '').replace(/,$/, '')} L</button>`).join('');
  $('#a-recipe').addEventListener('change', e => { const r = RBY.get(+e.target.value); if (r) adaptPickRecipe(r, true); });
  $('#a-liters').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; A.L = +b.dataset.l; $('#a-l').value = A.L; adaptRender(true); });
  $('#a-l').addEventListener('input', e => { const v = num(e.target.value); if (v > 0) { A.L = v; adaptRender(false); } });
  $('#a-head').addEventListener('input', e => { A.head = +e.target.value; adaptRender(false); });
  $('#a-pf').addEventListener('input', e => { A.pf = +e.target.value; adaptRender(false); });
  $('#a-spices').addEventListener('change', e => { A.spices = e.target.checked; adaptRender(false); });
  $('#n-g').addEventListener('input', needRender);
  $('#a-start').addEventListener('click', () => {
    const { r, target, water, salt } = adaptLast || {}; if (!r) return;
    openJar({ recipe_id: r.id, name: r.name, method: r.method, net_g: target, water_g: water, salt_g: Math.round(salt * 10) / 10 });
  });
  $('#a-l').value = A.L; $('#a-head').value = A.head; $('#a-pf').value = A.pf; $('#a-spices').checked = A.spices;
  onView.adatta = () => adaptRender(true);
}

/* ======================================================
   KOMBUCHA  (tutto in grammi: 1 L d'acqua = 1000 g)
   ====================================================== */
const KB_DEF = { per_litro: { tea_g: [5, 8, 6], sugar_g: [50, 80, 70] }, starter_pct: [5, 20, 10], f1: { temp: [20, 26], days: [7, 14], taste_from: [5, 7], base_days_20: 12 }, ph: { target: [2.5, 3.5], safe_below: 4.2 }, f2: { days: [2, 4] }, steps: [], safety_ok: [], safety_bad: [], rules: [] };
const KBD = () => (DATA.drinks && DATA.drinks.kombucha) || KB_DEF;
function kombuLook() { return { mode: 'kombucha', layers: [], liquid: 'rgba(196,122,40,.58)', tint: 'rgba(214,150,60,.2)', spices: [] }; }
let K = Object.assign({ mode: 'litri', L: 2, lordo: '', tara: '', tea: 6, sug: 70, st: 10, d: '' }, LS.get('kombu', {}));
let kFill = -1, kLast = null;
const r5 = x => Math.round(x / 5) * 5;
function kCalc() {
  const st = clamp(K.st, 5, 20) / 100;
  let water, tot;
  if (K.mode === 'litri') { tot = Math.max(0, num(K.L) || 0) * 1000; water = tot * (1 - st); }
  else { water = Math.max(0, (num(K.lordo) || 0) - (num(K.tara) || 0)); tot = water / (1 - st); }
  const Lb = tot / 1000, starter = tot - water, sugar = K.sug * Lb, tea = K.tea * Lb;
  const d = num(K.d);
  let scLo, scHi, area = 0;
  if (d > 0) { area = Math.PI * (d / 2) ** 2; scLo = r5(area * .5); scHi = r5(area * 1.0); }
  else { const m = r5(25 * Lb + 25); scLo = Math.max(30, m - 15); scHi = m + 15; }
  const R = { water: r5(water), sugar: r5(sugar), tea: Math.round(tea * 2) / 2, starter: r5(starter), scLo, scHi, area, Lb };
  R.total = R.water + R.sugar + R.starter;
  return R;
}
function kRender(anim) {
  LS.set('kombu', K);
  segSet('#k-mode', K.mode);
  $('#k-litri').hidden = K.mode !== 'litri'; $('#k-pesa').hidden = K.mode !== 'pesa';
  $$('#k-lchips button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.l - num(K.L)) < 1e-6));
  $('#k-tea-o').textContent = nf(K.tea, K.tea % 1 ? 1 : 0) + ' g/L'; $('#k-tea').style.setProperty('--p', ((K.tea - 5) / 3 * 100) + '%');
  $('#k-sug-o').textContent = nf(K.sug) + ' g/L'; $('#k-sug').style.setProperty('--p', ((K.sug - 50) / 30 * 100) + '%');
  $('#k-st-o').textContent = K.st + ' %'; $('#k-st').style.setProperty('--p', ((K.st - 5) / 15 * 100) + '%');
  const R = kCalc(); kLast = R;
  const row = (c, name, sub, val, u = 'g') => `<li><span class="ki" style="background:${c}22"><i style="background:${c}"></i></span><span>${name}<small>${sub}</small></span><em>${val}<i>${u}</i></em></li>`;
  $('#k-res').innerHTML = R.Lb > 0
    ? row('#5ab8ff', 'Acqua', 'si pesa: 1 L = 1000 g', nf(R.water))
      + row('#f5f2ea', 'Zucchero', `${nf(K.sug)} g per litro`, nf(R.sugar))
      + row('#8a5a2b', 'Tè in foglie', `${nf(K.tea, K.tea % 1 ? 1 : 0)} g per litro · poi si tolgono`, nf(R.tea, R.tea % 1 ? 1 : 0))
      + row('#d6963c', 'Starter', `liquido del lotto prima · ${K.st} %`, nf(R.starter))
      + row('#eadfc4', 'SCOBY', 'indicativo · non critico', `${nf(R.scLo)}–${nf(R.scHi)}`)
    : `<li><span class="ki"></span><span>${K.mode === 'litri' ? 'Scrivi i litri' : 'Pesa contenitore con acqua e vuoto'}<small>il resto lo calcolo io</small></span><em>—</em></li>`;
  $('#k-tot').innerHTML = R.Lb > 0 ? `<span>Totale di controllo<br><small style="color:var(--mut)">acqua + zucchero + starter</small></span><b>${nf(R.total)} g</b>` : '';
  $('#k-scoby-h').innerHTML = R.area > 0
    ? `SCOBY: basta un disco che copra la superficie. Vaso Ø ${nf(num(K.d), num(K.d) % 1 ? 1 : 0)} cm → superficie ~${nf(R.area)} cm², disco 0,5–1 cm ≈ ${nf(R.scLo)}–${nf(R.scHi)} g.`
    : 'SCOBY: non è critico, basta un disco che copra la superficie. Tipico 50–100 g per 1–3 L. Scrivi il diametro del vaso per una stima.';
  const fill = R.Lb > 0 ? .3 + .55 * Math.min(1, R.Lb / 5) : .05;
  if (Math.abs(fill - kFill) > .001) {
    const first = kFill < 0;
    $('#k-jar').innerHTML = jarSVG({ ...kombuLook(), fill, bubbles: 8, seed: 77, cloth: true, animate: first || anim, startOff: first ? null : ((fill - kFill) * 118).toFixed(1), alt: 'Vaso di kombucha' });
    kFill = fill; settle($('#k-jar'));
  }
}
function bottleSVG() {
  return `<svg viewBox="0 0 90 120" aria-hidden="true"><ellipse cx="45" cy="116" rx="24" ry="3" fill="#000" opacity=".45"/>
    <defs><clipPath id="btc"><path d="M37 14h16v14c0 6 14 12 14 26v52a8 8 0 0 1-8 8H31a8 8 0 0 1-8-8V54c0-14 14-20 14-26z"/></clipPath></defs>
    <g clip-path="url(#btc)"><rect x="0" y="40" width="90" height="80" fill="rgba(206,132,50,.62)"/><circle cx="38" cy="96" r="7" fill="#ff8a2b"/><circle cx="38" cy="96" r="4.5" fill="#ffb066"/><circle cx="54" cy="84" r="6" fill="#f2d34a"/><rect x="44" y="100" width="12" height="6" rx="2" fill="#e3b770"/>
      ${[[32, 70], [50, 62], [58, 92], [42, 80], [36, 58]].map(([x, y], i) => `<circle class="bub" cx="${x}" cy="${y}" r="1.6" fill="#fff" fill-opacity=".4" stroke="#fff" stroke-opacity=".8" stroke-width=".5" style="--h:-${y - 42}px;--d:${2 + i * .4}s;--dl:${i * .5}s"/>`).join('')}</g>
    <path d="M37 14h16v14c0 6 14 12 14 26v52a8 8 0 0 1-8 8H31a8 8 0 0 1-8-8V54c0-14 14-20 14-26z" fill="rgba(255,255,255,.06)" stroke="rgba(225,255,240,.45)" stroke-width="1.6"/>
    <path d="M28 56v44" stroke="#fff" stroke-opacity=".3" stroke-width="3" stroke-linecap="round"/>
    <rect x="35" y="6" width="20" height="9" rx="3" fill="#e9e9e4"/><path d="M35 12c-6 2-6 10 0 12M55 12c6 2 6 10 0 12" stroke="#b9bbb3" stroke-width="1.6" fill="none"/>
    <g stroke="#f5b544" stroke-width="2" stroke-linecap="round" fill="none"><path d="M28 6l-6-4M62 6l6-4M45 2V-4"/></g></svg>`;
}
function kTopView(kind) {
  const R = rng(kind.length * 31 + 7);
  let s = `<svg viewBox="0 0 140 130" aria-hidden="true"><ellipse cx="70" cy="122" rx="52" ry="5" fill="#000" opacity=".4"/><circle cx="70" cy="62" r="56" fill="#d9d2c0" opacity=".25"/><circle cx="70" cy="62" r="50" fill="#9a6224"/><circle cx="70" cy="62" r="46" fill="#ecdfc2"/>`;
  for (let k = 0; k < 14; k++) { const a = R() * 6.28, d = R() * 34; s += `<ellipse cx="${(70 + Math.cos(a) * d).toFixed(1)}" cy="${(62 + Math.sin(a) * d).toFixed(1)}" rx="${(3 + R() * 6).toFixed(1)}" ry="${(2 + R() * 3).toFixed(1)}" fill="#d8c597" opacity=".7"/>`; }
  if (kind === 'new') s += `<path d="M36 52c10-14 30-16 44-10s22 12 18 26-26 22-40 18-28-18-22-34z" fill="#f8f2e2" opacity=".9"/><path d="M48 60c10 4 22 2 32 6" stroke="#e6dcc2" stroke-width="1.4" fill="none"/>`;
  if (kind === 'strands') for (let k = 0; k < 9; k++) { const x = 34 + R() * 72, y = 36 + R() * 50; s += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}q${(R() * 10 - 5).toFixed(1)} 8 ${(R() * 6 - 3).toFixed(1)} ${(10 + R() * 10).toFixed(1)}" stroke="#6b3d14" stroke-width="${(1.6 + R() * 1.4).toFixed(1)}" fill="none" stroke-linecap="round" opacity=".85"/>`; }
  if (kind === 'bad') for (const [x, y, r, c] of [[54, 50, 11, '#2f7d4a'], [86, 62, 12, '#3a5fa8'], [62, 82, 8, '#1f2a24']]) {
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
    for (let k = 0; k < 18; k++) { const a = k / 18 * 6.28 + R() * .3, l = r + 2 + R() * 4; s += `<path d="M${(x + Math.cos(a) * r * .6).toFixed(1)} ${(y + Math.sin(a) * r * .6).toFixed(1)}L${(x + Math.cos(a) * l).toFixed(1)} ${(y + Math.sin(a) * l).toFixed(1)}" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/>`; }
  }
  return s + '</svg>';
}
function renderKombuStatic() {
  const k = KBD(), f1 = k.f1, ph = k.ph;
  $('#k-steps').innerHTML = (k.steps.length ? k.steps : KOMBU_STEPS).map(s => `<li>${esc(s)}</li>`).join('');
  const pos = p => ((p - 2) / 3.2 * 100).toFixed(1) + "%";
  $('#k-facts').innerHTML = `
    <article class="kfact"><div class="gill">${jarSVG({ ...kombuLook(), fill: .8, bubbles: 6, seed: 4, cloth: true }).replace('<svg ', '<svg style="height:92px;width:auto" ')}</div><small>1a fermentazione</small><b>${f1.days[0]}–${f1.days[1]} giorni</b><p>a ${f1.temp[0]}–${f1.temp[1]} °C · assaggia dal giorno ${f1.taste_from[0]}–${f1.taste_from[1]}</p></article>
    <article class="kfact kbase">${baseEditor('kombucha', k.base_eff ?? 12, k.base_default ?? 12, !!k.base_custom, 'vale anche per i lotti in corso')}</article>
    <article class="kfact"><small>pH obiettivo</small><b>${nf(ph.target[0], 1)}–${nf(ph.target[1], 1)}</b>
      <div class="phbar" style="background:linear-gradient(90deg,#f5b544 0%,#8be36b ${pos(ph.target[0])},#8be36b ${pos(ph.target[1])},#f5b544 ${pos(ph.safe_below)},#ff5c7a calc(${pos(ph.safe_below)} + 2%),#ff5c7a 100%)"><span style="left:${pos(ph.target[0])}">${nf(ph.target[0], 1)}</span><span style="left:${pos(ph.target[1])}">${nf(ph.target[1], 1)}</span><span style="left:${pos(ph.safe_below)}">${nf(ph.safe_below, 1)}</span></div>
      <p>Sicuro sotto ${nf(ph.safe_below, 1)}. Striscia pH facoltativa.</p></article>
    <article class="kfact"><div class="gill">${bottleSVG()}</div><small>2a fermentazione · facoltativa</small><b>${k.f2.days[0]}–${k.f2.days[1]} giorni</b><p>In bottiglia con frutta o zenzero. Attenzione: la pressione sale.</p></article>
    <article class="kfact"><div class="gill">${jarSVG({ ...kombuLook(), fill: .8, bubbles: 0, cold: true, seed: 8 }).replace('<svg ', '<svg style="height:92px;width:auto" ')}</div><small>Poi</small><b>in frigo</b><p>Lascia sempre starter e SCOBY per il lotto dopo.</p></article>`;
  $('#k-safe').innerHTML = [
    ['ok', 'check', 'Normale', 'Patina nuova sopra', 'È lo SCOBY che cresce: liscio, chiaro.', 'new'],
    ['ok', 'check', 'Normale', 'Filamenti marroni', 'Sono lieviti: pendono sotto lo SCOBY.', 'strands'],
    ['bad', 'trash', 'Butta tutto', 'Muffa pelosa colorata', 'Sullo SCOBY: verde, blu, nera, pelosa.', 'bad']
  ].map(([c, ic, v, h, p, kind]) => `<article class="scard ${c}"><div class="sill">${kTopView(kind)}</div><div class="stx"><span class="verd">${icon(ic)}${v}</span><h3>${h}</h3><p>${p}</p></div></article>`).join('');
  $('#k-rules').innerHTML = (k.rules.length ? k.rules : []).map(r => `<span>${icon('info')}${esc(r)}</span>`).join('');
}
const KOMBU_STEPS = ['Pesa l\'acqua: 1 L = 1000 g.'];
function renderKombuJars() {
  const L = JARS.filter(j => isKombu(j) && j.status !== 'finito');
  const el = $('#k-list'); if (!el) return;
  el.innerHTML = L.length ? L.map(jarCard).join('') : `<div class="empty" style="padding:20px"><p>Nessun lotto in corso</p></div>`;
  settle(el);
}
function initKombu() {
  $('#k-lchips').innerHTML = [1, 2, 3, 4, 5].map(l => `<button type="button" data-l="${l}">${l} L</button>`).join('');
  $('#k-l').value = K.L; $('#k-lordo').value = K.lordo; $('#k-tara').value = K.tara; $('#k-d').value = K.d;
  $('#k-tea').value = K.tea; $('#k-sug').value = K.sug; $('#k-st').value = K.st;
  $('#k-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { K.mode = b.dataset.m; kRender(); } });
  $('#k-lchips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { K.L = +b.dataset.l; $('#k-l').value = K.L; kRender(); } });
  const bind = (sel, key, isNum) => $(sel).addEventListener('input', e => { K[key] = isNum ? +e.target.value : e.target.value; kRender(); });
  bind('#k-l', 'L'); bind('#k-lordo', 'lordo'); bind('#k-tara', 'tara'); bind('#k-d', 'd');
  bind('#k-tea', 'tea', true); bind('#k-sug', 'sug', true); bind('#k-st', 'st', true);
  const start = () => { const R = kCalc(); openJar({ kind: 'kombucha', name: 'Kombucha ' + dIT(isoToday()), water_g: R.water, sugar_g: R.sugar, tea_g: R.tea, starter_g: R.starter, scoby_g: R.Lb > 0 ? r5((R.scLo + R.scHi) / 2) : 0 }); };
  $('#k-start').addEventListener('click', start);
  $('#k-new').addEventListener('click', start);
  jarActions($('#k-list'));
  renderKombuStatic(); kRender();
  onView.kombucha = () => { kFill = -1; kRender(true); renderKombuJars(); };
}

/* ---------- avvio ---------- */
function floaters() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const R = rng(42); let s = '';
  for (let k = 0; k < 16; k++) { const sz = 6 + R() * 22; s += `<span style="left:${(R() * 100).toFixed(1)}%;width:${sz.toFixed(0)}px;height:${sz.toFixed(0)}px;animation-duration:${(18 + R() * 26).toFixed(1)}s;animation-delay:${(-R() * 40).toFixed(1)}s;--dx:${((R() - .5) * 120).toFixed(0)}px"></span>`; }
  $('#floaters').innerHTML = s;
}
function initDialogs() {
  $$('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  });
}
async function init() {
  floaters();
  $('#today').textContent = dIT(isoToday());
  initDialogs(); initCalc(); initJarForm(); initDetail(); initSensor(); renderGuide();
  go(location.hash.slice(1) || 'sale');
  try {
    const [d, j] = await Promise.all([api('/api/data'), api('/api/jars')]);
    DATA = d; JARS = j;
    RBY = new Map(DATA.recipes.map(r => [r.id, r]));
    const cnt = {}; DATA.recipes.forEach(r => { cnt[r.name] = (cnt[r.name] || 0) + 1; }); DUP = new Set(Object.keys(cnt).filter(n => cnt[n] > 1));
    initJars(); initRecipes(); initIngSearch(); initAdapt(); initKombu();
    renderJars(); renderMeteo(); loadSensor();
    const v = location.hash.slice(1); if (onView[v]) onView[v]();
  } catch (err) {
    console.error(err); toast('Server non raggiungibile: il calcolatore funziona comunque', true);
  }
}
window.openJar = openJar;
init();
