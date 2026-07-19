-- CreateTable
CREATE TABLE "UnmatchedSaleItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "orderReference" TEXT,
    "eventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,

    CONSTRAINT "UnmatchedSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnmatchedSaleItem_tenantId_resolvedAt_idx" ON "UnmatchedSaleItem"("tenantId", "resolvedAt");

-- CreateIndex
CREATE INDEX "UnmatchedSaleItem_tenantId_sku_idx" ON "UnmatchedSaleItem"("tenantId", "sku");

-- AddForeignKey
ALTER TABLE "UnmatchedSaleItem" ADD CONSTRAINT "UnmatchedSaleItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
