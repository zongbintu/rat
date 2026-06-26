# AGENTS.md

This file guides future development work in this repository.

## Project Goal

Migrate this project from a local Python-backed demo into a Cloudflare-hosted web tool:

- Frontend: Cloudflare Pages serving static assets.
- Backend API: Cloudflare Pages Functions.
- Runtime language for deployed backend: JavaScript or TypeScript.
- Python may remain temporarily as a reference implementation, but new deployable backend logic must not depend on Python.

The target user flow has two features:

1. When the user enters a security code, the page suggests matching stocks/bonds.
2. When the user clicks the calculate button, the app fetches market data and calculates the convertible-bond floor-price metrics, plus the lower-page table data for trading date, volume, and amount.

## Preferred Architecture

Use Cloudflare Pages plus Pages Functions. Do not create a separate Worker unless the API grows beyond this small app.

Recommended repository shape:

```text
rat/
  index.html
  data/
    convertible_bond_stocks.json
  functions/
    api/
      calculate.js
  scripts/
    update-securities.js
  .github/
    workflows/
      update-securities.yml
  package.json
  wrangler.toml
```

Use `data/convertible_bond_stocks.json` as the canonical static autocomplete data file. Do not rename it to `securities.json` unless the product expands from convertible-bond-related stocks into a general securities search.

## Frontend Rules

- Keep the first screen as the actual calculator UI, not a marketing page.
- The autocomplete/search list must be loaded from `/data/convertible_bond_stocks.json`, then filtered in the browser.
- Do not call a backend API on every keystroke.
- The calculate button should call only one backend endpoint:

```js
fetch(`/api/calculate?code=${code}&date=${date}`)
```

- The API response should be JSON shaped for direct UI rendering:

```json
{
  "code": "000001",
  "name": "平安银行",
  "avg20": "12.36",
  "avg1": "12.48",
  "floorPrice": "12.48",
  "cbValue": "100.64",
  "previousTradeDate": "2026-06-25",
  "tableRows": [
    {
      "date": "2026-06-25",
      "volume": "12,364.81",
      "amount": "127,090.29"
    }
  ]
}
```

- `tableRows` powers the lower table in `index.html`. Include at least the previous trading day's date, volume, and amount used by the calculation. If later UI requirements show more historical rows, extend this array without changing the top-level metric fields.
- Show clear loading and error states around the calculate request.
- Keep all visible Chinese text valid UTF-8. If existing files show mojibake, fix encoding while touching the relevant UI text.

## Pages Function Rules

Implement the calculation endpoint at:

```text
functions/api/calculate.js
```

Cloudflare will expose it as:

```text
/api/calculate
```

Use the Pages Functions handler shape:

```js
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  // ...
  return Response.json(data);
}
```

Port the logic from `cb_value.py` in this order:

1. `detect_exchange`
2. date parsing and validation
3. JSON and JSONP fetching
4. Shenzhen quote fetching
5. Shanghai quote fetching
6. calculation and response formatting, including the lower-table trading date, volume, and amount fields

Use Worker-native `fetch()` instead of `requests`.

For JSONP responses, parse defensively:

```js
const match = text.trim().match(/^[\w$]+\((.*)\)$/s);
```

Return structured errors with non-200 status codes:

```json
{ "error": "证券代码必须是 6 位数字" }
```

## Quota And Caching Rules

Cloudflare Workers Free currently allows 100,000 requests/day. Pages Functions count toward this quota.

To preserve quota:

- Autocomplete must use static JSON and browser-side filtering.
- Only the calculate action should hit `/api/calculate`.
- Cache calculation results by `code + date`.
- Use Cloudflare cache headers and/or the Cache API for repeated same-day lookups.
- Keep outgoing subrequests well below the free-plan limit of 50 subrequests per invocation.

Suggested cache key:

```text
/api/calculate?code=000001&date=2026-06-25
```

For market data, a same-day cache TTL such as 1 day is acceptable unless product requirements say otherwise.

## Securities List Update

The preferred update strategy is GitHub Actions, not a runtime server write.

Daily flow:

```text
GitHub Actions scheduled workflow
  -> runs scripts/update-securities.js
  -> writes data/convertible_bond_stocks.json
  -> commits changed file
  -> Cloudflare Pages auto-deploys from Git
```

This keeps autocomplete data static and CDN-friendly.

Only use Cloudflare Cron + KV/R2 if GitHub Actions is unavailable or the list must update without redeploying Pages.

## Local Development

Use Wrangler, Cloudflare's official CLI, for local Pages/Functions development.

Expected setup:

```sh
npm init -y
npm install -D wrangler
```

If decimal precision becomes an issue, prefer `decimal.js` or integer arithmetic:

```sh
npm install decimal.js
```

Run locally:

```sh
npx wrangler pages dev .
```

Test these URLs:

```text
http://localhost:8788/
http://localhost:8788/data/convertible_bond_stocks.json
http://localhost:8788/api/calculate?code=000001&date=2026-06-25
```

## Deployment

Deploy with Wrangler:

```sh
npx wrangler pages deploy . --project-name rat
```

If the project is connected to GitHub in Cloudflare Pages, prefer pushing to the connected branch and letting Pages deploy automatically.

## Verification Checklist

Before considering the migration complete:

- The page loads from Cloudflare Pages or `wrangler pages dev`.
- Autocomplete works from static JSON without API requests per keystroke.
- `/api/calculate` returns JSON for valid Shanghai and Shenzhen codes.
- The calculate response updates both the metric cards and the lower table date/volume/amount fields in `index.html`.
- Invalid code and invalid date cases return helpful errors.
- The calculate UI renders loading, success, and error states.
- Repeated same `code + date` calls are cacheable.
- No deployed code requires Python or `requirements.txt`.

## Files To Treat Carefully

- `cb_value.py`: reference implementation for exchange request and calculation behavior. Do not delete until the JS/TS endpoint is verified.
- `index.html`: current UI. Keep edits scoped to API integration, data loading, encoding fixes, and necessary UX states.
- `data/convertible_bond_stocks.json`: canonical static autocomplete list for convertible-bond-related stocks. Keep all frontend references and update scripts pointed at this file.
