(() => {
  "use strict";

  const config = window.WEATHER_CONFIG;
  const celsiusToFahrenheit = (value) =>
    Number.isFinite(value) ? (value * 9) / 5 + 32 : value;
  const metricMeta = {
    temperature_c: {
      label: "Temperature",
      unit: "°F",
      color: "#d9823b",
      displayValue: celsiusToFahrenheit,
    },
    relative_humidity_percent: { label: "Humidity", unit: "%", color: "#4d86a2" },
    pressure_hpa: { label: "Pressure", unit: "hPa", color: "#668355" },
    wind_speed_m_s: { label: "Wind", unit: "m/s", color: "#75659b" },
  };
  let history = [];
  let activeMetric = "temperature_c";

  const byId = (id) => document.getElementById(id);
  const number = (value, digits = 1) =>
    Number.isFinite(value) ? Number(value).toFixed(digits) : "--";

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

  function rangeText(summary, unit, prefix = "Range", displayValue = (value) => value) {
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
    const state = stationState(reading);
    setState(state);
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

  function chartValues() {
    const displayValue = metricMeta[activeMetric].displayValue || ((value) => value);
    return history
      .map((reading) => ({
        time: Date.parse(reading.bucket_end_utc),
        value: displayValue(reading[activeMetric]?.mean),
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
  }

  function drawChart() {
    const canvas = byId("history-chart");
    const empty = byId("chart-empty");
    const points = chartValues();
    const meta = metricMeta[activeMetric];
    byId("chart-unit").textContent = `${meta.label} · ${meta.unit}`;
    if (points.length < 2) {
      empty.hidden = false;
      canvas.hidden = true;
      byId("chart-min").textContent = "Low --";
      byId("chart-max").textContent = "High --";
      return;
    }

    empty.hidden = true;
    canvas.hidden = false;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);

    const values = points.map((point) => point.value);
    let low = Math.min(...values);
    let high = Math.max(...values);
    const padding = Math.max((high - low) * 0.15, activeMetric === "pressure_hpa" ? 0.5 : 0.2);
    low -= padding;
    high += padding;
    const margin = { left: 8, right: 8, top: 14, bottom: 24 };
    const width = rect.width - margin.left - margin.right;
    const height = rect.height - margin.top - margin.bottom;
    const start = points[0].time;
    const end = points[points.length - 1].time;
    const x = (time) => margin.left + ((time - start) / Math.max(1, end - start)) * width;
    const y = (value) => margin.top + (1 - (value - low) / Math.max(0.0001, high - low)) * height;

    context.strokeStyle = "rgba(21,37,31,.09)";
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
      const lineY = margin.top + (height / 4) * index;
      context.beginPath();
      context.moveTo(margin.left, lineY);
      context.lineTo(rect.width - margin.right, lineY);
      context.stroke();
    }

    const gradient = context.createLinearGradient(0, margin.top, 0, rect.height);
    gradient.addColorStop(0, `${meta.color}44`);
    gradient.addColorStop(1, `${meta.color}00`);
    context.beginPath();
    points.forEach((point, index) => {
      const px = x(point.time);
      const py = y(point.value);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.lineTo(x(points[points.length - 1].time), margin.top + height);
    context.lineTo(x(points[0].time), margin.top + height);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(x(point.time), y(point.value));
      else context.lineTo(x(point.time), y(point.value));
    });
    context.strokeStyle = meta.color;
    context.lineWidth = 2.2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();

    context.fillStyle = "#718078";
    context.font = "10px DM Mono, monospace";
    context.textAlign = "left";
    context.fillText(formatTime(points[0].time, { month: undefined, day: undefined }), margin.left, rect.height - 5);
    context.textAlign = "right";
    context.fillText(formatTime(points[points.length - 1].time, { month: undefined, day: undefined }), rect.width - margin.right, rect.height - 5);

    byId("chart-min").textContent = `Low ${number(Math.min(...values))} ${meta.unit}`;
    byId("chart-max").textContent = `High ${number(Math.max(...values))} ${meta.unit}`;
  }

  async function refresh() {
    const button = byId("refresh-button");
    const banner = byId("error-banner");
    button.disabled = true;
    banner.hidden = true;
    try {
      const stationPath = `/api/v1/stations/${encodeURIComponent(config.stationId)}`;
      const [latestBody, historyBody] = await Promise.all([
        getJson(`${stationPath}/latest?ts=${Date.now()}`),
        getJson(`${stationPath}/history?hours=24&limit=400&ts=${Date.now()}`),
      ]);
      updateLatest(latestBody.reading);
      history = historyBody.readings || [];
      drawChart();
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

  document.querySelectorAll(".metric-tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeMetric = button.dataset.metric;
      document.querySelectorAll(".metric-tab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      drawChart();
    });
  });
  byId("refresh-button").addEventListener("click", refresh);
  window.addEventListener("resize", () => window.requestAnimationFrame(drawChart));
  refresh();
  window.setInterval(refresh, config.refreshIntervalMs);
})();
