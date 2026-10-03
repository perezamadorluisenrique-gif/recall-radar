// Shapes raw CPSC Recalls API records into the compact form the app searches.
// Shared by the browser (live fallback) and scripts/fetch-recalls.mjs (nightly snapshot).

export const CPSC_API = 'https://www.saferproducts.gov/RestWebServices/Recall';

const list = (v) => (Array.isArray(v) ? v : []);
const names = (v, key = 'Name') => list(v).map((x) => (x && x[key]) || '').map((s) => s.trim()).filter(Boolean);
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s || '');

// "Fisher-Price Recalls Rock 'n Play Sleepers Due to ..." -> "Fisher-Price"
export function brandFromTitle(title = '') {
  const m = title.match(/^(.*?)\s+Recall(?:s|ed)?\b/i);
  if (!m) return '';
  return m[1].replace(/^(more than|over|about)\s+[\w.,]+\s+(million\s+)?/i, '').trim();
}

export function upcsOf(rec) {
  return list(rec.ProductUPCs)
    .map((u) => (typeof u === 'string' ? u : u && (u.UPC || u.Upc || u.upc)) || '')
    .map((u) => String(u).replace(/\D/g, ''))
    .filter((u) => u.length >= 8);
}

// Index row: everything needed to search and list a recall.
export function toIndexRow(rec) {
  const products = list(rec.Products);
  return {
    i: rec.RecallID,
    n: rec.RecallNumber,
    d: (rec.RecallDate || '').slice(0, 10),
    t: rec.Title || '',
    b: brandFromTitle(rec.Title),
    p: products.map((p) => p.Name).filter(Boolean).join(' | '),
    m: products.map((p) => p.Model).filter(Boolean).join(' | '),
    u: upcsOf(rec),
  };
}

// Detail row: shown once a recall is opened.
export function toDetail(rec) {
  const img = list(rec.Images)[0];
  return {
    h: clip(names(rec.Hazards).join(' '), 900),
    r: clip(names(rec.Remedies).join(' '), 1200),
    ro: names(rec.RemedyOptions, 'Option'),
    c: clip(rec.ConsumerContact || '', 900),
    url: rec.URL || '',
    img: img ? img.URL : '',
    units: list(rec.Products).map((p) => p.NumberOfUnits).filter(Boolean).join('; '),
    sold: clip(names(rec.Retailers).join(' '), 500),
    inj: clip(names(rec.Injuries).join(' '), 400),
  };
}

export function toFullRow(rec) {
  return { ...toIndexRow(rec), x: toDetail(rec) };
}

export function liveUrl(params) {
  const q = new URLSearchParams({ format: 'json', ...params });
  return `${CPSC_API}?${q}`;
}

// Pull phone numbers, emails and links out of the free-text ConsumerContact field.
export function parseContact(text = '') {
  const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [])];
  const phones = [...new Set((text.match(/(?:1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || []).map((p) => p.trim()))];
  const urls = [
    ...new Set(
      (text.match(/(?:https?:\/\/|www\.)[^\s,;"“”)]+/gi) || [])
        .map((u) => u.replace(/[.]+$/, ''))
        .filter((u) => !u.includes('@'))
        .map((u) => (u.startsWith('http') ? u : 'https://' + u)),
    ),
  ];
  return { emails, phones, urls };
}
