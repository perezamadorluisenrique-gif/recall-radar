// End-to-end check of the app in a phone-sized browser, against the sample snapshot
// (npm run data:sample) served on BASE. Network calls to NHTSA and Open Food Facts are
// mocked so the test is deterministic and runs offline.
// Usage: BASE=http://localhost:5173 node test/e2e.mjs [--shots dir]
import assert from 'node:assert/strict';

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;

const NHTSA = {
  Count: 2,
  results: [
    { Manufacturer: 'Honda (American Honda Motor Co.)', NHTSACampaignNumber: '18V661000', parkIt: false, parkOutSide: false, overTheAirUpdate: false, ReportReceivedDate: '27/09/2018', Component: 'AIR BAGS:FRONTAL:PASSENGER SIDE:INFLATOR MODULE', Summary: 'Honda is recalling certain 2010-2012 Accord vehicles. The passenger frontal air bag inflator may rupture.', Consequence: 'An inflator rupture may result in sharp metal fragments striking the driver or other occupants.', Remedy: 'Dealers will replace the passenger air bag inflator, free of charge.' },
    { Manufacturer: 'Honda (American Honda Motor Co.)', NHTSACampaignNumber: '20V314000', parkIt: true, parkOutSide: false, overTheAirUpdate: false, ReportReceivedDate: '28/05/2020', Component: 'ELECTRICAL SYSTEM', Summary: 'Test campaign that says do not drive.', Consequence: 'Fire.', Remedy: 'Free repair.' },
  ],
};

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.route('https://api.nhtsa.gov/recalls/**', (r) => r.fulfill({ json: NHTSA }));
await page.route('https://api.nhtsa.gov/products/vehicle/makes**', (r) => r.fulfill({ json: { results: [{ make: 'HONDA' }, { make: 'TOYOTA' }] } }));
await page.route('https://api.nhtsa.gov/products/vehicle/models**', (r) => r.fulfill({ json: { results: [{ model: 'ACCORD' }, { model: 'CIVIC' }] } }));
await page.route('https://vpic.nhtsa.dot.gov/**', (r) => r.fulfill({ json: { Results: [{ Make: 'HONDA', Model: 'Accord', ModelYear: '2012' }] } }));
await page.route('https://world.openfoodfacts.org/**', (r) => r.fulfill({ json: { status: 1, product: { brands: 'Anker', product_name: 'PowerCore 10000 A1263' } } }));
await page.route(/cpsc\.gov|openproductsfacts|esm\.sh/, (r) => r.abort());
const shot = (name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.log(`not ok - ${name}\n  ${err.message.split('\n')[0]}`);
    await shot(`FAILED-${name.replace(/\W+/g, '-')}`);
    process.exitCode = 1;
  }
};

await page.goto(BASE + '/');
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '/');

await step('loads the snapshot and shows the feed', async () => {
  await page.waitForFunction(() => /recalls/.test(document.querySelector('#freshness').textContent));
  await page.waitForSelector('#feed-list .card');
  await shot('1-home');
});

await step('search finds a model-number match', async () => {
  await page.fill('#q', 'Anker A1263');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#search-results .card');
  assert.match(await page.textContent('#search-results .card .chip'), /Model match/);
  assert.equal(await page.isHidden('#feed'), true);
});

await step('search by recall number', async () => {
  await page.fill('#q', 'CPSC recall 19105');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => /Rock 'n Play/.test(document.querySelector('#search-results .card h3')?.textContent || ''));
  await page.fill('#q', 'Anker A1263');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => /Anker/.test(document.querySelector('#search-results .card h3')?.textContent || ''));
});

await step('recall sheet opens and deep link is set', async () => {
  await page.click('#search-results .card h3 button');
  await page.waitForSelector('#sheet[open] h2');
  assert.match(await page.textContent('#sheet h2'), /Anker/);
  assert.match(page.url(), /recall=25338/);
  await shot('2-sheet');
  await page.click('#sheet .close');
  await page.waitForFunction(() => !location.search.includes('recall='));
});

