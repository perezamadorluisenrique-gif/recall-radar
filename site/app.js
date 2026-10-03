import { toFullRow, liveUrl, parseContact } from './cpsc.js';
import { buildIndex, search, checkItems, extractItems, looksLikeUpc, lookupUpc, tokenize } from './match.js';

// ---------- tiny helpers ----------
const $ = (sel) => document.querySelector(sel);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('rr.' + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('rr.' + key, JSON.stringify(value));
    } catch {}
  },
};
const fmtDate = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const LABEL = { exact: 'Barcode match', strong: 'Model match', likely: 'Likely match', possible: 'Possible match' };

// ---------- data ----------
const state = { index: null, live: false, details: new Map(), meta: null };

async function loadData() {
  try {
    const [rows, meta] = await Promise.all([
      fetch('data/index.json').then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch('data/meta.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    state.index = buildIndex(rows);
    state.meta = meta;
    const when = meta ? ` · updated ${new Date(meta.updated).toLocaleDateString()}` : '';
    $('#freshness').textContent = `${rows.length.toLocaleString()} recalls${when}`;
  } catch {
    state.live = true;
    $('#freshness').textContent = 'Live CPSC search';
  }
}

// Live mode: ask the CPSC API directly (used when no snapshot is deployed).
async function liveSearch(query) {
  const words = tokenize(query).filter((t) => !/^\d+$/.test(t));
  if (!words.length) return [];
  const res = await fetch(liveUrl({ ProductName: words.slice(0, 2).join(' ') }));
  if (!res.ok) throw new Error('CPSC API ' + res.status);
  const rows = (await res.json()).map(toFullRow);
  rows.forEach((r) => state.details.set(r.n, r.x));
  return rows;
}

async function find(query, opts) {
  if (state.live) return search(buildIndex(await liveSearch(query)), query, opts);
  return search(state.index, query, opts);
}

async function detailsFor(row) {
  if (state.details.has(row.n)) return state.details.get(row.n);
  const year = row.d.slice(0, 4);
  const file = await fetch(`data/details/${year}.json`).then((r) => r.json());
  for (const [n, x] of Object.entries(file)) state.details.set(n, x);
  return state.details.get(row.n) || {};
}

// ---------- saved items & remedies ----------
let mine = store.get('mine', []); // {id, name, added, recall?: row, status?}
const saveMine = () => {
  store.set('mine', mine);
  const open = mine.filter((m) => m.recall && m.status !== 'done').length;
  const c = $('#mine-count');
  c.hidden = !mine.length;
  c.textContent = open ? `${open} ⚠` : mine.length;
  c.classList.toggle('warn', open > 0);
};

function addMine(name, recall) {
  const existing = recall && mine.find((m) => m.recall && m.recall.n === recall.n);
  if (existing) return existing;
  const item = { id: crypto.randomUUID?.() || String(Date.now()), name, added: new Date().toISOString().slice(0, 10), recall: recall || null, status: recall ? 'todo' : null };
  mine.unshift(item);
  saveMine();
  return item;
}

// Re-check watched items against the latest snapshot.
async function recheckMine() {
  if (!state.index) return;
  const found = [];
  for (const item of mine) {
    if (item.recall) continue;
    const hit = search(state.index, item.name, { minConfidence: 'likely', limit: 1 })[0];
    if (hit && !(item.dismissed || []).includes(hit.row.n)) found.push({ item, hit });
  }
  const box = $('#alerts');
  box.replaceChildren();
  for (const { item, hit } of found) {
    box.append(
      el('div', { class: 'alert' },
        el('strong', {}, `“${item.name}” may be recalled`),
        el('p', {}, hit.row.t),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary small', onclick: () => { item.recall = hit.row; item.status = 'todo'; saveMine(); openWizard(item); recheckMine(); } }, 'It’s mine, fix it'),
          el('button', { class: 'btn ghost small', onclick: () => { (item.dismissed ||= []).push(hit.row.n); saveMine(); recheckMine(); } }, 'Not my model'),
        ),
      ),
    );
  }
}

// ---------- rendering ----------
function recallCard(hit, { context } = {}) {
  const { row, confidence } = hit;
  const body = el('div', { class: 'card-more', hidden: true });
  const card = el('article', { class: `card ${confidence}` },
    el('div', { class: 'card-head' },
      el('span', { class: `chip ${confidence}` }, LABEL[confidence]),
      el('time', { datetime: row.d }, fmtDate(row.d)),
    ),
    el('h3', {}, row.t),
    row.p && el('p', { class: 'product' }, row.p),
    row.m && el('p', { class: 'models' }, 'Models: ', row.m),
    context && el('p', { class: 'context' }, 'From your list: ', el('em', {}, context)),
    body,
    el('div', { class: 'row' },
      el('button', { class: 'btn primary small', onclick: () => openWizard(addMine(context || row.p || row.t, row)) }, 'I own this'),
      el('button', { class: 'btn ghost small', onclick: (e) => toggleDetails(row, body, e.currentTarget) }, 'Details'),
    ),
  );
  return card;
}

async function toggleDetails(row, body, btn) {
  if (!body.hidden) {
    body.hidden = true;
    btn.textContent = 'Details';
    return;
  }
  btn.textContent = 'Loading…';
  try {
    const x = await detailsFor(row);
    body.replaceChildren(
      x.img && el('img', { src: x.img, alt: '', loading: 'lazy' }),
      x.h && el('p', {}, el('b', {}, 'Hazard: '), x.h),
      x.r && el('p', {}, el('b', {}, 'Remedy: '), x.r),
      x.sold && el('p', {}, el('b', {}, 'Sold: '), x.sold),
      x.units && el('p', {}, el('b', {}, 'Units: '), x.units),
      x.url && el('a', { href: x.url, target: '_blank', rel: 'noopener' }, 'Official CPSC notice ↗'),
    );
    body.hidden = false;
    btn.textContent = 'Hide details';
  } catch {
    btn.textContent = 'Details unavailable';
  }
}

function emptyState(text, sub) {
  return el('div', { class: 'empty' }, el('p', { class: 'ok' }, text), sub && el('p', {}, sub));
}

async function runSearch(query, target) {
  query = query.trim();
  if (!query) return;
  target.replaceChildren(el('p', { class: 'loading' }, 'Checking recalls…'));
  try {
    const hits = await find(query, { limit: 20 });
    if (!hits.length) {
      target.replaceChildren(
        emptyState(`No recalls found for “${query}”.`, 'That’s good news, but try the brand plus product type, or the model number, to be sure.'),
        el('button', { class: 'btn ghost', onclick: () => { addMine(query); renderMine(); flash(`Watching “${query}” for future recalls`); } }, `Watch “${query}” for future recalls`),
      );
      return;
    }
    target.replaceChildren(
      el('p', { class: 'summary' }, `${hits.length}${hits.length === 20 ? '+' : ''} recall${hits.length > 1 ? 's' : ''} mention this. Check the model and dates.`),
      ...hits.map((h) => recallCard(h)),
    );
  } catch (err) {
    target.replaceChildren(emptyState('Couldn’t reach the recall database.', String(err.message || err)));
  }
}

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('[role=tabpanel]').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  if (name !== 'scan') stopCamera();
  if (name === 'mine') renderMine();
  store.set('tab', name);
}
document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- search tab ----------
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch($('#q').value, $('#search-results'));
});
$('#examples').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  $('#q').value = e.target.textContent;
  runSearch($('#q').value, $('#search-results'));
});

