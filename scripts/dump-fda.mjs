import { writeFile, mkdir } from 'node:fs/promises';
const from = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
const to = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const search = `report_date:[${from}+TO+${to}]+AND+(classification:"Class+I"+classification:"Class+II")`;
const out = [];
for (let skip = 0; skip < 25000; skip += 1000) {
  const r = await fetch(`https://api.fda.gov/food/enforcement.json?search=${search}&limit=1000&skip=${skip}`);
  if (!r.ok) { console.log('status', r.status, await r.text()); break; }
  const j = await r.json(); out.push(...j.results); console.log(skip, j.meta.results.total);
  if (j.results.length < 1000) break;
}
await mkdir('raw', { recursive: true });
await writeFile('raw/fda.json', JSON.stringify(out));
console.log('fda', out.length, out.filter(r=>/upc/i.test(r.product_description+r.code_info)).length, 'mention UPC');
