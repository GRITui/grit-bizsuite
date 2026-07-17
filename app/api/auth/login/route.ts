import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";

interface LoginBody {
  slug?: string;
  email?: string;
  password?: string;
}

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { slug, email, password } = body;
  if (!slug || !email || !password) {
    return NextResponse.json(
      { error: "slug, email, and password are all required" },
      { status: 400 },
    );
  }

  // Generic "invalid credentials" message throughout — never reveal which
  // part (tenant/email/password) was wrong.
  const invalid = () =>
    NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return invalid();

  const user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: email.toLowerCase() } },
  });
  if (!user) return invalid();

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) return invalid();

  await createSession({
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
  });

  return NextResponse.json({
    user: { id: user.id, email: user.email, role: user.role },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
  });
}
