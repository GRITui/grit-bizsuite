// First-run setup: apply every app's migrations against the freshly-created
// databases, then (per this build's default) seed demo data. Runs once,
// gated by setupMarkerFile — see main.ts for the call site.
//
// Deliberately does NOT reuse `next build`'s standalone output for this:
// standalone mode prunes devDependencies, and `prisma` (the CLI) is a
// devDependency in every app — it won't be present in the bundled
// `.next/standalone/node_modules`. Instead, `scripts/build-resources.sh`
// vendors one shared copy of the `prisma` CLI + each app's `prisma/`
// directory (schema + migrations, no generated client needed for
// `migrate deploy`) into `resources/prisma-tools/` and `resources/apps/*/prisma/`
// respectively, and this module shells out to that bundled CLI — the exact
// same `prisma migrate deploy` this whole suite has been validated against
// all session, just invoked programmatically instead of via `npx`.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { bundledAppDir, bundledPrismaToolsDir, setupMarkerFile, logsDir } from "./paths";

const execFileAsync = promisify(execFile);

function log(line: string): void {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(path.join(logsDir, "setup.log"), `[${new Date().toISOString()}] ${line}\n`);
}

async function runPrismaMigrateDeploy(appId: "grit-pos" | "grit-inventory" | "grit-manpower", dbUrl: string): Promise<void> {
  const schemaPath = path.join(bundledAppDir(appId), "prisma", "schema.prisma");
  const prismaBin = path.join(bundledPrismaToolsDir, "node_modules", ".bin", "prisma");
  log(`Running migrate deploy for ${appId}...`);
  const { stdout, stderr } = await execFileAsync(prismaBin, ["migrate", "deploy", "--schema", schemaPath], {
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
  log(`${appId} migrate deploy stdout:\n${stdout}`);
  if (stderr) log(`${appId} migrate deploy stderr:\n${stderr}`);
}

async function applyTaskboardSchema(dbUrl: string): Promise<void> {
  const sqlPath = path.join(bundledAppDir("grit-taskboard"), "sql", "schema-core.sql");
  const schemaSql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // A plain string passed to client.query() (no parameters) uses
    // node-postgres's simple query protocol, which — like `psql -f` —
    // accepts a whole multi-statement file including dollar-quoted
    // `do $$ ... $$;` blocks. schema-core.sql is written to be idempotent
    // (see its own header comment in the web monorepo), so this is safe
    // to run even if some objects already exist.
    log("Applying taskboard schema-core.sql...");
    await client.query(schemaSql);
  } finally {
    await client.end();
  }
}

/**
 * Minimal re-implementation of dev/local-run/seed-demo-pos.ts +
 * seed-demo-inventory.ts's essential logic via raw SQL, since invoking the
 * real Prisma Client from the Electron main process would mean loading a
 * *different* app's generated client into a foreign process — doable but
 * more fragile than just inserting the same rows directly. Keep this in
 * sync BY HAND with those two scripts if the demo dataset ever changes;
 * it is a deliberate duplication, not a shared import.
 */
async function seedDemoData(posUrl: string, inventoryUrl: string): Promise<void> {
  const tenantId = crypto.randomUUID();
  const posUserId = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash("gritdemo1", 12);

  const pos = new Client({ connectionString: posUrl });
  await pos.connect();
  try {
    log("Seeding grit-pos demo tenant...");
    await pos.query(
      `insert into "tenants" (id, name, slug, tier, addons, "enabledTraits")
       values ($1, 'Demo Cafe', 'demo-cafe', 'SCALE', '{custom_reporting}', '{hospitality.tables,hospitality.pickup_links,retail.variant_matrix}')
       on conflict (slug) do nothing`,
      [tenantId],
    );
    // If the tenant already existed (re-run / upgrade), fetch its real id
    // rather than trusting the freshly-generated one above.
    const { rows } = await pos.query(`select id from "tenants" where slug = 'demo-cafe'`);
    const realTenantId = rows[0].id as string;

    await pos.query(
      `insert into "users" (id, "tenantId", email, "passwordHash", role)
       values ($1, $2, 'owner@demo.cafe', $3, 'owner')
       on conflict ("tenantId", email) do nothing`,
      [posUserId, realTenantId, passwordHash],
    );
    await pos.query(
      `insert into "categories" (id, "tenantId", name, "sortOrder")
       values ($1, $2, 'Apparel', 1)
       on conflict do nothing`,
      [categoryId, realTenantId],
    );
    const existingProduct = await pos.query(
      `select id from "products" where "tenantId" = $1 and name = 'Grit Tee'`,
      [realTenantId],
    );
    if (existingProduct.rows.length === 0) {
      await pos.query(
        `insert into "products" (id, "tenantId", "categoryId", name, description, "basePrice", "isActive")
         values ($1, $2, (select id from "categories" where "tenantId" = $2 and name = 'Apparel' limit 1), 'Grit Tee', 'Demo variant-matrix product', 25.0, true)`,
        [productId, realTenantId],
      );
      await pos.query(
        `insert into "variants" (id, "productId", name, "priceDelta", "tenantId", sku, attributes)
         values ($1, $2, 'Black / L', 0, $3, 'SKU-BLK-L', '{"size":"L","color":"black"}')`,
        [variantId, productId, realTenantId],
      );
    }
    log(`grit-pos seeded. organization_id=${realTenantId}`);

    const inv = new Client({ connectionString: inventoryUrl });
    await inv.connect();
    try {
      log("Seeding grit-inventory demo tenant (same organization_id)...");
      await inv.query(
        `insert into "Tenant" (id, name, slug, tier, addons)
         values ($1, 'Demo Cafe', 'demo-cafe', 'SCALE', '{custom_reporting}')
         on conflict (id) do nothing`,
        [realTenantId],
      );
      const storeId = crypto.randomUUID();
      await inv.query(
        `insert into "Store" (id, "tenantId", name, type, "isDefault")
         values ($1, $2, 'Main Store', 'retail', true)
         on conflict do nothing`,
        [storeId, realTenantId],
      );
      const invUserId = crypto.randomUUID();
      await inv.query(
        `insert into "User" (id, "tenantId", "storeId", email, "passwordHash", name, role)
         values ($1, $2, $3, 'admin@demo.cafe', $4, 'Demo Admin', 'OWNER')
         on conflict do nothing`,
        [invUserId, realTenantId, storeId, passwordHash],
      );
      log("grit-inventory seeded.");
    } finally {
      await inv.end();
    }
  } finally {
    await pos.end();
  }
}

export interface DatabaseUrls {
  pos: string;
  inventory: string;
  manpower: string;
  taskboard: string;
}

export function isFirstRun(): boolean {
  return !fs.existsSync(setupMarkerFile);
}

/** Runs once, on true first launch. Idempotent per-step (every insert above
 * uses ON CONFLICT DO NOTHING / an existence check), but only called once
 * in the normal flow — see main.ts. */
export async function runFirstTimeSetup(urls: DatabaseUrls, seedDemoDataFlag: boolean): Promise<void> {
  log("=== First-run setup starting ===");
  await runPrismaMigrateDeploy("grit-pos", urls.pos);
  await runPrismaMigrateDeploy("grit-inventory", urls.inventory);
  await runPrismaMigrateDeploy("grit-manpower", urls.manpower);
  await applyTaskboardSchema(urls.taskboard);

  if (seedDemoDataFlag) {
    await seedDemoData(urls.pos, urls.inventory);
  }

  fs.mkdirSync(path.dirname(setupMarkerFile), { recursive: true });
  fs.writeFileSync(setupMarkerFile, JSON.stringify({ completedAt: new Date().toISOString() }, null, 2));
  log("=== First-run setup complete ===");
}
