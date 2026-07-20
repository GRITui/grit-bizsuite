import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

interface CreateLocationBody {
  name?: string;
}

export async function GET() {
  try {
    const tenantId = await requireTenantId();

    const locations = await prisma.location.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ locations });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await requireTenantId();

    let body: CreateLocationBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { name } = body;
    if (!name || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const location = await prisma.location.create({
      data: { tenantId, name: name.trim() },
      select: { id: true, name: true },
    });

    return NextResponse.json({ location }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
