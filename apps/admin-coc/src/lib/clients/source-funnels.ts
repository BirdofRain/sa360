import { lookupNicheDisplayName } from "@sa360/shared";

import {
  LEADCAPTURE_HOSTED_PAGE_HOST,
  normalizeLeadCaptureParentUrl,
} from "./leadcapture-page-url";

export type SourceFunnelAssociationStatus = "unassociated" | "suggested" | "confirmed";

export type SourceFunnelAdminItem = {
  id: string;
  provider: string;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  pageSlug: string | null;
  observedFunnelName: string | null;
  nicheKey: string | null;
  associationStatus: SourceFunnelAssociationStatus;
  suggestedClientAccountId: string | null;
  originClientAccountId: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type SourceFunnelListResponse = {
  ok: true;
  count: number;
  items: SourceFunnelAdminItem[];
};

export type AssociateSourceFunnelSuccess = {
  ok: true;
  created: boolean;
  parentUrlKey: string;
  pageSlug: string | null;
  backfilledInventoryCount: number;
  item: SourceFunnelAdminItem;
};

export type AssociateSourceFunnelResult =
  | AssociateSourceFunnelSuccess
  | SourceFunnelOriginConflict
  | { ok: false; error: string };

export type SourceFunnelOriginConflict = {
  ok: false;
  error: string;
  code: "confirm_requires_explicit_reassign";
  sourceFunnelId: string;
  parentUrlKey: string | null;
  pageSlug: string | null;
  currentOriginClientAccountId: string;
  currentOriginClientDisplayName: string | null;
  requestedOriginClientAccountId: string;
  item: SourceFunnelAdminItem | null;
};

export type ConfirmSourceFunnelSuccess = {
  ok: true;
  backfilledInventoryCount: number;
  item: SourceFunnelAdminItem;
};

export type ReassignSourceFunnelSuccess = {
  ok: true;
  newlyStamped: number;
  reassigned: number;
  conflictsSkipped: number;
  item: SourceFunnelAdminItem;
};

export type ClearSourceFunnelSuccess = {
  ok: true;
  clearedInventoryCount: number;
  item: SourceFunnelAdminItem;
};

export const LEADCAPTURE_SOURCES_EMPTY_INPUT = "Enter a LeadCapture page URL or slug.";
export const LEADCAPTURE_SOURCES_UNRECOGNIZED =
  "That value could not be recognized as a valid LeadCapture source.";
export const LEADCAPTURE_SOURCES_OWNED_ELSEWHERE =
  "This source is already associated with another client.";

const NICHE_LABELS: Record<string, string> = {
  vet_fex: "Veteran",
  vet: "Veteran",
  VET: "Veteran",
  nurse_life: "Nurse",
  NURSE: "Nurse",
  health_insurance: "Health",
  HEALTH: "Health",
  trucker_life: "Trucker",
  TRUCKER: "Trucker",
  mortgage_protection: "Mortgage",
  MORTGAGE: "Mortgage",
  final_expense: "Final expense",
};

export function sourceFunnelDisplayName(item: Pick<SourceFunnelAdminItem, "observedFunnelName">): string {
  const name = item.observedFunnelName?.trim();
  return name || "LeadCapture source";
}

export function sourceFunnelNicheLabel(nicheKey: string | null | undefined): string | null {
  const key = nicheKey?.trim();
  if (!key) return null;
  return lookupNicheDisplayName(key) ?? NICHE_LABELS[key] ?? key;
}

export function isWaitingForFirstLead(
  item: Pick<SourceFunnelAdminItem, "firstSeenAt">
): boolean {
  return !item.firstSeenAt;
}

/**
 * Full lead timestamp for the associated-source card. Rendered in UTC so two
 * operators comparing the same source read the same instant.
 */
export function formatSourceFunnelLeadTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export const SOURCE_FUNNEL_NO_LEAD_YET = "No lead yet";

export type SourceFunnelPageIdentity = {
  /** Lowercased hostname actually stored in parentUrlKey. Never dropped for custom domains. */
  hostname: string | null;
  pathname: string | null;
  /** True only inside the known my.leadcapture.io namespace. */
  hostedPage: boolean;
  /** Label matching how the host is used, so a custom domain never reads as a hosted page. */
  hostLabel: "Custom domain" | "LeadCapture domain";
  parentUrlKey: string | null;
};

/**
 * Splits the stored identity back into host + page without inventing either.
 * Identity is persisted as hostname + pathname, so both halves are displayable;
 * a source registered before #135 may still carry only a pageSlug.
 */
export function sourceFunnelPageIdentity(
  item: Pick<SourceFunnelAdminItem, "parentUrlKey" | "pageSlug">
): SourceFunnelPageIdentity {
  const parentUrlKey = item.parentUrlKey?.trim() || null;
  if (!parentUrlKey) {
    const slug = item.pageSlug?.trim() || null;
    return {
      hostname: null,
      pathname: slug ? `/${slug.replace(/^\/+/, "")}` : null,
      hostedPage: false,
      hostLabel: "Custom domain",
      parentUrlKey: null,
    };
  }
  const parsed = normalizeLeadCaptureParentUrl(`https://${parentUrlKey}`);
  if (!parsed) {
    return {
      hostname: null,
      pathname: null,
      hostedPage: false,
      hostLabel: "Custom domain",
      parentUrlKey,
    };
  }
  const hostedPage = parsed.hostname === LEADCAPTURE_HOSTED_PAGE_HOST;
  return {
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    hostedPage,
    hostLabel: hostedPage ? "LeadCapture domain" : "Custom domain",
    parentUrlKey,
  };
}

export function sourceFunnelAssociationLabel(
  item: Pick<SourceFunnelAdminItem, "associationStatus">
): string {
  if (item.associationStatus === "confirmed") return "Confirmed";
  if (item.associationStatus === "suggested") return "Suggested source";
  return "Unassociated";
}

export function sourceFunnelObservationLabel(
  item: Pick<SourceFunnelAdminItem, "firstSeenAt">
): string {
  return isWaitingForFirstLead(item) ? "Waiting for first lead" : "Observed";
}

export type SourceFunnelMatchEvidence = { label: string; value: string };

/**
 * The identity this source is actually matched on. Only persisted fields are
 * listed — the Legacy route key arrives per event and is not stored on the
 * funnel, so it is never claimed here.
 */
export function sourceFunnelMatchEvidence(
  item: Pick<SourceFunnelAdminItem, "parentUrlKey" | "pageSlug" | "providerFunnelId">
): SourceFunnelMatchEvidence[] {
  const evidence: SourceFunnelMatchEvidence[] = [];
  const identity = sourceFunnelPageIdentity(item);
  if (identity.parentUrlKey) {
    evidence.push({ label: "Page URL", value: identity.parentUrlKey });
  }
  if (identity.hostedPage && item.pageSlug?.trim()) {
    evidence.push({ label: "Hosted slug", value: item.pageSlug.trim() });
  }
  const formId = item.providerFunnelId?.trim();
  if (formId) {
    evidence.push({ label: "Form ID", value: formId });
  }
  return evidence;
}

export function associateSuccessMessage(result: {
  created: boolean;
  backfilledInventoryCount: number;
  firstSeenAt: string | null;
}): string {
  if (result.created && isWaitingForFirstLead({ firstSeenAt: result.firstSeenAt })) {
    return "LeadCapture source associated. Waiting for the first lead from this page.";
  }
  if (result.backfilledInventoryCount > 0) {
    return `LeadCapture source associated. ${result.backfilledInventoryCount} existing inventory records were tagged with this origin client.`;
  }
  return "LeadCapture source associated.";
}

export function confirmSuccessMessage(backfilledInventoryCount: number): string {
  if (backfilledInventoryCount > 0) {
    return `LeadCapture source associated. ${backfilledInventoryCount} existing inventory records were tagged with this origin client.`;
  }
  return "LeadCapture source associated.";
}

export function reassignSuccessMessage(result: {
  newlyStamped: number;
  reassigned: number;
  conflictsSkipped: number;
}): string {
  const corrected = result.newlyStamped + result.reassigned;
  const correctedPhrase =
    corrected === 1
      ? "1 inventory record was corrected"
      : `${corrected} inventory records were corrected`;
  if (result.conflictsSkipped > 0) {
    const skipped =
      result.conflictsSkipped === 1
        ? "1 conflicting record was left unchanged"
        : `${result.conflictsSkipped} conflicting records were left unchanged`;
    return `Source reassigned. ${correctedPhrase}. ${skipped}.`;
  }
  if (corrected > 0) {
    return `Source reassigned. ${correctedPhrase}.`;
  }
  return "Source reassigned.";
}

export function clearSuccessMessage(clearedInventoryCount: number): string {
  if (clearedInventoryCount > 0) {
    return `Source association removed. ${clearedInventoryCount} matching inventory records were cleared.`;
  }
  return "Source association removed.";
}

export function reassignConfirmCopy(input: {
  currentOwner: string;
  newOwner: string;
}): string {
  return `Reassign this LeadCapture source?\n\nThis source is currently associated with ${input.currentOwner}.\n\nReassigning it to ${input.newOwner} changes the origin client for matching inventory generated by this source. Existing matching provenance will be corrected.`;
}

export const CLEAR_ASSOCIATION_CONFIRM_COPY =
  "Remove this LeadCapture association?\n\nThis removes the source from this client and clears matching origin-client stamps. It does not delete the source or its leads.";

export function partitionClientSourceFunnels(items: SourceFunnelAdminItem[]): {
  confirmed: SourceFunnelAdminItem[];
  suggested: SourceFunnelAdminItem[];
} {
  return {
    confirmed: items.filter((item) => item.associationStatus === "confirmed"),
    suggested: items.filter((item) => item.associationStatus === "suggested"),
  };
}

export function parseSourceFunnelConflict(body: string): SourceFunnelOriginConflict | null {
  try {
    const parsed = JSON.parse(body) as Partial<SourceFunnelOriginConflict>;
    if (parsed.code !== "confirm_requires_explicit_reassign") return null;
    if (!parsed.sourceFunnelId || !parsed.currentOriginClientAccountId) return null;
    return {
      ok: false,
      error: typeof parsed.error === "string" ? parsed.error : LEADCAPTURE_SOURCES_OWNED_ELSEWHERE,
      code: "confirm_requires_explicit_reassign",
      sourceFunnelId: parsed.sourceFunnelId,
      parentUrlKey: parsed.parentUrlKey ?? null,
      pageSlug: parsed.pageSlug ?? null,
      currentOriginClientAccountId: parsed.currentOriginClientAccountId,
      currentOriginClientDisplayName: parsed.currentOriginClientDisplayName ?? null,
      requestedOriginClientAccountId: parsed.requestedOriginClientAccountId ?? "",
      item: parsed.item ?? null,
    };
  } catch {
    return null;
  }
}

export function operatorSafeSourceFunnelError(message: string | null | undefined): string {
  const text = message?.trim() || "Unable to complete source association.";
  if (/prisma|sql|stack|ECONN|password|secret/i.test(text) && !text.startsWith("Admin API")) {
    return "Unable to complete source association.";
  }
  return text;
}
