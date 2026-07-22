-- Adds DailyReconciliation.vatLiabilityTotal: the VAT liability for the
-- business date (sum of computeOrderVat's vatAmount across every Order
-- closed that day), snapshotted at close time alongside the existing
-- cash/card/qrPay/stripe totals. Defaults existing rows to 0 since we have
-- no way to retroactively recompute VAT for reconciliations closed before
-- this column existed (those rows predate the VAT model itself in some
-- cases) — only reconciliations closed after this migration carry a real
-- figure.
ALTER TABLE "daily_reconciliations" ADD COLUMN "vatLiabilityTotal" DECIMAL(10,2) NOT NULL DEFAULT 0;
