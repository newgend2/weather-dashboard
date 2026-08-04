# Weather 1 Dashboard

Static GitHub Pages dashboard for the Weather 1 field station. The page reads
five-minute summaries from the public Cloudflare Worker API; telemetry updates do
not rebuild or redeploy this site.

The API retains temperature in Celsius as its canonical sensor unit. The
dashboard converts current, range, chart, low, and high temperatures to
Fahrenheit for display.

History controls provide a selectable day plus 1D, 5D, 1M, 6M, YTD, 1Y, 5Y,
and Max ranges. Day views mark every five-minute observation, use hourly grid
intervals, show units on the y-axis, label high/low values inside the plot, and
provide exact time/value tooltips. Longer views use clearly labelled server-side
aggregation so multi-year charts remain responsive without discarding stored
history.

## Pages setup

In this repository, open **Settings → Pages** and set **Source** to **GitHub
Actions**. Pushes to `main` then deploy through `.github/workflows/pages.yml`.

Production URL: <https://newgend2.github.io/weather-dashboard/>

## Configuration

`config.js` contains the public Worker URL and station ID. It contains no secret.
The ingestion secret exists only in Cloudflare and on the Raspberry Pi.
