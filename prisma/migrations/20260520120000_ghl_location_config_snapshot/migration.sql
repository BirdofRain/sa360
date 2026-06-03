-- CreateTable
CREATE TABLE "GhlLocationConfigSnapshot" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "clientAccountId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "locationName" TEXT,
    "locationJson" JSONB,
    "pipelinesJson" JSONB,
    "workflowsJson" JSONB,
    "usersJson" JSONB,
    "customFieldsJson" JSONB,
    "tagsJson" JSONB,
    "errorsJson" JSONB,
    "warningsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlLocationConfigSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GhlLocationConfigSnapshot_locationId_fetchedAt_idx" ON "GhlLocationConfigSnapshot"("locationId", "fetchedAt");

-- CreateIndex
CREATE INDEX "GhlLocationConfigSnapshot_clientAccountId_fetchedAt_idx" ON "GhlLocationConfigSnapshot"("clientAccountId", "fetchedAt");
