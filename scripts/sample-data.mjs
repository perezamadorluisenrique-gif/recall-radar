// Writes a tiny snapshot from test/fixture.json so the app runs offline in development.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toIndexRow, toDetail } from '../site/cpsc.js';

const OUT = new URL('../site/data/', import.meta.url);
const raw = JSON.parse(await readFile(new URL('../test/fixture.json', import.meta.url)));
await mkdir(new URL('details/', OUT), { recursive: true });
const byYear = {};
for (const rec of raw) (byYear[rec.RecallDate.slice(0, 4)] ||= {})[rec.RecallNumber] = toDetail(rec);
for (const [y, d] of Object.entries(byYear)) await writeFile(new URL(`details/${y}.json`, OUT), JSON.stringify(d));
await writeFile(new URL('index.json', OUT), JSON.stringify(raw.map(toIndexRow)));
await writeFile(new URL('meta.json', OUT), JSON.stringify({ updated: new Date().toISOString(), count: raw.length, sample: true }));
console.log(`Wrote sample snapshot with ${raw.length} recalls`);
