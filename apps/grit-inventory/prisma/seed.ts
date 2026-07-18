import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  const tenant = await db.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Demo Tenant", slug: "demo" },
  });

  const store = await db.store.upsert({
    where: { id: `${tenant.id}-main-store` },
    update: {},
    create: {
      id: `${tenant.id}-main-store`,
      tenantId: tenant.id,
      name: "Main Store",
      isDefault: true,
    },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@demo.invento";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "changeme123";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      tenantId: tenant.id,
      storeId: store.id,
      email: adminEmail,
      passwordHash,
      name: "Admin",
      role: "OWNER",
    },
  });

  const product = await db.product.upsert({
    where: { id: `${tenant.id}-demo-product` },
    update: {},
    create: {
      id: `${tenant.id}-demo-product`,
      tenantId: tenant.id,
      name: "Sample T-Shirt",
      description: "Seed data for local development.",
    },
  });

  await db.variant.upsert({
    where: { tenantId_sku: { tenantId: tenant.id, sku: "TSHIRT-M-BLK" } },
    update: {},
    create: {
      tenantId: tenant.id,
      productId: product.id,
      sku: "TSHIRT-M-BLK",
      name: "Medium / Black",
      price: 19.99,
      quantityOnHand: 50,
      reorderThreshold: 10,
    },
  });

  await db.variant.upsert({
    where: { tenantId_sku: { tenantId: tenant.id, sku: "TSHIRT-L-BLK" } },
    update: {},
    create: {
      tenantId: tenant.id,
      productId: product.id,
      sku: "TSHIRT-L-BLK",
      name: "Large / Black",
      price: 19.99,
      quantityOnHand: 3,
      reorderThreshold: 10,
    },
  });

  console.log(`Seeded tenant "${tenant.slug}". Admin login: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
