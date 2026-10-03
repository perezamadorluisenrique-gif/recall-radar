// Fuzzy matching of things people own ("Anker PowerCore 10000 portable charger")
// against CPSC recall index rows. Pure functions, no DOM, so Node tests can run them.

const STOP = new Set(
  `a an and the of for with in on at to by from or as is it its this that be are was
  recall recalls recalled due hazard hazards risk risks serious injury death deaths
  sold exclusively online stores store nationwide distributed imported manufactured
  inc llc ltd co corp corporation company group usa us
  model models all new pack set pcs pc piece pieces count ct size color black white
  gray grey blue red green pink purple brown beige silver gold clear multicolor
  small medium large xl inch inches in ft oz lb lbs mm cm qty quantity item items
  amazon com walmart target ebay temu shein order ordered delivered shipped arriving
  product products about approximately`.split(/\s+/),
);

export function normalize(s = '') {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ');
}

const stem = (t) => (t.length > 4 && /[^s]s$/.test(t) && !/\d/.test(t) ? t.slice(0, -1) : t);
export const isModelish = (t) => t.length >= 3 && /\d/.test(t) && /[a-z]/.test(t);

export function tokenize(s) {
  const text = normalize(s);
  const out = new Set();
  // Joined variants keep model numbers like "BI-B41" or "A1263-01" intact.
  for (const m of text.matchAll(/[a-z0-9]+(?:[-/.][a-z0-9]+)+/g)) {
    const joined = m[0].replace(/[-/.]/g, '');
    if (isModelish(joined)) out.add(joined);
  }
  for (let t of text.split(/[^a-z0-9]+/)) {
    if (!t || t.length < 2 || STOP.has(t)) continue;
    if (/^\d+$/.test(t) && t.length < 3) continue;
    out.add(stem(t));
  }
  return [...out];
}

export function buildIndex(rows) {
  const postings = new Map();
  const docs = rows.map((row, idx) => {
    // Brand signal: first word of the recalling firm and of the product name
    // ("Anker", "VEEKTOMX"), which is what shows up on order lines.
    const brand = new Set([tokenize(row.b)[0], tokenize(row.p.split('|')[0])[0]].filter(Boolean));
    const tokens = new Set([...tokenize(row.t), ...tokenize(row.p), ...tokenize(row.m), ...brand]);
    for (const t of tokens) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = []));
      p.push(idx);
    }
    return { row, tokens, brand };
  });
  const upc = new Map();
  rows.forEach((row, idx) => {
    for (const u of row.u || []) upc.set(stripUpc(u), idx);
  });
  const N = rows.length || 1;
  const idf = (t) => Math.log(1 + N / (postings.get(t)?.length || 0.5));
  return { rows, docs, postings, upc, idf };
}

const stripUpc = (u) => String(u).replace(/\D/g, '').replace(/^0+/, '');
export const looksLikeUpc = (q) => /^\s*\d[\d\s-]{6,16}\d\s*$/.test(q);

export function lookupUpc(index, code) {
  const idx = index.upc.get(stripUpc(code));
  return idx === undefined ? null : { row: index.rows[idx], score: 1, confidence: 'exact', matched: [code] };
}

const RANK = { exact: 4, strong: 3, likely: 2, possible: 1 };

/**
 * Score every recall that shares a token with the query.
 * confidence: exact (UPC) > strong (model number hit) > likely > possible.
 */
export function search(index, query, { minConfidence = 'possible', limit = 25 } = {}) {
  if (looksLikeUpc(query)) {
    const hit = lookupUpc(index, query);
    return hit ? [hit] : [];
  }
  const q = tokenize(query);
  if (!q.length) return [];
  const qWeight = q.reduce((s, t) => s + index.idf(t), 0);
  const cand = new Map();
  for (const t of q) for (const idx of index.postings.get(t) || []) cand.set(idx, (cand.get(idx) || 0) + 1);

  const results = [];
  for (const [idx] of cand) {
    const doc = index.docs[idx];
    const matched = q.filter((t) => doc.tokens.has(t));
    const score = matched.reduce((s, t) => s + index.idf(t), 0) / qWeight;
    const modelHit = matched.some(isModelish);
    const brandHit = matched.some((t) => doc.brand.has(t));
    const informative = matched.filter((t) => !/^\d+$/.test(t)).length;
    let confidence = null;
    if (modelHit && (brandHit || score >= 0.35)) confidence = 'strong';
    else if (informative >= 2 && ((brandHit && score >= 0.4) || score >= 0.75)) confidence = 'likely';
    else if (score >= 0.4 && informative >= 2) confidence = 'possible';
    else if (q.length === 1 && informative === 1) confidence = 'possible';
    if (!confidence || RANK[confidence] < RANK[minConfidence]) continue;
    results.push({ row: doc.row, score: score + (brandHit ? 0.15 : 0) + (modelHit ? 0.3 : 0), confidence, matched });
  }
  results.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.score - a.score || b.row.d.localeCompare(a.row.d));
  return results.slice(0, limit);
}

// Turn a pasted order history / receipt into candidate product lines.
const NOISE =
  /^(order|ordered|order placed|order #|order number|total|subtotal|tax|shipping|ship to|sold by|qty|quantity|delivered|arriving|return|buy it again|view|track|write a|price|payment|items? ordered|invoice|receipt|thank you|visa|mastercard|amex|card ending)\b/i;

export function extractItems(text) {
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/\$\s?\d[\d,]*(\.\d\d)?/g, ' ')
        .replace(/\b(qty|quantity)\s*:?\s*\d+\b/gi, ' ')
        .replace(/^\s*(\d+\s*[x×]\s+|[-*•·]\s*|\d+[.)]\s+)/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((l) => l.length >= 4 && !NOISE.test(l) && tokenize(l).length >= 2)
    .filter((l, i, a) => a.indexOf(l) === i);
}

export function checkItems(index, text) {
  return extractItems(text).map((item) => ({
    item,
    matches: search(index, item, { minConfidence: 'likely', limit: 3 }),
  }));
}
