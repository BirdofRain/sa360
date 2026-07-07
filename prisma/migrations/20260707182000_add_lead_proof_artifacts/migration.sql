-- CreateEnum
CREATE TYPE "LeadProofArtifactProvider" AS ENUM (
  'leadcapture_io',
  'leadconduit_facebook',
  'meta_lead_ads',
  'trustedform',
  'manual',
  'unknown'
);

-- CreateEnum
CREATE TYPE "LeadProofArtifactType" AS ENUM (
  'CONSENT_CERTIFICATE',
  'CRYPTOGRAPHIC_INTEGRITY'
);

-- CreateEnum
CREATE TYPE "LeadProofArtifactStatus" AS ENUM (
  'CAPTURED',
  'MISSING',
  'NEEDS_REVIEW'
);

-- CreateTable
CREATE TABLE "LeadProofArtifact" (
  "id" TEXT NOT NULL,
  "leadProofId" TEXT NOT NULL,
  "provider" "LeadProofArtifactProvider" NOT NULL,
  "artifactType" "LeadProofArtifactType" NOT NULL,
  "status" "LeadProofArtifactStatus" NOT NULL DEFAULT 'CAPTURED',
  "externalReference" TEXT,
  "capturedAt" TIMESTAMP(3),
  "artifactFingerprint" TEXT NOT NULL,
  "rawArtifactPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LeadProofArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadProofArtifact_leadProofId_artifactFingerprint_key"
ON "LeadProofArtifact"("leadProofId", "artifactFingerprint");

-- CreateIndex
CREATE INDEX "LeadProofArtifact_leadProofId_provider_artifactType_idx"
ON "LeadProofArtifact"("leadProofId", "provider", "artifactType");

-- CreateIndex
CREATE INDEX "LeadProofArtifact_status_updatedAt_idx"
ON "LeadProofArtifact"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "LeadProofArtifact"
ADD CONSTRAINT "LeadProofArtifact_leadProofId_fkey"
FOREIGN KEY ("leadProofId") REFERENCES "LeadProof"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
