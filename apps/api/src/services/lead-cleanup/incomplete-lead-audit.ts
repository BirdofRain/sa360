import { LEAD_CLEANUP_REASONS, LEAD_CLEANUP_STATUSES } from "../../lib/lead-cleanup.js";
import { normalizeRoutingLeadIdentity } from "../routing-dry-run-lead-identity.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const resolved = trimOrNull(value);
    if (resolved) return resolved;
  }
  return null;
}

export type LeadIdentitySnapshot = {
  clientAccountId: string | null;
  clientName: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  leadUid: string | null;
  contactIdGhl: string | null;
  subaccountIdGhl: string | null;
  orderId: string | null;
  routingRuleId: string | null;
  deliveryAttemptId: string | null;
};

export type LeadIdentitySupport = {
  fullName: boolean;
  phone: boolean;
  email: boolean;
  leadUid: boolean;
  contactIdGhl: boolean;
  subaccountIdGhl: boolean;
  orderId: boolean;
  routingRuleId: boolean;
  deliveryAttemptId: boolean;
};

export type LeadCleanupDecision =
  | { action: "keep" }
  | {
      action: "mark" | "review_required";
      status: string;
      reason: string;
    };

export function classifyIncompleteLeadIdentity(
  snapshot: LeadIdentitySnapshot,
  support: LeadIdentitySupport
): LeadCleanupDecision {
  const hasClient = Boolean(snapshot.clientAccountId || snapshot.clientName);
  const hasFirst = Boolean(snapshot.firstName);
  const hasLast = Boolean(snapshot.lastName);
  const missingCore = !hasClient && !hasFirst && !hasLast;

  if (!missingCore) return { action: "keep" };

  const supportedValuePresent = {
    fullName: support.fullName && Boolean(snapshot.fullName),
    phone: support.phone && Boolean(snapshot.phone),
    email: support.email && Boolean(snapshot.email),
    leadUid: support.leadUid && Boolean(snapshot.leadUid),
    contactIdGhl: support.contactIdGhl && Boolean(snapshot.contactIdGhl),
    subaccountIdGhl: support.subaccountIdGhl && Boolean(snapshot.subaccountIdGhl),
    orderId: support.orderId && Boolean(snapshot.orderId),
    routingRuleId: support.routingRuleId && Boolean(snapshot.routingRuleId),
    deliveryAttemptId: support.deliveryAttemptId && Boolean(snapshot.deliveryAttemptId),
  };

  const hasAnySupportedIdentity = Object.values(supportedValuePresent).some(Boolean);
  if (!hasAnySupportedIdentity) {
    const supportsExtendedIdentity = Object.values(support).some(Boolean);
    return {
      action: "mark",
      status: LEAD_CLEANUP_STATUSES.INCOMPLETE_MISSING_CLIENT_AND_NAME,
      reason: supportsExtendedIdentity
        ? LEAD_CLEANUP_REASONS.MISSING_ALL_IDENTITY_FIELDS
        : LEAD_CLEANUP_REASONS.MISSING_CLIENT_FIRST_LAST,
    };
  }

  // Conservative: preserve anything with partial identity anchors for manual review.
  return {
    action: "review_required",
    status: LEAD_CLEANUP_STATUSES.REVIEW_REQUIRED_INCOMPLETE_IDENTITY,
    reason: LEAD_CLEANUP_REASONS.AMBIGUOUS_PARTIAL_IDENTITY_REVIEW_REQUIRED,
  };
}

export type SourceLeadEventIdentityInput = {
  clientAccountIdResolved: string | null;
  destinationLocationIdResolved: string | null;
  routingRuleIdResolved: string | null;
  sourceLeadUid: string | null;
  normalizedPayloadJson: unknown;
};

