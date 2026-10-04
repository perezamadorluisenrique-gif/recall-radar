import { toFullRow, liveUrl, parseContact } from './cpsc.js';
import { buildIndex, search, checkItems, extractItems, lookupUpc, tokenize } from './match.js';
import { CATEGORIES } from './tags.js';
import * as cars from './vehicles.js';

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
const fmtDate = (d) => (d ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtMonth = (d) => (d ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '');
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const LABEL = { exact: 'Barcode match', strong: 'Model match', likely: 'Brand and product match', possible: 'Similar product' };
const SOURCE = { cpsc: 'Product', fda: 'Food' };
const appUrl = (params = '') => location.origin + location.pathname + params;

// ---------- data ----------
const state = { rows: [], index: null, live: false, details: new Map(), meta: null, byNumber: new Map() };
let indexReady;

async function loadData() {
  try {
    const [rows, meta] = await Promise.all([
      fetch('data/index.json').then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch('data/meta.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    state.rows = rows;
    state.meta = meta;
    rows.forEach((r) => state.byNumber.set(r.n, r));
    const when = meta ? ` · updated ${new Date(meta.updated).toLocaleDateString()}` : '';
    $('#freshness').textContent = meta?.sample ? `Demo data: ${rows.length} sample recalls` : `${rows.length.toLocaleString()} recalls${when}`;
  } catch {
    state.live = true;
    $('#freshness').textContent = 'Live CPSC search';
  }
  // Paint the feed first; build the search index when the browser is idle.
  indexReady = new Promise((resolve) =>
    (window.requestIdleCallback || ((f) => setTimeout(f, 30)))(() => {
      state.index = buildIndex(state.rows);
      resolve(state.index);
    }),
  );
}

// Live mode: ask the CPSC API directly (used when no snapshot is deployed).
async function liveSearch(query) {
  const words = tokenize(query).filter((t) => !/^\d+$/.test(t));
  if (!words.length) return [];
  const res = await fetch(liveUrl({ ProductName: words.slice(0, 2).join(' ') }));
  if (!res.ok) throw new Error('CPSC API ' + res.status);
  const rows = (await res.json()).map(toFullRow);
  rows.forEach((r) => {
    state.details.set(r.n, r.x);
    state.byNumber.set(r.n, r);
  });
  return rows;
}

async function find(query, opts) {
  if (state.live) return search(buildIndex(await liveSearch(query)), query, opts);
  return search(await indexReady, query, opts);
}

async function detailsFor(row) {
  if (state.details.has(row.n)) return state.details.get(row.n);
  const file = await fetch(`data/details/${row.s || 'cpsc'}-${row.d.slice(0, 4)}.json`).then((r) => r.json());
  for (const [n, x] of Object.entries(file)) state.details.set(n, x);
  return state.details.get(row.n) || {};
}

// ---------- saved items ----------
// item: {id, kind: 'item'|'vehicle', name, added, recall?, status?, date?, dismissed?, car?, seen?}
let mine = store.get('mine', []);
const uid = () => crypto.randomUUID?.() || String(Date.now() + Math.random());
const saveMine = () => {
  store.set('mine', mine);
  const open = mine.filter((m) => (m.recall && m.status !== 'done') || (m.kind === 'vehicle' && m.openCount)).length;
  const c = $('#mine-count');
  c.hidden = !mine.length;
  c.textContent = open ? `${open} ⚠` : mine.length;
  c.classList.toggle('warn', open > 0);
};

function addMine(name, recall, extra = {}) {
  const existing = recall ? mine.find((m) => m.recall && m.recall.n === recall.n) : mine.find((m) => !m.recall && m.kind !== 'vehicle' && m.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const item = { id: uid(), kind: 'item', name, added: today(), recall: recall || null, status: recall ? 'todo' : null, ...extra };
  mine.unshift(item);
  saveMine();
  return item;
}

// Re-check watched items and vehicles; show an alert for anything new.
async function recheckMine() {
  const box = $('#alerts');
  const found = [];
  if (!state.live) {
    const index = await indexReady;
    for (const item of mine) {
      if (item.recall || item.kind === 'vehicle') continue;
      const hit = search(index, item.name, { minConfidence: 'likely', limit: 3 }).find(
        (h) => !(item.dismissed || []).includes(h.row.n) && !(item.date && h.row.d < item.date && yearsApart(h.row.d, item.date) > 0.5),
      );
      if (hit) found.push({ item, hit });
    }
  }
  box.replaceChildren(
    ...found.map(({ item, hit }) =>
      el('div', { class: 'alert' },
        el('strong', {}, `“${item.name}” may be recalled`),
        el('p', {}, hit.row.t),
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn primary small', onclick: () => { item.recall = hit.row; item.status = 'todo'; saveMine(); openWizard(item); recheckMine(); renderMine(); } }, 'It’s mine, fix it'),
          el('button', { class: 'btn small', onclick: () => openRecall(hit.row) }, 'View recall'),
          el('button', { class: 'btn ghost small', onclick: () => { (item.dismissed ||= []).push(hit.row.n); saveMine(); recheckMine(); } }, 'Not my model'),
        ),
      ),
    ),
  );
  recheckVehicles();
}
const yearsApart = (a, b) => Math.abs(new Date(b) - new Date(a)) / (365.25 * 864e5);

async function recheckVehicles() {
  const vehicles = mine.filter((m) => m.kind === 'vehicle').slice(0, 5);
  for (const v of vehicles) {
    try {
      const list = await cars.recallsFor(v.car);
      const fresh = list.filter((c) => !(v.seen || []).includes(c.id));
      v.openCount = list.length;
      saveMine();
      if (fresh.length && v.seen) {
        $('#alerts').append(
          el('div', { class: 'alert' },
            el('strong', {}, `New recall for your ${v.name}`),
            el('p', {}, fresh[0].component ? `${fresh[0].component}: ${fresh[0].summary.slice(0, 140)}…` : fresh[0].summary.slice(0, 160)),
            el('div', { class: 'row' },
              el('button', { class: 'btn primary small', onclick: () => { showTab('car'); showCar(v.car, v.vin); } }, 'See it'),
              el('button', { class: 'btn ghost small', onclick: (e) => { v.seen = list.map((c) => c.id); saveMine(); e.target.closest('.alert').remove(); } }, 'Dismiss'),
            ),
          ),
        );
      }
    } catch {}
  }
}

// ---------- recall cards ----------
function tagChips(row) {
  return (row.z || []).length ? el('div', { class: 'tags' }, row.z.map((z) => el('span', { class: 'tag' }, z))) : null;
}

function sourceLine(row) {
  const bits = [SOURCE[row.s || 'cpsc']];
  if (row.c) bits.push(`Class ${row.c}`);
  if (row.done) bits.push('Closed');
  return bits.join(' · ');
}

function recallCard(row, { confidence, context, date, note } = {}) {
  const level = confidence || (row.s === 'fda' && row.c === 'I' ? 'strong' : 'feed');
  return el('article', { class: `card ${level}` },
    el('div', { class: 'card-head' },
      confidence ? el('span', { class: `chip ${confidence}` }, LABEL[confidence]) : el('span', { class: 'chip src' }, sourceLine(row)),
      el('time', { datetime: row.d }, fmtDate(row.d)),
    ),
    el('h3', {}, el('button', { class: 'linkish', onclick: () => openRecall(row) }, row.t)),
    row.p && row.s !== 'fda' && el('p', { class: 'product' }, row.p),
    tagChips(row),
    context && el('p', { class: 'context' }, 'From your list: ', el('em', {}, context), date ? ` · bought ${fmtMonth(date)}` : ''),
    note && el('p', { class: 'note' }, note),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary small', onclick: () => openWizard(addMine(context || row.p || row.t, row, date ? { date } : {})) }, 'I own this'),
      el('button', { class: 'btn ghost small', onclick: () => openRecall(row) }, 'View recall'),
    ),
  );
}

function emptyState(text, sub) {
  return el('div', { class: 'empty' }, el('p', { class: 'ok' }, text), sub && el('p', {}, sub));
}

// ---------- recall sheet (also the target of ?recall= links) ----------
async function openRecall(row) {
  const dlg = $('#sheet');
  dlg.replaceChildren(el('div', { class: 'wiz' }, el('p', { class: 'loading' }, 'Loading recall…')));
  if (!dlg.open) dlg.showModal();
  const x = await detailsFor(row).catch(() => ({}));
  const link = appUrl(`?recall=${encodeURIComponent(row.n)}`);
  const contact = parseContact(x.c || '');
  history.replaceState(null, '', `?recall=${encodeURIComponent(row.n)}`);
  dlg.replaceChildren(
    el('div', { class: 'wiz' },
      el('header', {},
        el('span', { class: 'chip src' }, sourceLine(row), ' · ', fmtDate(row.d)),
        el('button', { class: 'close', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'),
      ),
      el('h2', { id: 'sheet-title' }, row.t),
      tagChips(row),
      x.img && el('img', { class: 'hero-img', src: x.img, alt: 'Recalled product', loading: 'lazy', onerror: (e) => e.target.remove() }),
      x.h && el('section', { class: 'hazard' }, el('h4', {}, 'Hazard'), el('p', {}, x.h)),
      x.r && el('section', {}, el('h4', {}, 'What to do'), el('p', {}, x.r)),
      x.desc && el('section', {}, el('h4', {}, row.s === 'fda' ? 'Product' : 'How to identify it'), el('p', {}, x.desc)),
      x.codes && el('section', {}, el('h4', {}, 'Lot and package codes'), el('p', { class: 'codes' }, x.codes)),
      (x.sold || x.units) && el('section', {}, el('h4', {}, row.s === 'fda' ? 'Distribution' : 'Where it was sold'), x.sold && el('p', {}, x.sold), x.units && el('p', { class: 'muted' }, 'Units: ', x.units)),
      x.inj && !/^none/i.test(x.inj) && el('section', {}, el('h4', {}, 'Incidents'), el('p', {}, x.inj)),
      x.firm && el('p', { class: 'muted' }, x.firm),
      (contact.phones.length || contact.emails.length) && el('p', { class: 'muted' }, 'Contact: ', [...contact.phones.slice(0, 1), ...contact.emails.slice(0, 1)].join(' · ')),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn primary small', onclick: () => { dlg.close(); openWizard(addMine(row.p || row.t, row)); } }, 'I own this'),
        el('button', { class: 'btn small', onclick: (e) => share(row.t, link, e.currentTarget) }, 'Share'),
        x.url && el('a', { class: 'btn ghost small', href: x.url, target: '_blank', rel: 'noopener' }, 'Official notice ↗'),
      ),
    ),
  );
}
$('#sheet').addEventListener('close', () => {
  if (new URLSearchParams(location.search).has('recall')) history.replaceState(null, '', location.pathname);
});

async function share(title, url, btn) {
  try {
    if (navigator.share) return await navigator.share({ title, text: `Recall: ${title}`, url });
  } catch {
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied';
  } catch {
    prompt('Copy this link', url);
  }
}

// ---------- search tab ----------
async function runSearch(query, target) {
  query = query.trim();
  if (!query) return;
  $('#feed').hidden = target === $('#search-results');
  target.replaceChildren(el('p', { class: 'loading' }, 'Checking recalls…'));
  try {
    const hits = await find(query, { limit: 20 });
    if (!hits.length) {
      target.replaceChildren(
        emptyState(`No recalls found for “${query}”.`, 'That’s good news. To be thorough, try the brand plus product type, or the model number printed on the label.'),
        el('button', { class: 'btn ghost', onclick: () => { addMine(query); renderMine(); flash(`Watching “${query}” for future recalls`); } }, `Watch “${query}” for future recalls`),
      );
      return;
    }
    const strongest = hits[0].confidence;
    target.replaceChildren(
      el('p', { class: 'summary' }, `${hits.length}${hits.length === 20 ? '+' : ''} ${hits.length === 1 ? 'recall matches' : 'recalls match'}. ${strongest === 'exact' || strongest === 'strong' ? 'Check the details to confirm.' : 'Compare the model number and dates with yours.'}`),
      ...hits.map((h) => recallCard(h.row, { confidence: h.byNumber ? null : h.confidence })),
      el('button', { class: 'btn ghost', onclick: () => { addMine(query); renderMine(); flash(`Watching “${query}” for future recalls`); } }, `None of these? Watch “${query}” for future recalls`),
    );
  } catch (err) {
    target.replaceChildren(emptyState('Couldn’t reach the recall database.', String(err.message || err)));
  }
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!$('#q').value.trim()) {
    $('#search-results').replaceChildren();
    $('#feed').hidden = false;
    return;
  }
  runSearch($('#q').value, $('#search-results'));
});
$('#q').addEventListener('input', () => {
  if (!$('#q').value.trim()) {
    $('#search-results').replaceChildren();
    $('#feed').hidden = false;
  }
});
$('#examples').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  $('#q').value = e.target.textContent;
  runSearch($('#q').value, $('#search-results'));
});

