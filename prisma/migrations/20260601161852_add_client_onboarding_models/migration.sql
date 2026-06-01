-- CreateEnum
CREATE TYPE "ClientAccountStatus" AS ENUM ('active', 'paused', 'onboarding', 'archived');

-- CreateTable
CREATE TABLE "ClientAccount" (
    "clientAccountId" TEXT NOT NULL,
    "clientDisplayName" TEXT NOT NULL,
    "status" "ClientAccountStatus" NOT NULL DEFAULT 'onboarding',
    "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "portalDisplayName" TEXT,
    "portalLoginEmail" TEXT,
    "primaryNicheKeys" JSONB NOT NULL DEFAULT '[]',
    "primaryProductTypes" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("clientAccountId")
);

-- CreateTable
CREATE TABLE "ClientGhlDestination" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "destinationSubaccountIdGhl" TEXT NOT NULL,
    "locationName" TEXT,
    "ghlConnectionStatus" TEXT,
    "snapshotInstalled" BOOLEAN NOT NULL DEFAULT false,
    "requiredFieldsInstalled" BOOLEAN NOT NULL DEFAULT false,
    "defaultAssignedUserIdGhl" TEXT,
    "destinationWorkflowIdGhl" TEXT,
    "destinationPipelineIdGhl" TEXT,
    "destinationPipelineStageIdGhl" TEXT,
    "pipelineStageContactingIdGhl" TEXT,
    "pipelineStageAppointmentSetIdGhl" TEXT,
    "pipelineStageShowedIdGhl" TEXT,
    "pipelineStageSoldIdGhl" TEXT,
    "pipelineStageDeadIdGhl" TEXT,
    "opportunityCreationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "backupSheetEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backupSheetId" TEXT,
    "deliveryMode" TEXT NOT NULL DEFAULT 'shadow',
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clientCutoverApproved" BOOLEAN NOT NULL DEFAULT false,
    "internalApprovalStatus" TEXT NOT NULL DEFAULT 'not_reviewed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientGhlDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientAccount_status_idx" ON "ClientAccount"("status");

-- Backfill ClientAccount from existing routing rules before FK enforcement.
-- Idempotent: ON CONFLICT DO NOTHING leaves manually created rows untouched.
INSERT INTO "ClientAccount" (
    "clientAccountId",
    "clientDisplayName",
    "status",
    "portalEnabled",
    "primaryNicheKeys",
    "primaryProductTypes",
    "notes",
    "createdAt",
    "updatedAt"
)
SELECT
    s."clientAccountId",
    COALESCE(NULLIF(TRIM(s."clientDisplayName"), ''), s."clientAccountId"),
    'onboarding'::"ClientAccountStatus",
    false,
    '[]'::jsonb,
    '[]'::jsonb,
    'Auto-created during Phase 5A migration from existing CampaignRoutingRule.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (TRIM("clientAccountId"))
        TRIM("clientAccountId") AS "clientAccountId",
        "clientDisplayName"
    FROM "CampaignRoutingRule"
    WHERE TRIM("clientAccountId") <> ''
    ORDER BY TRIM("clientAccountId"), "updatedAt" DESC
) AS s
ON CONFLICT ("clientAccountId") DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "ClientGhlDestination_clientAccountId_key" ON "ClientGhlDestination"("clientAccountId");

-- AddForeignKey
ALTER TABLE "ClientGhlDestination" ADD CONSTRAINT "ClientGhlDestination_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRoutingRule" ADD CONSTRAINT "CampaignRoutingRule_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "LeadDuplicateRiskAssessment_destinationClientAccountId_evaluate" RENAME TO "LeadDuplicateRiskAssessment_destinationClientAccountId_eval_idx";

-- RenameIndex
ALTER INDEX "LeadDuplicateRiskAssessment_masterClientAccountId_evaluatedAt_i" RENAME TO "LeadDuplicateRiskAssessment_masterClientAccountId_evaluated_idx";

-- RenameIndex
ALTER INDEX "LeadDuplicateRiskAssessment_normalizedEmail_destinationClientA_" RENAME TO "LeadDuplicateRiskAssessment_normalizedEmail_destinationClie_idx";

-- RenameIndex
ALTER INDEX "LeadDuplicateRiskAssessment_normalizedPhone_destinationClientA_" RENAME TO "LeadDuplicateRiskAssessment_normalizedPhone_destinationClie_idx";
