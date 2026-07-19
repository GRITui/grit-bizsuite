import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import type { EmploymentStatus } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

interface UpdateEmployeeBody {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  position?: string;
  department?: string | null;
  locationId?: string | null;
  status?: EmploymentStatus;
  hireDate?: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await requireTenantId();
    const { id } = await params;

    const employee = await prisma.employee.findFirst({
      where: { id, tenantId },
      include: {
        location: true,
        documents: { orderBy: { uploadedAt: "desc" } },
        wageRates: { orderBy: { effectiveFrom: "desc" } },
      },
    });

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    return NextResponse.json({ employee });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await requireTenantId();
    const { id } = await params;

    const existing = await prisma.employee.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    let body: UpdateEmployeeBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { firstName, lastName, email, phone, position, department, locationId, status, hireDate } = body;

    if (locationId) {
      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
      });
      if (!location) {
        return NextResponse.json({ error: "locationId not found" }, { status: 400 });
      }
    }

    let parsedHireDate: Date | undefined;
    if (hireDate !== undefined) {
      parsedHireDate = new Date(hireDate);
      if (Number.isNaN(parsedHireDate.getTime())) {
        return NextResponse.json({ error: "hireDate must be a valid date" }, { status: 400 });
      }
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
        ...(email !== undefined ? { email: email || null } : {}),
        ...(phone !== undefined ? { phone: phone || null } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(department !== undefined ? { department: department || null } : {}),
        ...(locationId !== undefined ? { locationId: locationId || null } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(parsedHireDate !== undefined ? { hireDate: parsedHireDate } : {}),
      },
      include: {
        location: true,
        documents: { orderBy: { uploadedAt: "desc" } },
        wageRates: { orderBy: { effectiveFrom: "desc" } },
      },
    });

    return NextResponse.json({ employee });
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
