import type { InventoryLot, PrismaClient, SourceLeadEvent } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { normalizeAgentName } from "./agent-name-normalize.js";

export type ProtectedAgentMatchType =
  | "supplier_account_id"
  | "agent_id"
  | "normalized_agent_name";

export type ProtectedAgentExclusionRecord = {
  id: string;
  matchType: ProtectedAgentMatchType;
  matchValue: string;
  active: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ItemOwnerIdentity = {
  supplierAccountId?: string;
  agentId?: string;
  normalizedAgentName?: string;
};

export type ProtectedAgentExclusionItemInput = {
  inventoryLot: Pick<InventoryLot, "supplierAccountId">;
  sourceLeadEvent: Pick<
    SourceLeadEvent,
    "enrichmentMetadataJson" | "normalizedPayloadJson"
  >;
};

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFirst(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) return trimmed;
  }
  return null;
}

function readAgentId(
  enrichmentMetadataJson: unknown,
  normalizedPayloadJson: unknown
): string | null {
  const enrichment = asRecord(enrichmentMetadataJson);
  const sourceAttributes = enrichment ? asRecord(enrichment.sourceAttributes) : null;
  const normalized = asRecord(normalizedPayloadJson);
  const ownership = normalized ? asRecord(normalized.ownership) : null;

  return readFirst(
    sourceAttributes?.agent_id,
    sourceAttributes?.agentId,
    sourceAttributes?.assigned_agent_id,
    sourceAttributes?.assignedAgentId,
    ownership?.assigned_agent_id,
    ownership?.assignedAgentId,
    normalized?.agent_id,
    normalized?.agentId
  );
}

function readAgentName(
  enrichmentMetadataJson: unknown,
  normalizedPayloadJson: unknown
): string | null {
  const enrichment = asRecord(enrichmentMetadataJson);
  const sourceAttributes = enrichment ? asRecord(enrichment.sourceAttributes) : null;
  const normalized = asRecord(normalizedPayloadJson);
  const ownership = normalized ? asRecord(normalized.ownership) : null;

  return readFirst(
    sourceAttributes?.agent_name,
    sourceAttributes?.agentName,
    sourceAttributes?.assigned_agent_name,
    sourceAttributes?.assignedAgentName,
    ownership?.assigned_agent_name,
    ownership?.assignedAgentName,
    normalized?.agent_name,
    normalized?.agentName
  );
}

export function resolveItemOwnerIdentity(
  item: ProtectedAgentExclusionItemInput
): ItemOwnerIdentity {
  const identity: ItemOwnerIdentity = {};
  const supplierAccountId = trimString(item.inventoryLot.supplierAccountId);
  if (supplierAccountId) identity.supplierAccountId = supplierAccountId;

  const agentId = readAgentId(
    item.sourceLeadEvent.enrichmentMetadataJson,
    item.sourceLeadEvent.normalizedPayloadJson
  );
  if (agentId) identity.agentId = agentId;

  const agentName = readAgentName(
    item.sourceLeadEvent.enrichmentMetadataJson,
    item.sourceLeadEvent.normalizedPayloadJson
  );
  if (agentName) {
    const normalizedAgentName = normalizeAgentName(agentName);
    if (normalizedAgentName) identity.normalizedAgentName = normalizedAgentName;
  }

  return identity;
}

export function isItemExcludedByProtectedAgents(
  item: ProtectedAgentExclusionItemInput,
  exclusions: ProtectedAgentExclusionRecord[]
): boolean {
  if (exclusions.length === 0) return false;

  const owner = resolveItemOwnerIdentity(item);
  const hasResolvableOwner = Boolean(
    owner.supplierAccountId || owner.agentId || owner.normalizedAgentName
  );
  if (!hasResolvableOwner) return true;

  return exclusions.some((exclusion) => {
    if (!exclusion.active) return false;
    switch (exclusion.matchType) {
      case "supplier_account_id":
        return owner.supplierAccountId === exclusion.matchValue;
      case "agent_id":
        return owner.agentId === exclusion.matchValue;
      case "normalized_agent_name":
        return owner.normalizedAgentName === exclusion.matchValue;
      default:
        return false;
    }
  });
}

export async function listActiveExclusions(
  db: PrismaClient = prisma
): Promise<ProtectedAgentExclusionRecord[]> {
  return db.protectedAgentExclusion.findMany({
    where: { active: true },
    orderBy: [{ matchType: "asc" }, { matchValue: "asc" }],
  }) as Promise<ProtectedAgentExclusionRecord[]>;
}

export async function listProtectedAgentExclusions(db: PrismaClient = prisma) {
  return db.protectedAgentExclusion.findMany({
    orderBy: [{ active: "desc" }, { matchType: "asc" }, { matchValue: "asc" }],
  });
}

export async function upsertProtectedAgentExclusion(
  input: {
    matchType: ProtectedAgentMatchType;
    matchValue: string;
    active?: boolean;
    note?: string | null;
  },
  db: PrismaClient = prisma
) {
  const matchValue =
    input.matchType === "normalized_agent_name"
      ? normalizeAgentName(input.matchValue)
      : input.matchValue.trim();

  return db.protectedAgentExclusion.upsert({
    where: {
      matchType_matchValue: {
        matchType: input.matchType,
        matchValue,
      },
    },
    create: {
      matchType: input.matchType,
      matchValue,
      active: input.active ?? true,
      note: input.note ?? null,
    },
    update: {
      active: input.active ?? true,
      note: input.note ?? null,
    },
  });
}

export async function deactivateProtectedAgentExclusion(id: string, db: PrismaClient = prisma) {
  return db.protectedAgentExclusion.update({
    where: { id: id.trim() },
    data: { active: false },
  });
}
