// Writes a tiny snapshot from test/fixture.json so the app runs offline in development.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toIndexRow, toDetail } from '../site/cpsc.js';
import { toFdaRow, toFdaDetail } from '../site/fda.js';

const OUT = new URL('../site/data/', import.meta.url);
const raw = JSON.parse(await readFile(new URL('../test/fixture.json', import.meta.url)));
await mkdir(new URL('details/', OUT), { recursive: true });
const byYear = {};
for (const rec of raw) (byYear[rec.RecallDate.slice(0, 4)] ||= {})[rec.RecallNumber] = toDetail(rec);
for (const [y, d] of Object.entries(byYear)) await writeFile(new URL(`details/cpsc-${y}.json`, OUT), JSON.stringify(d));
const fda = JSON.parse(await readFile(new URL('../test/fixture-fda.json', import.meta.url)));
const fdaDetails = {};
for (const rec of fda) (fdaDetails[`fda-${rec.report_date.slice(0, 4)}`] ||= {})[rec.recall_number] = toFdaDetail(rec);
for (const [k, d] of Object.entries(fdaDetails)) await writeFile(new URL(`details/${k}.json`, OUT), JSON.stringify(d));
const rows = [...raw.map(toIndexRow), ...fda.map(toFdaRow)].sort((a, b) => b.d.localeCompare(a.d));
await writeFile(new URL('index.json', OUT), JSON.stringify(rows));
await writeFile(new URL('meta.json', OUT), JSON.stringify({ updated: new Date().toISOString(), count: rows.length, sample: true }));
console.log(`Wrote sample snapshot with ${rows.length} recalls`);