// ---------- feed ----------
let feedFilter = store.get('feedFilter', 'all');
let feedShown = 10;
function renderFeed() {
  if (!state.rows.length) {
    $('#feed').hidden = true;
    return;
  }
  const since = daysAgo(45);
  const recent = state.rows.filter((r) => r.d >= since);
  const groups = [['all', 'All'], ['food', 'Food'], ...CATEGORIES.map(([k, label]) => [k, label])];
  const counts = Object.fromEntries(groups.map(([k]) => [k, k === 'all' ? recent.length : recent.filter((r) => r.g === k).length]));
  $('#feed-count').textContent = `${plural(recent.filter((r) => r.d >= daysAgo(7)).length, 'new recall')} this week`;
  $('#feed-filters').replaceChildren(
    ...groups.filter(([k]) => counts[k]).map(([k, label]) =>
      el('button', { type: 'button', class: 'filter', 'aria-pressed': String(feedFilter === k), onclick: () => { feedFilter = k; feedShown = 10; store.set('feedFilter', k); renderFeed(); } }, label, el('span', { class: 'n' }, counts[k])),
    ),
  );
  const list = feedFilter === 'all' ? recent : recent.filter((r) => r.g === feedFilter);
  // Collapse near-duplicate FDA entries (one firm, one day, many SKUs) into the first one.
  const seen = new Set();
  const deduped = list.filter((r) => {
    if (r.s !== 'fda') return true;
    const k = `${r.b}|${r.d}|${(r.z || []).join()}`;
    return !seen.has(k) && seen.add(k);
  });
  $('#feed-list').replaceChildren(...deduped.slice(0, feedShown).map((r) => recallCard(r)));
  $('#feed-more').hidden = deduped.length <= feedShown;
}
$('#feed-more').addEventListener('click', () => {
  feedShown += 20;
  renderFeed();
});

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('[role=tabpanel]').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  if (name !== 'scan') stopCamera();
  if (name === 'mine') renderMine();
  if (name === 'car') initCar();
  store.set('tab', name);
}
document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

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

