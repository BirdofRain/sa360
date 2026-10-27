/**
 * Stored-snapshot discovery and client-only workflow selection.
 * Reads GhlLocationConfigSnapshot. Does not call GoHighLevel.
 * Writes destinationWorkflowIdGhl and workflowTriggerMode only.
 */

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import type { OnboardingGhlRouteDeps } from "../../routes/admin-client-onboarding-v2-ghl.js";
import type { DiscoveredWorkflow, SelectTimeZoneSelectionPatch } from "./onboarding-ghl-workflow.js";

export function onboardingGhlRouteDeps(db: PrismaClient = prisma): OnboardingGhlRouteDeps {
  return {
    async listWorkflows(clientAccountId) {
      const client = await db.clientAccount.findUnique({
        where: { clientAccountId },
        select: {
          clientAccountId: true,
          ghlDestination: { select: { destinationSubaccountIdGhl: true } },
        },
      });
      if (!client) return { clientFound: false, workflows: [] };
      const locationId = client.ghlDestination?.destinationSubaccountIdGhl?.trim() || null;
      const snapshot = await db.ghlLocationConfigSnapshot.findFirst({
        where: {
          OR: [{ clientAccountId }, ...(locationId ? [{ locationId }] : [])],
        },
        orderBy: { fetchedAt: "desc" },
      });
      return { clientFound: true, workflows: workflowsFrom(snapshot?.workflowsJson) };
    },
    async readDestination(clientAccountId) {
      const row = await db.clientGhlDestination.findUnique({ where: { clientAccountId } });
      if (!row) return null;
      const profile = await db.clientOnboardingDestinationProfile.findUnique({
        where: { clientAccountId },
        select: { revision: true },
      });
      return {
        clientAccountId,
        revision: profile?.revision ?? 0,
        destinationWorkflowIdGhl: row.destinationWorkflowIdGhl,
        workflowTriggerMode: row.workflowTriggerMode,
        deliveryEnabled: row.deliveryEnabled,
        clientCutoverApproved: row.clientCutoverApproved,
      };
    },
    async saveWorkflowSelection(clientAccountId, patch) {
      return saveSelectTimeZone(clientAccountId, patch, db);
    },
  };
}

export async function saveSelectTimeZone(
  clientAccountId: string,
  patch: SelectTimeZoneSelectionPatch,
  db: PrismaClient = prisma
) {
  return db.$transaction(async (tx) => {
    const before = await tx.clientGhlDestination.findUnique({ where: { clientAccountId } });
    if (!before) {
      throw new Error("client_ghl_destination_missing");
    }
    const sheetsBefore = await tx.companySheetsDestination.findUnique({
      where: { clientAccountId },
      select: {
        campaignDispatchEnabled: true,
        agedDispatchEnabled: true,
        campaignDispatchNotBefore: true,
      },
    });
    const profile = await tx.clientOnboardingDestinationProfile.findUnique({
      where: { clientAccountId },
      select: { revision: true },
    });
    await tx.clientGhlDestination.update({
      where: { clientAccountId },
      data: {
        destinationWorkflowIdGhl: patch.destinationWorkflowIdGhl,
        workflowTriggerMode: patch.workflowTriggerMode,
      },
    });
    if (profile) {
      const moved = await tx.clientOnboardingDestinationProfile.updateMany({
        where: { clientAccountId, revision: profile.revision },
        data: { revision: { increment: 1 } },
      });
      if (moved.count !== 1) throw new Error("revision_conflict");
    }
    const after = await tx.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId } });
    const sheetsAfter = await tx.companySheetsDestination.findUnique({
      where: { clientAccountId },
      select: {
        campaignDispatchEnabled: true,
        agedDispatchEnabled: true,
        campaignDispatchNotBefore: true,
      },
    });
    if (
      after.deliveryEnabled !== before.deliveryEnabled ||
      after.clientCutoverApproved !== before.clientCutoverApproved ||
      JSON.stringify(sheetsBefore) !== JSON.stringify(sheetsAfter)
    ) {
      throw new Error("delivery_switch_changed");
    }
    const nextProfile = await tx.clientOnboardingDestinationProfile.findUnique({
      where: { clientAccountId },
      select: { revision: true },
    });
    return {
      clientAccountId,
      revision: nextProfile?.revision ?? 0,
      destinationWorkflowIdGhl: after.destinationWorkflowIdGhl,
      workflowTriggerMode: after.workflowTriggerMode,
      deliveryEnabled: after.deliveryEnabled,
      clientCutoverApproved: after.clientCutoverApproved,
    };
  });
}

function workflowsFrom(value: unknown): DiscoveredWorkflow[] {
  if (!Array.isArray(value)) return [];
  const workflows: DiscoveredWorkflow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!id || !name) continue;
    workflows.push({
      id,
      name,
      status: typeof record.status === "string" ? record.status : null,
      type: typeof record.type === "string" ? record.type : null,
    });
  }
  return workflows;
}
