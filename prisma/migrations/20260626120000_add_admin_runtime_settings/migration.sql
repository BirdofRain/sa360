-- CreateEnum
CREATE TYPE "AdminRuntimeSettingScope" AS ENUM ('GLOBAL', 'CLIENT', 'SUBACCOUNT');

-- CreateEnum
CREATE TYPE "AdminRuntimeSettingEnvironment" AS ENUM ('STAGING', 'PRODUCTION');

-- CreateTable
CREATE TABLE "AdminRuntimeSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scope" "AdminRuntimeSettingScope" NOT NULL DEFAULT 'GLOBAL',
    "clientAccountId" TEXT,
    "subaccountIdGhl" TEXT,
    "environment" "AdminRuntimeSettingEnvironment" NOT NULL DEFAULT 'STAGING',
    "description" TEXT,
    "reason" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "isEditable" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminRuntimeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminRuntimeSetting_key_idx" ON "AdminRuntimeSetting"("key");

-- CreateIndex
CREATE INDEX "AdminRuntimeSetting_scope_idx" ON "AdminRuntimeSetting"("scope");

-- CreateIndex
CREATE INDEX "AdminRuntimeSetting_environment_idx" ON "AdminRuntimeSetting"("environment");

-- CreateIndex
CREATE INDEX "AdminRuntimeSetting_clientAccountId_idx" ON "AdminRuntimeSetting"("clientAccountId");

-- CreateIndex
CREATE INDEX "AdminRuntimeSetting_subaccountIdGhl_idx" ON "AdminRuntimeSetting"("subaccountIdGhl");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRuntimeSetting_key_scope_environment_clientAccountId_s_key" ON "AdminRuntimeSetting"("key", "scope", "environment", "clientAccountId", "subaccountIdGhl");
