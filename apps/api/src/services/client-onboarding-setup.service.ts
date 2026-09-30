import { createHash } from "node:crypto";
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
  revision: number;
  repairRequired: boolean;
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

type ReadDataResult =
  | { readable: true; data: ClientOnboardingSetupData }
  | { readable: false };

function readData(value: unknown): ReadDataResult {
  const parsed = clientOnboardingSetupDataSchema.safeParse(value);
  return parsed.success ? { readable: true, data: parsed.data } : { readable: false };
}

function present(
  client: Pick<ClientAccount, "primaryNicheKeys" | "primaryProductTypes">,
  setup: ClientOnboardingSetup | null
): ClientOnboardingSetupDto {
  const parsed = setup ? readData(setup.setupDataJson) : { readable: true as const, data: {} };
  const data = parsed.readable ? parsed.data : {};
  return {
    status: setup?.status ?? "draft",
    data,
    revision: setup?.revision ?? 0,
    repairRequired: !parsed.readable,
    missingRequiredFields: parsed.readable ? missingClientSetupFields(client, data) : [],
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
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "VALIDATION"
        | "REQUEST_ID_CONFLICT"
        | "STALE_WRITE"
        | "SETUP_REPAIR_REQUIRED";
      error: string;
      missingRequiredFields?: string[];
    };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function requestPayloadHash(clientAccountId: string, patch: ClientOnboardingSetupPatch): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        clientAccountId,
        intent: patch.intent,
        expectedRevision: patch.expectedRevision,
        data: patch.data,
      })
    )
    .digest("hex");
}

function replaySnapshot(value: Prisma.JsonValue | null): ClientOnboardingSetupDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1 || !snapshot.item || typeof snapshot.item !== "object") return null;
  return snapshot.item as ClientOnboardingSetupDto;
}

export async function saveClientOnboardingSetup(
  clientAccountId: string,
  patch: ClientOnboardingSetupPatch,
  db: PrismaClient = prisma
): Promise<SaveClientSetupResult> {
  const id = clientAccountId.trim();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${patch.requestId}))`;
    const lockedClient = await tx.$queryRaw<Array<{ clientAccountId: string }>>`
      SELECT "clientAccountId"
      FROM "ClientAccount"
      WHERE "clientAccountId" = ${id}
      FOR UPDATE
    `;
    if (lockedClient.length === 0) {
      return { ok: false as const, code: "NOT_FOUND" as const, error: "Client not found" };
    }

    const payloadHash = requestPayloadHash(id, patch);
    const priorRequest = await tx.clientOnboardingSetupAuditEvent.findUnique({
      where: { requestId: patch.requestId },
    });
    if (priorRequest) {
      if (
        priorRequest.clientAccountId !== id ||
        priorRequest.requestIntent !== patch.intent ||
        priorRequest.requestPayloadHash !== payloadHash ||
        priorRequest.requestExpectedRevision !== patch.expectedRevision
      ) {
        return {
          ok: false as const,
          code: "REQUEST_ID_CONFLICT" as const,
          error: "This request ID was already used for a different client, action, or payload.",
        };
      }
      const item = replaySnapshot(priorRequest.resultJson);
      if (!item) {
        return {
          ok: false as const,
          code: "REQUEST_ID_CONFLICT" as const,
          error: "This legacy request ID cannot be safely replayed. Start a new save attempt.",
        };
      }
      return { ok: true as const, item, replayed: true };
    }

    const client = await tx.clientAccount.findUnique({
      where: { clientAccountId: id },
      include: { onboardingSetup: true },
    });
    if (!client) return { ok: false as const, code: "NOT_FOUND" as const, error: "Client not found" };
    const currentRevision = client.onboardingSetup?.revision ?? 0;
    if (patch.expectedRevision !== currentRevision) {
      return {
        ok: false as const,
        code: "STALE_WRITE" as const,
        error:
          "This setup changed after it was loaded. Reload and resolve the newer changes before saving.",
      };
    }

    const previous = client.onboardingSetup
      ? readData(client.onboardingSetup.setupDataJson)
      : { readable: true as const, data: {} };
    if (!previous.readable && patch.intent !== "recover_draft") {
      return {
        ok: false as const,
        code: "SETUP_REPAIR_REQUIRED" as const,
        error:
          "This setup contains unreadable stored data. It was not changed. Use the explicit recovery action before saving.",
      };
    }
    const previousData = previous.readable ? previous.data : {};
    const data =
      patch.intent === "recover_draft" ? patch.data : { ...previousData, ...patch.data };
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
    const dataChanged =
      patch.intent === "recover_draft" || canonicalJson(previousData) !== canonicalJson(data);
    const previousStatus = client.onboardingSetup?.status ?? "draft";
    const status =
      patch.intent === "save_draft" || patch.intent === "recover_draft"
        ? dataChanged
          ? "draft"
          : previousStatus
        : patch.intent === "submit"
          ? "submitted"
          : patch.intent;
    const statusChanged = status !== previousStatus;
    const changesSubmissionState =
      patch.intent === "submit" ||
      patch.intent === "needs_information" ||
      patch.intent === "setup_reviewed" ||
      (dataChanged && (patch.intent === "save_draft" || patch.intent === "recover_draft"));
    const mutatesSetup =
      !client.onboardingSetup ||
      dataChanged ||
      statusChanged ||
      changesSubmissionState;

    let setup = client.onboardingSetup;
    if (!setup) {
      setup = await tx.clientOnboardingSetup.create({
        data: {
          clientAccountId: id,
          status,
          setupDataJson: data as Prisma.InputJsonValue,
          revision: 1,
          submittedAt: patch.intent === "submit" ? now : null,
          reviewedAt: patch.intent === "setup_reviewed" ? now : null,
        },
      });
    } else if (mutatesSetup) {
      setup = await tx.clientOnboardingSetup.update({
        where: { id: setup.id },
        data: {
          status,
          setupDataJson: data as Prisma.InputJsonValue,
          revision: { increment: 1 },
          submittedAt:
            patch.intent === "submit"
              ? now
              : dataChanged && (patch.intent === "save_draft" || patch.intent === "recover_draft")
                ? null
                : undefined,
          reviewedAt:
            patch.intent === "setup_reviewed"
              ? now
              : patch.intent === "submit" ||
                  patch.intent === "needs_information" ||
                  (dataChanged &&
                    (patch.intent === "save_draft" || patch.intent === "recover_draft"))
                ? null
                : undefined,
        },
      });
    }
    const changedFields = Object.keys(patch.data).filter(
      (key) =>
        canonicalJson(previousData[key as keyof ClientOnboardingSetupData]) !==
        canonicalJson(data[key as keyof ClientOnboardingSetupData])
    );
    const item = present(client, setup);
    await tx.clientOnboardingSetupAuditEvent.create({
      data: {
        setupId: setup.id,
        clientAccountId: id,
        historicalClientAccountId: id,
        requestId: patch.requestId,
        requestIntent: patch.intent,
        requestPayloadHash: payloadHash,
        requestExpectedRevision: patch.expectedRevision,
        resultJson: { version: 1, item } as Prisma.InputJsonValue,
        action: patch.intent,
        actor: "ADMIN",
        changesJson: {
          changedFields,
          previousStatus: client.onboardingSetup?.status ?? null,
          nextStatus: status,
          previousRevision: currentRevision,
          nextRevision: setup.revision,
          noOp: !mutatesSetup,
        },
      },
    });
    return { ok: true as const, item, replayed: false };
  });
}
