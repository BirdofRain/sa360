/**
 * Operator view of a stored campaign shadow decision.
 * Parsing does not invent a campaign, a niche, or a tag.
 */

export type CampaignShadowView = {
  banner: string;
  /** A stored campaign id is not permission to deliver. */
  executionAuthorized: false;
  evaluation: "stored" | "not_evaluated";
  shadowEnabled: boolean;
  decision: null | {
    status: string;
    evaluatedAt: string;
    winningRoutingAuthority: string | null;
    provider: string | null;
    sourceEvidence: Array<{ kind: string; normalizedValue: string }>;
    clientCampaignId: string | null;
    campaignDisplayName: string | null;
    campaignSlug: string | null;
    campaignRevision: number | null;
    configuredNicheKey: string | null;
    configuredProductType: string | null;
    nicheClassificationStatus: string;
    incomingRaw: string | null;
    incomingNormalized: string | null;
    incomingProvenance: string;
    untrustedNiche: string | null;
    reasonCodes: string[];
    leadTypeKey: string | null;
    leadTypeLabel: string | null;
    leadTypeStatus: string | null;
    nicheTag: string | null;
    campaignTag: string | null;
    tagsAuthorized: boolean;
    tagReason: string | null;
    workflowIdGhl: string | null;
    worksheetTitle: string | null;
    worksheetId: number | null;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseCampaignShadowView(payload: unknown): CampaignShadowView | null {
  const root = record(payload);
  if (!root || root.ok !== true) return null;
  const evaluation = root.evaluation === "stored" ? "stored" : "not_evaluated";
  const decision = record(root.decision);
  if (evaluation !== "stored" || !decision) {
    return {
      banner: text(root.banner) ?? "Shadow analysis only — no campaign-specific delivery executed.",
      executionAuthorized: false,
      evaluation: "not_evaluated",
      shadowEnabled: root.shadowEnabled === true,
      decision: null,
    };
  }
  const incoming = record(decision.incomingNiche);
  const untrusted = Array.isArray(incoming?.untrustedObservations) ? incoming.untrustedObservations : [];
  const firstUntrusted = record(untrusted[0]);
  const leadType = record(decision.leadTypeDecision);
  const tags = record(decision.proposedTags);
  const destination = record(decision.destinationSelection);
  const evidence = Array.isArray(decision.sourceEvidence) ? decision.sourceEvidence : [];
  return {
    banner: text(root.banner) ?? "Shadow analysis only — no campaign-specific delivery executed.",
    executionAuthorized: false,
    evaluation: "stored",
    shadowEnabled: root.shadowEnabled === true,
    decision: {
      status: text(decision.status) ?? "UNRESOLVED",
      evaluatedAt: text(decision.evaluatedAt) ?? "",
      winningRoutingAuthority: text(decision.winningRoutingAuthority),
      provider: text(decision.provider),
      sourceEvidence: evidence.flatMap((item) => {
        const row = record(item);
        const kind = text(row?.kind);
        const normalizedValue = text(row?.normalizedValue);
        return kind && normalizedValue ? [{ kind, normalizedValue }] : [];
      }),
      clientCampaignId: text(decision.clientCampaignId),
      campaignDisplayName: text(decision.campaignDisplayName),
      campaignSlug: text(decision.campaignSlug),
      campaignRevision: typeof decision.campaignRevision === "number" ? decision.campaignRevision : null,
      configuredNicheKey: text(decision.configuredNicheKey),
      configuredProductType: text(decision.configuredProductType),
      nicheClassificationStatus: text(decision.nicheClassificationStatus) ?? "UNRESOLVED",
      incomingRaw: text(incoming?.trustedRawValue),
      incomingNormalized: text(incoming?.trustedNormalizedKey),
      incomingProvenance: text(incoming?.trustedProvenance) ?? "none",
      untrustedNiche: text(firstUntrusted?.normalizedKey) ?? text(firstUntrusted?.rawValue),
      reasonCodes: stringList(decision.reasonCodes),
      leadTypeKey: text(leadType?.leadTypeKey),
      leadTypeLabel: text(leadType?.leadTypeLabel),
      leadTypeStatus: text(leadType?.status),
      nicheTag: text(tags?.nicheTag),
      campaignTag: text(tags?.campaignTag),
      tagsAuthorized: tags?.authorized === true,
      tagReason: text(tags?.reason),
      workflowIdGhl: text(destination?.workflowIdGhl),
      worksheetTitle: text(destination?.worksheetTitle),
      worksheetId: typeof destination?.worksheetId === "number" ? destination.worksheetId : null,
    },
  };
}