// ---------- scan tab ----------
let stream = null;
let scanning = false;
async function startCamera() {
  const video = $('#video');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    flash('Camera not available. Type the barcode number instead.');
    return;
  }
  video.srcObject = stream;
  await video.play();
  $('#scan-start').hidden = true;
  scanning = true;
  const detect = await makeDetector();
  const tick = async () => {
    if (!scanning) return;
    const code = await detect(video).catch(() => null);
    if (code) {
      navigator.vibrate?.(60);
      stopCamera();
      $('#upc').value = code;
      lookupBarcode(code);
    } else requestAnimationFrame(() => setTimeout(tick, 120));
  };
  tick();
}
function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('#scan-start').hidden = false;
}
async function makeDetector() {
  if ('BarcodeDetector' in window) {
    const d = new BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8'] });
    return async (v) => (await d.detect(v))[0]?.rawValue;
  }
  const { BrowserMultiFormatReader } = await import('https://esm.sh/@zxing/browser@0.1.5');
  const reader = new BrowserMultiFormatReader();
  const canvas = document.createElement('canvas');
  return async (v) => {
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      return null;
    }
  };
}
$('#scan-start').addEventListener('click', startCamera);
$('#upc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  lookupBarcode($('#upc').value);
});

// Barcode: exact UPC hit if CPSC listed it, otherwise look up the product name and search by that.
async function lookupBarcode(code) {
  code = code.replace(/\D/g, '');
  const out = $('#scan-results');
  if (code.length < 8) return flash('That doesn’t look like a barcode number.');
  out.replaceChildren(el('p', { class: 'loading' }, `Looking up ${code}…`));
  const exact = state.index && lookupUpc(state.index, code);
  if (exact) return out.replaceChildren(el('p', { class: 'summary danger' }, 'This exact barcode is on a recall notice.'), recallCard(exact));
  const name = await productName(code);
  if (!name) {
    return out.replaceChildren(
      emptyState(`No recall lists barcode ${code}.`, 'Most recall notices don’t include barcodes, so search by brand and product name too.'),
      nameSearchForm(out),
    );
  }
  const hits = (await find(name, { minConfidence: 'possible', limit: 10 })) || [];
  out.replaceChildren(
    el('p', { class: 'summary' }, 'Barcode is ', el('b', {}, name)),
    ...(hits.length ? hits.map((h) => recallCard(h, { context: name })) : [emptyState('No recalls match this product.', 'Nice. Add it to My stuff and we’ll keep checking.')]),
    el('button', { class: 'btn ghost', onclick: () => { addMine(name); flash('Added to My stuff'); } }, 'Add to My stuff'),
  );
}
function nameSearchForm(out) {
  const input = el('input', { placeholder: 'Brand and product, e.g. Graco Pack n Play' });
  return el('form', { class: 'searchbar', onsubmit: (e) => { e.preventDefault(); runSearch(input.value, out); } }, input, el('button', { class: 'btn' }, 'Search'));
}
async function productName(upc) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${upc}.json?fields=product_name,brands`);
    const j = await r.json();
    if (j.product?.product_name) return [j.product.brands?.split(',')[0], j.product.product_name].filter(Boolean).join(' ');
  } catch {}
  try {
    const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`);
    const j = await r.json();
    const it = j.items?.[0];
    if (it?.title) return it.brand && !it.title.toLowerCase().includes(it.brand.toLowerCase()) ? `${it.brand} ${it.title}` : it.title;
  } catch {}
  return null;
}

