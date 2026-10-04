// Shapes raw CPSC Recalls API records into the compact form the app searches.
// Shared by the browser (live fallback) and scripts/fetch-recalls.mjs (nightly snapshot).
import { classify, hazardTags } from './tags.js';

export const CPSC_API = 'https://www.saferproducts.gov/RestWebServices/Recall';

const list = (v) => (Array.isArray(v) ? v : []);
const names = (v, key = 'Name') => list(v).map((x) => (x && x[key]) || '').map((s) => s.trim()).filter(Boolean);
export const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s || '');

const GENERIC_FIRM = /^(more than|over|about|nearly|approximately|cpsc|the)\b/i;

/**
 * The firm behind a recall, from the title's usual shapes:
 *   "Fisher-Price Recalls Rock 'n Play Sleepers ..."          -> Fisher-Price
 *   "Toasters Recalled by Hamilton Beach Due to ..."          -> Hamilton Beach
 *   "NICREW LED Lights Recalled Due to ...; Sold on Amazon by Nicrew" -> Nicrew
 *   "NEWDERY Power Banks Recalled Due to Fire ..."             -> "" (no firm named)
 */
export function brandFromTitle(title = '') {
  const t = title.replace(/\s+/g, ' ').trim();
  let m = t.match(/^(.*?)\s+(?:Recalls|Recall|Reannounces|Expands|Announces)\b/i);
  if (m && !/\bRecalled\b/i.test(m[1]) && m[1].split(' ').length <= 8) return cleanFirm(m[1]);
  m = t.match(/\b(?:Recalled|Repaired|Repair|Recall(?:ed)? Alert) by ([^;:,()]+?)(?: Due\b| for\b|;|,|\(|$)/i);
  if (m) return cleanFirm(m[1]);
  m = t.match(/;\s*(?:Manufactured|Imported|Distributed|Sold(?: Exclusively)?(?: on [\w.]+)?) by ([^;,()]+)/i);
  if (m) return cleanFirm(m[1]);
  // "NEWDERY Power Banks Recalled Due to ..." names no firm; the matcher falls back to
  // the product name's first word when it is rare enough to be a brand.
  return '';
}

function cleanFirm(s) {
  s = s.replace(/^CPSC,?\s+(and\s+)?/i, '').replace(/\s+(Announce|Announces|to)$/i, '').replace(/^(more than|over|about|nearly)\s+[\w.,]+\s+(million\s+|thousand\s+)?/i, '');
  return GENERIC_FIRM.test(s) ? '' : s.replace(/\s+(Inc|LLC|Ltd|Corp|Co)\.?$/i, '').trim();
}

export function upcsOf(rec) {
  const listed = list(rec.ProductUPCs).map((u) => (typeof u === 'string' ? u : u && (u.UPC || u.Upc || u.upc)) || '');
  return [...new Set([...listed.map((u) => String(u).replace(/\D/g, '')), ...upcsInText(rec.Description)])].filter((u) => u.length >= 8);
}

// Barcode numbers written in prose ("UPC 0 41220 12345 6", "UPC codes 0123..., 0456...").
export function upcsInText(text = '') {
  const out = [];
  for (const m of (text || '').matchAll(/\b(?:UPC|GTIN|EAN|barcode)s?\b/gi)) {
    const window = text.slice(m.index, m.index + 400);
    for (const d of window.matchAll(/\d(?:[ -]?\d){10,13}/g)) {
      const code = d[0].replace(/\D/g, '');
      if (code.length >= 12 && code.length <= 14) out.push(code);
    }
  }
  return out;
}

// Units, ordinals and sizes look like model numbers ("2nd", "10000mah", "6-drawer") but aren't.
const NOT_MODEL =
  /^(\d+(st|nd|rd|th|in\d+|x\d+|pk|pack|packs|pc|pcs|ct|count|oz|fl|floz|ml|l|lb|lbs|kg|g|mg|in|inch|inches|ft|feet|mm|cm|m|qt|quart|gal|gallon|w|watt|watts|v|volt|volts|a|amp|amps|mah|ah|wh|kw|gb|tb|mb|hz|khz|ghz|mp|k|p|x|yr|yrs|year|years|mo|month|months|wk|week|day|days|hr|hour|piece|pieces|drawer|drawers|cup|cups|slice|slices|seat|seater|person|tier|shelf|shelves|speed|way|bit|core|cell|port|ports|outlet|outlets|light|lights|gen|series|ply|sheet|sheets|roll|rolls|cu|cuft|btu|psi|cc|hp|t|s|f|c|d)|h2o|h20|mp3|mp4|4k|8k|1080p|720p|usb[a-z0-9]*|covid19|n95|kn95)$/;

export const isModelish = (t) => t.length >= 3 && /\d/.test(t) && /[a-z]/.test(t) && !NOT_MODEL.test(t) && !/^\d[a-z]{4,}$/.test(t);
const isDigitModel = (t) => /^\d{4,}$/.test(t) && !/^(19|20)\d\d$/.test(t);

/** Model, part, style and item numbers mentioned in a recall's description. */
export function modelsInText(text = '') {
  const out = new Set();
  for (const m of (text || '').matchAll(/\b(models?|styles?|parts?|items?|skus?|catalog|cat\.)(?=[\s#:.,])/gi)) {
    let window = text.slice(m.index + m[0].length, m.index + m[0].length + 260);
    window = window.split(/\.\s+[A-Z]|\n/)[0];
    for (const tok of window.matchAll(/[A-Za-z0-9]+(?:[-/.#][A-Za-z0-9]+)*/g)) {
      const raw = tok[0].toLowerCase();
      const joined = raw.replace(/[-/.#]/g, '');
      if (isModelish(joined) || isDigitModel(joined)) out.add(joined);
      for (const part of raw.split(/[-/.#]/)) if (part !== joined && isModelish(part)) out.add(part);
    }
  }
  return [...out].slice(0, 60);
}

// Index row: everything needed to search and list a recall.
export function toIndexRow(rec) {
  const products = list(rec.Products);
  const p = products.map((x) => x.Name).filter(Boolean).join(' | ');
  const models = new Set([
    ...products.map((x) => x.Model).filter(Boolean).flatMap((s) => modelsInText('model ' + s)),
    ...modelsInText(rec.Description),
  ]);
  const hazard = names(rec.Hazards).join(' ');
  const row = {
    s: 'cpsc',
    n: rec.RecallNumber,
    d: (rec.RecallDate || '').slice(0, 10),
    t: (rec.Title || '').replace(/\s+/g, ' ').trim(),
    b: brandFromTitle(rec.Title),
    p,
  };
  if (models.size) row.m = [...models];
  const u = upcsOf(rec);
  if (u.length) row.u = u;
  const z = hazardTags(`${rec.Title} ${hazard}`);
  if (z.length) row.z = z;
  row.g = classify(`${rec.Title} ${p}`);
  return row;
}

// Detail row: shown once a recall is opened.
export function toDetail(rec) {
  const img = list(rec.Images)[0];
  return {
    h: clip(names(rec.Hazards).join(' '), 900),
    r: clip(names(rec.Remedies).join(' '), 1200),
    ro: names(rec.RemedyOptions, 'Option'),
    c: clip(rec.ConsumerContact || '', 900),
    desc: clip(rec.Description || '', 900),
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
  const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [])].map((e) => e.replace(/\.$/, ''));
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
