import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

interface CreateWageRateBody {
  hourlyRate?: number | string;
  effectiveFrom?: string;
  overtimeMultiplier?: number | string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await requireTenantId();
    const { id } = await params;

    const employee = await prisma.employee.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    let body: CreateWageRateBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { hourlyRate, effectiveFrom, overtimeMultiplier } = body;

    if (hourlyRate === undefined || hourlyRate === null || !effectiveFrom) {
      return NextResponse.json(
        { error: "hourlyRate and effectiveFrom are required" },
        { status: 400 },
      );
    }

    const parsedHourlyRate = Number(hourlyRate);
    if (Number.isNaN(parsedHourlyRate)) {
      return NextResponse.json({ error: "hourlyRate must be a number" }, { status: 400 });
    }

    const parsedEffectiveFrom = new Date(effectiveFrom);
    if (Number.isNaN(parsedEffectiveFrom.getTime())) {
      return NextResponse.json({ error: "effectiveFrom must be a valid date" }, { status: 400 });
    }

    let parsedOvertimeMultiplier: number | undefined;
    if (overtimeMultiplier !== undefined && overtimeMultiplier !== null && overtimeMultiplier !== "") {
      parsedOvertimeMultiplier = Number(overtimeMultiplier);
      if (Number.isNaN(parsedOvertimeMultiplier)) {
        return NextResponse.json({ error: "overtimeMultiplier must be a number" }, { status: 400 });
      }
    }

    const wageRate = await prisma.wageRate.create({
      data: {
        employeeId: id,
        hourlyRate: parsedHourlyRate,
        effectiveFrom: parsedEffectiveFrom,
        ...(parsedOvertimeMultiplier !== undefined ? { overtimeMultiplier: parsedOvertimeMultiplier } : {}),
      },
    });

    return NextResponse.json({ wageRate }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
