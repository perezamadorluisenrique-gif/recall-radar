// Fuzzy matching of things people own ("Anker PowerCore 10000 portable charger")
// against recall index rows. Pure functions, no DOM, so Node tests can run them.
import { isModelish } from './cpsc.js';

export { isModelish };

const STOP = new Set(
  `a an and the of for with in on at to by from or as is it its this that be are was
  recall recalls recalled due hazard hazards risk risks serious injury death deaths alert
  sold exclusively online stores store nationwide distributed imported manufactured
  inc llc ltd co corp corporation company group usa us international brands
  model models all new pack set pcs pc piece pieces count ct size color black white
  gray grey blue red green pink purple brown beige silver gold clear multicolor
  small medium large xl inch inches in ft oz lb lbs mm cm qty quantity item items
  amazon com walmart target ebay temu shein costco order ordered delivered shipped arriving
  product products about approximately renewed version edition premium pro plus
  one two three four five six ten million thousand more than`.split(/\s+/),
);

export function normalize(s = '') {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`®™©]/g, '')
    .replace(/\b([a-z])\s?&\s?([a-z])\b/g, '$1$2') // H&M, AT&T
    .replace(/&/g, ' and ');
}

const stem = (t) => (t.length > 4 && /[^s]s$/.test(t) && !/\d/.test(t) ? t.slice(0, -1) : t);
const isCode = (t) => isModelish(t) || /^\d{4,}$/.test(t);

export function tokenize(s) {
  const text = normalize(s);
  const out = new Set();
  // Joined variants keep model numbers like "BI-B41" or "22AF685/44B" intact.
  for (const m of text.matchAll(/[a-z0-9]+(?:[-/.#][a-z0-9]+)+/g)) {
    const joined = m[0].replace(/[-/.#]/g, '');
    if (isModelish(joined) || m[0].split(/[-/.#]/).every((p) => p.length === 1)) out.add(joined); // BI-B41, H-E-B
  }
  for (let t of text.split(/[^a-z0-9]+/)) {
    if (!t || t.length < 2 || STOP.has(t)) continue;
    if (/^\d+$/.test(t) && t.length < 3) continue;
    out.add(stem(t));
  }
  return [...out];
}

const firstWord = (s = '') => tokenize(s).find((t) => !/^\d+$/.test(t));

export function buildIndex(rows) {
  const postings = new Map();
  const docs = rows.map((row, idx) => {
    const models = new Set(row.m || []);
    const title = new Set(tokenize(row.t));
    const tokens = new Set([...title, ...tokenize(row.p), ...tokenize(row.b), ...models]);
    for (const t of tokens) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = []));
      p.push(idx);
    }
    // Model numbers printed in the product name count too ("INIU BI-B41 Power Banks").
    for (const t of tokenize(row.p)) if (isModelish(t)) models.add(t);
    return { row, tokens, title, models, brand: null, firmWords: null };
  });
  const N = rows.length || 1;
  const df = (t) => postings.get(t)?.length || 0;
  // Brand signal: the recalling firm's first word, plus the product name's first word
  // when that word is rare enough to be a name ("VEEKTOMX") rather than a noun ("cast").
  docs.forEach((doc) => {
    const brand = new Set();
    const firmWords = new Set();
    // A common first word ("Little Tikes", "Battery-Biz") only counts together with the next one.
    const firm = tokenize(doc.row.b).filter((t) => !/^\d+$/.test(t));
    if (firm[0] && (df(firm[0]) <= 60 || !firm[1])) brand.add(firm[0]);
    else if (firm[1]) brand.add(firm[0] + ' ' + firm[1]);
    for (const b of brand) for (const w of b.split(' ')) firmWords.add(w);
    const lead = firstWord(doc.row.p.split('|')[0]);
    if (lead && df(lead) <= 3) brand.add(lead);
    doc.brand = brand;
    doc.firmWords = firmWords;
  });
  const upc = new Map();
  rows.forEach((row, idx) => {
    for (const u of row.u || []) {
      const k = stripUpc(u);
      upc.set(k, [...(upc.get(k) || []), idx]);
    }
  });
  const idf = (t) => Math.log(1 + N / (df(t) || 0.5));
  const rare = 3;
  const byNumber = new Map(rows.map((row) => [String(row.n).toLowerCase(), row]));
  return { rows, docs, postings, upc, idf, df, rare, byNumber };
}

const stripUpc = (u) => String(u).replace(/\D/g, '').replace(/^0+/, '');
export const looksLikeUpc = (q) => /^\s*\d[\d\s-]{6,16}\d\s*$/.test(q);

export function lookupUpc(index, code) {
  const k = stripUpc(code);
  // UPC-A on the label vs EAN-13 / GTIN-14 in the notice differ only by leading zeros;
  // some notices drop the check digit.
  const hits = index.upc.get(k) || index.upc.get(k.slice(0, -1)) || [];
  return hits.map((idx) => ({ row: index.rows[idx], score: 1, confidence: 'exact', matched: [code] }));
}

export const RANK = { exact: 4, strong: 3, likely: 2, possible: 1 };

// "25338", "CPSC recall 25-338", "#H-0543-2026"
function byRecallNumber(index, query) {
  const m = query.trim().toLowerCase().match(/^(?:(?:cpsc|fda|recall|number|no\.?|#)\s*)*#?\s*([a-z]?-?\d[\d-]{2,}\d)$/);
  if (!m || !index.byNumber) return null;
  const n = m[1];
  return index.byNumber.get(n) || index.byNumber.get(n.replace(/-/g, '')) || null;
}

/**
 * Score every recall that shares a word with the query.
 * exact: barcode on the notice. strong: a model number from the notice, plus the brand
 * or real overlap. likely: the brand plus product words. possible: partial overlap.
 */
export function search(index, query, { minConfidence = 'possible', limit = 25, source } = {}) {
  const numbered = byRecallNumber(index, query);
  if (numbered) return [{ row: numbered, score: 1, confidence: 'exact', matched: [query.trim()], byNumber: true }];
  if (looksLikeUpc(query)) return lookupUpc(index, query).slice(0, limit);
  const q = tokenize(query);
  if (!q.length) return [];
  const qWeight = q.reduce((s, t) => s + index.idf(t), 0);
  const cand = new Set();
  for (const t of q) for (const idx of index.postings.get(t) || []) cand.add(idx);

  const results = [];
  for (const idx of cand) {
    const doc = index.docs[idx];
    if (source && doc.row.s !== source) continue;
    const matched = q.filter((t) => doc.tokens.has(t));
    const score = matched.reduce((s, t) => s + index.idf(t), 0) / qWeight;
    const brandHit = [...doc.brand].some((b) => b.split(' ').every((w) => matched.includes(w)));
    // A model hit must be specific to a few recalls; "Hover-1" on every Hover-1 product is a brand.
    const modelHit = q.some((t) => isCode(t) && doc.models.has(t) && index.df(t) <= 2 && (isModelish(t) || brandHit));
    const informative = matched.filter((t) => !/^\d+$/.test(t)).length;
    const productWords = matched.filter((t) => !/^\d+$/.test(t) && !doc.firmWords.has(t)).length;
    const rareHit = matched.some((t) => !/^\d+$/.test(t) && index.df(t) <= index.rare);
    let confidence = null;
    if (modelHit && (brandHit || score >= 0.3)) confidence = 'strong';
    else if ((brandHit && productWords >= 1 && score >= 0.4) || (score >= 0.8 && informative >= 3 && rareHit)) confidence = 'likely';
    else if (score >= 0.4 && informative >= 2) confidence = 'possible';
    else if (q.length === 1 && informative === 1) confidence = 'possible';
    if (!confidence || RANK[confidence] < RANK[minConfidence]) continue;
    // Words in the headline ("Peanut Butter: Salmonella") say more than words deep in the description.
    const inTitle = matched.reduce((s, t) => s + (doc.title.has(t) ? index.idf(t) : 0), 0) / qWeight;
    results.push({ row: doc.row, score: score + inTitle * 0.25 + (brandHit ? 0.15 : 0) + (modelHit ? 0.3 : 0), confidence, matched, brandHit, modelHit });
  }
  results.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.score - a.score || b.row.d.localeCompare(a.row.d));
  return results.slice(0, limit);
}

// ---------- order histories ----------

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const NOISE =
  /^(order|ordered|order placed|order #|order number|orden|total|subtotal|tax|shipping|ship to|sold by|qty|quantity|delivered|arriving|return|returned|refund|buy it again|view|track|write a|leave|price|payment|items? ordered|invoice|receipt|thank you|visa|mastercard|amex|discover|card ending|get product support|problem with order|archive order|condition|seller|now|was|save|free|details|share|gift)\b/i;

/** Finds a date in a line like "Order placed March 3, 2023", "Delivered Jan 5, 2024" or "03/12/2023". */
export function parseDate(line) {
  const s = line.toLowerCase();
  let m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d\d)\b/);
  if (m) return iso(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2]);
  m = s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+((?:19|20)\d\d)\b/);
  if (m) return iso(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
  m = s.match(/\b((?:19|20)\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/((?:19|20)?\d\d)\b/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}
const iso = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

/** Turn a pasted order history or receipt into product lines, each with the order date seen above it. */
export function extractItems(text) {
  const items = [];
  const seen = new Set();
  let date = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const found = parseDate(rawLine);
    if (found) date = found;
    const line = rawLine
      .replace(/\$\s?\d[\d,]*(\.\d\d)?/g, ' ')
      .replace(/\b(qty|quantity)\s*:?\s*\d+\b/gi, ' ')
      .replace(/^\s*(\d+\s*[x×]\s+|[-*•·]\s*|\d+[.)]\s+)/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (line.length < 4 || NOISE.test(line) || (found && tokenize(line.replace(/\d/g, '')).length < 3)) continue;
    if (tokenize(line).length < 2 || seen.has(line)) continue;
    seen.add(line);
    items.push({ item: line, date });
  }
  return items;
}

const DAY = 864e5;
const yearsBetween = (a, b) => (new Date(b) - new Date(a)) / (365.25 * DAY);

/**
 * Order-mode check. A match is downgraded when the purchase came well after the recall
 * (stores pull recalled stock) or, without a date, when the recall is very old.
 */
export function checkItems(index, text, { today = new Date().toISOString().slice(0, 10) } = {}) {
  return extractItems(text).map(({ item, date }) => {
    const matches = [];
    const earlier = [];
    for (const m of search(index, item, { minConfidence: 'likely', limit: 5 })) {
      if (m.confidence === 'exact') matches.push(m);
      else if (date && yearsBetween(m.row.d, date) > 0.5) earlier.push({ ...m, note: 'before' });
      else if (!date && m.confidence === 'likely' && yearsBetween(m.row.d, today) > 12) earlier.push({ ...m, note: 'old' });
      else matches.push(m);
    }
    return { item, date, matches: matches.slice(0, 3), earlier: earlier.slice(0, 2) };
  });
}
