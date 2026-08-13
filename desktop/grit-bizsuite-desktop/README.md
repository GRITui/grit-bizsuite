# Grit BizSuite Desktop (macOS arm64)

Native macOS packaging for the Grit BizSuite web monorepo — an Electron
launcher that bundles an embedded Postgres cluster and all 5 apps
(`grit-pos`, `grit-inventory`, `grit-manpower`, `grit-taskboard`,
`grit-reports`), so a user can install one `.dmg` and click one icon
instead of running a shell script against their own Postgres install.

> **Status: unrun, untested source code.** This was written in a Linux
> sandbox with no macOS, no Electron display, and no darwin-arm64 Postgres
> binary available to execute — nothing here has been built, launched, or
> packaged for real. Treat this as a first draft to build and iterate on,
> not a working artifact. Expect to fix real problems on your first build
> attempt (see "Known risks" below for the likeliest ones).

## What this is not

This directory is deliberately **outside** the root `package.json`'s npm
workspaces glob (`apps/*`, `packages/*`) — it has its own toolchain
(Electron + electron-builder) that has nothing to do with the Next.js/Neon
stack the rest of the monorepo runs on, and mixing the two would pull
Electron's native deps into every other app's `npm install`.

## Architecture

| App | Runtime | Bundled as | Port |
|---|---|---|---|
| grit-pos | Next.js standalone | `resources/apps/grit-pos/server.js` | 13000 |
| grit-inventory | Next.js standalone | `resources/apps/grit-inventory/server.js` | 13001 |
| grit-taskboard | no-build PWA + serve.mjs shim | `resources/apps/grit-taskboard/` | 13002 |
| grit-reports | static | `resources/apps/grit-reports/` | 13003 |
| grit-manpower | Next.js standalone | `resources/apps/grit-manpower/server.js` | 13004 |
| Postgres 16 | embedded-postgres | `node_modules/@embedded-postgres/darwin-arm64` | 55432 |

Ports are non-default (13000+, not 3000+) specifically so the packaged app
doesn't collide with whatever else the user already runs locally. Postgres
and every app bind to `127.0.0.1` only.

Source layout:

```
src/
  main.ts          Electron main process — app lifecycle, ties everything together
  preload.ts        contextBridge IPC surface for the renderer
  paths.ts          packaged vs. dev resource/userData path resolution
  secrets.ts         per-install random secret generation (session/webhook/service-token/taskboard/pg password)
  postgres.ts        embedded Postgres start/stop/database creation
  migrate.ts          first-run Prisma migrate deploy + taskboard schema + demo seed
  appProcesses.ts      spawns/health-checks/tears down the 5 app child processes
  renderer/            plain HTML/CSS/JS launcher UI (status dots + Open buttons + Quit)
```

## Building

**Prerequisites:** a Mac (this only targets darwin-arm64), Node.js, Xcode
Command Line Tools (`xcode-select --install`).

```bash
cd desktop/grit-bizsuite-desktop
npm install

# Populates resources/ from the web monorepo — clones it, builds
# packages/*, builds the 3 Next apps with output:"standalone", copies the
# 2 no-build apps, vendors Postgres + Prisma CLI. Reads the source repo
# from REPO_URL/REPO_REF env vars (defaults to this repo's main branch).
# Expect to have to debug this script — see its own header comment.
npm run prepare-resources

# Compiles src/ (TypeScript -> dist/)
npm run build

# Launch unpackaged, for iterating without a full .dmg build each time
npm run dev
```

## Packaging a .dmg

```bash
npm run dist:mac
```

Output lands in `release/*.dmg`. This is **unsigned** by default (see
`electron-builder.yml`'s `mac.hardenedRuntime: false`) — on first launch,
macOS Gatekeeper will block it; the user needs to right-click the app →
Open, once, to bypass that. This is expected and normal for an unsigned
build, not a bug.

### Code signing & notarization (not set up yet)

Requires an Apple Developer Program membership ($99/yr). Once you have
one:

1. Set `mac.hardenedRuntime: true` in `electron-builder.yml`.
2. Set `CSC_LINK`/`CSC_KEY_PASSWORD` env vars (or `mac.identity`) to your
   Developer ID Application certificate.
3. Add an `afterSign` hook calling `@electron/notarize` with your Apple ID
   + app-specific password (or API key), and wait for Apple's notarization
   service before the .dmg is fully trusted on a fresh Mac with no
   Gatekeeper override.

None of this is wired up yet — it's the natural next step once signing
credentials exist, not before.

## First launch behavior

On first launch, `main.ts` runs, in order: load-or-create secrets →
start embedded Postgres (running `initdb` if the data directory is empty)
→ run Prisma migrations for pos/inventory/manpower + apply taskboard's
`schema-core.sql` → seed demo data (`owner@demo.cafe` / `gritdemo1`,
same credentials used throughout this repo's local-dev docs) → start all
5 app servers, reporting status to the launcher window as each comes up.

Every subsequent launch skips the migrate/seed step (gated by
`setup-complete.json` in Electron's `userData` dir) and just starts
Postgres + the 5 apps.

To seed a real user's own data instead of the demo dataset, set
`SEED_DEMO_DATA = false` in `main.ts` before packaging.

## Known risks / open items

- **Bundle size.** Bundling 3 full Next.js standalone builds + Postgres
  binaries + a Prisma CLI copy will likely land the `.dmg` somewhere in
  the 500MB-1GB range. Not addressed here; a future pass could dedupe
  shared `node_modules` across the 3 Next apps.
- **`build-resources.sh`'s standalone-output flattening is unverified.**
  The exact directory layout `next build` emits for a monorepo app with
  `output: "standalone"` was reasoned about from Next's documented
  behavior, not observed on a real build in this environment. If
  `resources/apps/<id>/server.js` doesn't exist after running the script,
  start by inspecting the real `.next/standalone/` tree it produced and
  adjust the `nested_app_dir` path in the script.
- **arm64-only.** No Intel Mac support — `mac.arch: [arm64]` and the
  `@embedded-postgres/darwin-arm64` optional dependency both hard-code
  this. Supporting Intel would mean detecting `process.arch` and vendoring
  the `@embedded-postgres/darwin-x64` binaries too.
- **Port conflicts.** 13000-13004/55432 are chosen to be unlikely
  collisions, not guaranteed-free ones. `appProcesses.ts`/`postgres.ts`
  don't currently detect "port already in use" and offer a fallback — a
  crash on that port shows as status "Failed" in the launcher with no
  more specific message than what's in the per-app log file
  (`~/Library/Logs/Grit BizSuite/<app>.log`).
- **No upgrade-migration story.** If a future release changes the Prisma
  schemas, this build has no logic to detect "already set up, but on an
  older schema version" and re-run `migrate deploy` — right now
  `setup-complete.json` treats first-run setup as a one-time, permanent
  event. Needs real design before a second version ships.
- **Prisma CLI version pinning.** `build-resources.sh` installs
  `prisma@^7.0.0` into `resources/prisma-tools` independently of whatever
  version each app's own `package.json` pins — check they match before
  relying on this for anything beyond local iteration.
