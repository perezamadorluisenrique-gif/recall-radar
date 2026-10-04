import { mkdir, writeFile } from 'node:fs/promises';
import { liveUrl } from '../site/cpsc.js';
await mkdir('raw', { recursive: true });
for (let y = 1973; y <= new Date().getUTCFullYear(); y++) {
  const r = await fetch(liveUrl({ RecallDateStart: `${y}-01-01`, RecallDateEnd: `${y}-12-31` }));
  await writeFile(`raw/${y}.json`, await r.text());
}
