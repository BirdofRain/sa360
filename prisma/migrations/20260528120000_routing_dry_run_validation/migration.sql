-- AlterTable
ALTER TABLE "RoutingDryRunDecision" ADD COLUMN     "legacyDeliveredClientAccountId" TEXT,
ADD COLUMN     "legacyDeliveredSubaccountIdGhl" TEXT,
ADD COLUMN     "legacyDeliveryContactIdGhl" TEXT,
ADD COLUMN     "legacyDeliveryStatus" TEXT,
ADD COLUMN     "validationStatus" TEXT,
ADD COLUMN     "validationNotes" TEXT,
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validatedBy" TEXT;

-- CreateIndex
CREATE INDEX "RoutingDryRunDecision_validationStatus_createdAt_idx" ON "RoutingDryRunDecision"("validationStatus", "createdAt");
