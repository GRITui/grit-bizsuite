import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

export async function GET() {
  try {
    const tenantId = await requireTenantId();

    const timeEntries = await prisma.timeEntry.findMany({
      where: { tenantId },
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
      orderBy: { clockIn: "desc" },
      take: 50,
    });

    return NextResponse.json({ timeEntries });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
