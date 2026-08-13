#!/usr/bin/env bash
# Populates desktop/grit-bizsuite-desktop/resources/ from the web monorepo,
# ready for `npm run dist:mac`. Run this on your own Mac — it is NOT part
# of `npm install`/`npm run build` for this package, and has never been
# executed by the assistant that wrote it (no macOS, no darwin-arm64
# Postgres binary, no Electron display in that sandbox). Treat the whole
# script as a first draft: read it before running it, and expect to fix
# real problems on the first pass.
#
# What it does, in order:
#   1. Clone (or reuse) the grit-bizsuite repo at a pinned commit/branch.
#   2. npm install + build packages/* (they ship pre-compiled dist/, see
#      the root AGENTS.md — nothing can import them unbuilt).
#   3. Build grit-pos / grit-inventory / grit-manpower with
#      `output: "standalone"` (already added to their next.config.ts as
#      part of this same change) and flatten the standalone output so
#      each app's server.js lands at resources/apps/<id>/server.js
#      directly, instead of nested under the monorepo's workspace path.
#   4. Copy grit-taskboard and grit-reports verbatim (no build step) along
#      with the serve.mjs/register-loader.mjs shim used throughout local
#      dev this session.
#   5. Vendor a Postgres 16 macOS-arm64 binary distribution.
#   6. Vendor a standalone `prisma` CLI + each Next app's prisma/ dir
#      (schema + migrations only — `migrate deploy` doesn't need a
#      generated client).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCES_DIR="$DESKTOP_DIR/resources"

# --- configuration -----------------------------------------------------
REPO_URL="${REPO_URL:-https://github.com/GRITui/grit-bizsuite.git}"
# Pin this to a real commit/tag before you actually build a release — the
# branch default below is only a placeholder so the script has something
# to check out on a first try.
REPO_REF="${REPO_REF:-main}"
WORK_DIR="${WORK_DIR:-$DESKTOP_DIR/.build/grit-bizsuite-src}"
POSTGRES_VERSION="${POSTGRES_VERSION:-16.4.0}"
# EDB's zonky/embedded-postgres-binaries releases publish darwin-arm64
# tarballs under this naming scheme; embedded-postgres itself resolves the
# same artifact via its @embedded-postgres/darwin-arm64 optional
# dependency at `npm install` time for the DESKTOP package (see
# package.json) — this download is a SEPARATE, redundant vendoring step
# only needed if you want resources/postgres-macos-arm64 populated for
# inspection/offline builds. If `npm install` in grit-bizsuite-desktop
# already pulled the binary into
# node_modules/@embedded-postgres/darwin-arm64, prefer copying from there
# instead of re-downloading — see the fallback below.
POSTGRES_BINARIES_URL="${POSTGRES_BINARIES_URL:-}"

echo "==> Desktop dir: $DESKTOP_DIR"
echo "==> Resources dir: $RESOURCES_DIR"
rm -rf "$RESOURCES_DIR"
mkdir -p "$RESOURCES_DIR/apps" "$RESOURCES_DIR/prisma-tools" "$RESOURCES_DIR/postgres-macos-arm64"

# --- 1. clone/update the web monorepo -----------------------------------
if [ -d "$WORK_DIR/.git" ]; then
  echo "==> Reusing existing clone at $WORK_DIR, fetching $REPO_REF"
  git -C "$WORK_DIR" fetch origin "$REPO_REF"
  git -C "$WORK_DIR" checkout "$REPO_REF"
  git -C "$WORK_DIR" reset --hard "origin/$REPO_REF" 2>/dev/null || git -C "$WORK_DIR" reset --hard "$REPO_REF"
else
  echo "==> Cloning $REPO_URL ($REPO_REF) into $WORK_DIR"
  mkdir -p "$(dirname "$WORK_DIR")"
  git clone -b "$REPO_REF" "$REPO_URL" "$WORK_DIR"
fi

# --- 2. install + build shared packages ---------------------------------
echo "==> npm install (this can take a while — full monorepo)"
(cd "$WORK_DIR" && npm install)

echo "==> Building packages/*"
(cd "$WORK_DIR" && npx turbo run build --filter='./packages/*')