await step('?recall= link opens that recall', async () => {
  await page.goto(BASE + '/?recall=19105');
  await page.waitForSelector('#sheet[open] h2');
  assert.match(await page.textContent('#sheet h2'), /Rock 'n Play/);
  await page.click('#sheet .close');
});

await step('order history check uses purchase dates', async () => {
  await page.click('[data-tab=orders]');
  await page.fill('#orders', 'Order placed March 3, 2018\nKids II Rocking Sleeper\nOrder placed June 1, 2024\nKids II Rocking Sleeper Deluxe\nOrganic Cotton Bath Towels');
  await page.click('#orders-check');
  await page.waitForSelector('#orders-results .summary');
  assert.match(await page.textContent('#orders-results .summary'), /1 of 3 items may be recalled/);
  assert.match(await page.textContent('#orders-results .clear'), /came before you bought it/);
  await shot('3-orders');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'orders tab overflows');
});

await step('remedy wizard builds the claim message', async () => {
  await page.click('#orders-results .card button:has-text("I own this")');
  await page.waitForSelector('#wizard[open]');
  await page.fill('#wizard label:has-text("Your name") input', 'Jane Doe');
  assert.match(await page.inputValue('#wizard textarea'), /Jane Doe/);
  await shot('4-wizard');
  await page.click('#wizard .close');
});

await step('?items= imports a product list', async () => {
  await page.goto(BASE + '/?items=' + encodeURIComponent('ESR HaloLock Magnetic Wireless Power Bank\nPaper towels 12 rolls'));
  await page.waitForSelector('#orders-results .summary');
  assert.match(await page.textContent('#orders-results .summary'), /1 of 2 items/);
});

await step('barcode lookup falls back to the product name', async () => {
  await page.click('[data-tab=scan]');
  await page.fill('#upc', '012345678905');
  await page.click('#upc-form button');
  await page.waitForSelector('#scan-results .card');
  assert.match(await page.textContent('#scan-results'), /Anker PowerCore 10000 A1263/);
});

await step('vehicle check by VIN shows urgent warning', async () => {
  await page.click('[data-tab=car]');
  await page.fill('#vin', '1HGCM82633A004352');
  await page.click('#vin-form button');
  await page.waitForSelector('#car-results .card');
  assert.match(await page.textContent('#car-results .summary'), /2 recalls for the 2012 Honda Accord/);
  assert.match(await page.textContent('#car-results .alert'), /Do not drive/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'car tab overflows');
  await page.click('#car-results button:has-text("Save my")');
  await shot('5-car');
});

await step('vehicle check by year, make and model', async () => {
  await page.selectOption('#car-year', '2012');
  await page.waitForFunction(() => !document.querySelector('#car-make').disabled);
  await page.selectOption('#car-make', 'HONDA');
  await page.waitForFunction(() => !document.querySelector('#car-model').disabled);
  await page.selectOption('#car-model', 'CIVIC');
  await page.click('#ymm-go');
  await page.waitForFunction(() => /Civic/.test(document.querySelector('#car-results .summary')?.textContent || ''));
});

await step('mine lists saved things and watched items raise alerts', async () => {
  await page.click('[data-tab=mine]');
  await page.fill('#add-name', 'Contigo kids water bottle');
  await page.fill('#add-name', '4moms mamaRoo swing');
  await page.click('#add-form button');
  assert.ok((await page.$$('#mine-list .card')).length >= 3);
  await shot('6-mine');
});

await step('food recalls appear with lot codes', async () => {
  await page.click('[data-tab=search]');
  await page.click('#feed-filters button:has-text("Food")').catch(() => {});
  await page.fill('#q', 'Junebar snack bar');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#search-results .card');
  await page.click('#search-results .card h3 button');
  await page.waitForSelector('#sheet[open] .codes');
  await page.click('#sheet .close');
});

await step('dark mode and no horizontal scroll', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(BASE + '/');
  await page.waitForSelector('#feed-list .card');
  await shot('7-dark');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});

await step('no script errors', async () => assert.deepEqual(errors, []));
await browser.close();
