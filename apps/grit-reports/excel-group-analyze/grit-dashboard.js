/* grit-reports — excel-group-analyze/grit-dashboard.js
 *
 * Client for the two aggregator endpoints (api/aggregate-margins.js,
 * api/aggregate-labor.js). Plain vanilla JS, no build step, no dependency
 * beyond the already-bundled chart.umd.js — same convention as app.js.
 */
(function () {
  "use strict";

  const jwtInput = document.getElementById("jwtInput");
  const fromInput = document.getElementById("fromInput");
  const toInput = document.getElementById("toInput");
  const loadBtn = document.getElementById("loadBtn");
  const statusEl = document.getElementById("status");
  const upstreamChipsEl = document.getElementById("upstreamChips");
  const degradedBannerEl = document.getElementById("degradedBanner");
  const lockedPanel = document.getElementById("lockedPanel");
  const lockedMessage = document.getElementById("lockedMessage");
  const resultArea = document.getElementById("resultArea");
  const kpiBar = document.getElementById("kpiBar");
  const downloadCsvBtn = document.getElementById("downloadCsvBtn");

  let lastPayload = null; // { margins, labor } for CSV export
  let chart = null;

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function defaultRange() {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: isoDate(from), to: isoDate(to) };
  }

  function setStatus(message, kind) {
    statusEl.textContent = message || "";
    statusEl.className = kind || "";
  }

  // Resolves the effective per-source marker exactly the way the chips
  // always have (the margins body wins for the shared POS source, the labor
  // body carries taskboard) — the chips, degraded banner, KPI flags and
  // chart hatching all read from this one list so they can't disagree.
  function upstreamMarkers(marginsBody, laborBody) {
    const mu = marginsBody && marginsBody.upstream ? marginsBody.upstream : {};
    const lu = laborBody && laborBody.upstream ? laborBody.upstream : {};
    return [
      { label: "grit-pos", marker: mu.pos || lu.pos || "unconfigured" },
      { label: "grit-inventory", marker: mu.inventory || "unconfigured" },
      { label: "grit-taskboard", marker: lu.taskboard || "unconfigured" },
    ];
  }

  function markerWord(marker) {
    if (marker === "ok") return "connected";
    if (marker === "unconfigured") return "not connected (no URL configured)";
    if (marker === "missing") return "not connected (endpoint unavailable)";
    return "error";
  }

  function setChip(container, label, marker) {
    const chip = document.createElement("span");
    chip.className = "chip " + (marker || "unconfigured");
    const dot = document.createElement("span");
    dot.className = "dot";
    chip.appendChild(dot);
    const text = document.createElement("span");
    text.textContent = `${label}: ${markerWord(marker)}`;
    chip.appendChild(text);
    container.appendChild(chip);
  }

  function renderUpstreamChips(markers) {
    upstreamChipsEl.innerHTML = "";
    for (const m of markers) setChip(upstreamChipsEl, m.label, m.marker);
  }

  /* Degraded-upstream banner (issue #45): when any source didn't answer, say
   * so loudly next to the numbers — a zero there means "no data", not "a
   * quiet day". Names each affected source and when the snapshot was fetched
   * (client-side time of the completed fetch; the API doesn't send one). */
  function renderDegradedBanner(markers, fetchedAt) {
    const degraded = markers.filter((m) => m.marker !== "ok");
    if (degraded.length === 0) {
      degradedBannerEl.style.display = "none";
      degradedBannerEl.textContent = "";
      return;
    }
    degradedBannerEl.textContent =
      "\u26a0 Degraded data \u2014 " +
      degraded.map((m) => `${m.label}: ${markerWord(m.marker)}`).join("; ") +
      ". Figures from these sources read as zeros or gaps because the data was" +
      " unavailable when fetched \u2014 they are not real zeros." +
      ` Fetched at ${fetchedAt.toISOString()}.`;
    degradedBannerEl.style.display = "block";
  }

  function kpiTile(value, label, degraded) {
    const tile = document.createElement("div");
    tile.className = "kpiTile" + (degraded ? " degraded" : "");
    const v = document.createElement("div");
    v.className = "kpiValue";
    v.textContent = value;
    const l = document.createElement("div");
    l.className = "kpiLabel";
    l.textContent = label + (degraded ? " \u26a0" : "");
    tile.appendChild(v);
    tile.appendChild(l);
    if (degraded) {
      tile.title =
        "Upstream source unavailable \u2014 this figure may be a placeholder zero, not real data.";
    }
    return tile;
  }

  function fmtMoney(n) {
    if (n === null || n === undefined) return "—";
    return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtNum(n, suffix) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) + (suffix || "");
  }

  function renderKpis(marginsBody, laborBody, markers) {
    // Flag every tile whose figure depends on a source that didn't answer,
    // including both sides of the labor aggregator (issue #45 parity).
    const markerByLabel = {};
    for (const m of markers) markerByLabel[m.label] = m.marker;
    const posOk = markerByLabel["grit-pos"] === "ok";
    const invOk = markerByLabel["grit-inventory"] === "ok";
    const taskboardOk = markerByLabel["grit-taskboard"] === "ok";
    kpiBar.innerHTML = "";
    kpiBar.appendChild(kpiTile(fmtMoney(marginsBody.revenue.total), "POS revenue", !posOk));
    kpiBar.appendChild(kpiTile(fmtMoney(marginsBody.cogs.total), "Inventory COGS", !invOk));
    kpiBar.appendChild(
      kpiTile(fmtMoney(marginsBody.margin.total), "Gross margin", !posOk || !invOk),
    );
    kpiBar.appendChild(kpiTile(fmtNum(marginsBody.margin.pct, "%"), "Margin %", !posOk || !invOk));
    kpiBar.appendChild(kpiTile(fmtNum(laborBody.transactions.count), "Transactions", !posOk));
    kpiBar.appendChild(
      kpiTile(fmtNum(laborBody.tasks.avg_completion_hours, " hrs"), "Avg task completion", !taskboardOk),
    );
    kpiBar.appendChild(
      kpiTile(
        fmtNum(laborBody.efficiency.transactions_per_completed_task),
        "Txns / completed task",
        !posOk || !taskboardOk,
      ),
    );
  }

  /* Diagonal-stripe fill so a degraded series reads as "unverified data",
   * not a solid bar of real zeros (issue #45). Pure canvas pattern — no new
   * dependency; falls back to the flat color if patterns aren't available. */
  function hatchPattern(color) {
    const tile = document.createElement("canvas");
    tile.width = 8;
    tile.height = 8;
    const ctx = tile.getContext("2d");
    if (!ctx || typeof ctx.createPattern !== "function") return color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, 2);
    ctx.lineTo(2, -2);
    ctx.moveTo(0, 8);
    ctx.lineTo(8, 0);
    ctx.moveTo(6, 10);
    ctx.lineTo(10, 6);
    ctx.stroke();
    return ctx.createPattern(tile, "repeat") || color;
  }

  function renderChart(marginsBody, markers) {
    const canvas = document.getElementById("dashCanvas");
    if (chart) {
      chart.destroy();
      chart = null;
    }
    const daily = Array.isArray(marginsBody.daily) ? marginsBody.daily : [];
    if (typeof Chart === "undefined" || daily.length === 0) return;
    // Revenue/COGS as grouped bars, margin as an overlaid trend line — the
    // /api/aggregate-margins `daily[].cogs`/`margin` series is only
    // non-null when the grit-inventory upstream call succeeded (see
    // aggregate-margins.js), so those two datasets are omitted rather than
    // drawn as a flat zero line when it didn't. When a source answered but
    // is flagged non-ok anyway (defensive), its series still draws but with
    // a hatched fill / dashed line + "(source unavailable)" label so it
    // can't be mistaken for real data.
    const markerByLabel = {};
    for (const m of markers) markerByLabel[m.label] = m.marker;
    const posDegraded = markerByLabel["grit-pos"] !== "ok";
    const inventoryDegraded = markerByLabel["grit-inventory"] !== "ok";
    const hasCogs = daily.some((d) => d.cogs !== null && d.cogs !== undefined);
    const hasMargin = daily.some((d) => d.margin !== null && d.margin !== undefined);
    const datasets = [
      {
        type: "bar",
        label: posDegraded ? "Revenue (source unavailable)" : "Revenue",
        data: daily.map((d) => d.revenue),
        backgroundColor: posDegraded ? hatchPattern("#2d6cdf") : "#2d6cdf",
      },
    ];
    if (hasCogs) {
      datasets.push({
        type: "bar",
        label: inventoryDegraded ? "COGS (source unavailable)" : "COGS",
        data: daily.map((d) => d.cogs),
        backgroundColor: inventoryDegraded ? hatchPattern("#df4b4b") : "#df4b4b",
      });
    }
    if (hasMargin) {
      datasets.push({
        type: "line",
        label: inventoryDegraded ? "Margin (source unavailable)" : "Margin",
        data: daily.map((d) => d.margin),
        borderColor: "#2ddf8a",
        backgroundColor: "#2ddf8a",
        borderDash: inventoryDegraded ? [6, 4] : undefined,
        fill: false,
        tension: 0.25,
        yAxisID: "y",
      });
    }
    chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: daily.map((d) => d.date),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#eee" } } },
        scales: {
          x: { ticks: { color: "#aaa" }, grid: { color: "#333" } },
          y: { ticks: { color: "#aaa" }, grid: { color: "#333" } },
        },
      },
    });
  }

  function csvEscape(value) {
    const s = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv(marginsBody, laborBody) {
    const rows = [["date", "metric", "value"]];
    for (const d of marginsBody.daily || []) {
      rows.push([d.date, "revenue", d.revenue]);
    }
    rows.push(["", "revenue_total", marginsBody.revenue.total]);
    rows.push(["", "cogs_total", marginsBody.cogs.total]);
    rows.push(["", "margin_total", marginsBody.margin.total]);
    rows.push(["", "margin_pct", marginsBody.margin.pct]);
    rows.push(["", "transactions_total", laborBody.transactions.count]);
    rows.push(["", "tasks_completed", laborBody.tasks.completed_count]);
    rows.push(["", "avg_completion_hours", laborBody.tasks.avg_completion_hours]);
    rows.push(["", "transactions_per_completed_task", laborBody.efficiency.transactions_per_completed_task]);
    return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  }

  function downloadCsv() {
    if (!lastPayload) return;
    const csv = buildCsv(lastPayload.margins, lastPayload.labor);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grit-dashboard-${lastPayload.margins.from}-to-${lastPayload.margins.to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function authHeaders() {
    const headers = {};
    const token = jwtInput.value.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  async function fetchAggregate(path, from, to) {
    const url = `${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      credentials: "same-origin",
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  function showLocked(message) {
    lockedPanel.style.display = "block";
    resultArea.style.display = "none";
    if (message) lockedMessage.textContent = message;
  }

  function hideLocked() {
    lockedPanel.style.display = "none";
  }

  async function loadDashboard() {
    const from = fromInput.value || defaultRange().from;
    const to = toInput.value || defaultRange().to;
    loadBtn.disabled = true;
    setStatus("Loading…", "");
    resultArea.style.display = "none";
    lockedPanel.style.display = "none";
    upstreamChipsEl.innerHTML = "";
    degradedBannerEl.style.display = "none";

    try {
      const [marginsRes, laborRes] = await Promise.all([
        fetchAggregate("/api/aggregate-margins", from, to),
        fetchAggregate("/api/aggregate-labor", from, to),
      ]);

      if (marginsRes.status === 401 || laborRes.status === 401) {
        setStatus("", "");
        showLocked(
          "Not signed in. Paste a Grit Passport bearer token above, or sign in to a Grit " +
            "BizSuite app in this browser so the grit_passport cookie is set, then reload.",
        );
        return;
      }
      if (marginsRes.status === 403 || laborRes.status === 403) {
        setStatus("", "");
        const msg =
          (marginsRes.body && marginsRes.body.error) ||
          (laborRes.body && laborRes.body.error) ||
          "The custom_reporting addon is required for this dashboard.";
        showLocked(msg);
        return;
      }
      if (marginsRes.status !== 200 || laborRes.status !== 200) {
        setStatus(
          `Aggregator error (margins: ${marginsRes.status}, labor: ${laborRes.status}). ` +
            "See browser console / server logs for details.",
          "error",
        );
        return;
      }

      hideLocked();
      lastPayload = { margins: marginsRes.body, labor: laborRes.body };
      // Timestamp taken once both responses are in — it's when this
      // snapshot was actually fetched from the aggregators.
      const fetchedAt = new Date();
      const markers = upstreamMarkers(marginsRes.body, laborRes.body);
      renderUpstreamChips(markers);
      renderDegradedBanner(markers, fetchedAt);
      renderKpis(marginsRes.body, laborRes.body, markers);
      renderChart(marginsRes.body, markers);
      resultArea.style.display = "block";
      setStatus(`Loaded ${from} → ${to}.`, "success");
    } catch (err) {
      setStatus(
        "Could not reach the aggregator API (network error). " + (err && err.message ? err.message : ""),
        "error",
      );
    } finally {
      loadBtn.disabled = false;
    }
  }

  function init() {
    const range = defaultRange();
    fromInput.value = range.from;
    toInput.value = range.to;
    loadBtn.addEventListener("click", loadDashboard);
    downloadCsvBtn.addEventListener("click", downloadCsv);
  }

  init();
})();
