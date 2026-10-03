# RecallRadar

**Is anything in your home recalled?** RecallRadar checks the products you already own against every U.S. Consumer Product Safety Commission (CPSC) recall, then walks you through getting the refund, replacement or repair.

**Live app:** https://perezamadorluisenrique-gif.github.io/recall-radar/

Only about 6% of recalled consumer products are ever fixed (CPSC 2017 recall-effectiveness workshop, cited by the Senate Commerce Committee in 2021). People simply never find out that the charger or baby sleeper they bought three years ago was recalled. RecallRadar flips recalls from "pull" (go read the news) to "push" (here's what *you* own that's affected).

## What it does

- **Search** any product, brand, model number or UPC.
- **Scan** a barcode with your phone camera. Exact UPC hits come first; otherwise the barcode is resolved to a product name (Open Food Facts, UPCitemdb) and matched by name.
- **Paste your order history** from Amazon, Walmart, Target, eBay or a receipt. Each line is checked; prices, order numbers and noise are ignored.
- **My stuff**: keep a list of things you own. It is re-checked against new recalls every time you open the app, and you get an alert when something matches.
- **Remedy wizard**: confirm the model, see the hazard, fill in your details once, and get a ready-to-send refund/replacement request with the company's email, phone and recall page pulled from the notice. Track each claim from "Not started" to "Resolved".

Everything you enter stays in your browser (localStorage). No accounts, no server.

## How it works

```
GitHub Action (daily) ──► CPSC Recalls API ──► site/data/index.json + details/<year>.json ──► GitHub Pages
                                                         │
Browser: search / scan / paste ──► match.js (token + IDF scoring, model and UPC detection) ──► results ──► remedy wizard
```

- `scripts/fetch-recalls.mjs` downloads every recall year by year from `https://www.saferproducts.gov/RestWebServices/Recall` (free, no key) and writes a compact search index plus per-year detail files, so the app loads fast on phones and works offline.
- `site/match.js` does the fuzzy matching. Confidence levels: **Barcode match** (UPC on the notice), **Model match** (a model number like `A1263` matched), **Likely** (brand plus product words), **Possible** (partial overlap, search only).
- If no snapshot is deployed, the app falls back to querying the CPSC API live.
- Static site, no build step: plain HTML, CSS and ES modules. Installable as a PWA.

## Run it locally

```bash
npm test               # matching tests against real recall records
npm run data:sample    # small offline snapshot (10 real recalls) for development
npm run data           # or: the full CPSC snapshot (~10k recalls)
npm start              # serves site/ on http://localhost:5173
```

## Deploy

Push to `main`. The `Refresh recalls and deploy` workflow runs the tests, downloads the latest recalls and publishes `site/` to GitHub Pages; it also runs daily. One-time setup: **Settings → Pages → Source: GitHub Actions**.

## Roadmap

- Forward order-confirmation emails to a personal address for automatic checking.
- Receipt photo OCR.
- Push / email notifications for new matches on "My stuff".
- NHTSA (vehicles, car seats), FDA (food, drugs) and Health Canada recall sources.
- B2B API for resale marketplaces, home-insurance apps and product-registration services.

## Disclaimer

Not affiliated with or endorsed by CPSC. Matches are suggestions: always confirm the model number, dates and retailer against the official recall notice before acting.

## License

MIT
