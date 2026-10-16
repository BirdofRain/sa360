"use client";

import { useState, useTransition } from "react";
import { CANONICAL_US_STATE_CODES } from "@sa360/shared";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clientLookupBuyerAvailability,
  type BuyerInventoryAvailabilityReport,
} from "@/lib/fulfillment-ops/client-api";
import { presentationLabelForBucket } from "@/lib/fulfillment-ops/ppl-pricing-catalog";

const AGED_TIERS = [
  "COMMERCE_1_3_MO",
  "COMMERCE_3_6_MO",
  "COMMERCE_6_9_MO",
  "COMMERCE_9_12_MO",
  "COMMERCE_12_MO_PLUS",
] as const;

const NICHES = [
  { value: "trucker", label: "Trucker" },
  { value: "vet", label: "Veteran" },
  { value: "nurse", label: "Nurse" },
] as const;

function countedLabel(value: { count: number; countSemantics: string } | undefined): string {
  if (!value) return "—";
  return value.countSemantics === "exact" ? String(value.count) : `at least ${value.count}`;
}

export function BuyerAvailabilityPanel({
  enabled,
  clients,
}: {
  enabled: boolean;
  clients: Array<{ id: string; label: string }>;
}) {
  const [clientAccountId, setClientAccountId] = useState("");
  const [nicheKey, setNicheKey] = useState("trucker");
  const [statesText, setStatesText] = useState("GA");
  const [tiers, setTiers] = useState<string[]>([...AGED_TIERS]);
  const [report, setReport] = useState<BuyerInventoryAvailabilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!enabled) {
    return (
      <SectionPanel title="Buyer availability">
        <div className="space-y-2 p-4" data-testid="buyer-availability-disabled">
          <p className="text-sm text-slate-700">
            Buyer-specific availability lookup is off. Set
            {" "}
            <span className="font-mono">SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED=true</span>
            {" "}
            to enable this read-only check. It does not create orders, reservations, or deliveries.
          </p>
        </div>
      </SectionPanel>
    );
  }

  const states = statesText
    .split(/[\s,]+/)
    .map((state) => state.trim().toUpperCase())
    .filter(Boolean);
  const allTiers = tiers.length === AGED_TIERS.length;

  return (
    <SectionPanel title="Buyer availability">
      <form
        className="space-y-3 p-4"
        data-testid="buyer-availability-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setReport(null);
          startTransition(async () => {
            const result = await clientLookupBuyerAvailability({
              clientAccountId: clientAccountId.trim(),
              nicheKey,
              states,
              ...(allTiers ? {} : { commerceAgeBucketKeys: tiers }),
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setReport(result.data);
          });
        }}
      >
        <WarningBanner tone="info" title="Read-only eligibility count">
          Uses the same buyer-ready, age, allocation, commerce, protected-agent, and prior-delivery
          rules as selection. Confirmed origin matching this buyer is excluded. Missing origin is
          unresolved and is not counted as eligible. This check does not reserve or deliver leads.
        </WarningBanner>
        <div className="grid gap-2 md:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Buyer client account</span>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              data-testid="buyer-availability-client"
              value={clients.some((client) => client.id === clientAccountId) ? clientAccountId : ""}
              onChange={(event) => setClientAccountId(event.target.value)}
            >
              <option value="">Select buyer…</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Canonical client account id</span>
            <Input
              value={clientAccountId}
              onChange={(event) => setClientAccountId(event.target.value)}
              placeholder="client account id"
              data-testid="buyer-availability-client-id"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Niche</span>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              data-testid="buyer-availability-niche"
              value={nicheKey}
              onChange={(event) => setNicheKey(event.target.value)}
            >
              {NICHES.map((niche) => (
                <option key={niche.value} value={niche.value}>
                  {niche.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">States</span>
            <Input
              value={statesText}
              onChange={(event) => setStatesText(event.target.value)}
              placeholder="GA"
              list="buyer-availability-states"
              data-testid="buyer-availability-states"
            />
            <datalist id="buyer-availability-states">
              {CANONICAL_US_STATE_CODES.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
          </label>
        </div>
        <fieldset className="grid gap-2 md:grid-cols-5">
          <legend className="mb-1 text-sm text-muted-foreground">Aged tiers</legend>
          {AGED_TIERS.map((tier) => (
            <label key={tier} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tiers.includes(tier)}
                data-testid={`buyer-availability-tier-${tier}`}
                onChange={(event) => {
                  setTiers((current) =>
                    event.target.checked
                      ? [...current, tier]
                      : current.filter((key) => key !== tier)
                  );
                }}
              />
              {presentationLabelForBucket(tier)}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={pending || !clientAccountId.trim() || states.length === 0 || tiers.length === 0}
            data-testid="buyer-availability-submit"
          >
            {pending ? "Checking availability…" : "Check availability"}
          </Button>
          {error ? (
            <span className="text-sm text-red-700" data-testid="buyer-availability-error">
              {error}
            </span>
          ) : null}
        </div>
        {report ? <BuyerAvailabilityResult report={report} /> : null}
      </form>
    </SectionPanel>
  );
}

function BuyerAvailabilityResult({ report }: { report: BuyerInventoryAvailabilityReport }) {
  const incomplete = report.queryCompleteness === "incomplete" || report.eligibleCountSemantics === "lower_bound";
  return (
    <div className="space-y-3 border-t border-slate-100 pt-3" data-testid="buyer-availability-result">
      {incomplete ? (
        <WarningBanner tone="warn" title="Incomplete scan — lower bound">
          {report.summary}
        </WarningBanner>
      ) : (
        <p className="text-sm text-slate-800" data-testid="buyer-availability-summary">
          {report.summary}
        </p>
      )}
      <p className="text-sm text-slate-700" data-testid="buyer-availability-total">
        {report.buyer.clientDisplayName} / {report.nicheKey} / {report.states.join(", ")} —{" "}
        {incomplete ? "at least " : ""}
        {report.eligibleTotal} buyer-eligible
        {incomplete ? " (lower bound)" : " (exact)"}
        {" · "}
        evaluated {report.evaluatedAt}
      </p>
      {report.eligibleTotal === 0 && report.queryCompleteness === "complete" ? (
        <EmptyState
          title="No definitively buyer-eligible leads"
          hint="Unresolved origin is listed separately and is not counted as eligible."
        />
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Age tier</th>
              <th className="py-1 pr-3 font-medium">Eligible</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.ageTiers.map((tier) => (
              <tr key={tier.commerceAgeBucketKey} data-testid={`buyer-availability-tier-row-${tier.commerceAgeBucketKey}`}>
                <td className="py-1 pr-3">{presentationLabelForBucket(tier.commerceAgeBucketKey)}</td>
                <td className="py-1 pr-3">
                  {tier.countSemantics === "not_reached"
                    ? "not reached"
                    : tier.countSemantics === "lower_bound"
                      ? `at least ${tier.eligible ?? 0}`
                      : tier.eligible}
                </td>
                <td className="py-1">{tier.countSemantics}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-2 text-sm md:grid-cols-3" data-testid="buyer-availability-provenance">
        <div>
          <dt className="text-muted-foreground">Structural cohort (exact)</dt>
          <dd>{report.structuralCohort.rows}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Same-origin stamp</dt>
          <dd>{countedLabel(report.exclusionReasons.originClientStamped as BuyerAvailabilityCounted)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Unresolved origin</dt>
          <dd>{countedLabel(report.exclusionReasons.originUnresolved as BuyerAvailabilityCounted)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reconciled from source funnel</dt>
          <dd>{report.provenance.reconciledFromSourceFunnel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Prior buyer delivery</dt>
          <dd>{countedLabel(report.exclusionReasons.sameBuyerPriorDelivery as BuyerAvailabilityCounted)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Open allocation / reserved</dt>
          <dd>
            {countedLabel(report.exclusionReasons.existingAllocation as BuyerAvailabilityCounted)}
            {" / "}
            {countedLabel(report.exclusionReasons.reserved as BuyerAvailabilityCounted)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{report.provenance.coverageNote}</p>
    </div>
  );
}

type BuyerAvailabilityCounted = {
  count: number;
  countSemantics: "exact" | "lower_bound";
};