// Barcode: exact hit if a notice lists it, otherwise look up the product name and search by that.
async function lookupBarcode(code) {
  code = code.replace(/\D/g, '');
  const out = $('#scan-results');
  if (code.length < 8) return flash('That doesn’t look like a barcode number.');
  out.replaceChildren(el('p', { class: 'loading' }, `Looking up ${code}…`));
  const index = state.live ? null : await indexReady;
  const exact = index ? lookupUpc(index, code) : [];
  if (exact.length) {
    return out.replaceChildren(el('p', { class: 'summary danger' }, 'This exact barcode is on a recall notice.'), ...exact.map((h) => recallCard(h.row, { confidence: 'exact' })));
  }
  const name = await productName(code);
  if (!name) {
    return out.replaceChildren(
      emptyState(`No recall lists barcode ${code}.`, 'Most product recall notices don’t include barcodes, so search by brand and product name too.'),
      nameSearchForm(out),
    );
  }
  const hits = await find(name, { minConfidence: 'likely', limit: 10 });
  out.replaceChildren(
    el('p', { class: 'summary' }, 'Barcode ', code, ' is ', el('b', {}, name), '. No recall lists this barcode.'),
    ...(hits.length
      ? [el('p', { class: 'muted' }, 'Recalls from the same brand for similar products:'), ...hits.map((h) => recallCard(h.row, { confidence: h.confidence, context: name }))]
      : [emptyState('No recalls match this product.', 'Nice. Add it to Mine and RecallRadar will keep checking.')]),
    el('button', { class: 'btn ghost', onclick: () => { addMine(name); flash('Added to Mine'); } }, 'Add to Mine'),
  );
}
function nameSearchForm(out) {
  const input = el('input', { placeholder: 'Brand and product, e.g. Graco Pack n Play', 'aria-label': 'Brand and product' });
  return el('form', { class: 'searchbar', onsubmit: (e) => { e.preventDefault(); runSearch(input.value, out); } }, input, el('button', { class: 'btn' }, 'Search'));
}
async function productName(upc) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${upc}.json?fields=product_name,brands`);
    const j = await r.json();
    if (j.product?.product_name) return [j.product.brands?.split(',')[0], j.product.product_name].filter(Boolean).join(' ');
  } catch {}
  try {
    const r = await fetch(`https://world.openproductsfacts.org/api/v2/product/${upc}.json?fields=product_name,brands`);
    const j = await r.json();
    if (j.product?.product_name) return [j.product.brands?.split(',')[0], j.product.product_name].filter(Boolean).join(' ');
  } catch {}
  return null;
}

