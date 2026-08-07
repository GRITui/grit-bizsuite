-- AlterTable
ALTER TABLE "ParcelLabel" ADD COLUMN     "carrierTrackingId" TEXT,
ADD COLUMN     "carrierStatus" TEXT,
ADD COLUMN     "carrierStatusUpdatedAt" TIMESTAMP(3);
