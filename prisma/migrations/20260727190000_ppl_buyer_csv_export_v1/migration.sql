-- PPL aged inventory beta: immutable buyer-safe CSV export packages

CREATE TABLE "LeadDeliveryExportPackage" (
    "id" TEXT NOT NULL,
    "leadOrderId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv_v1',
    "rowCount" INTEGER NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fieldSchemaVersion" TEXT NOT NULL,
    "allocationIdsJson" JSONB NOT NULL DEFAULT '[]',
    "csvContent" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDeliveryExportPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadDeliveryExportPackage_idempotencyKey_key" ON "LeadDeliveryExportPackage"("idempotencyKey");

CREATE INDEX "LeadDeliveryExportPackage_leadOrderId_createdAt_idx" ON "LeadDeliveryExportPackage"("leadOrderId", "createdAt");

CREATE INDEX "LeadDeliveryExportPackage_clientAccountId_createdAt_idx" ON "LeadDeliveryExportPackage"("clientAccountId", "createdAt");

CREATE INDEX "LeadDeliveryExportPackage_contentSha256_idx" ON "LeadDeliveryExportPackage"("contentSha256");

ALTER TABLE "LeadDeliveryExportPackage" ADD CONSTRAINT "LeadDeliveryExportPackage_leadOrderId_fkey" FOREIGN KEY ("leadOrderId") REFERENCES "LeadOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
