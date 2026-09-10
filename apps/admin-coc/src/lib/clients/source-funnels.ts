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
  return NICHE_LABELS[key] ?? key;
}

export function isWaitingForFirstLead(
  item: Pick<SourceFunnelAdminItem, "firstSeenAt">
): boolean {
  return !item.firstSeenAt;
}

export function formatSourceFunnelSeenAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
