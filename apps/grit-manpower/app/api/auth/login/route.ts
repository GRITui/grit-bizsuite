import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

interface LoginBody {
  email?: string;
  password?: string;
}

export async function POST(request: Request) {
  const limitResult = rateLimit(request, { limit: 10, windowMs: 60_000 });
  if (!limitResult.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  }

  let body: LoginBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  // Multi-tenant collision tradeoff: email isn't globally unique (it's
  // unique per-tenant, see the `@@unique([tenantId, email])` constraint), so
  // this picks whichever tenant's account matches first. Fine for the MVP —
  // a real multi-tenant login would need a tenant picker if the same email
  // signs up under two different businesses.
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createSession({
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
  });

  return NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } });
}