// ---------- orders tab ----------
const SAMPLE = `Order placed March 3, 2023
Anker PowerCore 10000 Portable Charger A1263, Ultra-Compact Power Bank
$25.99
Sold by: AnkerDirect
4moms mamaRoo Multi-Motion Baby Swing
Organic Cotton Bath Towels, 6 pack
Order placed June 12, 2024
ESR HaloLock Magnetic Wireless Power Bank 10000mAh
Hamilton Beach 2 Slice Toaster
Stainless Steel Water Bottle 32 oz`;
$('#orders-sample').addEventListener('click', () => {
  $('#orders').value = SAMPLE;
  checkOrders();
});
$('#orders-check').addEventListener('click', () => checkOrders());

async function checkOrders() {
  const text = $('#orders').value;
  const out = $('#orders-results');
  const items = extractItems(text);
  if (!items.length) return flash('Paste a few product names first.');
  out.replaceChildren(el('p', { class: 'loading' }, `Checking ${plural(items.length, 'item')}…`));
  let results;
  if (state.live) {
    results = [];
    for (const { item, date } of items.slice(0, 15)) results.push({ item, date, matches: (await find(item, { minConfidence: 'likely', limit: 3 }).catch(() => [])).map((m) => m), earlier: [] });
  } else results = checkItems(await indexReady, text);
  const flagged = results.filter((r) => r.matches.length);
  const clear = results.filter((r) => !r.matches.length);
  out.replaceChildren(
    el('p', { class: `summary ${flagged.length ? 'danger' : 'ok'}` },
      flagged.length ? `${flagged.length} of ${plural(results.length, 'item')} may be recalled.` : `All ${plural(results.length, 'item')} are clear.`),
    ...flagged.flatMap((r) => r.matches.map((m) => recallCard(m.row, { confidence: m.confidence, context: r.item, date: r.date }))),
    clear.length &&
      el('details', { class: 'clear' },
        el('summary', {}, `${plural(clear.length, 'item')} with no recall`),
        el('ul', {}, clear.map((r) =>
          el('li', {}, r.item,
            r.earlier[0] && el('span', { class: 'muted' }, r.earlier[0].note === 'before'
              ? ` · a similar recall (${fmtMonth(r.earlier[0].row.d)}) came before you bought it`
              : ` · only an old recall from ${r.earlier[0].row.d.slice(0, 4)} is similar`),
          ))),
        el('button', { class: 'btn ghost small', onclick: () => { clear.forEach((r) => addMine(r.item, null, r.date ? { date: r.date } : {})); flash(`Watching ${plural(clear.length, 'item')} for future recalls`); } }, 'Watch these for future recalls'),
      ),
  );
}

