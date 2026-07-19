import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

const DEFAULT_WINDOW_DAYS = 14;

interface CreateShiftBody {
  locationId?: string;
  employeeId?: string | null;
  role?: string | null;
  startsAt?: string;
  endsAt?: string;
  notes?: string | null;
}

export async function GET(request: Request) {
  try {
    const tenantId = await requireTenantId();

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    let from: Date;
    let to: Date;

    if (fromParam || toParam) {
      from = fromParam ? new Date(fromParam) : new Date();
      to = toParam ? new Date(toParam) : new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return NextResponse.json({ error: "from/to must be valid ISO date strings" }, { status: 400 });
      }
    } else {
      from = new Date();
      to = new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    }

    const shifts = await prisma.shift.findMany({
      where: {
        tenantId,
        startsAt: { gte: from, lte: to },
      },
      orderBy: { startsAt: "asc" },
      include: {
        location: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({ shifts });
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

    let body: CreateShiftBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { locationId, employeeId, role, startsAt, endsAt, notes } = body;

    if (!locationId || !startsAt || !endsAt) {
      return NextResponse.json(
        { error: "locationId, startsAt, and endsAt are required" },
        { status: 400 },
      );
    }

    const startsAtDate = new Date(startsAt);
    const endsAtDate = new Date(endsAt);
    if (Number.isNaN(startsAtDate.getTime()) || Number.isNaN(endsAtDate.getTime())) {
      return NextResponse.json({ error: "startsAt/endsAt must be valid ISO date strings" }, { status: 400 });
    }
    if (startsAtDate >= endsAtDate) {
      return NextResponse.json({ error: "startsAt must be before endsAt" }, { status: 400 });
    }

    // Verify the location belongs to this tenant before writing.
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    if (employeeId) {
      const employee = await prisma.employee.findFirst({
        where: { id: employeeId, tenantId },
        select: { id: true },
      });
      if (!employee) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }
    }

    const shift = await prisma.shift.create({
      data: {
        tenantId,
        locationId,
        employeeId: employeeId || null,
        role: role || null,
        startsAt: startsAtDate,
        endsAt: endsAtDate,
        notes: notes || null,
      },
      include: {
        location: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({ shift }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
