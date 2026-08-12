// Electron main process entry point. Ties together secrets.ts, postgres.ts,
// migrate.ts, and appProcesses.ts into the actual app lifecycle:
//   1. On ready: load/create secrets, start embedded Postgres, run
//      first-time migrate+seed if needed, start all 5 app servers.
//   2. Create the launcher window (renderer polls app status via IPC).
//   3. On quit: stop all app processes, then stop Postgres — in that
//      order, so nothing is left trying to reach a database that just
//      disappeared out from under it.
import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import EmbeddedPostgres from "embedded-postgres";
import { loadOrCreateSecrets, GritSecrets } from "./secrets";
import { startEmbeddedPostgres, stopEmbeddedPostgres, databaseUrl } from "./postgres";
import { isFirstRun, runFirstTimeSetup } from "./migrate";
import { startAllApps, stopAllApps, getStatus, PORTS, AppStatus } from "./appProcesses";
import { APP_IDS, AppId, logsDir } from "./paths";

// Seeding demo data is this build's default (per the scoped plan's
// "assumed defaults" — flip to false for a from-scratch empty install).
const SEED_DEMO_DATA = true;

let mainWindow: BrowserWindow | null = null;
let pgInstance: EmbeddedPostgres | null = null;
let shuttingDown = false;

const APP_LABELS: Record<AppId, string> = {
  "grit-pos": "Grit POS",
  "grit-inventory": "Grit Inventory",
  "grit-manpower": "Grit Manpower",
  "grit-taskboard": "Grit Taskboard",
  "grit-reports": "Grit Reports",
};

function bootLog(line: string): void {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(path.join(logsDir, "boot.log"), `[${new Date().toISOString()}] ${line}\n`);
}

function sendStatus(id: AppId, status: AppStatus): void {
  mainWindow?.webContents.send("app-status", { id, label: APP_LABELS[id], status, port: PORTS[id] });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    title: "Grit BizSuite",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function boot(): Promise<void> {
  bootLog("=== Grit BizSuite starting ===");

  const secrets: GritSecrets = loadOrCreateSecrets();
  bootLog("Secrets loaded.");

  pgInstance = await startEmbeddedPostgres(secrets.postgresPassword);
  bootLog("Embedded Postgres ready.");

  if (isFirstRun()) {
    bootLog("First run detected — applying migrations" + (SEED_DEMO_DATA ? " and seeding demo data" : "") + "...");
    await runFirstTimeSetup(
      {
        pos: databaseUrl("grit_pos", secrets.postgresPassword),
        inventory: databaseUrl("grit_inventory", secrets.postgresPassword),
        manpower: databaseUrl("grit_manpower", secrets.postgresPassword),
        taskboard: databaseUrl("grit_taskboard", secrets.postgresPassword),
      },
      SEED_DEMO_DATA,
    );
    bootLog("First-run setup complete.");
  } else {
    bootLog("Not first run — skipping migrate/seed.");
  }

  for (const id of APP_IDS) sendStatus(id, "starting");

  await startAllApps({
    secrets,
    pgPassword: secrets.postgresPassword,
    onStatusChange: sendStatus,
  });
  bootLog("All apps started (see per-app status for any that failed).");
}

app.whenReady().then(() => {
  createWindow();
  boot().catch((err) => {
    bootLog(`FATAL during boot: ${String(err?.stack ?? err)}`);
    mainWindow?.webContents.send("boot-error", String(err?.message ?? err));
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Quitting the window quits the whole suite — this is a launcher, not a
  // background service. (Documented tradeoff in the scope doc: no
  // menu-bar-only "keep running" mode in this first cut.)
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();
  bootLog("Shutting down...");
  try {
    stopAllApps();
    if (pgInstance) await stopEmbeddedPostgres(pgInstance);
  } catch (err) {
    bootLog(`Error during shutdown: ${String(err)}`);
  } finally {
    bootLog("Shutdown complete.");
    app.exit(0);
  }
});

ipcMain.handle("get-all-status", () => {
  return APP_IDS.map((id) => ({ id, label: APP_LABELS[id], status: getStatus(id), port: PORTS[id] }));
});

ipcMain.handle("open-app", (_event, id: AppId) => {
  shell.openExternal(`http://127.0.0.1:${PORTS[id]}`);
});

ipcMain.handle("quit-app", () => {
  app.quit();
});
