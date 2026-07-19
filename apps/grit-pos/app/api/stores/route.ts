import { NextResponse } from "next/server";
import { requireTenantId } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { errorResponse, HttpError, readJsonBody } from "../orders/_lib/http";

export interface StoreDTO {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  createdAt: string;
}

function serializeStore(store: {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  createdAt: Date;
}): StoreDTO {
  return {
    id: store.id,
    name: store.name,
    code: store.code,
    isDefault: store.isDefault,
    createdAt: store.createdAt.toISOString(),
  };
}

/** GET /api/stores — list this tenant's Stores, default first. */
export async function GET() {
  try {
    const tenantId = await requireTenantId();
    const stores = await prisma.store.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ stores: stores.map(serializeStore) });
  } catch (err) {
    return errorResponse(err);
  }
}

interface CreateStoreBody {
  name?: string;
  code?: string;
}

/**
 * POST /api/stores — adds another physical location for this tenant.
 * Every tenant already has exactly one Store (`isDefault = true`, created by
 * the Location-model migration's backfill) — this only ever adds additional,
 * non-default stores. There is deliberately no way to change which store is
 * default from here; that's out of scope for this minimal admin page.
 */
export async function POST(request: Request) {
  try {
    const tenantId = await requireTenantId();
    const body = await readJsonBody<CreateStoreBody>(request);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";

    if (!name) throw new HttpError(400, "name is required");
    if (!code) throw new HttpError(400, "code is required");
    if (!/^[A-Z0-9_-]{1,32}$/.test(code)) {
      throw new HttpError(400, "code must be 1-32 characters: letters, digits, - or _");
    }

    const existing = await prisma.store.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    if (existing) {
      throw new HttpError(409, `A store with code "${code}" already exists`);
    }

    const store = await prisma.store.create({
      data: { tenantId, name, code, isDefault: false },
    });

    return NextResponse.json({ store: serializeStore(store) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
