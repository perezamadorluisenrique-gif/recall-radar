// Writes a tiny snapshot from test/fixture.json so the app runs offline in development.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toIndexRow, toDetail } from '../site/cpsc.js';
import { toFdaRow, toFdaDetail } from '../site/fda.js';

const OUT = new URL('../site/data/', import.meta.url);
const raw = JSON.parse(await readFile(new URL('../test/fixture.json', import.meta.url)));
await mkdir(new URL('details/', OUT), { recursive: true });

// The app's feed only shows the last 45 days, so a fixed fixture goes empty as time passes.
// Shift every date by the same whole number of days so the newest recall is two days old.
const DAY = 86400000;
const day = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const fdaRaw = JSON.parse(await readFile(new URL('../test/fixture-fda.json', import.meta.url)));
const fdaIso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const newest = Math.max(...raw.map((r) => day(r.RecallDate)), ...fdaRaw.map((r) => day(fdaIso(r.report_date))));
const shift = Math.round((Date.now() - 2 * DAY - newest) / DAY) * DAY;
const moved = (ms) => new Date(ms + shift).toISOString().slice(0, 10);
for (const r of raw) r.RecallDate = `${moved(day(r.RecallDate))}T00:00:00`;
for (const r of fdaRaw) r.report_date = moved(day(fdaIso(r.report_date))).replaceAll('-', '');
const byYear = {};
for (const rec of raw) (byYear[rec.RecallDate.slice(0, 4)] ||= {})[rec.RecallNumber] = toDetail(rec);
for (const [y, d] of Object.entries(byYear)) await writeFile(new URL(`details/cpsc-${y}.json`, OUT), JSON.stringify(d));
const fda = fdaRaw;
const fdaDetails = {};
for (const rec of fda) (fdaDetails[`fda-${rec.report_date.slice(0, 4)}`] ||= {})[rec.recall_number] = toFdaDetail(rec);
for (const [k, d] of Object.entries(fdaDetails)) await writeFile(new URL(`details/${k}.json`, OUT), JSON.stringify(d));
const rows = [...raw.map(toIndexRow), ...fda.map(toFdaRow)].sort((a, b) => b.d.localeCompare(a.d));
await writeFile(new URL('index.json', OUT), JSON.stringify(rows));
await writeFile(new URL('meta.json', OUT), JSON.stringify({ updated: new Date().toISOString(), count: rows.length, sample: true }));
console.log(`Wrote sample snapshot with ${rows.length} recalls`);
