-- CreateEnum
CREATE TYPE "ClientChannelAiProvider" AS ENUM ('CLOSEBOT', 'GHL_AI', 'NONE');

-- CreateEnum
CREATE TYPE "ClientChannelDefaultLeadChannel" AS ENUM ('AUTO', 'BLUE', 'GREEN');

-- CreateEnum
CREATE TYPE "ClientChannelFallbackChannel" AS ENUM ('GREEN', 'NONE');

-- CreateEnum
CREATE TYPE "ClientChannelHealthStatus" AS ENUM ('HEALTHY', 'WARNING', 'DEGRADED', 'PAUSED');

-- CreateEnum
CREATE TYPE "ClientChannelPreferredContactWindow" AS ENUM ('ANYTIME_ALLOWED', 'AFTERNOON_3_6', 'EVENING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ClientChannelApplyScope" AS ENUM ('NEW_LEADS_ONLY', 'ACTIVE_UNLOCKED_ONLY', 'FORCE_MIGRATE_SELECTED');

-- CreateEnum
CREATE TYPE "ClientChannelWriteMode" AS ENUM ('simulate', 'shadow', 'live');

-- CreateTable
CREATE TABLE "ClientChannelProfileConfig" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "subaccountIdGhl" TEXT NOT NULL DEFAULT '',
    "blueEnabled" BOOLEAN NOT NULL DEFAULT false,
    "greenEnabled" BOOLEAN NOT NULL DEFAULT true,
    "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "closebotEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ghlAiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" "ClientChannelAiProvider" NOT NULL DEFAULT 'NONE',
    "defaultLeadChannel" "ClientChannelDefaultLeadChannel" NOT NULL DEFAULT 'AUTO',
    "fallbackChannel" "ClientChannelFallbackChannel" NOT NULL DEFAULT 'GREEN',
    "requiresSameNumberContinuity" BOOLEAN NOT NULL DEFAULT true,
    "blueNumber" TEXT,
    "greenNumber" TEXT,
    "voiceNumber" TEXT,
    "blueHealthStatus" "ClientChannelHealthStatus",
    "greenHealthStatus" "ClientChannelHealthStatus",
    "sendblueMaxNoReplyAttempts" INTEGER NOT NULL DEFAULT 4,
    "sendblueWindowDays" INTEGER NOT NULL DEFAULT 4,
    "textStartHour" INTEGER NOT NULL DEFAULT 9,
    "textEndHour" INTEGER NOT NULL DEFAULT 21,
    "preferredContactWindow" "ClientChannelPreferredContactWindow" NOT NULL DEFAULT 'ANYTIME_ALLOWED',
    "applyDefaultScope" "ClientChannelApplyScope" NOT NULL DEFAULT 'NEW_LEADS_ONLY',
    "writeMode" "ClientChannelWriteMode" NOT NULL DEFAULT 'simulate',
    "lastValidatedAt" TIMESTAMP(3),
    "lastAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientChannelProfileConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientChannelProfileConfig_clientAccountId_idx" ON "ClientChannelProfileConfig"("clientAccountId");

-- CreateIndex
CREATE INDEX "ClientChannelProfileConfig_subaccountIdGhl_idx" ON "ClientChannelProfileConfig"("subaccountIdGhl");

-- CreateIndex
CREATE INDEX "ClientChannelProfileConfig_writeMode_idx" ON "ClientChannelProfileConfig"("writeMode");

-- CreateIndex
CREATE UNIQUE INDEX "ClientChannelProfileConfig_clientAccountId_subaccountIdGhl_key" ON "ClientChannelProfileConfig"("clientAccountId", "subaccountIdGhl");
