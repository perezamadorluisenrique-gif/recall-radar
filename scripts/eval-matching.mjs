// Measures matching quality against the full snapshot (run `npm run data` first).
// Prints dataset stats, synthetic recall@k for order-style lines built from real
// recalls, and every alarm raised for a list of everyday products, for review.
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { buildIndex, search, tokenize } from '../site/match.js';

const raw = await readFile(new URL('../site/data/index.json', import.meta.url));
const rows = JSON.parse(raw);
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;

let t = performance.now();
const index = buildIndex(rows);
const buildMs = performance.now() - t;
console.log(`## Dataset
recalls: ${rows.length}
index.json: ${(raw.length / 1e6).toFixed(2)} MB raw, ${(gzipSync(raw).length / 1e6).toFixed(2)} MB gzip
with UPCs: ${pct(rows.filter((r) => r.u?.length).length, rows.length)}
with model field: ${pct(rows.filter((r) => r.m).length, rows.length)}
with brand parsed: ${pct(rows.filter((r) => r.b).length, rows.length)}
distinct tokens: ${index.postings.size}
build index: ${buildMs.toFixed(0)} ms
`);

// Deterministic sample of recalls since 2010 with a parsed brand.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pool = rows.filter((r) => r.b && r.p && r.d >= '2010');
const sample = Array.from({ length: 300 }, () => pool[Math.floor(rand() * pool.length)]);
const NOISE = ['Black', '2 Pack', 'for Home', 'New Version', 'Large', 'with Remote', 'Gray', '(Renewed)'];

function orderLine(r) {
  const brand = r.b.split(/\s+/)[0];
  const words = tokenize(r.p.split('|')[0]).filter((w) => !brand.toLowerCase().startsWith(w));
  const pick = words.sort((a, b) => index.idf(b) - index.idf(a)).slice(0, 3);
  return `${brand} ${pick.join(' ')} ${NOISE[Math.floor(rand() * NOISE.length)]}`;
}

let hit1 = 0, hit3 = 0, flagged = 0;
const misses = [];
t = performance.now();
for (const r of sample) {
  const q = orderLine(r);
  const res = search(index, q, { minConfidence: 'likely', limit: 3 });
  if (res.length) flagged++;
  const rank = res.findIndex((x) => x.row.n === r.n);
  if (rank === 0) hit1++;
  if (rank >= 0) hit3++;
  else if (misses.length < 15) misses.push(`${q}  =>  wanted ${r.n} "${r.t.slice(0, 70)}"; got ${res.map((x) => x.row.n).join(',') || 'nothing'}`);
}
const qMs = (performance.now() - t) / sample.length;
console.log(`## Synthetic order lines from real recalls (n=${sample.length})
flagged at all: ${pct(flagged, sample.length)}
correct recall ranked #1: ${pct(hit1, sample.length)}
correct recall in top 3: ${pct(hit3, sample.length)}
avg query: ${qMs.toFixed(2)} ms
misses:
  ${misses.join('\n  ')}
`);

const EVERYDAY = `Amazon Basics AA Alkaline Batteries 48 Pack
Apple AirPods Pro 2nd Generation
Ninja Air Fryer AF101 4 Quart
Instant Pot Duo 7-in-1 Electric Pressure Cooker 6 Quart
Crayola Washable Markers 10 Count
Hanes Mens ComfortSoft T-Shirt
Lodge Cast Iron Skillet 12 Inch
Pampers Swaddlers Diapers Size 1
Graco Pack n Play Playard
IKEA MALM 6-drawer dresser
Samsung 55 Inch QLED 4K TV
Dyson V8 Cordless Vacuum
Keurig K-Mini Single Serve Coffee Maker
Hamilton Beach 2 Slice Toaster
Philips Sonicare 4100 Electric Toothbrush
Kindle Paperwhite 16 GB
Logitech MX Master 3S Wireless Mouse
Anker USB C Cable 6ft 2 Pack
Nike Revolution 6 Running Shoes
YETI Rambler 20 oz Tumbler
Contigo Kids Water Bottle 14 oz
LEGO Classic Medium Creative Brick Box 10696
Peloton Bike
Cuisinart 14 Cup Food Processor
Vornado Space Heater VH200
Honeywell HPA300 HEPA Air Purifier
Little Tikes Cozy Coupe
Bugaboo Fox 5 Stroller
Baby Brezza Formula Pro Advanced
4moms mamaRoo Multi-Motion Baby Swing
Fisher-Price Deluxe Kick and Play Piano Gym
Hatch Rest Sound Machine Night Light
Owlet Dream Sock Baby Monitor
Nuna PIPA Infant Car Seat
Stanley Quencher H2.0 Tumbler 40 oz
Duracell Coin Lithium 2032 Battery 4 Count
Cosori Pro LE Air Fryer
GE Profile Smart Indoor Smoker
Ring Video Doorbell
Coleman Sundome Camping Tent
Schwinn Kids Bike 16 inch
Razor A5 Lux Kick Scooter
Hover-1 Hoverboard
Sunbeam Heating Pad
Mainstays 5 Shelf Bookcase
Pottery Barn Kids Crib
Bath towels organic cotton 6 pack
Stainless steel water bottle 32 oz
Paper towels 12 rolls
Dish soap lemon scent`.split('\n');

console.log('## Everyday products (review alarms by hand)');
let alarms = 0;
for (const q of EVERYDAY) {
  const res = search(index, q, { minConfidence: 'likely', limit: 3 });
  if (res.length) alarms++;
  console.log(`${res.length ? '!' : ' '} ${q}${res.map((x) => `\n      ${x.confidence} ${x.row.n} ${x.row.d} ${x.row.t.slice(0, 90)}`).join('')}`);
}
console.log(`\n${alarms} of ${EVERYDAY.length} everyday products raised an alarm`);
