import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createSessionCookie } from "@/lib/session";

// Bootstraps a brand-new tenant account: Tenant + a default Store + the
// first (OWNER) User, in one transaction, then logs that user in. Mirrors
// grit-pos's /api/auth/register.

const registerSchema = z.object({
  tenantName: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and hyphens only"),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const { tenantName, slug, name, email, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  try {
    const { tenant, store, user } = await db.$transaction(async (tx) => {
      // MVP launch is free for every signup: stamp full entitlements at
      // creation rather than stripping out the tier/addon gates, so
      // introducing real pricing later is a one-line default change.
      const tenant = await tx.tenant.create({
        data: { name: tenantName, slug, tier: "SCALE", addons: ["custom_reporting"] },
      });
      const store = await tx.store.create({
        data: { tenantId: tenant.id, name: "Main Store", type: "retail", isDefault: true },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          storeId: store.id,
          email: email.toLowerCase(),
          passwordHash,
          name,
          role: "OWNER",
        },
      });
      return { tenant, store, user };
    });

    await createSessionCookie({
      sub: user.id,
      tenantId: tenant.id,
      storeId: store.id,
      role: user.role,
      email: user.email,
      name: user.name,
    });

    return NextResponse.json(
      {
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : "";
      const message = target.includes("email")
        ? "That email is already registered"
        : "That business slug is already taken";
      return NextResponse.json({ error: message }, { status: 409 });
    }
    throw error;
  }
}
