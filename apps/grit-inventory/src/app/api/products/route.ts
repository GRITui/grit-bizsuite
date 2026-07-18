import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, requireApiSession } from "@/lib/api";

const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  initialVariant: z
    .object({
      sku: z.string().min(1),
      name: z.string().min(1),
      price: z.number().nonnegative(),
      quantityOnHand: z.number().int().min(0).default(0),
      reorderThreshold: z.number().int().min(0).default(0),
    })
    .optional(),
});

export async function GET() {
  const session = await requireApiSession();
  const products = await db.product.findMany({
    where: { tenantId: session.tenantId },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ products });
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  const body = await request.json().catch(() => null);
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid product");
  }

  const { name, description, initialVariant } = parsed.data;

  try {
    const product = await db.product.create({
      data: {
        tenantId: session.tenantId,
        name,
        description,
        ...(initialVariant && {
          variants: {
            create: {
              tenantId: session.tenantId,
              sku: initialVariant.sku,
              name: initialVariant.name,
              price: initialVariant.price,
              quantityOnHand: initialVariant.quantityOnHand,
              reorderThreshold: initialVariant.reorderThreshold,
            },
          },
        }),
      },
      include: { variants: true },
    });

    if (initialVariant && initialVariant.quantityOnHand > 0) {
      const variant = product.variants[0];
      await db.stockMovement.create({
        data: {
          tenantId: session.tenantId,
          storeId: session.storeId,
          variantId: variant.id,
          delta: initialVariant.quantityOnHand,
          reason: "manual_adjustment",
          note: "Initial stock on product creation",
          createdById: session.sub,
        },
      });
    }

    return NextResponse.json({ product }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return apiError("A variant with that SKU already exists", 409);
    }
    throw err;
  }
}