// Bookmarklet: collects product titles on an order-history page and opens them here.
const BOOKMARKLET = `(()=>{const s=new Set();document.querySelectorAll('.yohtmlc-product-title,[data-component="itemTitle"],.od-item-title,a[href*="/dp/"],a[href*="/gp/product/"],a[href*="/ip/"],a[data-test="product-title"]').forEach(e=>{const t=(e.innerText||'').trim().replace(/\\s+/g,' ');if(t.length>8&&t.length<200)s.add(t)});const a=[...s].slice(0,60);if(!a.length){alert('RecallRadar: no products found on this page.');return}window.open('${appUrl()}?items='+encodeURIComponent(a.join('\\n')),'_blank')})()`;
$('#bookmarklet').href = 'javascript:' + encodeURIComponent(BOOKMARKLET);
$('#bookmarklet').addEventListener('click', (e) => {
  e.preventDefault();
  flash('Drag this button to your bookmarks bar instead of clicking it.');
});

// ---------- car tab ----------
let carReady = false;
function initCar() {
  if (carReady) return;
  carReady = true;
  const y = $('#car-year');
  const thisYear = new Date().getFullYear() + 1;
  y.replaceChildren(el('option', { value: '' }, 'Year'), ...Array.from({ length: thisYear - 1980 + 1 }, (_, i) => thisYear - i).map((yr) => el('option', { value: yr }, yr)));
}
$('#car-year').addEventListener('change', async (e) => {
  const make = $('#car-make');
  make.disabled = true;
  $('#car-model').disabled = true;
  $('#ymm-go').disabled = true;
  if (!e.target.value) return;
  make.replaceChildren(el('option', {}, 'Loading…'));
  try {
    const makes = await cars.makesFor(e.target.value);
    make.replaceChildren(el('option', { value: '' }, 'Make'), ...makes.map((m) => el('option', { value: m }, m)));
    make.disabled = false;
  } catch {
    make.replaceChildren(el('option', { value: '' }, 'Couldn’t load makes'));
  }
});
$('#car-make').addEventListener('change', async (e) => {
  const model = $('#car-model');
  model.disabled = true;
  $('#ymm-go').disabled = true;
  if (!e.target.value) return;
  model.replaceChildren(el('option', {}, 'Loading…'));
  try {
    const models = await cars.modelsFor($('#car-year').value, e.target.value);
    model.replaceChildren(el('option', { value: '' }, 'Model'), ...models.map((m) => el('option', { value: m }, m)));
    model.disabled = false;
  } catch {
    model.replaceChildren(el('option', { value: '' }, 'Couldn’t load models'));
  }
});
$('#car-model').addEventListener('change', (e) => ($('#ymm-go').disabled = !e.target.value));
$('#ymm-form').addEventListener('submit', (e) => {
  e.preventDefault();
  showCar({ year: $('#car-year').value, make: $('#car-make').value, model: $('#car-model').value });
});
$('#vin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const vin = $('#vin').value.trim().toUpperCase();
  const out = $('#car-results');
  if (!cars.VIN_RE.test(vin)) return flash('A VIN has 17 letters and numbers (no I, O or Q).');
  out.replaceChildren(el('p', { class: 'loading' }, 'Decoding VIN…'));
  try {
    showCar(await cars.decodeVin(vin), vin);
  } catch (err) {
    out.replaceChildren(emptyState('Couldn’t decode that VIN.', err.message));
  }
});

