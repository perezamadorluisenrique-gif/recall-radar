// Downloads every CPSC recall (one request per year) plus two years of FDA food
// recalls and writes the compact snapshot the app loads:
//   site/data/index.json, site/data/details/<source>-<year>.json, site/data/meta.json
// Usage: node scripts/fetch-recalls.mjs [--raw dir] [--no-fda]
//   --raw dir  read CPSC years (<year>.json) and fda.json from a local dump instead of the network
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { toIndexRow, toDetail, liveUrl } from '../site/cpsc.js';
import { toFdaRow, toFdaDetail, FDA_API } from '../site/fda.js';

const OUT = new URL('../site/data/', import.meta.url);
const args = process.argv.slice(2);
const RAW = args.includes('--raw') ? args[args.indexOf('--raw') + 1] : null;
const NO_FDA = args.includes('--no-fda');
const FIRST = 1973;
const LAST = new Date().getUTCFullYear();

async function getJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'RecallRadar data job' } });
    if (res.status === 404) return null; // openFDA: no matches
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    return getJson(url, attempt + 1);
  }
}

async function cpscYear(year) {
  if (RAW) {
    const f = `${RAW}/${year}.json`;
    return existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : [];
  }
  return getJson(liveUrl({ RecallDateStart: `${year}-01-01`, RecallDateEnd: `${year}-12-31` }));
}

// Two years of Class I and II food recalls (Class III rarely affects health).
async function fdaRecords() {
  if (RAW) {
    const f = `${RAW}/fda.json`;
    return existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : [];
  }
  const from = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const to = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const search = `report_date:[${from}+TO+${to}]+AND+(classification:"Class+I"+classification:"Class+II")`;
  const out = [];
  for (let skip = 0; skip < 25000; skip += 1000) {
    const page = await getJson(`${FDA_API}?search=${search}&limit=1000&skip=${skip}`);
    const results = page?.results || [];
    out.push(...results);
    if (results.length < 1000) break;
  }
  return out;
}

const index = [];
const details = {}; // "cpsc-2024" -> { recallNumber: detail }
const put = (row, detail) => {
  index.push(row);
  (details[`${row.s}-${row.d.slice(0, 4)}`] ||= {})[row.n] = detail;
};

let cpsc = 0;
for (let year = FIRST; year <= LAST; year++) {
  const records = (await cpscYear(year)) || [];
  for (const rec of records) {
    const row = toIndexRow(rec);
    if (!row.n || !row.d) continue;
    put(row, toDetail(rec));
    cpsc++;
  }
}
if (cpsc < 5000) throw new Error(`Only ${cpsc} CPSC recalls fetched; refusing to publish a partial snapshot`);

let fda = 0;
if (!NO_FDA) {
  try {
    const seen = new Set();
    for (const rec of await fdaRecords()) {
      const row = toFdaRow(rec);
      if (!row.n || !row.d || seen.has(row.n)) continue;
      seen.add(row.n);
      put(row, toFdaDetail(rec));
      fda++;
    }
  } catch (err) {
    // Food recalls are a bonus; never block the CPSC snapshot on them.
    console.warn(`FDA fetch failed, publishing without food recalls: ${err.message}`);
  }
}

index.sort((a, b) => b.d.localeCompare(a.d));
await mkdir(new URL('details/', OUT), { recursive: true });
for (const [key, d] of Object.entries(details)) await writeFile(new URL(`details/${key}.json`, OUT), JSON.stringify(d));
await writeFile(new URL('index.json', OUT), JSON.stringify(index));
await writeFile(new URL('meta.json', OUT), JSON.stringify({ updated: new Date().toISOString(), count: index.length, sources: { cpsc, fda } }));
console.log(`Wrote ${index.length} recalls (CPSC ${cpsc}, FDA food ${fda})`);
