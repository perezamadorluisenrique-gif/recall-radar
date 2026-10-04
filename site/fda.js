// Shapes openFDA food enforcement reports into the same row format as CPSC recalls.
import { classify, hazardTags } from './tags.js';
import { clip, upcsInText } from './cpsc.js';

export const FDA_API = 'https://api.fda.gov/food/enforcement.json';

const isoDate = (s = '') => (s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(\-/&])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\b(Llc|Inc|Usa|Co)\b/g, (w) => w.toUpperCase());

// "Deep-brand Select Bhindi Cut Okra KEEP FROZEN a) Net Wt. 12 oz ..." -> "Deep-brand Select Bhindi Cut Okra"
export function productName(desc = '') {
  let s = desc.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  // Leading "Item #DIPSAU0205RFS", list numbering "1." and sizes "1.5oz, 2oz" come before the name.
  const SIZE = String.raw`\d+(?:\.\d+)?\s*(?:oz|lb|lbs|g|kg|ml|fl\.?\s*oz|ct|count|pound|ounce)s?\.?`;
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/^(?:upc|gtin)\s*:?\s*[\d\s-]{4,16}\d(?=[\s,])/i, '')
      .replace(/^(?:item|sku|product)\s*(?:#|no\.?|number)?\s*:?\s*[a-z0-9-]*\d[a-z0-9-]*/i, '')
      .replace(/^\(?\d{1,2}[.)]\s+/, '')
      .replace(new RegExp(`^(?:${SIZE}\\s*(?:,|and|&|/|or)?\\s*)+`, 'i'), '')
      .replace(/^[,\-–:\s]+/, '');
  }
  s = s.split(/\b(?:net wt|net weight|net contents|keep frozen|keep refrigerated|perishable|ingredients|contains|containing|distributed by|manufactured by|packed by|product of|upc|sku|packaged in|product code|lot\b|item\s*#|plastic bag|this is|\d+(?:\.\d+)?\s*(?:oz|lb|lbs|g|kg|ml|fl|ct|count|pound|ounce)s?\b)/i)[0];
  s = s.split(/[;:]|\.\s|\s[a-z]\)\s|\(\s*[a-z]\)|,\s(?=[a-z]+\s\d)/)[0];
  s = s.replace(/-\d+\/.*$/, '').replace(/,?\s*\d+(?:\.\d+)?\s*(?:"|in|inch)?\s*$/i, '');
  s = s.replace(/\s\d+\/$/, '').replace(/[,.\-–\s(]+$/, '').trim();
  if (s === s.toUpperCase()) s = titleCase(s);
  if (s.length > 80) s = s.slice(0, 80).replace(/[\s,]+\S*$/, '') + '…';
  return s || 'Food product';
}

export function hazardLabel(reason = '') {
  const r = reason.toLowerCase();
  if (r.includes('listeria')) return 'Listeria';
  if (r.includes('salmonella')) return 'Salmonella';
  if (/e\.? ?coli|stec|o157/.test(r)) return 'E. coli';
  if (r.includes('botul')) return 'Botulism risk';
  const allergen = r.match(/undeclared\s+(?:allergens?:?\s*)?([a-z ,&]+?)(?:\.|;|$| in | due| and may| which| that)/);
  if (allergen) return `Undeclared ${allergen[1].trim().replace(/\s+/g, ' ').slice(0, 40)}`;
  if (/foreign (material|object|matter)|metal|glass|plastic|rubber|wood/.test(r)) return 'Foreign material';
  if (r.includes('lead')) return 'Lead';
  return '';
}

export function toFdaRow(rec) {
  const name = productName(rec.product_description);
  const hz = hazardLabel(rec.reason_for_recall);
  const row = {
    s: 'fda',
    n: rec.recall_number,
    d: isoDate(rec.report_date || rec.recall_initiation_date),
    t: hz ? `${name}: ${hz}` : name,
    b: titleCase(rec.recalling_firm || ''),
    p: clip((rec.product_description || '').replace(/\s+/g, ' '), 260),
  };
  const u = [...new Set(upcsInText(`${rec.product_description} ${rec.code_info}`))];
  if (u.length) row.u = u;
  const z = hazardTags(rec.reason_for_recall || '');
  if (z.length) row.z = z;
  row.g = 'food';
  row.c = (rec.classification || '').replace('Class ', '');
  if (rec.status && rec.status !== 'Ongoing') row.done = 1;
  return row;
}

export function toFdaDetail(rec) {
  return {
    h: clip(rec.reason_for_recall || '', 700),
    r: 'Check the brand, size and lot or "best by" codes below. If yours match, do not eat it. Return it to the store for a refund or throw it away, and contact the company with questions.',
    codes: clip(`${rec.code_info || ''} ${rec.more_code_info || ''}`.trim(), 1200),
    desc: clip(rec.product_description || '', 900),
    units: rec.product_quantity || '',
    sold: clip(rec.distribution_pattern || '', 400),
    firm: [titleCase(rec.recalling_firm || ''), [rec.city, rec.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
    cls: rec.classification || '',
    status: rec.status || '',
    url: `https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=${encodeURIComponent(rec.event_id || '')}`,
  };
}
