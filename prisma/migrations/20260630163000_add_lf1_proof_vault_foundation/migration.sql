-- CreateEnum
CREATE TYPE "LeadProofStatus" AS ENUM ('UNREVIEWED', 'PROOF_ATTACHED', 'PROOF_MISSING', 'NEEDS_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeadVerificationStatus" AS ENUM ('UNCHECKED', 'PASSED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "LeadDuplicateStatus" AS ENUM ('UNCHECKED', 'UNIQUE', 'DUPLICATE_GLOBAL', 'DUPLICATE_BUYER', 'DUPLICATE_RECENT', 'POSSIBLE_MATCH');

-- CreateTable
CREATE TABLE "LeadProof" (
    "id" TEXT NOT NULL,
    "leadUid" TEXT NOT NULL,
    "sourceLeadId" TEXT,
    "sourceLane" TEXT,
    "sourcePlatform" TEXT,
    "sourceType" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetId" TEXT,
    "adsetName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "formId" TEXT,
    "formName" TEXT,
    "landingPageUrl" TEXT,
    "referrerUrl" TEXT,
    "consentText" TEXT,
    "consentVersion" TEXT,
    "consentCapturedAt" TIMESTAMP(3),
    "privacyPolicyVersion" TEXT,
    "termsVersion" TEXT,
    "submittedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "phoneRaw" TEXT,
    "phoneE164" TEXT,
    "email" TEXT,
    "proofStatus" "LeadProofStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "proofMissingReasons" JSONB,
    "rawSourcePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentDisclosureVersion" (
    "id" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "sourcePlatform" TEXT,
    "formId" TEXT,
    "formName" TEXT,
    "disclosureText" TEXT NOT NULL,
    "privacyPolicyUrl" TEXT,
    "termsUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentDisclosureVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSourceSnapshot" (
    "id" TEXT NOT NULL,
    "leadUid" TEXT NOT NULL,
    "sourceLane" TEXT,
    "sourcePlatform" TEXT,
    "sourceType" TEXT,
    "sourceLeadId" TEXT,
    "sourceAttributes" JSONB,
    "routingAttributes" JSONB,
    "rawPayload" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadVerificationResult" (
    "id" TEXT NOT NULL,
    "leadUid" TEXT NOT NULL,
    "verificationStatus" "LeadVerificationStatus" NOT NULL DEFAULT 'UNCHECKED',
    "duplicateStatus" "LeadDuplicateStatus",
    "phoneStatus" TEXT,
    "emailStatus" TEXT,
    "suppressionStatus" TEXT,
    "qualityScore" INTEGER,
    "reasons" JSONB,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadVerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadProof_leadUid_key" ON "LeadProof"("leadUid");

-- CreateIndex
CREATE INDEX "LeadProof_proofStatus_updatedAt_idx" ON "LeadProof"("proofStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadProof_sourceLane_updatedAt_idx" ON "LeadProof"("sourceLane", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadProof_campaignId_updatedAt_idx" ON "LeadProof"("campaignId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentDisclosureVersion_versionKey_key" ON "ConsentDisclosureVersion"("versionKey");

-- CreateIndex
CREATE INDEX "ConsentDisclosureVersion_active_effectiveFrom_idx" ON "ConsentDisclosureVersion"("active", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ConsentDisclosureVersion_sourcePlatform_formId_idx" ON "ConsentDisclosureVersion"("sourcePlatform", "formId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceSnapshot_leadUid_key" ON "LeadSourceSnapshot"("leadUid");

-- CreateIndex
CREATE INDEX "LeadSourceSnapshot_sourceLane_capturedAt_idx" ON "LeadSourceSnapshot"("sourceLane", "capturedAt");

-- CreateIndex
CREATE INDEX "LeadSourceSnapshot_sourcePlatform_sourceType_capturedAt_idx" ON "LeadSourceSnapshot"("sourcePlatform", "sourceType", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadVerificationResult_leadUid_key" ON "LeadVerificationResult"("leadUid");

-- CreateIndex
CREATE INDEX "LeadVerificationResult_verificationStatus_updatedAt_idx" ON "LeadVerificationResult"("verificationStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadVerificationResult_duplicateStatus_updatedAt_idx" ON "LeadVerificationResult"("duplicateStatus", "updatedAt");