// ---------- orders tab ----------
const SAMPLE = `Order placed March 3, 2023
Anker PowerCore 10000 Portable Charger, Ultra-Compact Power Bank
$25.99
Sold by: AnkerDirect
Fisher-Price Rock 'n Play Sleeper
Organic Cotton Bath Towels, 6 pack
Order placed June 12, 2024
ESR HaloLock Magnetic Wireless Power Bank 10000mAh
Stainless Steel Water Bottle 32 oz`;
$('#orders-sample').addEventListener('click', () => {
  $('#orders').value = SAMPLE;
  checkOrders();
});
$('#orders-check').addEventListener('click', checkOrders);

async function checkOrders() {
  const text = $('#orders').value;
  const out = $('#orders-results');
  const items = extractItems(text);
  if (!items.length) return flash('Paste a few product names first.');
  out.replaceChildren(el('p', { class: 'loading' }, `Checking ${items.length} items…`));
  let results;
  if (state.live) {
    results = [];
    for (const item of items.slice(0, 15)) results.push({ item, matches: await find(item, { minConfidence: 'likely', limit: 3 }).catch(() => []) });
  } else results = checkItems(state.index, text);
  const flagged = results.filter((r) => r.matches.length);
  const clear = results.filter((r) => !r.matches.length);
  out.replaceChildren(
    el('p', { class: `summary ${flagged.length ? 'danger' : 'ok'}` },
      flagged.length ? `${flagged.length} of ${results.length} items may be recalled.` : `All ${results.length} items are clear.`),
    ...flagged.flatMap((r) => r.matches.map((m) => recallCard(m, { context: r.item }))),
    clear.length &&
      el('details', { class: 'clear' },
        el('summary', {}, `${clear.length} item${clear.length > 1 ? 's' : ''} with no recall`),
        el('ul', {}, clear.map((r) => el('li', {}, r.item))),
        el('button', { class: 'btn ghost small', onclick: () => { clear.forEach((r) => addMine(r.item)); flash(`Watching ${clear.length} items for future recalls`); } }, 'Watch these for future recalls'),
      ),
  );
}

