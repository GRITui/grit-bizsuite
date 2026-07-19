import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

interface ClockInBody {
  employeeId?: string;
  shiftId?: string;
}

export async function POST(request: Request) {
  try {
    const tenantId = await requireTenantId();

    let body: ClockInBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { employeeId, shiftId } = body;

    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { id: true },
    });
    if (!employee) {
      return NextResponse.json({ error: "employeeId not found" }, { status: 400 });
    }

    const openEntry = await prisma.timeEntry.findFirst({
      where: { tenantId, employeeId, status: "open", clockOut: null },
      select: { id: true },
    });
    if (openEntry) {
      return NextResponse.json(
        { error: "Employee already has an open time entry" },
        { status: 409 },
      );
    }

    const timeEntry = await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId,
        shiftId: shiftId || null,
        clockIn: new Date(),
        status: "open",
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

    return NextResponse.json({ timeEntry }, { status: 201 });
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
