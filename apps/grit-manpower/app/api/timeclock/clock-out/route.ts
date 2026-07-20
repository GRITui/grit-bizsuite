import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

interface ClockOutBody {
  employeeId?: string;
  breakMinutes?: number;
}

export async function POST(request: Request) {
  try {
    const tenantId = await requireTenantId();

    let body: ClockOutBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { employeeId, breakMinutes } = body;

    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }

    if (breakMinutes !== undefined && (typeof breakMinutes !== "number" || breakMinutes < 0)) {
      return NextResponse.json(
        { error: "breakMinutes must be a non-negative number" },
        { status: 400 },
      );
    }

    const openEntry = await prisma.timeEntry.findFirst({
      where: { tenantId, employeeId, status: "open", clockOut: null },
      select: { id: true },
    });
    if (!openEntry) {
      return NextResponse.json(
        { error: "No open time entry for this employee" },
        { status: 404 },
      );
    }

    const timeEntry = await prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: {
        clockOut: new Date(),
        status: "closed",
        ...(breakMinutes !== undefined ? { breakMinutes } : {}),
      },
      select: {
        id: true,
        employeeId: true,
        shiftId: true,
        clockIn: true,
        clockOut: true,
        breakMinutes: true,
        status: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({ timeEntry });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