// ---------- my stuff ----------
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#add-name').value.trim();
  if (!name) return;
  $('#add-name').value = '';
  addMine(name);
  renderMine();
  await recheckMine();
});

const STATUS = [
  ['todo', 'Not started'],
  ['stopped', 'Stopped using it'],
  ['contacted', 'Contacted the company'],
  ['waiting', 'Waiting on refund / repair'],
  ['done', 'Resolved'],
];

function renderMine() {
  const list = $('#mine-list');
  if (!mine.length) return list.replaceChildren(emptyState('Nothing here yet.', 'Add things you own, especially baby gear, chargers, heaters and appliances.'));
  list.replaceChildren(
    ...mine.map((item) =>
      el('article', { class: `card mine ${item.recall ? (item.status === 'done' ? 'resolved' : 'recalled') : ''}` },
        el('div', { class: 'card-head' },
          el('span', { class: `chip ${item.recall ? (item.status === 'done' ? 'ok' : 'strong') : 'watch'}` }, item.recall ? STATUS.find((s) => s[0] === item.status)?.[1] : 'Watching'),
          el('time', {}, 'Added ', fmtDate(item.added)),
        ),
        el('h3', {}, item.name),
        item.recall && el('p', { class: 'product' }, item.recall.t),
        el('div', { class: 'row' },
          item.recall && el('button', { class: 'btn primary small', onclick: () => openWizard(item) }, item.status === 'done' ? 'View' : 'Continue remedy'),
          el('button', { class: 'btn ghost small', onclick: () => { mine = mine.filter((m) => m !== item); saveMine(); renderMine(); recheckMine(); } }, 'Remove'),
        ),
      ),
    ),
  );
}

// ---------- remedy wizard ----------
const profile = store.get('profile', {});

function message(item, x, p) {
  const r = item.recall;
  const want = (x.ro || []).map((o) => o.toLowerCase()).join(' or ') || 'remedy';
  const blank = (v, label) => v || `[${label}]`;
  const subject = `Recall ${r.n}: ${r.p || r.t} – ${want} request`;
  const body = `Hello,

I own a product covered by the recall announced on ${fmtDate(r.d)} (CPSC recall #${r.n}):
${r.t}

I have stopped using it and would like the ${want} described in the recall notice.

Product / model: ${blank(p.model, 'model or serial number')}
Bought from: ${blank(p.where, 'store or website')}, ${blank(p.when, 'approximate purchase date')}

Name: ${blank(p.name, 'your name')}
Shipping address: ${blank(p.address, 'your address')}
Phone: ${blank(p.phone, 'your phone')}

Please confirm the next steps and send a prepaid return label or any instructions I need.

Thank you.`;
  return { subject, body };
}

