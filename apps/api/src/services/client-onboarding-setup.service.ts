import type { ClientAccount, ClientOnboardingSetup, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";
import {
  clientOnboardingSetupDataSchema,
  type ClientOnboardingSetupData,
  type ClientOnboardingSetupPatch,
} from "../schemas/client-onboarding-setup.schema.js";

export type ClientOnboardingSetupDto = {
  status: "draft" | "submitted" | "needs_information" | "setup_reviewed";
  data: ClientOnboardingSetupData;
  missingRequiredFields: string[];
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string | null;
  operationalEffects: false;
};

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function missingClientSetupFields(
  client: Pick<ClientAccount, "primaryNicheKeys" | "primaryProductTypes">,
  data: ClientOnboardingSetupData
): string[] {
  const missing: string[] = [];
  if (!Array.isArray(client.primaryNicheKeys) || client.primaryNicheKeys.length === 0) {
    missing.push("primaryNicheKeys");
  }
  if (!Array.isArray(client.primaryProductTypes) || client.primaryProductTypes.length === 0) {
    missing.push("primaryProductTypes");
  }
  if (!data.sourceProvider) missing.push("sourceProvider");
  if (!hasText(data.trafficSourceName)) missing.push("trafficSourceName");
  if (data.sourceProvider === "nextgen") {
    if (!hasText(data.nextgenFunnelName)) missing.push("nextgenFunnelName");
    if (!hasText(data.nextgenFunnelUrl)) missing.push("nextgenFunnelUrl");
    if (!hasText(data.providerFunnelId) && !hasText(data.sourceMissingInfoNotes)) {
      missing.push("providerFunnelIdOrMissingNotes");
    }
    if (!hasText(data.testLeadUuid)) missing.push("testLeadUuid");
    if (!hasText(data.testSubmissionAt)) missing.push("testSubmissionAt");
    if (data.webhookConfigured !== true) missing.push("webhookConfigured");
    if (data.sourceTestSubmitted !== true) missing.push("sourceTestSubmitted");
  }
  if (!data.destinationChoice) missing.push("destinationChoice");
  const wantsGhl = data.destinationChoice === "ghl" || data.destinationChoice === "both";
  const wantsSheets =
    data.destinationChoice === "google_sheets" || data.destinationChoice === "both";
  if (wantsGhl && !hasText(data.ghlLocationId)) missing.push("ghlLocationId");
  if (wantsSheets) {
    if (!data.sheetsMode) missing.push("sheetsMode");
    if (data.sheetsMode === "existing" && !hasText(data.existingSpreadsheetUrl)) {
      missing.push("existingSpreadsheetUrl");
    }
    if (data.sheetsMode === "create_new" && !hasText(data.requestedSpreadsheetName)) {
      missing.push("requestedSpreadsheetName");
    }
    if (!hasText(data.googleAccountOwner)) missing.push("googleAccountOwner");
  }
  return missing;
}

function readData(value: unknown): ClientOnboardingSetupData {
  const parsed = clientOnboardingSetupDataSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function present(
  client: Pick<ClientAccount, "primaryNicheKeys" | "primaryProductTypes">,
  setup: ClientOnboardingSetup | null
): ClientOnboardingSetupDto {
  const data = readData(setup?.setupDataJson);
  return {
    status: setup?.status ?? "draft",
    data,
    missingRequiredFields: missingClientSetupFields(client, data),
    submittedAt: setup?.submittedAt?.toISOString() ?? null,
    reviewedAt: setup?.reviewedAt?.toISOString() ?? null,
    updatedAt: setup?.updatedAt?.toISOString() ?? null,
    operationalEffects: false,
  };
}

export async function getClientOnboardingSetup(
  clientAccountId: string,
  db: PrismaClient = prisma
): Promise<ClientOnboardingSetupDto | null> {
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: clientAccountId.trim() },
    include: { onboardingSetup: true },
  });
  return client ? present(client, client.onboardingSetup) : null;
}

export type SaveClientSetupResult =
  | { ok: true; item: ClientOnboardingSetupDto; replayed: boolean }
  | { ok: false; code: "NOT_FOUND" | "VALIDATION" | "REQUEST_ID_CONFLICT"; error: string; missingRequiredFields?: string[] };

export async function saveClientOnboardingSetup(
  clientAccountId: string,
  patch: ClientOnboardingSetupPatch,
  db: PrismaClient = prisma
): Promise<SaveClientSetupResult> {
  const id = clientAccountId.trim();
  return db.$transaction(async (tx) => {
    const priorRequest = await tx.clientOnboardingSetupAuditEvent.findUnique({
      where: { requestId: patch.requestId },
      include: { setup: true },
    });
    if (priorRequest) {
      if (priorRequest.clientAccountId !== id) {
        return {
          ok: false as const,
          code: "REQUEST_ID_CONFLICT" as const,
          error: "This request ID was already used for another client.",
        };
      }
      const client = await tx.clientAccount.findUnique({ where: { clientAccountId: id } });
      if (!client) return { ok: false as const, code: "NOT_FOUND" as const, error: "Client not found" };
      return { ok: true as const, item: present(client, priorRequest.setup), replayed: true };
    }

    const client = await tx.clientAccount.findUnique({
      where: { clientAccountId: id },
      include: { onboardingSetup: true },
    });
    if (!client) return { ok: false as const, code: "NOT_FOUND" as const, error: "Client not found" };

    const previousData = readData(client.onboardingSetup?.setupDataJson);
    const data = { ...previousData, ...patch.data };
    const missingRequiredFields = missingClientSetupFields(client, data);
    if (patch.intent === "submit" && missingRequiredFields.length > 0) {
      return {
        ok: false as const,
        code: "VALIDATION" as const,
        error: "Complete the required setup fields before submitting for review.",
        missingRequiredFields,
      };
    }
    if (
      (patch.intent === "needs_information" || patch.intent === "setup_reviewed") &&
      !hasText(data.reviewNotes)
    ) {
      return {
        ok: false as const,
        code: "VALIDATION" as const,
        error: "Add review notes before changing the review status.",
        missingRequiredFields: ["reviewNotes"],
      };
    }

    const now = new Date();
    const status =
      patch.intent === "save_draft"
        ? client.onboardingSetup?.status ?? "draft"
        : patch.intent === "submit"
          ? "submitted"
          : patch.intent;
    const setup = await tx.clientOnboardingSetup.upsert({
      where: { clientAccountId: id },
      create: {
        clientAccountId: id,
        status,
        setupDataJson: data as Prisma.InputJsonValue,
        submittedAt: patch.intent === "submit" ? now : null,
        reviewedAt: patch.intent === "setup_reviewed" ? now : null,
      },
      update: {
        status,
        setupDataJson: data as Prisma.InputJsonValue,
        ...(patch.intent === "submit" ? { submittedAt: now } : {}),
        ...(patch.intent === "setup_reviewed" ? { reviewedAt: now } : {}),
      },
    });
    const changedFields = Object.keys(patch.data).filter(
      (key) =>
        JSON.stringify(previousData[key as keyof ClientOnboardingSetupData]) !==
        JSON.stringify(data[key as keyof ClientOnboardingSetupData])
    );
    await tx.clientOnboardingSetupAuditEvent.create({
      data: {
        setupId: setup.id,
        clientAccountId: id,
        requestId: patch.requestId,
        action: patch.intent,
        actor: "ADMIN",
        changesJson: {
          changedFields,
          previousStatus: client.onboardingSetup?.status ?? null,
          nextStatus: status,
        },
      },
    });
    return { ok: true as const, item: present(client, setup), replayed: false };
  });
}
