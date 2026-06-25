const state = {
  data: null,
  scale: "log",
  hidden: new Set(),
  pointer: null,
};

const els = {
  chart: document.querySelector("#chart"),
  tooltip: document.querySelector("#tooltip"),
  status: document.querySelector("#status"),
  legend: document.querySelector("#legend"),
  cards: document.querySelector("#cards"),
  controls: document.querySelector(".controls"),
};

const ctx = els.chart.getContext("2d");

function fmtMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtMultiple(value) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}x`;
}

function fmtPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function visibleCycles() {
  return state.data.cycles.filter((cycle) => !state.hidden.has(cycle.id));
}

function maxFullDays() {
  return Math.max(...visibleCycles().map((cycle) => cycle.summary.lastDays));
}

function chartBounds() {
  const pad = { left: 72, right: 26, top: 28, bottom: 54 };
  const w = els.chart.clientWidth;
  const h = els.chart.clientHeight;
  return {
    ...pad,
    width: w,
    height: h,
    plotW: Math.max(100, w - pad.left - pad.right),
    plotH: Math.max(100, h - pad.top - pad.bottom),
  };
}

function valueTransform(value) {
  return state.scale === "log" ? Math.log10(Math.max(value, 0.05)) : value;
}

function valueInverse(value) {
  return state.scale === "log" ? 10 ** value : value;
}

function domain() {
  const cycles = visibleCycles();
  const xMax = maxFullDays();
  const values = [];
  for (const cycle of cycles) {
    for (const point of cycle.points) {
      if (point.days <= xMax) values.push(displayValue(point, cycle));
    }
  }
  const maxV = Math.max(2, ...values);
  const minV = Math.min(1, ...values);
  const yMin = state.scale === "relative" ? 0 : state.scale === "log" ? Math.max(0.3, minV * 0.85) : 0;
  const yMax = state.scale === "relative" ? 1.1 : maxV * 1.12;
  return {
    xMin: 0,
    xMax,
    yMin: valueTransform(yMin),
    yMax: valueTransform(yMax),
  };
}

function displayValue(point, cycle) {
  if (state.scale !== "relative") return point.normalized;
  return point.normalized / Math.max(0.0001, cycle.summary.peakNormalized || 1);
}

function project(point, bounds, d, cycle = null) {
  const yValue = cycle ? displayValue(point, cycle) : point.normalized;
  const x = bounds.left + ((point.days - d.xMin) / (d.xMax - d.xMin)) * bounds.plotW;
  const y =
    bounds.top +
    (1 - (valueTransform(yValue) - d.yMin) / (d.yMax - d.yMin)) *
      bounds.plotH;
  return { x, y };
}

function pointFromSummary(summary, kind) {
  if (kind === "peak") {
    return {
      days: summary.peakDays,
      normalized: summary.peakNormalized,
      date: summary.peakDate,
      price: summary.peakPrice,
    };
  }
  return {
    days: summary.troughDays,
    normalized: summary.troughNormalized,
    date: summary.troughDate,
    price: summary.troughPrice,
  };
}

function markerLabel(kind, point, cycle) {
  if (state.scale !== "relative") {
    return `${kind} ${fmtMultiple(point.normalized)}${kind === "低" && cycle.summary.troughStatus ? ` ${cycle.summary.troughStatus}` : ""}`;
  }
  const pct = Math.round(displayValue(point, cycle) * 100);
  const status = kind === "低" && cycle.summary.troughStatus ? ` ${cycle.summary.troughStatus}` : "";
  return `${kind} ${pct}% (${fmtMultiple(point.normalized)})${status}`;
}

function labelOffset(cycle, kind) {
  const index = state.data.cycles.findIndex((item) => item.id === cycle.id);
  if (state.scale !== "relative") return kind === "peak" ? -22 : 22;
  if (kind === "peak") return [-44, -22, 0][Math.max(0, index)] ?? -22;
  return [36, 18, 54][Math.max(0, index)] ?? 30;
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = els.chart.clientWidth;
  const height = els.chart.clientHeight;
  els.chart.width = Math.floor(width * ratio);
  els.chart.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawBackground(bounds, d) {
  ctx.clearRect(0, 0, bounds.width, bounds.height);
  ctx.fillStyle = "#101720";
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  const phases = state.data.phaseModel?.phases || [];
  for (const phase of phases) {
    if (phase.endDay < d.xMin || phase.startDay > d.xMax) continue;
    const start = Math.max(phase.startDay, d.xMin);
    const end = Math.min(phase.endDay, d.xMax);
    const x1 = bounds.left + ((start - d.xMin) / (d.xMax - d.xMin)) * bounds.plotW;
    const x2 = bounds.left + ((end - d.xMin) / (d.xMax - d.xMin)) * bounds.plotW;
    ctx.fillStyle = phase.color;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(x1, bounds.top, Math.max(1, x2 - x1), bounds.plotH);
    ctx.globalAlpha = 1;
    if (x2 - x1 > 70) {
      ctx.fillStyle = "rgba(238, 244, 248, 0.62)";
      ctx.font = "12px Inter, system-ui, sans-serif";
      ctx.fillText(phase.label, x1 + 10, bounds.top + bounds.plotH - 12);
    }
  }
}

function drawGrid(bounds, d) {
  ctx.strokeStyle = "#283341";
  ctx.lineWidth = 1;
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#9aa8b6";

  const tickStep = d.xMax <= 950 ? 180 : 365;
  const xTicks = [];
  for (let day = 0; day <= d.xMax + 1; day += tickStep) xTicks.push(day);
  for (const day of xTicks.filter((day) => day <= d.xMax)) {
    const x = bounds.left + ((day - d.xMin) / (d.xMax - d.xMin)) * bounds.plotW;
    ctx.beginPath();
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, bounds.top + bounds.plotH);
    ctx.stroke();
    ctx.fillText(`${day}天`, x - 16, bounds.top + bounds.plotH + 28);
  }

  const yTicks =
    state.scale === "relative"
      ? [0.1, 0.2, 0.3, 0.5, 0.8, 1]
      : state.scale === "log"
      ? [0.5, 1, 2, 3, 5, 10, 20, 30]
      : [0, 1, 2, 3, 4, 5, 8, 12, 16, 20];
  for (const value of yTicks) {
    const tv = valueTransform(value);
    if (tv < d.yMin || tv > d.yMax) continue;
    const y = bounds.top + (1 - (tv - d.yMin) / (d.yMax - d.yMin)) * bounds.plotH;
    ctx.beginPath();
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.left + bounds.plotW, y);
    ctx.stroke();
    ctx.fillText(state.scale === "relative" ? `${Math.round(value * 100)}%` : value === 0 ? "0" : `${value}x`, 18, y + 4);
  }

  ctx.strokeStyle = "#5b6775";
  ctx.beginPath();
  ctx.moveTo(bounds.left, bounds.top);
  ctx.lineTo(bounds.left, bounds.top + bounds.plotH);
  ctx.lineTo(bounds.left + bounds.plotW, bounds.top + bounds.plotH);
  ctx.stroke();
}

function drawStar(x, y, outer, inner, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#101720";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawDiamond(x, y, radius, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#101720";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawLabel(text, x, y, color, align = "left") {
  ctx.font = "12px Inter, system-ui, sans-serif";
  const width = ctx.measureText(text).width + 12;
  const height = 22;
  const left = align === "right" ? x - width - 10 : x + 10;
  const top = Math.max(8, y - height / 2);
  ctx.fillStyle = "rgba(9, 13, 18, 0.86)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eef4f8";
  ctx.fillText(text, left + 6, top + 15);
}

function drawCycleMarkers(cycle, bounds, d) {
  const peak = pointFromSummary(cycle.summary, "peak");
  const trough = pointFromSummary(cycle.summary, "trough");
  if (peak.days >= d.xMin && peak.days <= d.xMax && peak.normalized) {
    const pos = project(peak, bounds, d, cycle);
    drawStar(pos.x, pos.y, cycle.id === "cycle_2024" ? 11 : 9, 4, cycle.color);
    drawLabel(markerLabel("峰", peak, cycle), pos.x, pos.y + labelOffset(cycle, "peak"), cycle.color, pos.x > bounds.width - 180 ? "right" : "left");
  }
  if (trough.days >= d.xMin && trough.days <= d.xMax && trough.normalized) {
    const pos = project(trough, bounds, d, cycle);
    drawDiamond(pos.x, pos.y, cycle.id === "cycle_2024" ? 9 : 8, "#f43f5e");
    drawLabel(markerLabel("低", trough, cycle), pos.x, pos.y + labelOffset(cycle, "trough"), "#f43f5e", pos.x > bounds.width - 180 ? "right" : "left");
  }
}

function drawLine(cycle, bounds, d) {
  const points = cycle.points.filter((point) => point.days >= d.xMin && point.days <= d.xMax);
  if (points.length < 2) return;

  ctx.strokeStyle = cycle.color;
  ctx.lineWidth = cycle.id === "cycle_2024" ? 3 : 2;
  ctx.globalAlpha = cycle.id === "cycle_2024" ? 1 : 0.82;
  ctx.beginPath();
  points.forEach((point, idx) => {
    const pos = project(point, bounds, d, cycle);
    if (idx === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;

  const last = points[points.length - 1];
  const lastPos = project(last, bounds, d, cycle);
  ctx.fillStyle = cycle.color;
  ctx.beginPath();
  ctx.arc(lastPos.x, lastPos.y, cycle.id === "cycle_2024" ? 5 : 4, 0, Math.PI * 2);
  ctx.fill();

}

function nearestPoint(mouseX, bounds, d) {
  const day = Math.round(d.xMin + ((mouseX - bounds.left) / bounds.plotW) * (d.xMax - d.xMin));
  const rows = [];
  for (const cycle of visibleCycles()) {
    const candidates = cycle.points.filter((point) => point.days <= d.xMax);
    if (!candidates.length) continue;
    let best = candidates[0];
    for (const point of candidates) {
      if (Math.abs(point.days - day) < Math.abs(best.days - day)) best = point;
    }
    rows.push({ cycle, point: best });
  }
  return { day, rows };
}

function drawPointer(bounds, d) {
  if (!state.pointer) return;
  const { x, y } = state.pointer;
  if (x < bounds.left || x > bounds.left + bounds.plotW || y < bounds.top || y > bounds.top + bounds.plotH) {
    els.tooltip.hidden = true;
    return;
  }

  const info = nearestPoint(x, bounds, d);
  const px = bounds.left + ((info.day - d.xMin) / (d.xMax - d.xMin)) * bounds.plotW;
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "rgba(238, 244, 248, 0.45)";
  ctx.beginPath();
  ctx.moveTo(px, bounds.top);
  ctx.lineTo(px, bounds.top + bounds.plotH);
  ctx.moveTo(bounds.left, y);
  ctx.lineTo(bounds.left + bounds.plotW, y);
  ctx.stroke();
  ctx.setLineDash([]);

  const lines = info.rows
    .map(
      ({ cycle, point }) =>
        `<div><span style="color:${cycle.color}">●</span> ${cycle.name}: ${
          state.scale === "relative"
            ? `${Math.round(displayValue(point, cycle) * 100)}% (${fmtMultiple(point.normalized)})`
            : fmtMultiple(point.normalized)
        } · ${fmtMoney(point.price)} · ${point.date}</div>`
    )
    .join("");
  els.tooltip.innerHTML = `<strong>减半后第 ${info.day} 天</strong>${lines}`;
  els.tooltip.hidden = false;
  const left = Math.min(x + 14, bounds.width - 280);
  const top = y > bounds.height - 160 ? y - 130 : y + 14;
  els.tooltip.style.left = `${Math.max(8, left)}px`;
  els.tooltip.style.top = `${Math.max(8, top)}px`;
}

function draw() {
  if (!state.data) return;
  resizeCanvas();
  const bounds = chartBounds();
  const d = domain();
  drawBackground(bounds, d);
  drawGrid(bounds, d);
  for (const cycle of visibleCycles()) drawLine(cycle, bounds, d);
  for (const cycle of visibleCycles()) drawCycleMarkers(cycle, bounds, d);
  drawPointer(bounds, d);
}

function renderLegend() {
  els.legend.innerHTML = "";
  for (const cycle of state.data.cycles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.hidden.has(cycle.id) ? "off" : "";
    button.innerHTML = `<span class="swatch" style="background:${cycle.color}"></span>${cycle.name}`;
    button.addEventListener("click", () => {
      if (state.hidden.has(cycle.id)) state.hidden.delete(cycle.id);
      else state.hidden.add(cycle.id);
      renderLegend();
      draw();
    });
    els.legend.appendChild(button);
  }
}

function renderCards() {
  els.cards.innerHTML = "";
  for (const cycle of state.data.cycles) {
    const card = document.createElement("article");
    card.className = "card";
    const s = cycle.summary;
    card.innerHTML = `
      <h3><span class="swatch" style="background:${cycle.color}"></span>${cycle.name}</h3>
      <div class="metric"><span>减半日价格</span><b>${fmtMoney(cycle.basePrice)}</b></div>
      <div class="metric"><span>最新/结束日期</span><b>${s.lastDate}</b></div>
      <div class="metric"><span>已走天数</span><b>${s.lastDays} 天</b></div>
      <div class="metric"><span>当前倍数</span><b>${fmtMultiple(s.lastNormalized)}</b></div>
      <div class="metric"><span>周期峰值</span><b>${fmtMultiple(s.peakNormalized)} · 第 ${s.peakDays} 天</b></div>
      <div class="metric"><span>峰后低点</span><b>${fmtMultiple(s.troughNormalized)} · 第 ${s.troughDays} 天${s.troughStatus ? ` · ${s.troughStatus}` : ""}</b></div>
      ${s.daysSinceTrough !== undefined ? `<div class="metric"><span>低点确认</span><b>距今 ${s.daysSinceTrough} 天 / 阈值 ${s.lowConfirmDays} 天</b></div>` : ""}
      <div class="metric"><span>最大回撤</span><b>${fmtPct(s.maxDrawdown)}</b></div>
    `;
    els.cards.appendChild(card);
  }
}

function bindEvents() {
  els.controls.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.scale) state.scale = button.dataset.scale;
    document.querySelectorAll("[data-scale]").forEach((item) => {
      item.classList.toggle("active", item.dataset.scale === state.scale);
    });
    draw();
  });

  els.chart.addEventListener("mousemove", (event) => {
    const rect = els.chart.getBoundingClientRect();
    state.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    draw();
  });
  els.chart.addEventListener("mouseleave", () => {
    state.pointer = null;
    els.tooltip.hidden = true;
    draw();
  });
  window.addEventListener("resize", draw);
}

const CURRENT_CYCLE = {
  id: "cycle_2024",
  name: "2024 cycle",
  halving: "2024-04-20",
  color: "#f97316",
};

const LOW_CONFIRM_DAYS = 140;

function dateToMs(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function dayText(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((dateToMs(b) - dateToMs(a)) / 86400000);
}

function normalizeRows(rows) {
  const byDate = new Map();
  for (const row of rows) {
    if (!Number.isFinite(row.close) || row.close <= 0) continue;
    byDate.set(row.date, row);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchWithTimeout(url, signal, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const relayAbort = () => controller.abort();
  signal?.addEventListener("abort", relayAbort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}

async function fetchBinanceCurrent(signal) {
  const params = new URLSearchParams({
    symbol: "BTCUSDT",
    interval: "1d",
    startTime: String(dateToMs(CURRENT_CYCLE.halving)),
    limit: "1000",
  });
  const rows = await fetchWithTimeout(`https://api.binance.com/api/v3/klines?${params}`, signal);
  return normalizeRows(
    rows.map((row) => ({
      date: dayText(Number(row[0])),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
  );
}

async function fetchCryptoCompareCurrent(signal) {
  const rows = await fetchWithTimeout(
    "https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USDT&limit=1000&aggregate=1",
    signal
  );
  const data = rows?.Data?.Data;
  if (!Array.isArray(data)) throw new Error("invalid payload");
  return normalizeRows(
    data
      .map((row) => ({
        date: dayText(row.time * 1000),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volumeto ?? row.volumefrom ?? 0,
      }))
      .filter((row) => row.date >= CURRENT_CYCLE.halving)
  );
}

async function fetchOkxCurrent(signal) {
  const rows = await fetchWithTimeout(
    "https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1Dutc&limit=300",
    signal
  );
  const data = rows?.data;
  if (!Array.isArray(data)) throw new Error("invalid payload");
  return normalizeRows(
    data
      .map((row) => ({
        date: dayText(Number(row[0])),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[7] ?? row[6] ?? row[5] ?? 0),
      }))
      .filter((row) => row.date >= CURRENT_CYCLE.halving)
  );
}

function validateCurrentRows(rows) {
  if (rows.length < 300) throw new Error(`too few rows: ${rows.length}`);
  if (rows[0].date > CURRENT_CYCLE.halving) throw new Error(`starts too late: ${rows[0].date}`);
  return rows;
}

function readCachedCurrent() {
  try {
    const raw = window.localStorage.getItem("btc-cycle-map-current-v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.rows) || !parsed.provider) return null;
    return { rows: validateCurrentRows(parsed.rows), provider: parsed.provider, cached: true };
  } catch {
    return null;
  }
}

function writeCachedCurrent(provider, rows) {
  try {
    window.localStorage.setItem(
      "btc-cycle-map-current-v1",
      JSON.stringify({ savedAt: Date.now(), provider, rows })
    );
  } catch {
    // Best effort only.
  }
}

async function fetchCurrentRows() {
  const cached = readCachedCurrent();
  const providers = [
    { name: "Binance", load: fetchBinanceCurrent },
    { name: "CryptoCompare", load: fetchCryptoCompareCurrent },
    { name: "OKX", load: fetchOkxCurrent },
  ];
  const errors = [];
  for (const provider of providers) {
    const controller = new AbortController();
    try {
      els.status.textContent = `加载 ${provider.name} 本周期行情...`;
      const rows = validateCurrentRows(await provider.load(controller.signal));
      writeCachedCurrent(provider.name, rows);
      return { rows, provider: provider.name, errors, cached: false };
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      controller.abort();
    }
  }
  if (cached) return { ...cached, errors };
  throw new Error(errors.join("；") || "所有动态行情源不可用");
}

function buildCurrentCycle(rows) {
  const baseRow = rows.find((row) => row.date === CURRENT_CYCLE.halving) || rows[0];
  const base = baseRow.close;
  const points = rows.map((row) => {
    const normalized = row.close / base;
    return {
      date: row.date,
      days: daysBetween(CURRENT_CYCLE.halving, row.date),
      price: row.close,
      normalized,
      drawdown: 0,
    };
  });
  let runningHigh = 0;
  let peak = { normalized: 0, date: "", days: 0, price: 0 };
  let trough = { normalized: Infinity, date: "", days: 0, price: 0 };
  let maxDrawdown = 0;
  for (const point of points) {
    runningHigh = Math.max(runningHigh, point.normalized);
    point.drawdown = point.normalized / runningHigh - 1;
    maxDrawdown = Math.min(maxDrawdown, point.drawdown);
    if (point.normalized > peak.normalized) peak = { ...point };
  }
  for (const point of points) {
    if (point.days >= peak.days && point.normalized < trough.normalized) trough = { ...point };
  }
  const last = points[points.length - 1];
  const daysSinceLow = last.days - trough.days;
  return {
    ...CURRENT_CYCLE,
    baseDate: baseRow.date,
    basePrice: base,
    points,
    summary: {
      lastDate: last.date,
      lastDays: last.days,
      lastPrice: last.price,
      lastNormalized: last.normalized,
      peakDate: peak.date,
      peakDays: peak.days,
      peakPrice: peak.price,
      peakNormalized: peak.normalized,
      troughDate: trough.date,
      troughDays: trough.days,
      troughPrice: trough.price,
      troughNormalized: trough.normalized,
      troughStatus: daysSinceLow >= LOW_CONFIRM_DAYS ? "已形成" : "正在形成",
      daysSinceTrough: daysSinceLow,
      lowConfirmDays: LOW_CONFIRM_DAYS,
      maxDrawdown,
    },
  };
}

function median(values, fallback = 0) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return fallback;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function firstDayAtMultiple(cycle, multiple) {
  return cycle.points.find((point) => point.normalized >= multiple)?.days ?? null;
}

function buildPhaseModel(cycles) {
  const historical = cycles.filter((cycle) => cycle.id !== "cycle_2024");
  const first2x = median(historical.map((cycle) => firstDayAtMultiple(cycle, 2)), 180);
  const peakDay = median(historical.map((cycle) => cycle.summary.peakDays), 540);
  const troughDay = median(historical.map((cycle) => cycle.summary.troughDays), 900);
  const fullDay = Math.max(...historical.map((cycle) => cycle.summary.lastDays), 1450);
  const earlyEnd = Math.max(90, Math.min(first2x, peakDay - 180));
  const peakStart = Math.max(earlyEnd + 90, peakDay - 90);
  const peakEnd = Math.min(troughDay - 120, peakDay + 110);
  const troughEnd = Math.min(fullDay - 120, troughDay + 60);
  const phases = [
    ["post_halving", "减半后消化", 0, earlyEnd, "#164e63"],
    ["trend_expansion", "趋势扩张", earlyEnd, peakStart, "#14532d"],
    ["top_window", "历史顶部窗口", peakStart, peakEnd, "#7c2d12"],
    ["bear_drawdown", "熊市回撤", peakEnd, troughEnd, "#7f1d1d"],
    ["recovery", "修复/下一轮预热", troughEnd, fullDay, "#312e81"],
  ]
    .filter(([, , start, end]) => end > start)
    .map(([id, label, startDay, endDay, color]) => ({
      id,
      label,
      startDay: Math.round(startDay),
      endDay: Math.round(endDay),
      color,
    }));
  const current = cycles.find((cycle) => cycle.id === "cycle_2024");
  const currentDay = current?.summary.lastDays ?? 0;
  return {
    phases,
    currentPhase:
      phases.find((phase) => phase.startDay <= currentDay && currentDay <= phase.endDay) ??
      phases[phases.length - 1],
  };
}

async function init() {
  bindEvents();
  const response = await fetch("./data/historical_cycles.json");
  if (!response.ok) throw new Error(await response.text());
  const historical = await response.json();
  const current = await fetchCurrentRows();
  const cycles = [...historical.cycles, buildCurrentCycle(current.rows)];
  state.data = {
    symbol: "BTC-USD",
    source: `Historical static (${historical.source || "static"}) + current ${current.provider}${current.cached ? " cache" : ""}`,
    updatedAt: new Date().toISOString(),
    cycles,
    providerErrors: current.errors,
    phaseModel: buildPhaseModel(cycles),
  };
  const currentPhase = state.data.phaseModel?.currentPhase?.label;
  els.status.textContent = `${state.data.symbol} · ${state.data.source} · ${new Date(
    state.data.updatedAt
  ).toLocaleString()}${currentPhase ? ` · 当前阶段：${currentPhase}` : ""}`;
  renderLegend();
  renderCards();
  draw();
}

init().catch((error) => {
  els.status.textContent = `加载失败：${error.message}`;
  console.error(error);
});
