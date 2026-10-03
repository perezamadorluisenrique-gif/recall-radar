// Downloads every CPSC recall (one request per year) and writes the compact
// snapshot the app loads: site/data/index.json plus one details file per year.
// Usage: node scripts/fetch-recalls.mjs [firstYear]
import { mkdir, writeFile } from 'node:fs/promises';
import { toIndexRow, toDetail, liveUrl } from '../site/cpsc.js';

const OUT = new URL('../site/data/', import.meta.url);
const FIRST = Number(process.argv[2]) || 1973;
const LAST = new Date().getUTCFullYear();

async function fetchYear(year, attempt = 1) {
  const url = liveUrl({ RecallDateStart: `${year}-01-01`, RecallDateEnd: `${year}-12-31` });
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'RecallRadar data job' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 4) throw new Error(`${year}: ${err.message}`);
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    return fetchYear(year, attempt + 1);
  }
}

const index = [];
await mkdir(new URL('details/', OUT), { recursive: true });

for (let year = FIRST; year <= LAST; year++) {
  const records = await fetchYear(year);
  const details = {};
  for (const rec of records) {
    const row = toIndexRow(rec);
    if (!row.n || !row.d) continue;
    index.push(row);
    details[row.n] = toDetail(rec);
  }
  await writeFile(new URL(`details/${year}.json`, OUT), JSON.stringify(details));
  console.log(`${year}: ${records.length} recalls`);
}

index.sort((a, b) => b.d.localeCompare(a.d));
if (index.length < 1000) throw new Error(`Only ${index.length} recalls fetched; refusing to publish a partial snapshot`);
await writeFile(new URL('index.json', OUT), JSON.stringify(index));
await writeFile(new URL('meta.json', OUT), JSON.stringify({ updated: new Date().toISOString(), count: index.length }));
console.log(`Wrote ${index.length} recalls`);
