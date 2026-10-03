import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toIndexRow, brandFromTitle, parseContact } from '../site/cpsc.js';
import { buildIndex, search, checkItems, extractItems, tokenize } from '../site/match.js';

// Copied from real CPSC records (Sept 2026); the one UPC is synthetic.
const raw = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url)));
const index = buildIndex(raw.map(toIndexRow));
const top = (q, o) => search(index, q, o)[0];

test('brand comes from the recall title', () => {
  assert.equal(brandFromTitle("Fisher-Price Recalls Rock 'n Play Sleepers Due to Reports of Deaths"), 'Fisher-Price');
  assert.equal(brandFromTitle('More than One Million Anker Power Banks Recalled Due to Fire'), 'Anker Power Banks');
  assert.equal(brandFromTitle('NEWDERY Power Banks Recalled Due to Fire'), 'NEWDERY Power Banks');
});

test('tokenize keeps model numbers joined', () => {
  assert.ok(tokenize('INIU BI-B41 Power Bank').includes('bib41'));
  assert.ok(tokenize('Rock n Play Sleepers').includes('sleeper'));
});

test('model number in an order line is a strong match', () => {
  const r = top('Anker PowerCore 10000 Portable Charger A1263, Black');
  assert.equal(r.row.n, '25338');
  assert.equal(r.confidence, 'strong');
});

test('brand and product name without a model is likely', () => {
  const r = top('Anker PowerCore 10000 Portable Charger');
  assert.equal(r.row.n, '25338');
  assert.equal(r.confidence, 'likely');
});

test('quick search finds the Rock n Play', () => {
  assert.equal(top("fisher price rock 'n play").row.n, '19105');
  assert.equal(top('rock and play sleeper').row.n, '19105');
});

test('UPC lookup ignores leading zeros and dashes', () => {
  const r = top('850012-345678');
  assert.equal(r.confidence, 'exact');
  assert.equal(r.row.n, '26670');
});

test('unrelated items do not match in order mode', () => {
  const res = checkItems(index, 'Organic Cotton Bath Towels, 6 pack\nStainless Steel Water Bottle 32 oz');
  assert.equal(res.length, 2);
  for (const r of res) assert.equal(r.matches.length, 0, r.item);
});

test('order list parsing drops noise and finds recalled items', () => {
  const text = `Order placed October 2, 2025
Order # 112-1234567-1234567
Anker PowerCore 10000 Portable Charger, Ultra-Compact Power Bank
$25.99
Sold by: AnkerDirect
Qty: 1
ESR HaloLock Magnetic Wireless Power Bank 10000mAh
Kids II Rocking Sleeper
Organic Cotton Bath Towels`;
  const items = extractItems(text);
  assert.deepEqual(items.length, 4, items.join(' / '));
  const flagged = checkItems(index, text).filter((r) => r.matches.length).map((r) => r.matches[0].row.n);
  assert.deepEqual(flagged.sort(), ['19112', '25338', '25437']);
});

test('contact parsing extracts phone, email and links', () => {
  const c = parseContact(raw.find((r) => r.RecallNumber === '25338').ConsumerContact);
  assert.deepEqual(c.emails, ['support@anker.com']);
  assert.deepEqual(c.phones, ['800-988-7973']);
  assert.deepEqual(c.urls, ['https://www.anker.com/product-recalls']);
  const k = parseContact('Kids II toll-free at 1-866-869-7954');
  assert.equal(k.phones[0], '1-866-869-7954');
});
