import { requireTenantId } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import StoresApp from "@/components/stores/StoresApp";
import type { StoreDTO } from "@/components/stores/types";

export default async function StoresPage() {
  // layout.tsx already redirects unauthenticated staff to /login.
  const tenantId = await requireTenantId();

  const stores = await prisma.store.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  const initialStores: StoreDTO[] = stores.map((store) => ({
    id: store.id,
    name: store.name,
    code: store.code,
    isDefault: store.isDefault,
    createdAt: store.createdAt.toISOString(),
  }));

  return <StoresApp initialStores={initialStores} />;
}