async function showCar(car, vin) {
  const out = $('#car-results');
  const name = `${car.year} ${titleish(car.make)} ${titleish(car.model)}`;
  out.replaceChildren(el('p', { class: 'loading' }, `Checking ${name}…`));
  let list;
  try {
    list = await cars.recallsFor(car);
  } catch (err) {
    return out.replaceChildren(emptyState('Couldn’t reach NHTSA.', err.message));
  }
  const saved = mine.find((m) => m.kind === 'vehicle' && m.name === name);
  const save = () => {
    const item = saved || { id: uid(), kind: 'vehicle', name, added: today(), car: { year: car.year, make: car.make, model: car.model } };
    if (vin) item.vin = vin;
    item.seen = list.map((c) => c.id);
    item.openCount = list.length;
    if (!saved) mine.unshift(item);
    saveMine();
    flash(`Saved. You’ll be told about new recalls for your ${name}.`);
  };
  const urgent = list.filter((c) => c.parkIt || c.parkOutSide);
  out.replaceChildren(
    el('p', { class: `summary ${list.length ? 'danger' : 'ok'}` }, list.length ? `${plural(list.length, 'recall')} for the ${name}.` : `No recalls for the ${name}.`),
    urgent.length && el('div', { class: 'alert' }, el('strong', {}, urgent.some((c) => c.parkIt) ? 'Do not drive until repaired' : 'Park outside until repaired'), el('p', {}, 'The manufacturer warns that at least one of these defects can cause a fire or crash. Call a dealer now.')),
    list.length > 0 && el('p', { class: 'muted' }, 'Not every vehicle of a model is affected, and yours may already be fixed. ', el('a', { href: cars.vinCheckUrl(vin), target: '_blank', rel: 'noopener' }, vin ? 'Check your VIN on NHTSA ↗' : 'Check your VIN on NHTSA ↗'), ' to see open recalls for your exact car.'),
    ...list.map(campaignCard),
    el('button', { class: 'btn ghost', onclick: save }, saved ? 'Update saved vehicle' : `Save my ${name} and watch for new recalls`),
  );
}
const titleish = (s = '') => (s === s.toUpperCase() && s.length > 3 ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

function campaignCard(c) {
  const body = el('div', { class: 'card-more', hidden: true },
    c.consequence && el('p', {}, el('b', {}, 'Risk: '), c.consequence),
    c.remedy && el('p', {}, el('b', {}, 'Fix: '), c.remedy),
    el('p', { class: 'muted' }, c.maker, ' · campaign ', c.id, c.ota ? ' · fixed by over-the-air update' : ''),
    el('a', { href: cars.campaignUrl(c.id), target: '_blank', rel: 'noopener' }, 'NHTSA notice ↗'),
  );
  return el('article', { class: `card ${c.parkIt || c.parkOutSide ? 'strong' : 'likely'}` },
    el('div', { class: 'card-head' }, el('span', { class: 'chip src' }, c.component || 'Vehicle'), el('time', {}, fmtDate(c.d))),
    el('p', {}, c.summary.length > 260 ? c.summary.slice(0, 259) + '…' : c.summary),
    body,
    el('div', { class: 'row' }, el('button', { class: 'btn ghost small', onclick: (e) => { body.hidden = !body.hidden; e.target.textContent = body.hidden ? 'Risk and fix' : 'Hide'; } }, 'Risk and fix')),
  );
}

// ---------- mine ----------
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
  ['waiting', 'Waiting on refund or repair'],
  ['done', 'Resolved'],
];

