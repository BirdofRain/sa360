-- Durable customer notification intent/result for a released delivery package.
-- spreadsheetDeliveredAt remains the sole release / customer-download source of truth.
-- Notification is secondary: these columns must not gate portal access.

ALTER TABLE "LeadDeliveryExportPackage"
ADD COLUMN "customerReleaseNotifyStatus" TEXT,
ADD COLUMN "customerReleaseNotifyClaimedAt" TIMESTAMP(3),
ADD COLUMN "customerReleaseNotifiedAt" TIMESTAMP(3),
ADD COLUMN "customerReleaseNotifyError" TEXT,
ADD COLUMN "customerReleaseNotifyProviderId" TEXT;

CREATE INDEX "LeadDeliveryExportPackage_customerReleaseNotifyStatus_idx"
ON "LeadDeliveryExportPackage"("customerReleaseNotifyStatus");
