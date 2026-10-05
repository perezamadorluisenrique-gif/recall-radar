# RecallRadar

**Is anything in your home recalled?** RecallRadar checks the products, food and car you already own against U.S. recalls from the Consumer Product Safety Commission (CPSC), the FDA and NHTSA. Then it walks you through getting the refund, replacement or repair.

**Live app:** https://perezamadorluisenrique-gif.github.io/recall-radar/

Only about 6% of recalled consumer products are ever fixed (CPSC 2017 recall-effectiveness workshop, cited by the Senate Commerce Committee in 2021). People simply never find out that the charger, baby sleeper or snack bar they bought was recalled. RecallRadar flips recalls from "pull" (go read the news) to "push" (here is what *you* own that's affected).

## What it does

- **Search** any product, brand, model number, food, UPC or recall number (`25338`, `H-0543-2026`).
- **Latest recalls** feed of the last 45 days, filterable by category (baby and kids, power and batteries, home, kitchen, outdoor, clothing, food), with hazard tags such as fire, choking or Listeria.
- **Scan** a barcode with your phone camera. Exact UPC hits come first; otherwise the barcode is resolved to a product name through Open Food Facts and Open Products Facts and matched by name.
- **Paste your order history** from Amazon, Walmart, Target, eBay or a receipt. Order dates are read from lines like "Order placed March 3, 2018", so a recall from years before you bought something doesn't raise a false alarm.
- **One-click Amazon check**: a bookmarklet sends the product titles on your order-history page to the app.
- **Car check**: enter a VIN or pick year, make and model to see NHTSA safety recalls live, with a red warning for "do not drive" and "park outside" recalls. Saved vehicles are re-checked for new campaigns every time you open the app.
- **Food recalls**: FDA Class I and II food recalls from the last two years, with lot and "best by" codes to compare against your package.
- **Mine**: keep a list of things you own. It is re-checked against new recalls every time you open the app, and you get an alert when something matches. Back it up, restore it, or copy a summary.
- **Remedy wizard**: confirm the model, see the hazard, fill in your details once, and get a ready-to-send refund or replacement request with the company's email, phone and recall page pulled from the notice. If the company doesn't answer, it links to CPSC's complaint form. For food it walks through checking codes, returning or discarding, and Poison Control.
- **Share** any recall with a link (`?recall=25338`), share text or links into the app from other apps (PWA share target), and install it to your home screen.

Everything you enter stays in your browser (localStorage). No accounts, no server, no tracking.

## How it works

```
GitHub Action (daily) ──► CPSC Recalls API + openFDA food enforcement
                          ──► site/data/index.json + details/<source>-<year>.json ──► GitHub Pages
Browser: search / scan / paste ──► match.js (token + IDF scoring, model and UPC detection) ──► results ──► remedy wizard
Browser: VIN or year/make/model ──► NHTSA recalls API (live) ──► vehicle recalls
```

- `scripts/fetch-recalls.mjs` downloads every CPSC recall since 1973 year by year from `saferproducts.gov` and the last two years of FDA Class I and II food recalls from `api.fda.gov`. Both are free and need no key. It writes a compact search index plus per-year detail files, so the app loads fast on phones and works offline.
- `site/match.js` does the fuzzy matching. Confidence levels: **Barcode match** (UPC on the notice), **Model match** (a model number like `A1263` matched, specific to at most two recalls), **Brand and product match** (the brand plus at least one product word), **Similar product** (partial overlap, search only).
- `site/vehicles.js` calls the NHTSA recalls API and vPIC VIN decoder from the browser.
- If no snapshot is deployed, the app falls back to querying the CPSC API live.
- Static site, no build step: plain HTML, CSS and ES modules. Installable as a PWA.

## Data API

The daily snapshot is public and free to reuse:

- `data/meta.json`: `{updated, count, sources: {cpsc, fda}}`
- `data/index.json`: an array of compact rows `{s, n, d, t, b, p, m, u, z, g, c, done}`: source (`cpsc` or `fda`), recall number, date, title, firm, product names, model numbers, UPCs, hazard tags, category, FDA class, and `done` for FDA recalls that are completed or terminated.
- `data/details/<source>-<year>.json`: `{recallNumber: {...}}` with hazard, remedy, contact, images, codes and links.

Example: `https://perezamadorluisenrique-gif.github.io/recall-radar/data/meta.json`

## Run it locally

```bash
npm test               # unit tests against real recall records
npm run data:sample    # small offline snapshot (real CPSC and FDA records) for development
npm run data           # or: the full snapshot (about 12,000 recalls)
npm start              # serves site/ on http://localhost:5173
npm run e2e            # phone-sized browser test (needs Playwright; uses the sample snapshot, mocks NHTSA and Open Food Facts)
npm run eval           # matching quality on the full snapshot: accuracy on order-style lines and false alarms on everyday products
```

## Deploy

Push to `main`. The `Refresh recalls and deploy` workflow runs the unit tests and the browser test, downloads the latest recalls, refuses to publish if matching quality drops (top-3 accuracy under 88% or more than 20 of 50 everyday products flagged), and publishes `site/` to GitHub Pages. It also runs daily. One-time setup: **Settings → Pages → Source: GitHub Actions**.

## Roadmap

- Forward order-confirmation emails to a personal address for automatic checking.
- Receipt photo OCR.
- Push or email notifications for new matches on "Mine".
- USDA meat and poultry, drug and Health Canada recall sources.
- B2B API for resale marketplaces, home-insurance apps and product-registration services.

## Privacy

No account and no server. Your list stays in the browser. Visits are counted with [GoatCounter](https://www.goatcounter.com/) (`stats.js`): no cookies, nothing stored on the device, no personal data. It sends only the page path (never the query string, so shared links and anything typed stay private), the referring site and the screen width, and it is skipped when Do Not Track is on.

## Disclaimer

Not affiliated with or endorsed by CPSC, FDA or NHTSA. Matches are suggestions: always confirm the model number, lot codes, dates and retailer against the official recall notice before acting.

## License

MIT
