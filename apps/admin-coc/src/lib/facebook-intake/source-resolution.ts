export type SourceResolutionClassification =
  | "unstamped_confirmed_owner"
  | "unknown_ownership"
  | "cannot_identify"
  | "ambiguous_owner";

export type SourceResolutionOutcomeCounts = {
  associated: number;
  unassociated: number;
  ambiguous: number;
  missingFormIdentity: number;
  invalidFormIdentity: number;
  notEvaluated: number;
  associationDisabled: number;
  absent: number;
  other: number;
};

export type SourceResolutionEventRef = {
  sourceEventId: string;
  status: string;
  receivedAt: string;
  normalizedAt: string | null;
  storedAssociationOutcome: string;
};

export type SourceResolutionGroupView = {
  pageId: string | null;
  formId: string | null;
  campaignId: string | null;
  unresolvedEvents: number;
  classification: SourceResolutionClassification;
  confirmedOriginClientAccountId: string | null;
  confirmedSourceFunnelId: string | null;
  sourceFunnelCreatedAt: string | null;
  sourceFunnelUpdatedAt: string | null;
  earliestReceivedAt: string | null;
  latestReceivedAt: string | null;
  outcomes: SourceResolutionOutcomeCounts;
  explanation: string;
  events: SourceResolutionEventRef[];
};

export type SourceResolutionAssociationView = {
  id: string;
  pageId: string;
  formId: string;
  associationStatus: string;
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
  ownership: "confirmed" | "suggested_not_authority" | "unassociated";
  createdAt: string;
  updatedAt: string;
};

export type SourceResolutionReviewView = {
  readOnly: true;
  writesPerformed: false;
  summary: {
    events: number;
    byStatus: Array<{ status: string; events: number }>;
    settledCaptureOnly: number;
    unresolvedClient: number;
    unstampedDespiteConfirmedOwner: number;
    cannotIdentify: number;
    invalidSourceIdentifiers: number;
    unresolvedWithPageFormAndCampaign: number;
  };
  associations: {
    items: SourceResolutionAssociationView[];
    total: number;
    limit: number;
    offset: number;
    truncated: boolean;
  };
  groups: {
    items: SourceResolutionGroupView[];
    total: number;
    limit: number;
    offset: number;
  };
};

const CLASSIFICATIONS = new Set<SourceResolutionClassification>([
  "unstamped_confirmed_owner",
  "unknown_ownership",
  "cannot_identify",
  "ambiguous_owner",
]);

const SECRET_KEY = /payload|email|phone|token|secret|cipher|password|firstname|lastname|name/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function unsafeKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => SECRET_KEY.test(key) && key !== "storedAssociationOutcome");
}

function isOwnership(
  value: unknown
): value is SourceResolutionAssociationView["ownership"] {
  return value === "confirmed" || value === "suggested_not_authority" || value === "unassociated";
}

export function sourceResolutionClassificationLabel(classification: SourceResolutionClassification): string {
  switch (classification) {
    case "unstamped_confirmed_owner":
      return "Unresolved. A confirmed SourceFunnel matches.";
    case "unknown_ownership":
      return "Unresolved. No confirmed owner.";
    case "cannot_identify":
      return "Cannot identify. Page or Form is missing.";
    case "ambiguous_owner":
      return "Unresolved. More than one confirmed owner.";
  }
}

