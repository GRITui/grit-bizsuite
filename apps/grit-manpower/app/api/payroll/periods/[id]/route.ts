import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await requireTenantId();
    const { id } = await params;

    const period = await prisma.payrollPeriod.findFirst({
      where: { id, tenantId },
      include: {
        records: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: [
            { employee: { lastName: "asc" } },
            { employee: { firstName: "asc" } },
          ],
        },
      },
    });

    if (!period) {
      return NextResponse.json({ error: "Payroll period not found" }, { status: 404 });
    }

    return NextResponse.json({ period });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
