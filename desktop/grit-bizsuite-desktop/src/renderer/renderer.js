// No build step for the renderer — plain script loaded directly by
// index.html, talking to the main process only through the
// contextBridge-exposed `window.gritDesktop` (see ../preload.ts).
const listEl = document.getElementById("app-list");
const subtitleEl = document.getElementById("subtitle");
const bootErrorEl = document.getElementById("boot-error");
const quitBtn = document.getElementById("quit-btn");

const rows = new Map();

function statusLabel(status) {
  switch (status) {
    case "running":
      return "Running";
    case "starting":
      return "Starting…";
    case "crashed":
      return "Failed";
    default:
      return "Stopped";
  }
}

function upsertRow(entry) {
  let row = rows.get(entry.id);
  if (!row) {
    const li = document.createElement("li");
    li.className = "app-row";
    li.innerHTML = `
      <span class="name"><span class="dot"></span>${entry.label}</span>
      <span>
        <span class="status-text"></span>
        <button type="button">Open</button>
      </span>
    `;
    listEl.appendChild(li);
    row = {
      li,
      dot: li.querySelector(".dot"),
      statusText: li.querySelector(".status-text"),
      openBtn: li.querySelector("button"),
    };
    row.openBtn.addEventListener("click", () => window.gritDesktop.openApp(entry.id));
    rows.set(entry.id, row);
  }
  row.dot.className = `dot ${entry.status}`;
  row.statusText.textContent = statusLabel(entry.status);
  row.openBtn.disabled = entry.status !== "running";
}

function refreshSubtitle() {
  const all = [...rows.values()];
  if (all.length === 0) return;
  const running = all.filter((r) => r.dot.classList.contains("running")).length;
  const crashed = all.filter((r) => r.dot.classList.contains("crashed")).length;
  if (crashed > 0) {
    subtitleEl.textContent = `${running}/${all.length} running — ${crashed} failed to start (see logs)`;
  } else if (running === all.length) {
    subtitleEl.textContent = "All services running";
  } else {
    subtitleEl.textContent = `${running}/${all.length} running…`;
  }
}

window.gritDesktop.onStatus((entry) => {
  upsertRow(entry);
  refreshSubtitle();
});

window.gritDesktop.onBootError((message) => {
  bootErrorEl.hidden = false;
  bootErrorEl.textContent = `Startup error: ${message}`;
});

window.gritDesktop.getAllStatus().then((entries) => {
  entries.forEach(upsertRow);
  refreshSubtitle();
});

quitBtn.addEventListener("click", () => {
  quitBtn.disabled = true;
  quitBtn.textContent = "Stopping…";
  window.gritDesktop.quit();
});