export function extractSourceLeadEventIdentity(input: SourceLeadEventIdentityInput): {
  snapshot: LeadIdentitySnapshot;
  support: LeadIdentitySupport;
} {
  const normalized = normalizeRoutingLeadIdentity(input.normalizedPayloadJson);
  const root = asRecord(input.normalizedPayloadJson);
  const contact = asRecord(root?.contact);
  const routing = asRecord(root?.routing);

  const clientAccountId = firstNonEmpty(
    input.clientAccountIdResolved,
    root?.client_account_id,
    root?.clientAccountId,
    routing?.client_account_id,
    routing?.clientAccountId,
    contact?.client_account_id
  );

  const snapshot: LeadIdentitySnapshot = {
    clientAccountId,
    clientName: firstNonEmpty(
      root?.client_name,
      root?.clientName,
      routing?.client_name,
      routing?.clientName,
      contact?.client_name
    ),
    firstName: normalized?.firstName ?? null,
    lastName: normalized?.lastName ?? null,
    fullName: normalized?.leadName ?? null,
    phone: normalized?.phone ?? null,
    email: normalized?.email ?? null,
    leadUid: firstNonEmpty(input.sourceLeadUid, contact?.lead_uid),
    contactIdGhl: firstNonEmpty(normalized?.contactIdGhl, contact?.contact_id_ghl),
    subaccountIdGhl: firstNonEmpty(
      input.destinationLocationIdResolved,
      root?.subaccount_id_ghl,
      routing?.subaccount_id_ghl
    ),
    orderId: null,
    routingRuleId: trimOrNull(input.routingRuleIdResolved),
    deliveryAttemptId: null,
  };

  return {
    snapshot,
    support: {
      fullName: true,
      phone: true,
      email: true,
      leadUid: true,
      contactIdGhl: true,
      subaccountIdGhl: true,
      orderId: false,
      routingRuleId: true,
      deliveryAttemptId: false,
    },
  };
}

export type RoutingDryRunDecisionIdentityInput = {
  masterClientAccountId: string | null;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  sourceLeadUid: string | null;
  matchedRuleId: string | null;
  attributionSnapshot: unknown;
};

export function extractRoutingDryRunDecisionIdentity(input: RoutingDryRunDecisionIdentityInput): {
  snapshot: LeadIdentitySnapshot;
  support: LeadIdentitySupport;
} {
  const normalized = normalizeRoutingLeadIdentity(input.attributionSnapshot);
  const root = asRecord(input.attributionSnapshot);

  const snapshot: LeadIdentitySnapshot = {
    clientAccountId: firstNonEmpty(
      input.destinationClientAccountId,
      input.masterClientAccountId,
      root?.client_account_id,
      root?.clientAccountId
    ),
    clientName: firstNonEmpty(root?.client_name, root?.clientName),
    firstName: normalized?.firstName ?? null,
    lastName: normalized?.lastName ?? null,
    fullName: normalized?.leadName ?? null,
    phone: normalized?.phone ?? null,
    email: normalized?.email ?? null,
    leadUid: firstNonEmpty(input.sourceLeadUid, root?.lead_uid),
    contactIdGhl: normalized?.contactIdGhl ?? null,
    subaccountIdGhl: trimOrNull(input.destinationSubaccountIdGhl),
    orderId: null,
    routingRuleId: trimOrNull(input.matchedRuleId),
    deliveryAttemptId: null,
  };

  return {
    snapshot,
    support: {
      fullName: true,
      phone: true,
      email: true,
      leadUid: true,
      contactIdGhl: true,
      subaccountIdGhl: true,
      orderId: false,
      routingRuleId: true,
      deliveryAttemptId: false,
    },
  };
}

export type InboundContactIndexIdentityInput = {
  clientAccountId: string | null;
  subaccountIdGhl: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  phoneE164: string | null;
  email: string | null;
  leadUid: string | null;
  contactIdGhl: string | null;
};

export function extractInboundContactIdentity(input: InboundContactIndexIdentityInput): {
  snapshot: LeadIdentitySnapshot;
  support: LeadIdentitySupport;
} {
  const snapshot: LeadIdentitySnapshot = {
    clientAccountId: trimOrNull(input.clientAccountId),
    clientName: null,
    firstName: trimOrNull(input.firstName),
    lastName: trimOrNull(input.lastName),
    fullName: trimOrNull(input.displayName),
    phone: trimOrNull(input.phoneE164),
    email: trimOrNull(input.email),
    leadUid: trimOrNull(input.leadUid),
    contactIdGhl: trimOrNull(input.contactIdGhl),
    subaccountIdGhl: trimOrNull(input.subaccountIdGhl),
    orderId: null,
    routingRuleId: null,
    deliveryAttemptId: null,
  };

  return {
    snapshot,
    support: {
      fullName: true,
      phone: true,
      email: true,
      leadUid: true,
      contactIdGhl: true,
      subaccountIdGhl: true,
      orderId: false,
      routingRuleId: false,
      deliveryAttemptId: false,
    },
  };
}

export function summarizeIdentity(snapshot: LeadIdentitySnapshot): Record<string, string | null> {
  return {
    clientAccountId: snapshot.clientAccountId,
    firstName: snapshot.firstName,
    lastName: snapshot.lastName,
    fullName: snapshot.fullName,
    phone: snapshot.phone,
    email: snapshot.email,
    leadUid: snapshot.leadUid,
    contactIdGhl: snapshot.contactIdGhl,
    subaccountIdGhl: snapshot.subaccountIdGhl,
    routingRuleId: snapshot.routingRuleId,
  };
}
