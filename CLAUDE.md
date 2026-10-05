# RecallRadar

Static PWA (no build step) that checks products, food and cars people own against U.S. recalls
(CPSC, FDA food, NHTSA). Live: https://perezamadorluisenrique-gif.github.io/recall-radar/
Part of Hidden Problems Lab; project policy lives in `/mnt/project-files/autopilot/charter.md`.

## Commands
| Job | Command |
|---|---|
| Unit tests | `npm test` (node:test, `test/*.test.mjs`) |
| Single test file | `node --test test/match.test.mjs` |
| Sample data for dev | `npm run data:sample` |
| Full snapshot (CI only: the sandbox can't reach saferproducts.gov) | `npm run data` |
| Serve | `npm start` (site/ on :5173) or `python3 -m http.server 5173 -d site` |
| Phone e2e | `npm run data:sample && BASE=http://localhost:5173 node test/e2e.mjs` (Playwright, mocked APIs) |
| Matching quality gate | `node scripts/eval-matching.mjs --check` (needs full snapshot; fails if CPSC top-3 < 88% or > 20/50 everyday products alarm) |

## Architecture
- `site/` is what ships. `match.js` fuzzy matching, `cpsc.js`/`fda.js` sources, `vehicles.js` live NHTSA, `sw.js` offline shell.
- `scripts/fetch-recalls.mjs` builds `site/data/` (meta, index, per-year details) in CI; never commit `site/data/`.
- Deploy: `.github/workflows/deploy.yml` on push to main and daily cron; PRs run the same gates without deploying.

## Rules
- Never tell a user a product is safe: "no matching recall found in <sources> as of <date>", and always link the official notice.
- Data stays on the device; no tracking.
- Work on a branch and open a PR; gates must be green before merge. Never skip a test.

## Traps
- The sandbox can't reach github.io, saferproducts.gov or CPSC; use Actions runs as the probe, WebFetch for the live page (may be cached).
- Git branch deletes through the proxy fail; leftover `probe` and `rawdata` branches are harmless.
- GraphQL is blocked: use `gh api repos/...` instead of `gh pr list`/`gh issue list`.
- Scheduled runs start hours late; judge freshness from the run time. GitHub disables cron after 60 days with no commits.
- UPCitemdb and FSIS don't allow browser CORS.
