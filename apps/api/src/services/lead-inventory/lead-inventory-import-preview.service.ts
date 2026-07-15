import type { PrismaClient } from "@prisma/client";

import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { prisma as defaultPrisma } from "../../lib/db.js";
import { getLeadProofByLeadUid } from "../../repositories/lead-proof.repository.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { evaluateLeadEligibility } from "../fulfillment-shadow/eligibility.service.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "./lead-inventory-age.js";
import { resolveInventoryGeneratedAt } from "./lead-inventory-generated-at.js";
import { normalizeInventoryState } from "./lead-inventory-state.js";

export type LeadInventoryImportPreviewInput = {
  sourceLane?: string;
  campaignId?: string;
  formId?: string;
  receivedFrom?: string;
  receivedTo?: string;
  inventoryClass?: string;
  limit?: number;
};

export async function buildLeadInventoryImportPreview(
  input: LeadInventoryImportPreviewInput,
  db: PrismaClient = defaultPrisma
) {
  const evaluatedAt = new Date();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const ageBands = await listActiveAgeBandDefinitions(undefined, db);

  const where: Record<string, unknown> = {
    leadInventoryItem: { is: null },
  };
  if (input.sourceLane) where.sourceProvider = input.sourceLane;
  if (input.campaignId) where.sourceRouteKey = input.campaignId;
  if (input.formId) {
    where.OR = [
      { sourceCampaignId: input.formId },
      { enrichmentMetadataJson: { path: ["formId"], equals: input.formId } },
    ];
  }
  if (input.receivedFrom || input.receivedTo) {
    where.receivedAt = {
      ...(input.receivedFrom ? { gte: new Date(input.receivedFrom) } : {}),
      ...(input.receivedTo ? { lte: new Date(input.receivedTo) } : {}),
    };
  }

  const events = await db.sourceLeadEvent.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      sourceLeadUid: true,
      sourceProvider: true,
      sourceSystem: true,
      sourceRouteKey: true,
      receivedAt: true,
      normalizedPayloadJson: true,
      enrichmentMetadataJson: true,
    },
  });

  const groups = new Map<
    string,
    { state: string; ageBandKey: string; eligible: number; ineligible: number; blockers: Record<string, number> }
  >();
  const candidates: Array<{
    maskedSourceLeadEventId: string;
    maskedLeadUid: string | null;
    generatedAt: string | null;
    normalizedState: string | null;
    ageDays: number | null;
    ageBandKey: string | null;
    eligible: boolean;
    blockers: string[];
  }> = [];

  let eligibleCount = 0;
  let ineligibleCount = 0;

  for (const event of events) {
    const generated = resolveInventoryGeneratedAt(event);
    const identity = readNormalizedLeadIdentity(event.normalizedPayloadJson);
    const normalizedState = normalizeInventoryState(identity?.state ?? null);
    const blockers: string[] = [];

    if (!generated.generatedAt) blockers.push("generated_at_missing");
    if (!normalizedState) blockers.push("state_missing");

    const leadUid = event.sourceLeadUid;
    const proof = leadUid ? await getLeadProofByLeadUid(leadUid, db) : null;
    const verification = leadUid
      ? await db.leadVerificationResult.findUnique({ where: { leadUid } })
      : null;

    const eligibility = evaluateLeadEligibility({
      sourceLeadEvent: event,
      leadProof: proof,
      verification,
      leadState: normalizedState,
    });
    if (eligibility.status !== "eligible") {
      blockers.push("proof_or_verification_not_ready");
      blockers.push(...eligibility.reasonCodes);
    }

    const ageDays = generated.generatedAt
      ? calculateInventoryAgeDays(generated.generatedAt, evaluatedAt)
      : null;
    const ageBandKey =
      ageDays != null ? resolveAgeBandKey(ageDays, ageBands) : null;
    const eligible = blockers.length === 0;
    if (eligible) eligibleCount += 1;
    else ineligibleCount += 1;

    if (normalizedState && ageBandKey) {
      const key = `${normalizedState}::${ageBandKey}`;
      const group = groups.get(key) ?? {
        state: normalizedState,
        ageBandKey,
        eligible: 0,
        ineligible: 0,
        blockers: {},
      };
      if (eligible) group.eligible += 1;
      else group.ineligible += 1;
      for (const blocker of blockers) {
        group.blockers[blocker] = (group.blockers[blocker] ?? 0) + 1;
      }
      groups.set(key, group);
    }

    candidates.push({
      maskedSourceLeadEventId: maskSourceLeadUidForAudit(event.id) ?? "evt***",
      maskedLeadUid: maskSourceLeadUidForAudit(event.sourceLeadUid),
      generatedAt: generated.generatedAt?.toISOString() ?? null,
      normalizedState,
      ageDays,
      ageBandKey,
      eligible,
      blockers,
    });
  }

  return {
    ok: true,
    inventoryClass: input.inventoryClass ?? null,
    sourceLane: input.sourceLane ?? null,
    campaignId: input.campaignId ?? null,
    formId: input.formId ?? null,
    evaluatedAt: evaluatedAt.toISOString(),
    candidateCount: events.length,
    eligibleCount,
    ineligibleCount,
    writesPerformed: 0,
    groups: [...groups.values()],
    candidates,
  };
}
