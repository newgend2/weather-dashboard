(() => {
  "use strict";

  const config = window.WEATHER_CONFIG;
  const FIVE_MINUTES_SEC = 300;
  const MAX_CHART_POINTS = 1400;
  const celsiusToFahrenheit = (value) =>
    Number.isFinite(value) ? (value * 9) / 5 + 32 : value;
  const identity = (value) => value;
  const metricMeta = {
    temperature_c: {
      label: "Temperature",
      unit: "°F",
      color: "#d9823b",
      displayValue: celsiusToFahrenheit,
    },
    relative_humidity_percent: {
      label: "Humidity",
      unit: "%",
      color: "#4d86a2",
      displayValue: identity,
    },
    pressure_hpa: {
      label: "Pressure",
      unit: "hPa",
      color: "#668355",
      displayValue: identity,
    },
    wind_speed_m_s: {
      label: "Wind",
      unit: "m/s",
      color: "#75659b",
      displayValue: identity,
    },
  };
  const rangeMeta = {
    "1D": { label: "Selected day", resolutionSec: FIVE_MINUTES_SEC },
    "5D": { label: "Last 5 days", resolutionSec: FIVE_MINUTES_SEC },
    "1M": { label: "Last month", resolutionSec: 60 * 60 },
    "6M": { label: "Last 6 months", resolutionSec: 6 * 60 * 60 },
    YTD: { label: "Year to date", resolutionSec: 24 * 60 * 60 },
    "1Y": { label: "Last year", resolutionSec: 24 * 60 * 60 },
    "5Y": { label: "Last 5 years", resolutionSec: 7 * 24 * 60 * 60 },
    MAX: { label: "All available history", resolutionSec: null },
  };

  let historyPoints = [];
  let historyMeta = null;
  let coverage = null;
  let activeMetric = "temperature_c";
  let activeRange = "1D";
  let selectedDate = dateInputValue(new Date());
  let chartHitPoints = [];

  const byId = (id) => document.getElementById(id);
  const number = (value, digits = 1) =>
    Number.isFinite(value) ? Number(value).toFixed(digits) : "--";

  function dateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatTime(value, options = {}) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...options,
    }).format(date);
  }

  function formatSelectedDay(value) {
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function rangeText(summary, unit, prefix = "Range", displayValue = identity) {
    if (!summary || !Number.isFinite(summary.min) || !Number.isFinite(summary.max)) {
      return "Five-minute range unavailable";
    }
    return `${prefix} ${number(displayValue(summary.min))}–${number(displayValue(summary.max))} ${unit}`;
  }

  function stationState(reading) {
    const observed = new Date(reading.bucket_end_utc).getTime();
    const ageMinutes = (Date.now() - observed) / 60000;
    const shutdown = Date.parse(reading.health?.next_scheduled_shutdown_utc || "");
    const startup = Date.parse(reading.health?.next_scheduled_startup_utc || "");
    if (Number.isFinite(shutdown) && Number.isFinite(startup) && Date.now() >= shutdown && Date.now() < startup) {
      return { key: "sleeping", label: "Station sleeping" };
    }
    if (ageMinutes < 12) return { key: "current", label: "Current" };
    if (ageMinutes < 30) return { key: "delayed", label: "Update delayed" };
    return { key: "offline", label: "Station offline" };
  }

  function setState(state) {
    const pill = byId("station-state");
    pill.className = `state-pill state-${state.key}`;
    byId("state-label").textContent = state.label;
  }

  function updateLatest(reading) {
    setState(stationState(reading));
    const age = Math.max(0, Math.round((Date.now() - Date.parse(reading.bucket_end_utc)) / 60000));
    byId("observation-time").textContent =
      `${formatTime(reading.bucket_end_utc)} · ${age < 1 ? "just now" : `${age} min ago`}`;

    byId("temperature").textContent = number(celsiusToFahrenheit(reading.temperature_c?.latest));
    byId("humidity").textContent = number(reading.relative_humidity_percent?.latest);
    byId("pressure").textContent = number(reading.pressure_hpa?.latest);
    byId("wind").textContent = number(reading.wind_speed_m_s?.latest);
    byId("temperature-range").textContent = rangeText(
      reading.temperature_c,
      "°F",
      "Range",
      celsiusToFahrenheit,
    );
    byId("humidity-range").textContent = rangeText(reading.relative_humidity_percent, "%");
    byId("pressure-range").textContent = rangeText(reading.pressure_hpa, "hPa");
    byId("wind-range").textContent = Number.isFinite(reading.wind_speed_m_s?.max)
      ? `Maximum ${number(reading.wind_speed_m_s.max)} m/s`
      : "Five-minute maximum unavailable";

    const health = reading.health || {};
    byId("sample-count").textContent = String(reading.sample_count ?? "--");
    byId("wifi-signal").textContent = Number.isFinite(health.wifi_signal_percent)
      ? `${health.wifi_signal_percent}%`
      : "No Wi-Fi reading";
    byId("disk-used").textContent = Number.isFinite(health.disk_used_percent)
      ? `${number(health.disk_used_percent)}%`
      : "--";
    byId("clock-state").textContent =
      health.clock_synchronized === true ? "NTP synchronized" :
      health.clock_synchronized === false ? "RTC fallback" : "Unknown";
    byId("backlog").textContent = Number.isFinite(health.publisher_backlog_buckets)
      ? `${health.publisher_backlog_buckets} bucket${health.publisher_backlog_buckets === 1 ? "" : "s"}`
      : "--";
    byId("next-wake").textContent = formatTime(health.next_scheduled_startup_utc, {
      weekday: "short",
    });
  }

  async function getJson(path) {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.message || `API returned ${response.status}`);
    return body;
  }

  function subtractMonths(date, months) {
    const result = new Date(date);
    result.setMonth(result.getMonth() - months);
    return result;
  }

  function subtractYears(date, years) {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() - years);
    return result;
  }

  function adaptiveResolution(rangeSeconds) {
    const desired = rangeSeconds / MAX_CHART_POINTS;
    const choices = [300, 3600, 21600, 86400, 604800, 2678400];
    return choices.find((seconds) => seconds >= desired) || choices[choices.length - 1];
  }

  function selectedBounds() {
    const now = new Date();
    let start;
    let end = now;
    if (activeRange === "1D") {
      start = new Date(`${selectedDate}T00:00:00`);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
    } else if (activeRange === "5D") {
      start = new Date(now);
      start.setDate(start.getDate() - 5);
    } else if (activeRange === "1M") {
      start = subtractMonths(now, 1);
    } else if (activeRange === "6M") {
      start = subtractMonths(now, 6);
    } else if (activeRange === "YTD") {
      start = new Date(now.getFullYear(), 0, 1);
    } else if (activeRange === "1Y") {
      start = subtractYears(now, 1);
    } else if (activeRange === "5Y") {
      start = subtractYears(now, 5);
    } else {
      start = coverage?.first_bucket_utc ? new Date(coverage.first_bucket_utc) : new Date(now.getTime() - 86400000);
    }
    const rangeSeconds = Math.max(FIVE_MINUTES_SEC, Math.ceil((end - start) / 1000));
    return {
      start,
      end,
      resolutionSec: rangeMeta[activeRange].resolutionSec || adaptiveResolution(rangeSeconds),
    };
  }

  function updateHistoryControls() {
    const dayControls = byId("day-controls");
    dayControls.hidden = activeRange !== "1D";
    byId("history-date").value = selectedDate;
    byId("previous-day").disabled = Boolean(
      coverage?.first_bucket_utc && selectedDate <= dateInputValue(new Date(coverage.first_bucket_utc)),
    );
    byId("next-day").disabled = selectedDate >= dateInputValue(new Date());
    byId("history-period-label").textContent = activeRange === "1D"
      ? formatSelectedDay(selectedDate)
      : rangeMeta[activeRange].label;
    byId("chart-wrap").style.minWidth = activeRange === "1D" ? "960px" : "0";
    document.querySelectorAll(".range-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.range === activeRange);
    });
  }

  function updateCoverageControls() {
    const input = byId("history-date");
    input.max = dateInputValue(new Date());
    if (coverage?.first_bucket_utc) input.min = dateInputValue(new Date(coverage.first_bucket_utc));
  }

  function displayMetricValue(point, key = "mean") {
    const value = point[activeMetric]?.[key];
    return metricMeta[activeMetric].displayValue(value);
  }

  function chartValues() {
    return historyPoints
      .map((point) => ({
        point,
        time: Date.parse(point.time_utc),
        value: displayMetricValue(point, "mean"),
        min: displayMetricValue(point, "min"),
        max: displayMetricValue(point, "max"),
      }))
      .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.value));
  }

  function xAxisTicks(start, end) {
    const range = end - start;
    const ticks = [];
    let stepMs;
    let formatter;
    if (activeRange === "1D") {
      stepMs = 60 * 60 * 1000;
      formatter = (date) => new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(date);
    } else if (range <= 7 * 86400000) {
      stepMs = 12 * 60 * 60 * 1000;
      formatter = (date) => new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric" }).format(date);
    } else if (range <= 45 * 86400000) {
      stepMs = 3 * 86400000;
      formatter = (date) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
    } else if (range <= 550 * 86400000) {
      const cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      cursor.setDate(1);
      if (cursor.getTime() < start) cursor.setMonth(cursor.getMonth() + 1);
      while (cursor.getTime() <= end) {
        ticks.push({
          time: cursor.getTime(),
          label: new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" }).format(cursor),
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
      return ticks;
    } else {
      const cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      cursor.setMonth(0, 1);
      if (cursor.getTime() < start) cursor.setFullYear(cursor.getFullYear() + 1);
      while (cursor.getTime() <= end) {
        ticks.push({ time: cursor.getTime(), label: String(cursor.getFullYear()) });
        cursor.setFullYear(cursor.getFullYear() + 1);
      }
      return ticks;
    }

    const first = Math.ceil(start / stepMs) * stepMs;
    for (let time = first; time <= end; time += stepMs) {
      ticks.push({ time, label: formatter(new Date(time)) });
    }
    return ticks;
  }

  function drawExtremaLabel(context, x, y, label, color, preferBelow, bounds) {
    context.font = "600 10px DM Mono, monospace";
    const paddingX = 5;
    const labelWidth = context.measureText(label).width + paddingX * 2;
    const left = Math.max(bounds.left, Math.min(x - labelWidth / 2, bounds.right - labelWidth));
    const top = preferBelow
      ? Math.min(bounds.bottom - 18, y + 8)
      : Math.max(bounds.top, y - 24);
    context.fillStyle = "rgba(255,255,252,.94)";
    context.fillRect(left, top, labelWidth, 17);
    context.strokeStyle = `${color}88`;
    context.strokeRect(left, top, labelWidth, 17);
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, left + labelWidth / 2, top + 8.5);
  }

  function drawChart() {
    const canvas = byId("history-chart");
    const empty = byId("chart-empty");
    const tooltip = byId("chart-tooltip");
    const values = chartValues();
    const meta = metricMeta[activeMetric];
    tooltip.hidden = true;
    byId("chart-unit").textContent = `${meta.label} · ${meta.unit}`;
    chartHitPoints = [];
    if (!historyMeta || values.length === 0) {
      empty.hidden = false;
      canvas.hidden = true;
      byId("chart-resolution").textContent = "No observations in this period";
      return;
    }

    empty.hidden = true;
    canvas.hidden = false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);

    const extremaValues = values.flatMap((item) => [item.min, item.max]).filter(Number.isFinite);
    let low = Math.min(...extremaValues, ...values.map((item) => item.value));
    let high = Math.max(...extremaValues, ...values.map((item) => item.value));
    const valuePadding = Math.max((high - low) * 0.12, activeMetric === "pressure_hpa" ? 0.5 : 0.25);
    low -= valuePadding;
    high += valuePadding;

    const margin = { left: 68, right: 18, top: 20, bottom: 42 };
    const plotWidth = Math.max(1, rect.width - margin.left - margin.right);
    const plotHeight = Math.max(1, rect.height - margin.top - margin.bottom);
    const start = Date.parse(historyMeta.start_utc);
    const end = Date.parse(historyMeta.end_utc);
    const x = (time) => margin.left + ((time - start) / Math.max(1, end - start)) * plotWidth;
    const y = (value) => margin.top + (1 - (value - low) / Math.max(0.0001, high - low)) * plotHeight;
    const bounds = { left: margin.left, right: margin.left + plotWidth, top: margin.top, bottom: margin.top + plotHeight };

    context.lineWidth = 1;
    context.font = "10px DM Mono, monospace";
    context.textBaseline = "middle";
    for (let index = 0; index <= 4; index += 1) {
      const tickValue = high - ((high - low) / 4) * index;
      const tickY = margin.top + (plotHeight / 4) * index;
      context.strokeStyle = "rgba(21,37,31,.09)";
      context.beginPath();
      context.moveTo(margin.left, tickY);
      context.lineTo(bounds.right, tickY);
      context.stroke();
      context.fillStyle = "#63736c";
      context.textAlign = "right";
      context.fillText(`${number(tickValue)} ${meta.unit}`, margin.left - 8, tickY);
    }

    context.textBaseline = "alphabetic";
    let lastTickLabelX = Number.NEGATIVE_INFINITY;
    const minimumTickLabelSpacing = activeRange === "1D" ? 30 : 54;
    for (const tick of xAxisTicks(start, end)) {
      const tickX = x(tick.time);
      context.strokeStyle = "rgba(21,37,31,.07)";
      context.beginPath();
      context.moveTo(tickX, margin.top);
      context.lineTo(tickX, bounds.bottom);
      context.stroke();
      if (tickX - lastTickLabelX >= minimumTickLabelSpacing) {
        context.fillStyle = "#63736c";
        context.textAlign = "center";
        context.fillText(tick.label, Math.max(margin.left + 14, Math.min(bounds.right - 14, tickX)), rect.height - 9);
        lastTickLabelX = tickX;
      }
    }

    const gapThresholdMs = Math.max(20 * 60 * 1000, historyMeta.resolution_sec * 2.5 * 1000);
    context.strokeStyle = meta.color;
    context.lineWidth = 1.8;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    values.forEach((item, index) => {
      const pointX = x(item.time);
      const pointY = y(item.value);
      if (index === 0 || item.time - values[index - 1].time > gapThresholdMs) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    });
    context.stroke();

    values.forEach((item) => {
      const pointX = x(item.time);
      const pointY = y(item.value);
      context.beginPath();
      context.arc(pointX, pointY, historyMeta.aggregated ? 3 : 2.4, 0, Math.PI * 2);
      context.fillStyle = "#fffdf8";
      context.fill();
      context.strokeStyle = meta.color;
      context.lineWidth = 1.5;
      context.stroke();
      chartHitPoints.push({ x: pointX, y: pointY, item });
    });

    const lowest = values.reduce((result, item) => {
      if (!Number.isFinite(item.min)) return result;
      return !result || item.min < result.value ? { item, value: item.min } : result;
    }, null);
    const highest = values.reduce((result, item) => {
      if (!Number.isFinite(item.max)) return result;
      return !result || item.max > result.value ? { item, value: item.max } : result;
    }, null);
    if (highest && Number.isFinite(highest.value)) {
      const highX = x(highest.item.time);
      const highY = y(highest.value);
      context.beginPath();
      context.arc(highX, highY, 3.2, 0, Math.PI * 2);
      context.fillStyle = meta.color;
      context.fill();
      drawExtremaLabel(context, highX, highY, `High ${number(highest.value)} ${meta.unit}`, meta.color, false, bounds);
    }
    if (lowest && Number.isFinite(lowest.value)) {
      const lowX = x(lowest.item.time);
      const lowY = y(lowest.value);
      context.beginPath();
      context.arc(lowX, lowY, 3.2, 0, Math.PI * 2);
      context.fillStyle = meta.color;
      context.fill();
      drawExtremaLabel(context, lowX, lowY, `Low ${number(lowest.value)} ${meta.unit}`, meta.color, true, bounds);
    }

    const rawObservations = historyPoints.reduce((total, point) => total + Number(point.observation_count || 0), 0);
    byId("chart-resolution").textContent = historyMeta.aggregated
      ? `Each dot summarizes ${formatDuration(historyMeta.resolution_sec)} · ${rawObservations} observations`
      : `Each dot is one five-minute observation · ${values.length} shown`;
  }

  function formatDuration(seconds) {
    let value;
    let unit;
    if (seconds < 3600) {
      value = Math.round(seconds / 60);
      unit = "minute";
    } else if (seconds < 86400) {
      value = Math.round(seconds / 3600);
      unit = "hour";
    } else if (seconds < 604800) {
      value = Math.round(seconds / 86400);
      unit = "day";
    } else {
      value = Math.round(seconds / 604800);
      unit = "week";
    }
    return `${value} ${unit}${value === 1 ? "" : "s"}`;
  }

  function showTooltip(event) {
    if (chartHitPoints.length === 0) return;
    const canvas = byId("history-chart");
    const canvasRect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - canvasRect.left;
    const pointerY = event.clientY - canvasRect.top;
    let closest = null;
    for (const hit of chartHitPoints) {
      const distance = Math.hypot(hit.x - pointerX, hit.y - pointerY);
      if (!closest || distance < closest.distance) closest = { hit, distance };
    }
    const tooltip = byId("chart-tooltip");
    if (!closest || closest.distance > (event.pointerType === "touch" ? 28 : 13)) {
      tooltip.hidden = true;
      return;
    }

    const { point, value } = closest.hit.item;
    const meta = metricMeta[activeMetric];
    if (historyMeta.aggregated) {
      tooltip.textContent = `${formatTime(point.window_start_utc)} – ${formatTime(point.window_end_utc)}\nMean ${number(value)} ${meta.unit}\n${point.observation_count} five-minute observations`;
    } else {
      tooltip.textContent = `${formatTime(point.time_utc, { year: "numeric", second: "2-digit" })}\n${number(value)} ${meta.unit} five-minute mean`;
    }
    const wrapRect = byId("chart-wrap").getBoundingClientRect();
    tooltip.style.left = `${Math.max(90, Math.min(wrapRect.width - 90, event.clientX - wrapRect.left))}px`;
    tooltip.style.top = `${Math.max(52, event.clientY - wrapRect.top)}px`;
    tooltip.hidden = false;
  }

  async function loadHistory() {
    updateHistoryControls();
    const bounds = selectedBounds();
    const stationPath = `/api/v1/stations/${encodeURIComponent(config.stationId)}`;
    const query = new URLSearchParams({
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
      resolution_sec: String(bounds.resolutionSec),
      ts: String(Date.now()),
    });
    const body = await getJson(`${stationPath}/history?${query}`);
    historyPoints = body.points || [];
    historyMeta = body;
    drawChart();
  }

  async function refreshHistory() {
    const banner = byId("error-banner");
    banner.hidden = true;
    try {
      await loadHistory();
      byId("api-state").textContent = "API connected";
    } catch (error) {
      historyPoints = [];
      historyMeta = null;
      drawChart();
      banner.textContent = `Could not load history: ${error.message}`;
      banner.hidden = false;
    }
  }

  async function refresh() {
    const button = byId("refresh-button");
    const banner = byId("error-banner");
    button.disabled = true;
    banner.hidden = true;
    try {
      const stationPath = `/api/v1/stations/${encodeURIComponent(config.stationId)}`;
      const [latestBody, coverageBody] = await Promise.all([
        getJson(`${stationPath}/latest?ts=${Date.now()}`),
        getJson(`${stationPath}/coverage?ts=${Date.now()}`),
      ]);
      updateLatest(latestBody.reading);
      coverage = coverageBody;
      updateCoverageControls();
      await loadHistory();
      byId("api-state").textContent = "API connected";
    } catch (error) {
      setState({ key: "error", label: "Data unavailable" });
      banner.textContent = `Could not load station data: ${error.message}`;
      banner.hidden = false;
      byId("api-state").textContent = "API unavailable";
    } finally {
      button.disabled = false;
    }
  }

  function shiftSelectedDay(days) {
    const date = new Date(`${selectedDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    selectedDate = dateInputValue(date);
    refreshHistory();
  }

  document.querySelectorAll(".metric-tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeMetric = button.dataset.metric;
      document.querySelectorAll(".metric-tab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      drawChart();
    });
  });
  document.querySelectorAll(".range-tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeRange = button.dataset.range;
      refreshHistory();
    });
  });
  byId("history-date").addEventListener("change", (event) => {
    if (!event.target.value) return;
    selectedDate = event.target.value;
    activeRange = "1D";
    refreshHistory();
  });
  byId("previous-day").addEventListener("click", () => shiftSelectedDay(-1));
  byId("next-day").addEventListener("click", () => shiftSelectedDay(1));
  byId("refresh-button").addEventListener("click", refresh);
  byId("history-chart").addEventListener("pointermove", showTooltip);
  byId("history-chart").addEventListener("pointerleave", () => {
    byId("chart-tooltip").hidden = true;
  });
  window.addEventListener("resize", () => window.requestAnimationFrame(drawChart));

  updateHistoryControls();
  refresh();
  window.setInterval(refresh, config.refreshIntervalMs);
})();
