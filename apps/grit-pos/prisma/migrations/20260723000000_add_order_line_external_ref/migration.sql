-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "externalRef" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_externalRef_key" ON "order_lines"("externalRef");
