-- AlterTable
ALTER TABLE "LeadProofArtifact"
ADD COLUMN "certificateUrl" TEXT,
ADD COLUMN "integrityHash" TEXT,
ADD COLUMN "signature" TEXT,
ADD COLUMN "algorithm" TEXT,
ADD COLUMN "keyId" TEXT,
ADD COLUMN "issuedAt" TIMESTAMP(3),
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "retainedAt" TIMESTAMP(3),
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "providerMetadata" JSONB,
ADD COLUMN "failureReasons" JSONB;

-- CreateIndex
CREATE INDEX "LeadProofArtifact_certificateUrl_idx"
ON "LeadProofArtifact"("certificateUrl");

-- CreateIndex
CREATE INDEX "LeadProofArtifact_integrityHash_idx"
ON "LeadProofArtifact"("integrityHash");