export function sanitizeSourceResolutionReview(value: unknown): SourceResolutionReviewView | null {
  const root = asRecord(value);
  const summary = asRecord(root?.summary);
  const associations = asRecord(root?.associations);
  const groups = asRecord(root?.groups);
  if (!root || !summary || !associations || !groups) return null;
  if (unsafeKeys(root) || root.readOnly !== true || root.writesPerformed !== false) return null;
  const byStatus = Array.isArray(summary.byStatus)
    ? summary.byStatus.flatMap((item) => {
        const row = asRecord(item);
        if (!row || typeof row.status !== "string") return [];
        return [{ status: row.status, events: count(row.events) }];
      })
    : [];
  const associationItems = Array.isArray(associations.items)
    ? associations.items.flatMap((item) => {
        const row = asRecord(item);
        if (!row || unsafeKeys(row) || typeof row.id !== "string" || typeof row.pageId !== "string" || typeof row.formId !== "string") {
          return [];
        }
        if (!isOwnership(row.ownership)) return [];
        const ownership = row.ownership;
        return [
          {
            id: row.id,
            pageId: row.pageId,
            formId: row.formId,
            associationStatus: typeof row.associationStatus === "string" ? row.associationStatus : ownership,
            originClientAccountId: text(row.originClientAccountId),
            suggestedClientAccountId: text(row.suggestedClientAccountId),
            ownership,
            createdAt: text(row.createdAt) ?? "",
            updatedAt: text(row.updatedAt) ?? "",
          },
        ];
      })
    : [];
  const groupItems = Array.isArray(groups.items)
    ? groups.items.flatMap((item) => {
        const row = asRecord(item);
        if (!row || unsafeKeys(row)) return [];
        const classification = row.classification;
        if (typeof classification !== "string" || !CLASSIFICATIONS.has(classification as SourceResolutionClassification)) {
          return [];
        }
        const outcomes = asRecord(row.outcomes) ?? {};
        const events = Array.isArray(row.events)
          ? row.events.flatMap((event) => {
              const eventRow = asRecord(event);
              if (!eventRow || typeof eventRow.sourceEventId !== "string") return [];
              return [
                {
                  sourceEventId: eventRow.sourceEventId,
                  status: typeof eventRow.status === "string" ? eventRow.status : "",
                  receivedAt: text(eventRow.receivedAt) ?? "",
                  normalizedAt: text(eventRow.normalizedAt),
                  storedAssociationOutcome:
                    typeof eventRow.storedAssociationOutcome === "string" ? eventRow.storedAssociationOutcome : "absent",
                },
              ];
            })
          : [];
        return [
          {
            pageId: text(row.pageId),
            formId: text(row.formId),
            campaignId: text(row.campaignId),
            unresolvedEvents: count(row.unresolvedEvents),
            classification: classification as SourceResolutionClassification,
            confirmedOriginClientAccountId: text(row.confirmedOriginClientAccountId),
            confirmedSourceFunnelId: text(row.confirmedSourceFunnelId),
            sourceFunnelCreatedAt: text(row.sourceFunnelCreatedAt),
            sourceFunnelUpdatedAt: text(row.sourceFunnelUpdatedAt),
            earliestReceivedAt: text(row.earliestReceivedAt),
            latestReceivedAt: text(row.latestReceivedAt),
            outcomes: {
              associated: count(outcomes.associated),
              unassociated: count(outcomes.unassociated),
              ambiguous: count(outcomes.ambiguous),
              missingFormIdentity: count(outcomes.missing_form_identity),
              invalidFormIdentity: count(outcomes.invalid_form_identity),
              notEvaluated: count(outcomes.not_evaluated),
              associationDisabled: count(outcomes.association_disabled),
              absent: count(outcomes.absent),
              other: count(outcomes.other),
            },
            explanation: typeof row.explanation === "string" ? row.explanation : "",
            events,
          },
        ];
      })
    : [];
  return {
    readOnly: true,
    writesPerformed: false,
    summary: {
      events: count(summary.events),
      byStatus,
      settledCaptureOnly: count(summary.settledCaptureOnly),
      unresolvedClient: count(summary.unresolvedClient),
      unstampedDespiteConfirmedOwner: count(summary.unstampedDespiteConfirmedOwner),
      cannotIdentify: count(summary.cannotIdentify),
      invalidSourceIdentifiers: count(summary.invalidSourceIdentifiers),
      unresolvedWithPageFormAndCampaign: count(summary.unresolvedWithPageFormAndCampaign),
    },
    associations: {
      items: associationItems,
      total: count(associations.total),
      limit: count(associations.limit),
      offset: count(associations.offset),
      truncated: associations.truncated === true,
    },
    groups: {
      items: groupItems,
      total: count(groups.total),
      limit: count(groups.limit),
      offset: count(groups.offset),
    },
  };
}
