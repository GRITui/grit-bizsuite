import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

interface CreatePayrollPeriodBody {
  startDate?: string;
  endDate?: string;
}

export async function GET() {
  try {
    const tenantId = await requireTenantId();

    const periods = await prisma.payrollPeriod.findMany({
      where: { tenantId },
      include: {
        _count: { select: { records: true } },
      },
      orderBy: { startDate: "desc" },
    });

    return NextResponse.json({
      periods: periods.map(({ _count, ...period }) => ({
        ...period,
        recordCount: _count.records,
      })),
    });
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

    let body: CreatePayrollPeriodBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { startDate, endDate } = body;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 },
      );
    }

    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);

    if (Number.isNaN(parsedStartDate.getTime()) || Number.isNaN(parsedEndDate.getTime())) {
      return NextResponse.json(
        { error: "startDate and endDate must be valid dates" },
        { status: 400 },
      );
    }

    if (parsedStartDate >= parsedEndDate) {
      return NextResponse.json(
        { error: "startDate must be before endDate" },
        { status: 400 },
      );
    }

    const period = await prisma.payrollPeriod.create({
      data: {
        tenantId,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
      },
    });

    return NextResponse.json({ period }, { status: 201 });
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
