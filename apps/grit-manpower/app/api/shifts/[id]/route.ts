import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

const SHIFT_STATUSES = ["scheduled", "published", "completed", "cancelled"] as const;
type ShiftStatusInput = (typeof SHIFT_STATUSES)[number];

interface UpdateShiftBody {
  employeeId?: string | null;
  role?: string | null;
  startsAt?: string;
  endsAt?: string;
  status?: string;
  notes?: string | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await requireTenantId();
    const { id } = await params;

    const existing = await prisma.shift.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    let body: UpdateShiftBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { employeeId, role, startsAt, endsAt, status, notes } = body;

    if (status !== undefined && !SHIFT_STATUSES.includes(status as ShiftStatusInput)) {
      return NextResponse.json(
        { error: `status must be one of: ${SHIFT_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }

    const nextStartsAt = startsAt !== undefined ? new Date(startsAt) : existing.startsAt;
    const nextEndsAt = endsAt !== undefined ? new Date(endsAt) : existing.endsAt;
    if (startsAt !== undefined && Number.isNaN(nextStartsAt.getTime())) {
      return NextResponse.json({ error: "startsAt must be a valid ISO date string" }, { status: 400 });
    }
    if (endsAt !== undefined && Number.isNaN(nextEndsAt.getTime())) {
      return NextResponse.json({ error: "endsAt must be a valid ISO date string" }, { status: 400 });
    }
    if (nextStartsAt >= nextEndsAt) {
      return NextResponse.json({ error: "startsAt must be before endsAt" }, { status: 400 });
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

    const shift = await prisma.shift.update({
      where: { id },
      data: {
        ...(employeeId !== undefined ? { employeeId: employeeId || null } : {}),
        ...(role !== undefined ? { role: role || null } : {}),
        ...(startsAt !== undefined ? { startsAt: nextStartsAt } : {}),
        ...(endsAt !== undefined ? { endsAt: nextEndsAt } : {}),
        ...(status !== undefined ? { status: status as ShiftStatusInput } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
      },
      include: {
        location: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({ shift });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await requireTenantId();
    const { id } = await params;

    const existing = await prisma.shift.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    await prisma.shift.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