# --- 3. build the 3 Next apps (standalone) and flatten -------------------
build_next_app() {
  local app_id="$1"
  echo "==> Building $app_id (next build, standalone output)"
  (cd "$WORK_DIR/apps/$app_id" && npx next build)

  local standalone_root="$WORK_DIR/apps/$app_id/.next/standalone"
  # `next build` nests the standalone app under the workspace-relative
  # path it was built from, e.g.
  # .next/standalone/apps/<app_id>/server.js, plus a workspace-root
  # node_modules sibling — flatten all of that into one self-contained
  # directory at resources/apps/<app_id>.
  local nested_app_dir="$standalone_root/apps/$app_id"
  if [ ! -f "$nested_app_dir/server.js" ]; then
    echo "!! Expected $nested_app_dir/server.js — next build layout may have changed. Aborting." >&2
    exit 1
  fi

  local dest="$RESOURCES_DIR/apps/$app_id"
  mkdir -p "$dest"
  # App-specific server.js + any app-local node_modules next emitted.
  cp -R "$nested_app_dir/." "$dest/"
  # Workspace-hoisted node_modules (most deps end up here, not under the
  # nested app dir) — merge on top without clobbering the app-local copy.
  if [ -d "$standalone_root/node_modules" ]; then
    cp -R "$standalone_root/node_modules" "$dest/node_modules_root_tmp"
    # Only fill in packages not already present locally.
    if [ -d "$dest/node_modules" ]; then
      (cd "$dest/node_modules_root_tmp" && find . -maxdepth 1 -mindepth 1) | while read -r entry; do
        [ -e "$dest/node_modules/$entry" ] || cp -R "$dest/node_modules_root_tmp/$entry" "$dest/node_modules/$entry"
      done
      rm -rf "$dest/node_modules_root_tmp"
    else
      mv "$dest/node_modules_root_tmp" "$dest/node_modules"
    fi
  fi
  # Static assets + public/ are NOT included in standalone output by
  # default — Next expects you to copy them alongside server.js yourself.
  cp -R "$WORK_DIR/apps/$app_id/public" "$dest/public" 2>/dev/null || true
  mkdir -p "$dest/.next"
  cp -R "$WORK_DIR/apps/$app_id/.next/static" "$dest/.next/static"

  # prisma/schema.prisma + migrations only — no generated client, migrate.ts
  # shells out to the bundled `prisma` CLI in resources/prisma-tools instead.
  mkdir -p "$dest/prisma"
  cp -R "$WORK_DIR/apps/$app_id/prisma/schema.prisma" "$dest/prisma/" 2>/dev/null || true
  cp -R "$WORK_DIR/apps/$app_id/prisma/migrations" "$dest/prisma/" 2>/dev/null || true

  echo "    -> $dest ($(du -sh "$dest" | cut -f1))"
}

build_next_app grit-pos
build_next_app grit-inventory
build_next_app grit-manpower

# --- 4. copy the no-build apps verbatim -----------------------------------
copy_no_build_app() {
  local app_id="$1"
  echo "==> Copying $app_id (no build step)"
  local src="$WORK_DIR/apps/$app_id"
  local dest="$RESOURCES_DIR/apps/$app_id"
  mkdir -p "$dest"
  cp -R "$src/." "$dest/"
  # dev/local-run/serve.mjs + register-loader.mjs is the same static-file +
  # API-route shim validated all session for local runs of these two apps —
  # copy it in from the repo root so appProcesses.ts can spawn it exactly
  # like run-grit-bizsuite-local.sh did.
  cp "$WORK_DIR/dev/local-run/serve.mjs" "$dest/serve.mjs"
  cp "$WORK_DIR/dev/local-run/register-loader.mjs" "$dest/register-loader.mjs"
  rm -rf "$dest/node_modules"
}

copy_no_build_app grit-taskboard
copy_no_build_app grit-reports

# --- 5. vendor Postgres macOS arm64 binaries ------------------------------
DESKTOP_PG_MODULE_DIR="$DESKTOP_DIR/node_modules/@embedded-postgres/darwin-arm64"
if [ -d "$DESKTOP_PG_MODULE_DIR" ]; then
  echo "==> Copying Postgres binaries from already-installed @embedded-postgres/darwin-arm64"
  cp -R "$DESKTOP_PG_MODULE_DIR/." "$RESOURCES_DIR/postgres-macos-arm64/"
elif [ -n "$POSTGRES_BINARIES_URL" ]; then
  echo "==> Downloading Postgres binaries from $POSTGRES_BINARIES_URL"
  curl -fsSL "$POSTGRES_BINARIES_URL" -o "$RESOURCES_DIR/postgres-macos-arm64.tar.gz"
  tar -xzf "$RESOURCES_DIR/postgres-macos-arm64.tar.gz" -C "$RESOURCES_DIR/postgres-macos-arm64"
  rm "$RESOURCES_DIR/postgres-macos-arm64.tar.gz"
else
  echo "!! No @embedded-postgres/darwin-arm64 found in node_modules and no POSTGRES_BINARIES_URL set."
  echo "   Run 'npm install' in $DESKTOP_DIR first (it pulls this in as an optional"
  echo "   dependency of embedded-postgres) — this step just copies what npm already fetched."
  echo "   Note this directory ends up UNUSED at runtime anyway: postgres.ts imports"
  echo "   embedded-postgres directly and it resolves its own binaries from"
  echo "   node_modules, not from resources/postgres — this copy exists only so the"
  echo "   packaged .app has the binaries available if you later change that. Skipping."
fi

# --- 6. vendor the Prisma CLI ----------------------------------------------
echo "==> Vendoring standalone Prisma CLI into resources/prisma-tools"
mkdir -p "$RESOURCES_DIR/prisma-tools"
cat > "$RESOURCES_DIR/prisma-tools/package.json" <<'EOF'
{
  "name": "grit-desktop-prisma-tools",
  "private": true,
  "version": "0.0.0"
}
EOF
# Pin to the same major.minor Prisma version the web monorepo's apps use —
# check apps/grit-pos/package.json's "prisma" devDependency version and
# match it here if it ever drifts from 7.x.
(cd "$RESOURCES_DIR/prisma-tools" && npm install --no-save prisma@^7.0.0)

echo "==> Done. Resources populated at $RESOURCES_DIR"
echo "    Total size: $(du -sh "$RESOURCES_DIR" | cut -f1)"
echo ""
echo "Next: npm run dist:mac   (from $DESKTOP_DIR)"
