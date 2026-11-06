import { readFacebookId } from "./facebook-form-association.js";

/**
 * Read-only classification for Facebook Source Resolution review.
 * This module does not read or write the database.
 */

export const SOURCE_RESOLUTION_CLASSIFICATIONS = [
  "unstamped_confirmed_owner",
  "unknown_ownership",
  "cannot_identify",
  "ambiguous_owner",
] as const;

export type SourceResolutionClassification = (typeof SOURCE_RESOLUTION_CLASSIFICATIONS)[number];

export const STORED_ASSOCIATION_OUTCOMES = [
  "associated",
  "unassociated",
  "ambiguous",
  "missing_form_identity",
  "invalid_form_identity",
  "not_evaluated",
  "association_disabled",
  "absent",
  "other",
] as const;

export type StoredAssociationOutcome = (typeof STORED_ASSOCIATION_OUTCOMES)[number];

export type StoredAssociationOutcomeCounts = Record<StoredAssociationOutcome, number>;

export function emptyOutcomeCounts(): StoredAssociationOutcomeCounts {
  return {
    associated: 0,
    unassociated: 0,
    ambiguous: 0,
    missing_form_identity: 0,
    invalid_form_identity: 0,
    not_evaluated: 0,
    association_disabled: 0,
    absent: 0,
    other: 0,
  };
}

export function readStoredAssociationOutcome(value: string | null | undefined): StoredAssociationOutcome {
  if (value == null || value.trim() === "") return "absent";
  const trimmed = value.trim();
  return (STORED_ASSOCIATION_OUTCOMES as readonly string[]).includes(trimmed)
    ? (trimmed as StoredAssociationOutcome)
    : "other";
}

export type SourceResolutionOwner = {
  sourceFunnelId: string;
  originClientAccountId: string;
  createdAt: Date;
  updatedAt: Date;
};

export function classifySourceResolutionGroup(input: {
  pageId: string | null;
  formId: string | null;
  unresolvedEvents: number;
  owners: SourceResolutionOwner[];
}): {
  classification: SourceResolutionClassification;
  confirmedOriginClientAccountId: string | null;
  confirmedSourceFunnelId: string | null;
  sourceFunnelCreatedAt: string | null;
  sourceFunnelUpdatedAt: string | null;
} {
  const page = input.pageId ? readFacebookId(input.pageId) : null;
  const form = input.formId ? readFacebookId(input.formId) : null;
  if (!page?.ok || !form?.ok) {
    return {
      classification: "cannot_identify",
      confirmedOriginClientAccountId: null,
      confirmedSourceFunnelId: null,
      sourceFunnelCreatedAt: null,
      sourceFunnelUpdatedAt: null,
    };
  }
  const owners = dedupeOwners(input.owners);
  if (owners.length > 1) {
    return {
      classification: "ambiguous_owner",
      confirmedOriginClientAccountId: null,
      confirmedSourceFunnelId: null,
      sourceFunnelCreatedAt: null,
      sourceFunnelUpdatedAt: null,
    };
  }
  const owner = owners[0];
  if (!owner) {
    return {
      classification: "unknown_ownership",
      confirmedOriginClientAccountId: null,
      confirmedSourceFunnelId: null,
      sourceFunnelCreatedAt: null,
      sourceFunnelUpdatedAt: null,
    };
  }
  return {
    classification: "unstamped_confirmed_owner",
    confirmedOriginClientAccountId: owner.originClientAccountId,
    confirmedSourceFunnelId: owner.sourceFunnelId,
    sourceFunnelCreatedAt: owner.createdAt.toISOString(),
    sourceFunnelUpdatedAt: owner.updatedAt.toISOString(),
  };
}

function dedupeOwners(owners: SourceResolutionOwner[]): SourceResolutionOwner[] {
  const byClient = new Map<string, SourceResolutionOwner>();
  for (const owner of owners) {
    const clientAccountId = owner.originClientAccountId.trim();
    if (!clientAccountId || byClient.has(clientAccountId)) continue;
    byClient.set(clientAccountId, owner);
  }
  return [...byClient.values()];
}

/**
 * Settlement outcome counts explain why a confirmed owner and a null client
 * can exist together. The text reports those counts. It does not choose a
 * cause when more than one outcome is present, and it does not repair events.
 */
export function explainUnstampedGroup(input: {
  classification: SourceResolutionClassification;
  outcomes: StoredAssociationOutcomeCounts;
}): string {
  if (input.classification === "cannot_identify") {
    return "Page ID and Form ID are not both numeric Facebook IDs, so these events cannot be matched to a SourceFunnel. This review does not invent identifiers.";
  }
  if (input.classification === "ambiguous_owner") {
    return "More than one confirmed SourceFunnel origin matches this Page and Form. These events stay unassigned.";
  }
  if (input.classification === "unknown_ownership") {
    return "No confirmed SourceFunnel origin matches this Page and Form. These events stay unassigned.";
  }
  const disabled = input.outcomes.association_disabled;
  const unassociated = input.outcomes.unassociated;
  const total =
    input.outcomes.associated +
    input.outcomes.unassociated +
    input.outcomes.ambiguous +
    input.outcomes.missing_form_identity +
    input.outcomes.invalid_form_identity +
    input.outcomes.not_evaluated +
    input.outcomes.association_disabled +
    input.outcomes.absent +
    input.outcomes.other;
  if (disabled === total && disabled > 0) {
    return "A confirmed SourceFunnel origin exists now. Settlement recorded association_disabled, so it did not copy that origin onto these events. Confirming a SourceFunnel does not rewrite events already stored. This review does not reevaluate them.";
  }
  if (unassociated === total && unassociated > 0) {
    return "A confirmed SourceFunnel origin exists now. Settlement recorded unassociated, so no confirmed origin matched at that time. Confirming a SourceFunnel does not rewrite events already stored. This review does not reevaluate them.";
  }
  return "A confirmed SourceFunnel origin exists now, and these events still have no resolved client. Settlement outcomes on the events are mixed or empty. Confirming a SourceFunnel does not rewrite events already stored. This review does not reevaluate them.";
}
