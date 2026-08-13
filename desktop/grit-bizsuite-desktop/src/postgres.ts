// Lifecycle for the bundled Postgres instance — one embedded cluster,
// started on app launch, stopped cleanly on quit. Bound to a non-default
// port on loopback only, so it never collides with a Postgres the user
// might already have running for other projects, and is never reachable
// from outside the machine.
//
// Package: `embedded-postgres` (github.com/leinelissen/embedded-postgres).
// Pinned to the 16.x line to match every migration this app runs — see
// package.json. Ships prebuilt macOS arm64 binaries via its
// `@embedded-postgres/darwin-arm64` optional dependency; verify that
// resolves correctly when you first `npm install` this package on your
// Mac (an x64 Mac or CI machine would need the `-x64` variant instead —
// out of scope here per the arm64-only ask).
import type EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";
import { pgDataDir, logsDir } from "./paths";

// `embedded-postgres` ships ESM-only (see src/types/embedded-postgres.d.ts's
// header comment) while this project compiles to CommonJS. A plain
// `import EmbeddedPostgres from "embedded-postgres"` would downlevel to a
// `require()` call that throws ERR_REQUIRE_ESM, and even TypeScript's
// dynamic `import()` gets downleveled to a require()-based shim under
// `module: "commonjs"`. Routing the specifier through `new Function(...)`
// hides it from that downlevel transform, so Node's own native dynamic
// import runs instead — the standard workaround for loading an ESM-only
// dependency from a CommonJS entry point.
const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<{ default: typeof EmbeddedPostgres }>;

export const PG_PORT = 55432;
export const PG_HOST = "127.0.0.1";
export const PG_USER = "gritdesktop";

const DATABASES = ["grit_pos", "grit_inventory", "grit_manpower", "grit_taskboard"] as const;

function pgLogPath(): string {
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, "postgres.log");
}

function appendLog(line: string): void {
  fs.appendFileSync(pgLogPath(), `[${new Date().toISOString()}] ${line}\n`);
}

/** True once initdb has already populated the data directory — Postgres's
 * own marker for "this is a real data directory," not something this app
 * invents. Avoids re-running initialise() (and re-randomizing anything)
 * on every launch after the first. */
function isInitialised(): boolean {
  return fs.existsSync(path.join(pgDataDir, "PG_VERSION"));
}

export async function startEmbeddedPostgres(password: string): Promise<EmbeddedPostgres> {
  fs.mkdirSync(pgDataDir, { recursive: true });

  const { default: EmbeddedPostgresCtor } = await importEsm("embedded-postgres");
  const pg = new EmbeddedPostgresCtor({
    databaseDir: pgDataDir,
    port: PG_PORT,
    user: PG_USER,
    password,
    persistent: true, // never wipe data on stop() — this is real business data, not a scratch DB
    onLog: (message) => appendLog(String(message)),
    onError: (message) => appendLog(`ERROR: ${String(message)}`),
  });

  if (!isInitialised()) {
    appendLog("Data directory not yet initialised — running initdb");
    await pg.initialise();
  }

  await pg.start();
  appendLog(`Postgres started on ${PG_HOST}:${PG_PORT}`);

  for (const name of DATABASES) {
    try {
      await pg.createDatabase(name);
    } catch (err) {
      // createDatabase throws if it already exists — that's the expected,
      // common case on every launch after the first. Anything else is a
      // real problem and should surface, not be swallowed.
      if (!String(err).includes("already exists")) throw err;
    }
  }

  return pg;
}

export function databaseUrl(database: (typeof DATABASES)[number], password: string): string {
  return `postgresql://${PG_USER}:${encodeURIComponent(password)}@${PG_HOST}:${PG_PORT}/${database}`;
}

export async function stopEmbeddedPostgres(pg: EmbeddedPostgres): Promise<void> {
  appendLog("Stopping Postgres...");
  await pg.stop();
  appendLog("Postgres stopped");
}
