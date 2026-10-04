import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toIndexRow, brandFromTitle, parseContact, modelsInText, upcsInText, isModelish } from '../site/cpsc.js';
import { buildIndex, search, checkItems, extractItems, tokenize, parseDate } from '../site/match.js';
import { productName, hazardLabel, toFdaRow } from '../site/fda.js';
import { hazardTags, classify } from '../site/tags.js';

// Copied from real CPSC records (Sept 2026); the one UPC is synthetic.
const raw = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url)));
const index = buildIndex(raw.map(toIndexRow));
const top = (q, o) => search(index, q, o)[0];

test('brand comes from the recall title', () => {
  assert.equal(brandFromTitle("Fisher-Price Recalls Rock 'n Play Sleepers Due to Reports of Deaths"), 'Fisher-Price');
  assert.equal(brandFromTitle('Toasters Recalled by Hamilton Beach Due to Fire Hazard'), 'Hamilton Beach');
  assert.equal(brandFromTitle('NICREW LED Lights Recalled Due to Ingestion Hazard; Sold on Amazon by Nicrew'), 'Nicrew');
  assert.equal(brandFromTitle('CPSC, NIKE Announce Recall of Children\'s Athletic Shoes'), 'NIKE');
  assert.equal(brandFromTitle('NEWDERY Power Banks Recalled Due to Fire'), '');
});

test('tokenize keeps model numbers joined', () => {
  assert.ok(tokenize('INIU BI-B41 Power Bank').includes('bib41'));
  assert.ok(tokenize('Rock n Play Sleepers').includes('sleeper'));
});

test('model numbers come from descriptions, not sizes or ordinals', () => {
  assert.deepEqual(modelsInText('This recall involves Anker PowerCore 10000 power banks with model number A1263. The brand'), ['a1263']);
  assert.ok(modelsInText('models 22AF685/44B and 22AF685/94B').includes('22af685'));
  for (const t of ['2nd', '10000mah', '6drawer', '7in1', '4moms', '40oz', '4k']) assert.equal(isModelish(t), false, t);
  for (const t of ['a1263', 'bib41', 'vh200', 'sklc04200040']) assert.equal(isModelish(t), true, t);
});

test('barcodes written in prose are extracted', () => {
  assert.deepEqual(upcsInText('The UPC is 0 41220 12345 6 and lot 22041.'), ['041220123456']);
  assert.deepEqual(upcsInText('UPC codes 012345678905, 098765432109.'), ['012345678905', '098765432109']);
  assert.deepEqual(upcsInText('Lot 123456789012 only'), []);
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

test('order list parsing drops noise and keeps order dates', () => {
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
  assert.equal(items.length, 4, items.map((i) => i.item).join(' / '));
  assert.ok(items.every((i) => i.date === '2025-10-02'));
});

test('purchases made long after a recall are not flagged', () => {
  const before = checkItems(index, 'Order placed March 3, 2018\nKids II Rocking Sleeper');
  assert.equal(before[0].matches[0].row.n, '19112');
  const after = checkItems(index, 'Order placed March 3, 2023\nKids II Rocking Sleeper');
  assert.equal(after[0].matches.length, 0);
  assert.equal(after[0].earlier[0].note, 'before');
});

test('order lines without dates are matched as usual', () => {
  const flagged = checkItems(index, 'Anker PowerCore 10000 Portable Charger\nESR HaloLock Magnetic Wireless Power Bank\nOrganic Cotton Bath Towels')
    .filter((r) => r.matches.length)
    .map((r) => r.matches[0].row.n);
  assert.deepEqual(flagged.sort(), ['25338', '25437']);
});

test('dates in common order-history formats', () => {
  assert.equal(parseDate('Order placed March 3, 2023'), '2023-03-03');
  assert.equal(parseDate('Delivered 5 Jan 2024'), '2024-01-05');
  assert.equal(parseDate('Purchased 03/12/2023'), '2023-03-12');
  assert.equal(parseDate('2024-07-09 receipt'), '2024-07-09');
  assert.equal(parseDate('Anker 10000 charger'), null);
});

test('FDA reports become readable rows', () => {
  assert.equal(productName('Deep-brand Select Bhindi Cut Okra KEEP FROZEN a) Net Wt. 12 oz (340 g)'), 'Deep-brand Select Bhindi Cut Okra');
  assert.equal(productName('ORGANIC BABY SPINACH, 5 OZ CLAMSHELL'), 'Organic Baby Spinach');
  assert.equal(hazardLabel('Product tested positive for Listeria monocytogenes'), 'Listeria');
  assert.equal(hazardLabel('Undeclared milk and soy in the product.'), 'Undeclared milk and soy');
  const row = toFdaRow({ recall_number: 'F-0001-2026', report_date: '20260115', product_description: 'Acme Peanut Butter 16 oz jar UPC 0 12345 67890 5', reason_for_recall: 'Salmonella', recalling_firm: 'ACME FOODS INC', classification: 'Class I', status: 'Ongoing' });
  assert.equal(row.t, 'Acme Peanut Butter: Salmonella');
  assert.deepEqual(row.u, ['012345678905']);
  assert.equal(row.d, '2026-01-15');
  assert.equal(row.c, 'I');
});

test('hazard tags and categories', () => {
  assert.deepEqual(hazardTags('Due to Fire and Burn Hazards'), ['fire']);
  assert.deepEqual(hazardTags('Risk of Serious Injury or Death from Tip-Over and Entrapment Hazards'), ['entrapment', 'tip-over']);
  assert.equal(classify('Fisher-Price Rock n Play Sleepers'), 'baby');
  assert.equal(classify('Anker power banks'), 'power');
});

test('contact parsing extracts phone, email and links', () => {
  const c = parseContact(raw.find((r) => r.RecallNumber === '25338').ConsumerContact);
  assert.deepEqual(c.emails, ['support@anker.com']);
  assert.deepEqual(c.phones, ['800-988-7973']);
  assert.deepEqual(c.urls, ['https://www.anker.com/product-recalls']);
  const k = parseContact('Kids II toll-free at 1-866-869-7954');
  assert.equal(k.phones[0], '1-866-869-7954');
});

test('recall numbers find that recall', () => {
  const n = index.rows[0].n;
  assert.equal(search(index, `cpsc recall ${n}`)[0].row.n, n);
  assert.equal(search(index, `#${n}`)[0].row.n, n);
});

test('FDA product names skip item codes, UPCs, numbering and sizes', () => {
  assert.equal(productName('Item #DIPSAU0205RFS Salsa Autentica 5 lb. packaged in round plastic container.'), 'Salsa Autentica');
  assert.equal(productName('1.5oz, 2oz Dirty Brand Salt and Vinegar Potato Chips , Plastic Bag.'), 'Dirty Brand Salt and Vinegar Potato Chips');
  assert.equal(productName('Item 406897,UPC 13454 38407, Asian Style Stir Fry Single Serve OP no Trays 1/6.5 LB.'), 'Asian Style Stir Fry Single Serve OP no Trays');
  assert.equal(productName('Lotsa Pasta International Food Shop Fresh Basil Infused Olive Oil, Net Wt. 12 oz.'), 'Lotsa Pasta International Food Shop Fresh Basil Infused Olive Oil');
});
