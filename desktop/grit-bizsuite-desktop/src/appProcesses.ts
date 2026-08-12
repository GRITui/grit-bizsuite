// Spawns, health-checks, and tears down the 5 app servers as child
// processes of the Electron main process. Every port is bound to
// 127.0.0.1 only — nothing here is meant to be reachable from outside the
// machine, same posture as the embedded Postgres instance.
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { AppId, bundledAppDir, logsDir } from "./paths";
import { GritSecrets } from "./secrets";
import { databaseUrl } from "./postgres";

export const PORTS: Record<AppId, number> = {
  "grit-pos": 13000,
  "grit-inventory": 13001,
  "grit-taskboard": 13002,
  "grit-reports": 13003,
  "grit-manpower": 13004,
};
// Deliberately NOT 3000-3004: those are extremely common defaults for
// other local dev tools a real user is likely to already have running.
// 13000+ is a low-collision-risk range for a packaged consumer app.

export type AppStatus = "stopped" | "starting" | "running" | "crashed";

interface RunningApp {
  process: ChildProcess;
  status: AppStatus;
}

const running = new Map<AppId, RunningApp>();

function appLogStream(id: AppId): fs.WriteStream {
  fs.mkdirSync(logsDir, { recursive: true });
  return fs.createWriteStream(path.join(logsDir, `${id}.log`), { flags: "a" });
}

function sharedEnv(secrets: GritSecrets): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GRIT_SESSION_SECRET: secrets.gritSessionSecret,
    GRIT_EVENT_WEBHOOK_SECRET: secrets.gritEventWebhookSecret,
    GRIT_SERVICE_TOKEN: secrets.gritServiceToken,
  };
}

function startNextApp(id: "grit-pos" | "grit-inventory" | "grit-manpower", extraEnv: NodeJS.ProcessEnv): ChildProcess {
  // build-resources.sh flattens Next's standalone output so server.js
  // always lands directly at <appDir>/server.js, regardless of the
  // workspace-relative nesting `next build` itself produces — see that
  // script for exactly how.
  const serverPath = path.join(bundledAppDir(id), "server.js");
  return spawn(process.execPath, [serverPath], {
    env: { ...extraEnv, PORT: String(PORTS[id]), HOSTNAME: "127.0.0.1" },
    cwd: bundledAppDir(id),
  });
}

function startNoBuildApp(id: "grit-taskboard" | "grit-reports", extraEnv: NodeJS.ProcessEnv): ChildProcess {
  const appDir = bundledAppDir(id);
  const staticDir = id === "grit-taskboard" ? path.join(appDir, "app") : path.join(appDir, "excel-group-analyze");
  // Same shim used throughout this session's local-dev runs
  // (dev/local-run/serve.mjs + register-loader.mjs) — bundled verbatim by
  // build-resources.sh, not reimplemented here.
  return spawn(
    process.execPath,
    ["--import", path.join(appDir, "register-loader.mjs"), path.join(appDir, "serve.mjs"), appDir, staticDir, String(PORTS[id])],
    { env: extraEnv, cwd: appDir },
  );
}

function waitForPort(port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`Timed out waiting for port ${port}`));
        else setTimeout(attempt, 500);
      });
      req.on("timeout", () => req.destroy());
    };
    attempt();
  });
}

export interface StartAllOptions {
  secrets: GritSecrets;
  pgPassword: string;
  onStatusChange: (id: AppId, status: AppStatus) => void;
}

export async function startAllApps({ secrets, pgPassword, onStatusChange }: StartAllOptions): Promise<void> {
  const base = sharedEnv(secrets);

  const specs: { id: AppId; env: NodeJS.ProcessEnv }[] = [
    {
      id: "grit-pos",
      env: {
        ...base,
        DATABASE_URL: databaseUrl("grit_pos", pgPassword),
        GRIT_SUBSCRIBERS_TRANSACTION_COMPLETED: `http://127.0.0.1:${PORTS["grit-inventory"]}/api/events/grit`,
      },
    },
    {
      id: "grit-inventory",
      env: {
        ...base,
        DATABASE_URL: databaseUrl("grit_inventory", pgPassword),
        CARRIER_PROVIDER: "mock",
        GRIT_SUBSCRIBERS_INVENTORY_THRESHOLD_BREACHED: `http://127.0.0.1:${PORTS["grit-taskboard"]}/api/grit-events`,
      },
    },
    {
      id: "grit-manpower",
      env: {
        ...base,
        DATABASE_URL: databaseUrl("grit_manpower", pgPassword),
        GRIT_SUBSCRIBERS_MANPOWER_SHIFT_UNASSIGNED: `http://127.0.0.1:${PORTS["grit-taskboard"]}/api/grit-events`,
      },
    },
    {
      id: "grit-taskboard",
      env: {
        ...base,
        DATABASE_URL: databaseUrl("grit_taskboard", pgPassword),
        SESSION_SECRET: secrets.taskboardSessionSecret, // taskboard's OWN local bearer-token secret — a dedicated random value, deliberately distinct from GRIT_SESSION_SECRET (see apps/grit-taskboard/.env.example's own note on why these must never be the same value).
      },
    },
    {
      id: "grit-reports",
      env: {
        ...base,
        GRIT_POS_URL: `http://127.0.0.1:${PORTS["grit-pos"]}`,
        GRIT_INVENTORY_URL: `http://127.0.0.1:${PORTS["grit-inventory"]}`,
        GRIT_TASKBOARD_URL: `http://127.0.0.1:${PORTS["grit-taskboard"]}`,
      },
    },
  ];

  for (const { id, env } of specs) {
    onStatusChange(id, "starting");
    const child = id === "grit-taskboard" || id === "grit-reports" ? startNoBuildApp(id, env) : startNextApp(id, env);
    const logStream = appLogStream(id);
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
    child.on("exit", (code) => {
      const entry = running.get(id);
      if (entry) entry.status = "crashed";
      onStatusChange(id, "crashed");
      fs.appendFileSync(path.join(logsDir, `${id}.log`), `\n[process exited with code ${code}]\n`);
    });
    running.set(id, { process: child, status: "starting" });

    try {
      await waitForPort(PORTS[id]);
      const entry = running.get(id);
      if (entry) entry.status = "running";
      onStatusChange(id, "running");
    } catch (err) {
      const entry = running.get(id);
      if (entry) entry.status = "crashed";
      onStatusChange(id, "crashed");
      fs.appendFileSync(path.join(logsDir, `${id}.log`), `\n[failed to become ready: ${String(err)}]\n`);
    }
  }
}

export function stopAllApps(): void {
  for (const [id, entry] of running) {
    if (entry.status === "running" || entry.status === "starting") {
      entry.process.kill("SIGTERM");
    }
  }
  running.clear();
}

export function getStatus(id: AppId): AppStatus {
  return running.get(id)?.status ?? "stopped";
}
