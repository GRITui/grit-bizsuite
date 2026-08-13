// Resolves every path this app needs, branching on whether we're running
// packaged (inside a built .app, resources under process.resourcesPath —
// read-only, lives inside the signed bundle) or unpackaged (`npm run dev`,
// resources read straight from this repo's own `resources/` directory,
// populated by `scripts/build-resources.sh`). Every other module should
// import paths from here rather than constructing its own — this is the
// one place "where do bundled files live" is decided.
import { app } from "electron";
import path from "node:path";

const isPackaged = app.isPackaged;

/** Root of the bundled apps/postgres/prisma resources — read-only at runtime. */
export const resourcesRoot = isPackaged
  ? process.resourcesPath
  : path.join(__dirname, "..", "resources");

export const bundledAppsDir = path.join(resourcesRoot, "apps");
export const bundledPostgresDir = path.join(resourcesRoot, "postgres");
export const bundledPrismaToolsDir = path.join(resourcesRoot, "prisma-tools");

/**
 * Per-user, writable state — Postgres's actual data directory, generated
 * secrets, logs, the first-run marker. Never inside the app bundle itself
 * (that's read-only once signed, and gets wiped/replaced on every app
 * update anyway — this data must survive updates).
 */
export const userDataDir = app.getPath("userData");
export const pgDataDir = path.join(userDataDir, "pgdata");
export const secretsFile = path.join(userDataDir, "secrets.json");
export const setupMarkerFile = path.join(userDataDir, "setup-complete.json");
export const logsDir = app.getPath("logs");

/** Each bundled app's own directory, matching the names build-resources.sh writes. */
export const APP_IDS = ["grit-pos", "grit-inventory", "grit-manpower", "grit-taskboard", "grit-reports"] as const;
export type AppId = (typeof APP_IDS)[number];

export function bundledAppDir(id: AppId): string {
  return path.join(bundledAppsDir, id);
}
