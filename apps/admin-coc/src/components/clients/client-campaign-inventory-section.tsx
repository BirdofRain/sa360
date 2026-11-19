import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  campaignInventoryEvidenceLabel,
  type CampaignInventoryCandidateView,
  type CampaignInventoryView,
} from "@/lib/clients/campaign-inventory";

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "min-w-0 break-all font-mono" : "min-w-0 break-words"}>{value}</dd>
    </>
  );
}

function onOff(value: boolean | null): string {
  if (value == null) return "Not stored";
  return value ? "On" : "Off";
}

function CandidateCard({ candidate }: { candidate: CampaignInventoryCandidateView }) {
  const leadType =
    candidate.leadTypes.length === 0
      ? "Not stored"
      : candidate.leadTypes.map((item) => item.label ?? `${item.key} (not a catalog label)`).join(", ");
  const identifiers =
    candidate.exactIdentifiers.length === 0
      ? "None"
      : candidate.exactIdentifiers.map((item) => `${item.kind} ${item.value}`).join("; ");
  return (
    <li className="rounded-md border border-slate-200 px-3 py-2" data-testid={`campaign-candidate-${candidate.inventoryKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Candidate</span>
        <Badge variant="outline">{campaignInventoryEvidenceLabel(candidate.evidenceQuality)} evidence</Badge>
        <Badge variant="outline">{candidate.grouping.replaceAll("_", " ")}</Badge>
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        <Fact label="Exact identifiers" value={identifiers} mono />
        <Fact label="Niche" value={candidate.nicheKeys.join(", ") || "Not stored"} />
        <Fact label="Product" value={candidate.productTypes.join(", ") || "Not stored"} />
        <Fact label="Lead Type" value={leadType} />
        <Fact
          label="Routing authority"
          value={candidate.routingAuthorities.join(", ") || "None"}
        />
        <Fact label="GHL workflow" value={candidate.ghlWorkflows.join(", ") || candidate.ghlDefaultWorkflowId || "Not stored"} mono />
        <Fact label="Sheets tab" value={candidate.sheetsTabTitle ?? "No bound campaign tab"} />
        <Fact
          label="Published map"
          value={candidate.publishedMapVersion == null ? "None" : `Version ${candidate.publishedMapVersion}`}
        />
        <Fact label="Last source event" value={candidate.lastSourceEventId ?? "None"} mono />
        <Fact label="Last source event at" value={candidate.lastSourceEventAt ?? "None"} />
        <Fact label="Rule delivery" value={onOff(candidate.observedDelivery.anyRuleDeliveryEnabled)} />
        <Fact label="Rule active" value={onOff(candidate.observedDelivery.anyRuleActive)} />
        <Fact label="Client GHL delivery" value={onOff(candidate.observedDelivery.clientGhlDeliveryEnabled)} />
        <Fact label="Sheets enabled" value={onOff(candidate.observedDelivery.sheetsEnabled)} />
        <Fact label="Sheets campaign dispatch" value={onOff(candidate.observedDelivery.sheetsCampaignDispatchEnabled)} />
      </dl>
      {candidate.sources.length > 0 ? (
        <ul className="mt-2 grid gap-1">
          {candidate.sources.map((source) => (
            <li key={source.id} className="text-xs text-slate-700">
              <span className="font-medium">{source.originConfirmed ? "Confirmed source" : "Suggested source"}</span>
              {": "}
              <span className="font-mono">{source.providerFunnelId ?? source.parentUrlKey ?? source.id}</span>
              {source.observedFunnelName ? ` (${source.observedFunnelName}; display name is not ownership)` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No source is in this candidate.</p>
      )}
      {candidate.rules.length > 0 ? (
        <ul className="mt-1 grid gap-1">
          {candidate.rules.map((rule) => (
            <li key={rule.id} className="text-xs text-slate-700">
              <span className="font-mono">{rule.matchType}</span>
              {rule.campaignId ? ` ${rule.campaignId}` : ""}
              {rule.exact ? "" : " (not an exact identifier)"}
              {rule.active ? ", active" : ", inactive"}
              {rule.deliveryEnabled ? ", delivery on" : ", delivery off"}
              {rule.destinationWorkflowIdGhl ? `, workflow ${rule.destinationWorkflowIdGhl}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-slate-600">{candidate.authorityNote}</p>
      {candidate.conflicts.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {candidate.conflicts.map((code) => (
            <li key={code}>
              <Badge variant="outline">{code.replaceAll("_", " ")}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ClientCampaignInventorySection({
  inventory,
  loadError,
}: {
  inventory: CampaignInventoryView | null;
  loadError: string | null;
}) {
  return (
    <section
      aria-labelledby="client-campaign-inventory-heading"
      className="rounded-xl border border-slate-200 bg-white shadow-sm"
      data-testid="client-campaign-inventory"
    >
      <div className="border-b border-slate-200 p-4">
        <h2 id="client-campaign-inventory-heading" className="text-lg font-semibold">
          Campaigns
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only inventory of this client&apos;s sources and routing rules. Candidates are grouped
          only by exact identifiers. This section does not confirm a source, create a routing rule, or
          change delivery.
        </p>
      </div>
      <div className="grid gap-3 p-4">
        {loadError || !inventory ? (
          <p className="text-sm text-amber-900" role="status">
            {loadError ?? "Campaign inventory could not be read. It was not treated as empty."}
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              {inventory.candidateCount} candidate{inventory.candidateCount === 1 ? "" : "s"},{" "}
              {inventory.confirmedSourceCount} confirmed source{inventory.confirmedSourceCount === 1 ? "" : "s"},{" "}
              {inventory.suggestedSourceCount} suggested, {inventory.routingRuleCount} routing rule
              {inventory.routingRuleCount === 1 ? "" : "s"}.
            </p>
            <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
              <Fact label="Account niches" value={inventory.accountNiches.join(", ") || "None stored"} />
              <Fact label="GHL location" value={inventory.ghlLocationId ?? "Not stored"} mono />
              <Fact label="GHL delivery" value={onOff(inventory.ghlDeliveryEnabled)} />
              <Fact label="Sheets" value={inventory.sheetsTitle ?? "Not stored"} />
              <Fact label="Campaign tab" value={inventory.sheetsCampaignTabBound ? "Bound" : "Not bound"} />
            </dl>
            <p className="text-xs text-muted-foreground">
              GoHighLevel and Company Sheets shown here are the client destination, shared by every
              candidate. They are not a per-campaign binding.
            </p>
            {inventory.ambiguities.length > 0 ? (
              <ul className="grid gap-1">
                {inventory.ambiguities.map((item) => (
                  <li key={item.code} className="text-xs text-slate-700">
                    {item.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {inventory.conflicts.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
                {inventory.conflicts.map((item) => (
                  <li key={item.code}>
                    <Badge variant="outline" title={item.message}>
                      {item.code.replaceAll("_", " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            {inventory.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No campaign candidates. This client has no confirmed source, suggested source, or routing rule.
              </p>
            ) : (
              <ul className="grid gap-2">
                {inventory.candidates.map((item) => (
                  <CandidateCard key={item.inventoryKey} candidate={item} />
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-3 text-xs">
              <Link href="#advanced-configuration" className="text-sky-700 hover:underline">
                Source association tools
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
