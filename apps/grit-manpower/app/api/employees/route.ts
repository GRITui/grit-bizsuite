import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import type { EmploymentStatus } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

interface CreateEmployeeBody {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  position?: string;
  department?: string;
  hireDate?: string;
  status?: EmploymentStatus;
  locationId?: string;
}

export async function GET() {
  try {
    const tenantId = await requireTenantId();

    const employees = await prisma.employee.findMany({
      where: { tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        position: true,
        department: true,
        hireDate: true,
        status: true,
        locationId: true,
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    return NextResponse.json({ employees });
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

    let body: CreateEmployeeBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { firstName, lastName, position, hireDate, email, phone, department, locationId, status } = body;

    if (!firstName || !lastName || !position || !hireDate) {
      return NextResponse.json(
        { error: "firstName, lastName, position, and hireDate are all required" },
        { status: 400 },
      );
    }

    const parsedHireDate = new Date(hireDate);
    if (Number.isNaN(parsedHireDate.getTime())) {
      return NextResponse.json({ error: "hireDate must be a valid date" }, { status: 400 });
    }

    if (locationId) {
      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
      });
      if (!location) {
        return NextResponse.json({ error: "locationId not found" }, { status: 400 });
      }
    }

    const employee = await prisma.employee.create({
      data: {
        tenantId,
        firstName,
        lastName,
        position,
        hireDate: parsedHireDate,
        email: email || null,
        phone: phone || null,
        department: department || null,
        locationId: locationId || null,
        status: status ?? "active",
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        position: true,
        department: true,
        hireDate: true,
        status: true,
        locationId: true,
        location: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ employee }, { status: 201 });
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
