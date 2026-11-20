import type { CampaignShadowView } from "@/lib/source-intake/campaign-shadow";

function line(label: string, value: string | null | undefined) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="break-all">{value && value.length > 0 ? value : "—"}</p>
    </div>
  );
}

export function CampaignShadowPanel({ view }: { view: CampaignShadowView | null }) {
  if (!view) return null;
  const decision = view.decision;
  return (
    <section className="space-y-2 rounded-lg border p-3 text-xs" data-testid="campaign-shadow-panel">
      <p className="font-medium">Campaign shadow</p>
      <p data-testid="campaign-shadow-banner">{view.banner}</p>
      <p data-testid="campaign-shadow-evaluation">Evaluation: {view.evaluation}</p>
      {decision ? (
        <div className="grid grid-cols-2 gap-2">
          {line("Resolution", decision.status)}
          {line("Routing authority", decision.winningRoutingAuthority)}
          {line("Campaign", decision.campaignDisplayName ?? decision.clientCampaignId)}
          {line("Slug", decision.campaignSlug)}
          {line("Revision", decision.campaignRevision === null ? null : String(decision.campaignRevision))}
          {line("Provider", decision.provider)}
          {line(
            "Exact evidence",
            decision.sourceEvidence.map((item) => `${item.kind}=${item.normalizedValue}`).join(", ")
          )}
          {line("Expected niche", decision.configuredNicheKey)}
          {line("Product", decision.configuredProductType)}
          {line("Incoming niche", decision.incomingNormalized ?? decision.incomingRaw)}
          {line("Niche provenance", decision.incomingProvenance)}
          {line("Niche status", decision.nicheClassificationStatus)}
          {line("Untrusted niche", decision.untrustedNiche)}
          {line("Lead Type", decision.leadTypeLabel ?? decision.leadTypeKey)}
          {line("Lead Type status", decision.leadTypeStatus)}
          {line("Proposed niche tag", decision.tagsAuthorized ? decision.nicheTag : null)}
          {line("Proposed campaign tag", decision.tagsAuthorized ? decision.campaignTag : null)}
          {line("Tag approval", decision.tagsAuthorized ? "proposed" : decision.tagReason)}
          {line("Requested workflow", decision.workflowIdGhl)}
          {line(
            "Requested worksheet",
            decision.worksheetTitle ?? (decision.worksheetId === null ? null : String(decision.worksheetId))
          )}
          {line("Reasons", decision.reasonCodes.join(", "))}
        </div>
      ) : (
        <p data-testid="campaign-shadow-empty">No shadow decision is stored for this event.</p>
      )}
    </section>
  );
}
