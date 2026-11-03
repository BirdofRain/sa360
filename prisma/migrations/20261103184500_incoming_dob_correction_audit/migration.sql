-- Additive audit table for historical DOB correction apply and rollback.
-- The writer supplies the id and inserts this row in the same transaction as
-- the payload change. eventId is not a foreign key. This migration does not
-- read or update SourceLeadEvent. The action check is required by the
-- correction compatibility gate; Prisma does not generate it from the model.

-- CreateTable
CREATE TABLE "IncomingDobCorrectionAudit" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "previousUpdatedAt" TIMESTAMP(3) NOT NULL,
    "newUpdatedAt" TIMESTAMP(3) NOT NULL,
    "alreadyDelivered" BOOLEAN NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "externalDestinations" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomingDobCorrectionAudit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IncomingDobCorrectionAudit_action_check" CHECK ("action" IN ('apply', 'rollback'))
);

-- CreateIndex
CREATE INDEX "IncomingDobCorrectionAudit_eventId_createdAt_idx" ON "IncomingDobCorrectionAudit"("eventId", "createdAt");
