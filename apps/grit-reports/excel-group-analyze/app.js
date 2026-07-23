/* grit-reports — excel-group-analyze/app.js
 *
 * Client for the two aggregator endpoints (api/aggregate-margins.js,
 * api/aggregate-labor.js). Plain vanilla JS, no build step, no dependency
 * beyond the already-bundled chart.umd.js.
 */
(function () {
  "use strict";

  const jwtInput = document.getElementById("jwtInput");
  const fromInput = document.getElementById("fromInput");
  const toInput = document.getElementById("toInput");
  const loadBtn = document.getElementById("loadBtn");
  const statusEl = document.getElementById("status");
  const upstreamChipsEl = document.getElementById("upstreamChips");
  const lockedPanel = document.getElementById("lockedPanel");
  const lockedMessage = document.getElementById("lockedMessage");
  const resultArea = document.getElementById("resultArea");
  const kpiBar = document.getElementById("kpiBar");
  const downloadCsvBtn = document.getElementById("downloadCsvBtn");

  let lastPayload = null; // { margins, labor } for CSV export
  let chart = null;
  let pieChart = null;

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

  function setChip(container, label, marker) {
    const chip = document.createElement("span");
    chip.className = "chip " + (marker || "unconfigured");
    const dot = document.createElement("span");
    dot.className = "dot";
    chip.appendChild(dot);
    const text = document.createElement("span");
    const statusWord =
      marker === "ok"
        ? "connected"
        : marker === "unconfigured"
          ? "not connected (no URL configured)"
          : marker === "missing"
            ? "not connected (endpoint unavailable)"
            : "error";
    text.textContent = `${label}: ${statusWord}`;
    chip.appendChild(text);
    container.appendChild(chip);
  }

  function renderUpstreamChips(marginsBody, laborBody) {
    upstreamChipsEl.innerHTML = "";
    const posMarker =
      (marginsBody && marginsBody.upstream && marginsBody.upstream.pos) ||
      (laborBody && laborBody.upstream && laborBody.upstream.pos) ||
      "unconfigured";
    setChip(upstreamChipsEl, "grit-pos", posMarker);
    setChip(
      upstreamChipsEl,
      "grit-inventory",
      marginsBody && marginsBody.upstream ? marginsBody.upstream.inventory : "unconfigured",
    );
    setChip(
      upstreamChipsEl,
      "grit-taskboard",
      laborBody && laborBody.upstream ? laborBody.upstream.taskboard : "unconfigured",
    );
  }

  function kpiTile(value, label) {
    const tile = document.createElement("div");
    tile.className = "kpiTile";
    const v = document.createElement("div");
    v.className = "kpiValue";
    v.textContent = value;
    const l = document.createElement("div");
    l.className = "kpiLabel";
    l.textContent = label;
    tile.appendChild(v);
    tile.appendChild(l);
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

  function renderKpis(marginsBody, laborBody) {
    kpiBar.innerHTML = "";
    kpiBar.appendChild(kpiTile(fmtMoney(marginsBody.revenue.total), "POS revenue"));
    kpiBar.appendChild(kpiTile(fmtMoney(marginsBody.cogs.total), "Inventory COGS"));
    kpiBar.appendChild(kpiTile(fmtMoney(marginsBody.margin.total), "Gross margin"));
    kpiBar.appendChild(kpiTile(fmtNum(marginsBody.margin.pct, "%"), "Margin %"));
    kpiBar.appendChild(kpiTile(fmtNum(laborBody.transactions.count), "Transactions"));
    kpiBar.appendChild(kpiTile(fmtNum(laborBody.tasks.avg_completion_hours, " hrs"), "Avg task completion"));
    kpiBar.appendChild(
      kpiTile(fmtNum(laborBody.efficiency.transactions_per_completed_task), "Txns / completed task"),
    );
  }

  function renderChart(marginsBody) {
    const canvas = document.getElementById("dashCanvas");
    if (chart) {
      chart.destroy();
      chart = null;
    }
    const daily = Array.isArray(marginsBody.daily) ? marginsBody.daily : [];
    if (typeof Chart === "undefined" || daily.length === 0) return;
    // The /api/aggregate-margins `daily[].cogs`/`margin` series is only
    // non-null when the grit-inventory upstream call succeeded AND returned
    // per-day data (see aggregate-margins.js) — when it hasn't, this falls
    // back to a plain revenue-only bar rather than drawing a faked stack.
    const hasCogs = daily.some((d) => d.cogs !== null && d.cogs !== undefined);
    const hasMargin = daily.some((d) => d.margin !== null && d.margin !== undefined);
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const legendColor = isDark ? "#f5f1ea" : "#29201a";
    const tickColor = isDark ? "#b7a78f" : "#93816a";
    const gridColor = isDark ? "#3a3024" : "#e9e2d6";

    let datasets;
    let scales;
    if (hasCogs && hasMargin) {
      // Composition trend: COGS + margin STACK to reconstruct each day's
      // revenue bar (revenue = cogs + margin by construction), so the split
      // is readable at a glance instead of needing three separate series —
      // COGS on the bottom (the "cost floor"), margin stacked on top of it.
      // A dashed margin-% line on a secondary axis adds the trend insight a
      // stacked bar alone can't show: whether the split is *improving* day
      // over day, independent of how big the bar itself is.
      datasets = [
        {
          type: "bar",
          label: "COGS",
          data: daily.map((d) => d.cogs),
          backgroundColor: "#c94f4f",
          stack: "revenue",
          yAxisID: "y",
        },
        {
          type: "bar",
          label: "Gross margin",
          data: daily.map((d) => d.margin),
          backgroundColor: "#5c9d6e",
          stack: "revenue",
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Margin %",
          data: daily.map((d) =>
            d.margin !== null && d.margin !== undefined && d.revenue
              ? Number(((d.margin / d.revenue) * 100).toFixed(1))
              : null,
          ),
          borderColor: "#bd5f31",
          backgroundColor: "#bd5f31",
          borderDash: [5, 3],
          pointRadius: 3,
          fill: false,
          tension: 0.25,
          yAxisID: "y1",
        },
      ];
      scales = {
        x: { stacked: true, ticks: { color: tickColor }, grid: { color: gridColor } },
        y: {
          stacked: true,
          ticks: { color: tickColor },
          grid: { color: gridColor },
          title: { display: true, text: "Revenue ($)", color: tickColor },
        },
        y1: {
          position: "right",
          ticks: { color: tickColor, callback: (v) => v + "%" },
          grid: { display: false },
          title: { display: true, text: "Margin %", color: tickColor },
        },
      };
    } else {
      // No per-day COGS/margin from the upstream this range — plain revenue
      // bars rather than a stack with nothing to stack.
      datasets = [
        {
          type: "bar",
          label: "Revenue",
          data: daily.map((d) => d.revenue),
          backgroundColor: "#bd5f31",
        },
      ];
      scales = {
        x: { ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor }, grid: { color: gridColor } },
      };
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
        plugins: { legend: { labels: { color: legendColor } } },
        scales,
      },
    });
  }

  function renderPieChart(marginsBody) {
    const canvas = document.getElementById("dashPieCanvas");
    if (pieChart) {
      pieChart.destroy();
      pieChart = null;
    }
    if (typeof Chart === "undefined") return;
    // Revenue composition: gross margin vs. inventory COGS as a share of POS
    // revenue, both period totals already returned by /api/aggregate-margins
    // (marginsBody.cogs.total / marginsBody.margin.total) — a genuinely
    // meaningful breakdown since revenue = cogs + margin by construction, and
    // unlike the daily series neither field is ever null (only zeroed when
    // an upstream is unconfigured/missing).
    const cogs = Number(marginsBody.cogs.total) || 0;
    const margin = Number(marginsBody.margin.total) || 0;
    if (cogs === 0 && margin === 0) return;
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const legendColor = isDark ? "#f5f1ea" : "#29201a";
    const sliceBorder = isDark ? "#241c17" : "#fdfcfa";
    pieChart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: ["Inventory COGS", "Gross margin"],
        datasets: [
          {
            data: [cogs, margin],
            backgroundColor: ["#c94f4f", "#5c9d6e"],
            borderColor: sliceBorder,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: legendColor } } },
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
      renderUpstreamChips(marginsRes.body, laborRes.body);
      renderKpis(marginsRes.body, laborRes.body);
      renderChart(marginsRes.body);
      renderPieChart(marginsRes.body);
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

  // Suite nav — plain, ungated links to the other three Grit BizSuite apps.
  // Unlike the Next.js apps' AppSwitcher (packages/shared-ui/src/AppSwitcher.tsx),
  // this page has no client-side session: the `grit_passport` JWT is only ever
  // verified server-side inside the aggregator API (lib/passportVerify.js),
  // never decoded here, so there's no `enabled`/tier data available in the
  // browser to gate entries on the way AppSwitcher's lock treatment does.
  // Every entry links out plainly. Defaults mirror the localhost dev ports in
  // packages/passport/src/nav.ts's DEFAULT_APP_URLS; override per-deployment
  // via window.__GRIT_SUITE_URLS = { pos, inventory, taskboard } set before
  // this script runs.
  function renderSuiteNav() {
    const suiteNavList = document.getElementById("suiteNavList");
    if (!suiteNavList) return;
    const urls = Object.assign(
      {
        pos: "http://localhost:3000",
        inventory: "http://localhost:3001",
        taskboard: "http://localhost:3002",
      },
      window.__GRIT_SUITE_URLS || {},
    );
    const apps = [
      { key: "pos", label: "Grit POS" },
      { key: "inventory", label: "Grit Inventory" },
      { key: "taskboard", label: "Grit Taskboard" },
    ];
    apps.forEach((app) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = urls[app.key];
      a.textContent = app.label;
      li.appendChild(a);
      suiteNavList.appendChild(li);
    });
  }

  function init() {
    const range = defaultRange();
    fromInput.value = range.from;
    toInput.value = range.to;
    loadBtn.addEventListener("click", loadDashboard);
    downloadCsvBtn.addEventListener("click", downloadCsv);
    renderSuiteNav();
  }

  init();
})();
