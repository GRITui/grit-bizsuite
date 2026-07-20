import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, requireTenantId } from "@/lib/tenant";

interface CreateDocumentBody {
  type?: string;
  fileName?: string;
  fileUrl?: string;
  expiresAt?: string;
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

    let body: CreateDocumentBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { type, fileName, fileUrl, expiresAt } = body;

    if (!type || !fileName) {
      return NextResponse.json({ error: "type and fileName are required" }, { status: 400 });
    }

    let parsedExpiresAt: Date | null = null;
    if (expiresAt) {
      parsedExpiresAt = new Date(expiresAt);
      if (Number.isNaN(parsedExpiresAt.getTime())) {
        return NextResponse.json({ error: "expiresAt must be a valid date" }, { status: 400 });
      }
    }

    const document = await prisma.employeeDocument.create({
      data: {
        employeeId: id,
        type,
        fileName,
        fileUrl: fileUrl || null,
        expiresAt: parsedExpiresAt,
      },
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