async function openWizard(item) {
  const dlg = $('#wizard');
  const r = item.recall;
  const x = await detailsFor(r).catch(() => ({}));
  const contact = parseContact(x.c || '');
  const p = { ...profile, ...(item.claim || {}) };
  const subjectEl = el('input', { class: 'subject', 'aria-label': 'Email subject' });
  const bodyEl = el('textarea', { rows: 12, 'aria-label': 'Message' });
  const refresh = () => {
    const m = message(item, x, p);
    subjectEl.value = m.subject;
    bodyEl.value = m.body;
  };
  const field = (key, label, attrs = {}) =>
    el('label', {}, label,
      el('input', { value: p[key] || '', ...attrs, oninput: (e) => {
        p[key] = e.target.value;
        if (['name', 'address', 'phone'].includes(key)) { profile[key] = p[key]; store.set('profile', profile); }
        item.claim = { model: p.model, where: p.where, when: p.when };
        saveMine();
        refresh();
      } }),
    );
  refresh();

  const statusSel = el('select', { onchange: (e) => { item.status = e.target.value; saveMine(); renderMine(); } },
    STATUS.map(([v, l]) => el('option', { value: v, selected: item.status === v }, l)));
  const mailto = () => `mailto:${contact.emails[0]}?subject=${encodeURIComponent(subjectEl.value)}&body=${encodeURIComponent(bodyEl.value)}`;

  dlg.replaceChildren(
    el('form', { method: 'dialog', class: 'wiz' },
      el('header', {},
        el('h2', {}, 'Get your remedy'),
        el('button', { class: 'close', value: 'close', 'aria-label': 'Close' }, '×'),
      ),
      el('p', { class: 'wiz-title' }, r.t),

      el('ol', { class: 'steps' },
        el('li', {},
          el('h4', {}, 'Confirm it’s yours'),
          el('p', {}, 'Check the model number and where you bought it against the notice.'),
          r.m && el('p', {}, el('b', {}, 'Models: '), r.m),
          x.sold && el('p', {}, el('b', {}, 'Sold: '), x.sold),
          x.img && el('img', { src: x.img, alt: 'Recalled product', loading: 'lazy' }),
          x.url && el('a', { href: x.url, target: '_blank', rel: 'noopener' }, 'Open the official notice ↗'),
        ),
        el('li', {},
          el('h4', {}, 'Stop using it'),
          x.h && el('p', { class: 'hazard' }, x.h),
        ),
        el('li', {},
          el('h4', {}, `Claim your ${(x.ro || []).join(' / ').toLowerCase() || 'remedy'}`),
          x.r && el('p', {}, x.r),
          el('div', { class: 'grid' },
            field('model', 'Model / serial'),
            field('where', 'Bought from'),
            field('when', 'When'),
            field('name', 'Your name', { autocomplete: 'name' }),
            field('phone', 'Phone', { autocomplete: 'tel', inputmode: 'tel' }),
            field('address', 'Address', { autocomplete: 'street-address' }),
          ),
          subjectEl,
          bodyEl,
          el('div', { class: 'row wrap' },
            contact.emails[0] && el('a', { class: 'btn primary small', href: '#', onclick: (e) => { e.currentTarget.href = mailto(); if (item.status === 'todo' || item.status === 'stopped') { item.status = 'contacted'; statusSel.value = 'contacted'; saveMine(); } } }, `Email ${contact.emails[0]}`),
            ...contact.phones.slice(0, 1).map((ph) => el('a', { class: 'btn small', href: 'tel:' + ph.replace(/[^\d+]/g, '') }, `Call ${ph}`)),
            ...contact.urls.slice(0, 2).map((u) => el('a', { class: 'btn small', href: u, target: '_blank', rel: 'noopener' }, 'Recall page ↗')),
            el('button', { class: 'btn ghost small', type: 'button', onclick: async (e) => { await navigator.clipboard?.writeText(`${subjectEl.value}\n\n${bodyEl.value}`); e.target.textContent = 'Copied'; } }, 'Copy message'),
          ),
          x.c && el('p', { class: 'fine' }, x.c),
        ),
        el('li', {},
          el('h4', {}, 'Track it'),
          el('label', { class: 'status' }, 'Status ', statusSel),
        ),
      ),
    ),
  );
  dlg.showModal();
}

// ---------- misc ----------
function flash(text) {
  const t = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

saveMine();
showTab(store.get('tab', 'search'));
await loadData();
recheckMine();
const q = new URLSearchParams(location.search).get('q');
if (q) {
  showTab('search');
  $('#q').value = q;
  runSearch(q, $('#search-results'));
}
