# Weather 1 Dashboard

Static GitHub Pages dashboard for the Weather 1 field station. The page reads
five-minute summaries from the public Cloudflare Worker API; telemetry updates do
not rebuild or redeploy this site.

## Pages setup

In this repository, open **Settings → Pages** and set **Source** to **GitHub
Actions**. Pushes to `main` then deploy through `.github/workflows/pages.yml`.

Production URL: <https://newgend2.github.io/weather-dashboard/>

## Configuration

`config.js` contains the public Worker URL and station ID. It contains no secret.
The ingestion secret exists only in Cloudflare and on the Raspberry Pi.
