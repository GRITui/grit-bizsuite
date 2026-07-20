import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

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
        { error: "Payroll period is already finalized" },
        { status: 409 },
      );
    }

    const updated = await prisma.payrollPeriod.update({
      where: { id: period.id },
      data: { status: "finalized", finalizedAt: new Date() },
    });

    return NextResponse.json({ period: updated });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