function renderMine() {
  const list = $('#mine-list');
  if (!mine.length) return list.replaceChildren(emptyState('Nothing here yet.', 'Add things you own, especially baby gear, chargers, heaters and appliances. Save your car from the Car tab.'));
  list.replaceChildren(
    ...mine.map((item) => {
      const vehicle = item.kind === 'vehicle';
      const cls = vehicle ? (item.openCount ? 'recalled' : '') : item.recall ? (item.status === 'done' ? 'resolved' : 'recalled') : '';
      const chip = vehicle
        ? el('span', { class: `chip ${item.openCount ? 'likely' : 'watch'}` }, item.openCount ? plural(item.openCount, 'recall') : 'Vehicle')
        : el('span', { class: `chip ${item.recall ? (item.status === 'done' ? 'ok' : 'strong') : 'watch'}` }, item.recall ? STATUS.find((s) => s[0] === item.status)?.[1] : 'Watching');
      return el('article', { class: `card mine ${cls}` },
        el('div', { class: 'card-head' }, chip, el('time', {}, 'Added ', fmtDate(item.added))),
        el('h3', {}, item.name),
        item.recall && el('p', { class: 'product' }, item.recall.t),
        el('div', { class: 'row wrap' },
          item.recall && el('button', { class: 'btn primary small', onclick: () => openWizard(item) }, item.status === 'done' ? 'View' : 'Continue remedy'),
          vehicle && el('button', { class: 'btn primary small', onclick: () => { showTab('car'); showCar(item.car, item.vin); } }, 'View recalls'),
          el('button', { class: 'btn ghost small', onclick: () => { mine = mine.filter((m) => m !== item); saveMine(); renderMine(); recheckMine(); } }, 'Remove'),
        ),
      );
    }),
  );
}

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'RecallRadar', version: 1, exported: new Date().toISOString(), mine }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `recallradar-${today()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
});
$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data.mine) ? data.mine : [];
    const ids = new Set(mine.map((m) => m.id));
    const added = incoming.filter((m) => m && m.name && !ids.has(m.id));
    mine = [...added, ...mine];
    saveMine();
    renderMine();
    recheckMine();
    flash(`Restored ${plural(added.length, 'item')}`);
  } catch {
    flash('That file isn’t a RecallRadar backup.');
  }
  e.target.value = '';
});
$('#share-report').addEventListener('click', async (e) => {
  const lines = [
    `My RecallRadar check (${fmtDate(today())})`,
    ...mine.map((m) => (m.kind === 'vehicle' ? `• ${m.name}: ${m.openCount ? plural(m.openCount, 'open recall') : 'no recalls'}` : m.recall ? `• ${m.name}: RECALLED (${m.recall.t}) – ${STATUS.find((s) => s[0] === m.status)?.[1]}` : `• ${m.name}: no recall found`)),
    `Check yours: ${appUrl()}`,
  ];
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    e.target.textContent = 'Summary copied';
  } catch {
    flash('Couldn’t copy. Your browser blocked the clipboard.');
  }
});

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
  const statusSel = el('select', { 'aria-label': 'Status', onchange: (e) => { item.status = e.target.value; saveMine(); renderMine(); } },
    STATUS.map(([v, l]) => el('option', { value: v, selected: item.status === v }, l)));
  const header = el('header', {},
    el('h2', { id: 'wizard-title' }, r.s === 'fda' ? 'Food recall: what to do' : 'Get your remedy'),
    el('button', { class: 'close', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'),
  );
  const track = el('li', {}, el('h4', {}, 'Track it'), el('label', { class: 'status' }, 'Status ', statusSel));

  if (r.s === 'fda') {
    dlg.replaceChildren(
      el('div', { class: 'wiz' }, header, el('p', { class: 'wiz-title' }, r.t),
        el('ol', { class: 'steps' },
          el('li', {}, el('h4', {}, 'Compare the codes'), el('p', {}, 'Check the brand, package size and the lot or “best by” codes on your package.'), x.codes && el('p', { class: 'codes' }, x.codes)),
          el('li', {}, el('h4', {}, 'Don’t eat it'), x.h && el('p', { class: 'hazard' }, x.h), el('p', {}, 'If someone ate it and feels sick, call a doctor. For urgent questions call Poison Control at 1-800-222-1222.')),
          el('li', {}, el('h4', {}, 'Return or throw it away'), el('p', {}, 'Most stores refund recalled food without a receipt. Bag it before throwing it away and clean surfaces it touched.')),
          track,
        ),
      ),
    );
    return dlg.showModal();
  }

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
  const mailto = () => `mailto:${contact.emails[0]}?subject=${encodeURIComponent(subjectEl.value)}&body=${encodeURIComponent(bodyEl.value)}`;

  dlg.replaceChildren(
    el('div', { class: 'wiz' }, header,
      el('p', { class: 'wiz-title' }, r.t),
      el('ol', { class: 'steps' },
        el('li', {},
          el('h4', {}, 'Confirm it’s yours'),
          el('p', {}, 'Check the model number and where you bought it against the notice.'),
          x.desc && el('p', { class: 'muted' }, x.desc),
          Array.isArray(r.m) && el('p', {}, el('b', {}, 'Model numbers mentioned: '), r.m.slice(0, 12).join(', ').toUpperCase()),
          x.sold && el('p', {}, el('b', {}, 'Sold: '), x.sold),
          x.img && el('img', { src: x.img, alt: 'Recalled product', loading: 'lazy', onerror: (e) => e.target.remove() }),
          x.url && el('a', { href: x.url, target: '_blank', rel: 'noopener' }, 'Open the official notice ↗'),
        ),
        el('li', {}, el('h4', {}, 'Stop using it'), x.h && el('p', { class: 'hazard' }, x.h)),
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
            el('button', { class: 'btn ghost small', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(`${subjectEl.value}\n\n${bodyEl.value}`); e.target.textContent = 'Copied'; } catch { bodyEl.select(); } } }, 'Copy message'),
          ),
          x.c && el('p', { class: 'fine' }, x.c),
        ),
        track,
        el('li', {}, el('h4', {}, 'No answer?'), el('p', {}, 'If the company doesn’t respond within two weeks, ', el('a', { href: 'https://www.saferproducts.gov/IncidentReporting', target: '_blank', rel: 'noopener' }, 'tell CPSC ↗'), '. Companies are required to carry out the remedy they announced.')),
      ),
    ),
  );
  dlg.showModal();
}

// ---------- misc ----------
function flash(text) {
  const t = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// Incoming links: ?q= search, ?recall= a single recall, ?items= or shared text from the
// bookmarklet or the system share sheet.
async function handleIncoming() {
  const params = new URLSearchParams(location.search);
  const items = params.get('items');
  const shared = [params.get('title'), params.get('text')].filter(Boolean).join('\n').replace(/https?:\/\/\S+/g, '').trim();
  const recall = params.get('recall');
  const q = params.get('q');
  const tab = params.get('tab');
  if (tab && document.getElementById('tab-' + tab)) showTab(tab);
  if (recall) {
    const row = state.byNumber.get(recall);
    if (row) openRecall(row);
    else flash('That recall isn’t in the current data.');
  } else if (items || shared.split('\n').filter((l) => l.trim()).length > 1) {
    showTab('orders');
    $('#orders').value = items || shared;
    checkOrders();
  } else if (q || shared) {
    showTab('search');
    $('#q').value = q || shared;
    runSearch($('#q').value, $('#search-results'));
  }
  if (items || shared || tab) history.replaceState(null, '', location.pathname);
}

saveMine();
showTab(store.get('tab', 'search'));
await loadData();
renderFeed();
handleIncoming();
recheckMine();
