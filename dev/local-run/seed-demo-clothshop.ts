// Converts the existing "demo" tenant (demo@example.com / demo1234, the
// account handed out for product demos) into a clothing-shop demo: retail
// traits instead of hospitality ones, plus a small catalog of apparel
// products with size/color variants.
//
// Run against the target database (local or a real Neon connection string
// pulled via `vercel env pull`):
//   DATABASE_URL=postgresql://... npx tsx dev/local-run/seed-demo-clothshop.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/grit-pos/app/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function getOrCreateCategory(tenantId: string, name: string, sortOrder: number) {
  const existing = await prisma.category.findFirst({ where: { tenantId, name } });
  if (existing) return existing;
  return prisma.category.create({ data: { tenantId, name, sortOrder } });
}

async function upsertProduct(
  tenantId: string,
  categoryId: string,
  name: string,
  description: string,
  basePrice: number,
  variants: Array<{ size: string; color: string; sku: string; priceDelta?: number }>,
) {
  const existing = await prisma.product.findFirst({ where: { tenantId, name } });
  if (existing) return existing;

  return prisma.product.create({
    data: {
      tenantId,
      categoryId,
      name,
      description,
      basePrice,
      isActive: true,
      variants: {
        create: variants.map((v) => ({
          tenantId,
          name: `${v.color} / ${v.size}`,
          priceDelta: v.priceDelta ?? 0,
          sku: v.sku,
          attributes: { size: v.size, color: v.color },
        })),
      },
    },
  });
}

async function main() {
  const tenant = await prisma.tenant.update({
    where: { slug: "demo" },
    data: {
      name: "Demo Apparel Co.",
      tier: "GROWTH",
      enabledTraits: ["retail.variant_matrix"],
    },
  });

  const categories = {
    tops: await getOrCreateCategory(tenant.id, "Tops", 1),
    bottoms: await getOrCreateCategory(tenant.id, "Bottoms", 2),
    outerwear: await getOrCreateCategory(tenant.id, "Outerwear", 3),
    accessories: await getOrCreateCategory(tenant.id, "Accessories", 4),
  };

  await upsertProduct(
    tenant.id,
    categories.tops.id,
    "Essential Crew Tee",
    "100% combed cotton, regular fit crew neck.",
    18.0,
    [
      { size: "S", color: "White", sku: "TEE-WHT-S" },
      { size: "M", color: "White", sku: "TEE-WHT-M" },
      { size: "L", color: "White", sku: "TEE-WHT-L" },
      { size: "S", color: "Black", sku: "TEE-BLK-S" },
      { size: "M", color: "Black", sku: "TEE-BLK-M" },
      { size: "L", color: "Black", sku: "TEE-BLK-L" },
    ],
  );

  await upsertProduct(
    tenant.id,
    categories.tops.id,
    "Linen Button-Down",
    "Lightweight linen-blend shirt, relaxed fit.",
    38.0,
    [
      { size: "M", color: "Sand", sku: "LNB-SND-M" },
      { size: "L", color: "Sand", sku: "LNB-SND-L" },
      { size: "M", color: "Sky Blue", sku: "LNB-SKY-M" },
      { size: "L", color: "Sky Blue", sku: "LNB-SKY-L" },
    ],
  );

  await upsertProduct(
    tenant.id,
    categories.bottoms.id,
    "Slim Fit Jeans",
    "Mid-rise stretch denim, slim through the leg.",
    45.0,
    [
      { size: "30", color: "Indigo", sku: "JNS-IND-30" },
      { size: "32", color: "Indigo", sku: "JNS-IND-32" },
      { size: "34", color: "Indigo", sku: "JNS-IND-34" },
      { size: "32", color: "Black", sku: "JNS-BLK-32" },
      { size: "34", color: "Black", sku: "JNS-BLK-34" },
    ],
  );

  await upsertProduct(
    tenant.id,
    categories.outerwear.id,
    "Canvas Chore Jacket",
    "Heavyweight cotton canvas, brass snap buttons.",
    68.0,
    [
      { size: "S", color: "Olive", sku: "CCJ-OLV-S" },
      { size: "M", color: "Olive", sku: "CCJ-OLV-M" },
      { size: "L", color: "Olive", sku: "CCJ-OLV-L" },
      { size: "M", color: "Stone", sku: "CCJ-STN-M" },
      { size: "L", color: "Stone", sku: "CCJ-STN-L" },
    ],
  );

  await upsertProduct(
    tenant.id,
    categories.accessories.id,
    "Ribbed Wool Beanie",
    "One size, merino wool blend.",
    15.0,
    [
      { size: "One size", color: "Charcoal", sku: "BNI-CHR-OS" },
      { size: "One size", color: "Camel", sku: "BNI-CML-OS" },
    ],
  );

  console.log(`Cloth-shop demo seeded. tenant_id=${tenant.id}, slug=${tenant.slug}`);
  console.log("Login: demo@example.com / demo1234");
}

main().finally(() => prisma.$disconnect());
