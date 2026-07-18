import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { AddVariantForm, VariantTable } from "@/components/variant-manager";
import { ArchiveProductButton, EditProductButton } from "@/components/product-form";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const product = await db.product.findFirst({
    where: { id, tenantId: session.tenantId },
    include: { variants: { orderBy: { createdAt: "asc" } } },
  });

  if (!product) notFound();

  const variants = product.variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    name: v.name,
    price: v.price.toString(),
    quantityOnHand: v.quantityOnHand,
    reorderThreshold: v.reorderThreshold,
    isActive: v.isActive,
  }));

  return (
    <div>
      <PageHeader
        title={product.isActive ? product.name : `${product.name} (inactive)`}
        description={product.description ?? undefined}
        action={
          <div className="flex items-center gap-2">
            <EditProductButton product={{ id: product.id, name: product.name, description: product.description }} />
            <ArchiveProductButton product={{ id: product.id, isActive: product.isActive }} />
          </div>
        }
      />

      <Card className="p-0">
        <div className="p-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Variants</h2>
        </div>
        {variants.length > 0 && <VariantTable variants={variants} />}
        <div className="px-4 pb-4">
          <AddVariantForm productId={product.id} />
        </div>
      </Card>
    </div>
  );
}
