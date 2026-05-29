-- CreateTable
CREATE TABLE "LeadDuplicateRiskAssessment" (
    "id" TEXT NOT NULL,
    "masterClientAccountId" TEXT NOT NULL,
    "destinationClientAccountId" TEXT,
    "destinationSubaccountIdGhl" TEXT,
    "sourceEventUuid" TEXT,
    "sourceLeadUid" TEXT,
    "routingDryRunDecisionId" TEXT,
    "leadDeliveryPlanId" TEXT,
    "lifecycleEventId" TEXT,
    "identityStatus" TEXT NOT NULL DEFAULT 'needs_review',
    "riskLevel" TEXT NOT NULL DEFAULT 'none',
    "confidence" TEXT NOT NULL DEFAULT 'none',
    "recommendedAction" TEXT,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "candidateMatches" JSONB NOT NULL DEFAULT '[]',
    "normalizedPhone" TEXT,
    "normalizedEmail" TEXT,
    "facebookLeadId" TEXT,
    "facebookSubmissionId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "operatorOverrideStatus" TEXT,
    "operatorNotes" TEXT,
    "operatorUpdatedAt" TIMESTAMP(3),
    "operatorUpdatedBy" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDuplicateRiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadDuplicateRiskAssessment_routingDryRunDecisionId_key" ON "LeadDuplicateRiskAssessment"("routingDryRunDecisionId");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_masterClientAccountId_evaluatedAt_idx" ON "LeadDuplicateRiskAssessment"("masterClientAccountId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_destinationClientAccountId_evaluated_idx" ON "LeadDuplicateRiskAssessment"("destinationClientAccountId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_sourceLeadUid_idx" ON "LeadDuplicateRiskAssessment"("sourceLeadUid");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_sourceEventUuid_idx" ON "LeadDuplicateRiskAssessment"("sourceEventUuid");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_riskLevel_evaluatedAt_idx" ON "LeadDuplicateRiskAssessment"("riskLevel", "evaluatedAt");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_identityStatus_evaluatedAt_idx" ON "LeadDuplicateRiskAssessment"("identityStatus", "evaluatedAt");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_facebookLeadId_idx" ON "LeadDuplicateRiskAssessment"("facebookLeadId");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_normalizedPhone_destinationClientA_idx" ON "LeadDuplicateRiskAssessment"("normalizedPhone", "destinationClientAccountId");

-- CreateIndex
CREATE INDEX "LeadDuplicateRiskAssessment_normalizedEmail_destinationClientA_idx" ON "LeadDuplicateRiskAssessment"("normalizedEmail", "destinationClientAccountId");

-- AddForeignKey
ALTER TABLE "LeadDuplicateRiskAssessment" ADD CONSTRAINT "LeadDuplicateRiskAssessment_routingDryRunDecisionId_fkey" FOREIGN KEY ("routingDryRunDecisionId") REFERENCES "RoutingDryRunDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
