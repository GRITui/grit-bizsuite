import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

// Bootstraps a brand-new tenant account: creates the Tenant and its
// first (owner) User together, in one transaction, then logs that user in.

interface RegisterBody {
  tenantName?: string;
  slug?: string;
  email?: string;
  password?: string;
}

// Unauthenticated, DB-writing endpoint — rate limit it so it can't be used
// to spam-create tenants/accounts.
export async function POST(request: Request) {
  const limitResult = rateLimit(request, { limit: 5, windowMs: 60_000 });
  if (!limitResult.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  }

  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tenantName, slug, email, password } = body;

  if (!tenantName || !slug || !email || !password) {
    return NextResponse.json(
      { error: "tenantName, slug, email, and password are all required" },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: "slug must be lowercase letters, numbers, and hyphens only" },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);

  try {
    const { tenant, user } = await prisma.$transaction(async (tx) => {
      // MVP launch is free for every signup: stamp full entitlements at
      // creation rather than stripping out the tier/addon gates themselves,
      // so introducing real pricing later is a one-line default change, not
      // a rewrite of @grit/passport's entitlement checks.
      const tenant = await tx.tenant.create({
        data: { name: tenantName, slug, tier: "SCALE", addons: ["custom_reporting"] },
      });
      // Every tenant needs a default Store so `location_id` in outbound
      // events resolves to a real Store id (see Store's schema doc-comment
      // and lib/stores.ts resolveOrderStoreId) rather than falling back to
      // the tenant id. Single-store-only for now — no store-picker UI yet.
      await tx.store.create({
        data: { tenantId: tenant.id, name: "Main", code: "MAIN", isDefault: true },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: email.toLowerCase(),
          passwordHash,
          role: "owner",
        },
      });
      return { tenant, user };
    });

    await createSession({
      id: user.id,
      tenantId: tenant.id,
      role: user.role,
      email: user.email,
      tenant: { tier: tenant.tier, addons: tenant.addons },
    });

    return NextResponse.json(
      {
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
        user: { id: user.id, email: user.email, role: user.role },
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "That tenant slug is already taken" },
        { status: 409 },
      );
    }
    throw error;
  }
}
