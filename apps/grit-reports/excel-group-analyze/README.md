# Grit BizSuite Dashboard

A self-contained, browser-based data visualization dashboard for Grit
BizSuite. It calls the cross-app aggregator API (`api/aggregate-margins`,
`api/aggregate-labor`) and renders the result as KPI tiles and charts — no
build step, no server-side rendering, no npm dependency beyond the bundled
Chart.js.

## Features

- **KPI tiles** — POS revenue, inventory COGS, gross margin (total + %),
  transaction count, average taskboard task-completion time, and a
  transactions-per-completed-task efficiency ratio.
- **Daily revenue chart** — grouped bar (revenue/COGS) with an overlaid
  margin trend line, rendered with the bundled Chart.js. COGS/margin bars
  only appear when the inventory upstream provides them.
- **Revenue composition chart** — a doughnut/pie chart showing gross margin
  vs. inventory COGS as a share of POS revenue for the selected period.
- **Per-upstream status chips** (grit-pos / grit-inventory / grit-taskboard)
  driven by each response's `upstream` marker, so a not-yet-built or
  unreachable upstream endpoint reads as a chip, never a crash or a
  silently-zero dashboard.
- **Locked state** (padlock panel) when the aggregator returns 401 (not
  signed in) or 403 (missing the `custom_reporting` addon), with copy
  explaining what's needed.
- **Download CSV** — exports the loaded range's daily + summary metrics as a
  `date,metric,value` CSV for further analysis in any spreadsheet tool.

Both charts re-render against the current light/dark `prefers-color-scheme`
theme (tick/legend/grid/slice colors switch with the OS theme).

## Quick start

No build step. Either:

- open `index.html` directly in a browser (charts render, but the aggregator
  calls need a deployed `api/` backend and a Grit Passport session), or
- host the folder on any static host:
  - **Vercel**: this is the app's `outputDirectory` per `../vercel.json`;
    `api/` at the app root is auto-detected as serverless functions.
  - **Netlify / other static hosts**: framework "Other", no build command,
    output directory = this folder (the aggregator API needs a Node
    serverless-function-capable host).

## Auth

Paste a Grit Passport bearer token into the field at the top of the page, or
leave it blank to rely on the `grit_passport` cookie already set by another
Grit BizSuite app in the same browser (cross-subdomain SSO — see
`@grit/passport`'s README for the cookie's `domain` attribute).

## Privacy

All chart rendering happens client-side (Chart.js is bundled locally — no
CDN calls). The dashboard only sends requests to this app's own `/api/*`
aggregator endpoints.

## Files

| File | Purpose |
|---|---|
| `index.html` | UI layout, styles |
| `app.js` | Dashboard logic — fetches the aggregator API, renders KPI tiles and charts |
| `chart.umd.js` | Bundled Chart.js v4 (MIT) |
