import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

const { Decimal } = Prisma;

// MVP simplification: overtime is computed per payroll period, not per week
// (which is how overtime law usually works). Every hour worked in the
// period beyond a flat 40-hour threshold is treated as overtime. Revisit
// once real labor-law compliance is in scope.
const REGULAR_HOURS_THRESHOLD = 40;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await requireTenantId();
    const { id } = await params;

    const period = await prisma.payrollPeriod.findFirst({
      where: { id, tenantId },
    });

    if (!period) {
      return NextResponse.json({ error: "Payroll period not found" }, { status: 404 });
    }

    if (period.status === "finalized") {
      return NextResponse.json(
        { error: "Cannot regenerate a finalized payroll period" },
        { status: 409 },
      );
    }

    const records = await prisma.$transaction(async (tx) => {
      const employees = await tx.employee.findMany({
        where: { tenantId, status: "active" },
        select: { id: true },
      });

      const generated = [];

      for (const employee of employees) {
        const timeEntries = await tx.timeEntry.findMany({
          where: {
            tenantId,
            employeeId: employee.id,
            status: "closed",
            clockOut: { not: null },
            clockIn: { gte: period.startDate, lt: period.endDate },
          },
          select: { clockIn: true, clockOut: true, breakMinutes: true },
        });

        let totalMinutes = 0;
        for (const entry of timeEntries) {
          if (!entry.clockOut) continue;
          const workedMs = entry.clockOut.getTime() - entry.clockIn.getTime();
          const workedMinutes = workedMs / (1000 * 60) - entry.breakMinutes;
          totalMinutes += Math.max(workedMinutes, 0);
        }

        // No hours worked this period — nothing to pay, skip creating a
        // record (also spares us a wage-rate lookup for idle employees).
        if (totalMinutes <= 0) continue;

        const wageRate = await tx.wageRate.findFirst({
          where: { employeeId: employee.id, effectiveFrom: { lte: period.startDate } },
          orderBy: { effectiveFrom: "desc" },
        });

        // No applicable wage rate on file — can't compute pay, so skip this
        // employee rather than failing the whole generation run.
        if (!wageRate) continue;

        const totalHours = new Decimal(totalMinutes).div(60);
        const regularHours = Decimal.min(totalHours, REGULAR_HOURS_THRESHOLD);
        const overtimeHours = Decimal.max(totalHours.sub(REGULAR_HOURS_THRESHOLD), 0);

        const grossPay = regularHours
          .mul(wageRate.hourlyRate)
          .add(overtimeHours.mul(wageRate.hourlyRate).mul(wageRate.overtimeMultiplier));

        const record = await tx.payrollRecord.upsert({
          where: {
            payrollPeriodId_employeeId: {
              payrollPeriodId: period.id,
              employeeId: employee.id,
            },
          },
          create: {
            payrollPeriodId: period.id,
            employeeId: employee.id,
            regularHours,
            overtimeHours,
            hourlyRate: wageRate.hourlyRate,
            grossPay,
          },
          update: {
            regularHours,
            overtimeHours,
            hourlyRate: wageRate.hourlyRate,
            grossPay,
          },
          include: {
            employee: { select: { id: true, firstName: true, lastName: true } },
          },
        });

        generated.push(record);
      }

      return generated;
    });

    return NextResponse.json({ records });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
