import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type {
  ProvenanceBreakdownView,
  ProvenanceImpactPanelModel,
  ProvenanceImpactView,
} from "@/lib/fulfillment-ops/provenance-impact";

function BreakdownTable({
  caption,
  rows,
}: {
  caption: string;
  rows: ProvenanceBreakdownView[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="mb-2 text-left text-xs font-medium text-slate-500">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500">
            <th className="py-2 pr-3 font-medium">Key</th>
            <th className="py-2 pr-3 font-medium">Before</th>
            <th className="py-2 pr-3 font-medium">Blocked</th>
            <th className="py-2 font-medium">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="py-2 text-slate-500" colSpan={4}>
                No rows in the structural gate.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${caption}:${row.key}`} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-mono text-xs">{row.key}</td>
                <td className="py-2 pr-3">{row.before}</td>
                <td className="py-2 pr-3">{row.blocked}</td>
                <td className="py-2">{row.remaining}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function OrderList({ title, numbers }: { title: string; numbers: string[] }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{title}</div>
      {numbers.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">None in this snapshot.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {numbers.map((orderNumber) => (
            <li key={orderNumber} className="font-mono text-sm">
              {orderNumber}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadyReport({ report }: { report: ProvenanceImpactView }) {
  const gate = report.structuralGate;
  const labels = report.historicalCampaignLabels;
  const reserved = report.reservedAndAllocations;
  const percent = gate.percentBlocked === null ? "—" : `${gate.percentBlocked}%`;

  return (
    <div className="space-y-4 p-4">
      <WarningBanner tone="info" title="Production inventory impact is not measured by this screen.">
        These figures describe the database the API is connected to ({report.database.name} at{" "}
        {report.database.serverAddress}, captured {report.database.capturedAt}). Production impact is measured
        only after this route is deployed, SA360_PROVENANCE_AUDIT_ENABLED=true is set on that API,
        and a completed query is confirmed against production. This snapshot does not change
        inventory, allocations, orders, or leads.
      </WarningBanner>
      <p className="text-sm text-slate-600">
        Structural gate only. Same-origin buyer exclusion is not applied. Policy {report.policyId}.
        Verified-acquisition evidence is treated as absent.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div data-testid="provenance-impact-before">
          <StatTile label="Available before gate" value={gate.availableBeforeGate} />
        </div>
        <div data-testid="provenance-impact-blocked">
          <StatTile label="Blocked by gate" value={gate.blockedByGate} tone="warn" />
        </div>
        <div data-testid="provenance-impact-remaining">
          <StatTile label="Remaining after gate" value={gate.remainingAfterGate} />
        </div>
        <div data-testid="provenance-impact-percent">
          <StatTile label="Percent blocked" value={percent} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable caption="By niche" rows={report.breakdowns.byNiche} />
        <BreakdownTable caption="By inventory lot" rows={report.breakdowns.byLot} />
        <BreakdownTable caption="By item provider" rows={report.breakdowns.byItemProvider} />
        <BreakdownTable caption="By event provider" rows={report.breakdowns.byEventProvider} />
        <BreakdownTable caption="By event system" rows={report.breakdowns.byEventSystem} />
      </div>
      <div data-testid="provenance-impact-campaign-recovery">
        <h4 className="text-sm font-medium text-slate-800">Historical campaign-label recovery</h4>
        <p className="mt-1 text-sm text-slate-600">
          csv_import events only. Counts of stored labels, not the label text.
        </p>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>csv_import events: {labels.events}</div>
          <div>Nonempty original labels: {labels.eventsWithNonemptySourceCampaignName}</div>
          <div>Distinct labels: {labels.distinctSourceCampaignNameCount}</div>
          <div>Recoverable events: {labels.recoverableConsistentEvents}</div>
          <div>Conflicting events: {labels.conflictingEvents}</div>
          <div>Missing events: {labels.missingEvents}</div>
          <div>Distinct recoverable labels: {labels.distinctRecoverableLabelCount}</div>
          <div>Distinct conflicting labels: {labels.distinctConflictingLabelCount}</div>
        </dl>
      </div>
      <div data-testid="provenance-impact-at-risk">
        <h4 className="text-sm font-medium text-slate-800">At-risk reserved orders</h4>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>Reserved items unresolved: {reserved.reservedItemsUnresolved}</div>
          <div>Open allocations unresolved: {reserved.openAllocationsUnresolved}</div>
          <div>Orders with unresolved reserved allocations: {reserved.ordersWithUnresolvedReservedAllocations}</div>
          <div>
            Mixed eligible and unresolved orders:{" "}
            {reserved.ordersWithMixedEligibleAndUnresolvedReservedAllocations}
          </div>
        </dl>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <OrderList title="Unresolved reserved order numbers" numbers={reserved.unresolvedReservedOrderNumbers} />
          <OrderList title="Mixed reserved order numbers" numbers={reserved.mixedReservedOrderNumbers} />
        </div>
      </div>
    </div>
  );
}

export function ProvenanceImpactPanel({ model }: { model: ProvenanceImpactPanelModel }) {
  return (
    <SectionPanel title="Inventory Provenance Impact">
      <div data-testid="provenance-impact-panel" data-state={model.state}>
        {model.state === "disabled" ? (
          <div className="space-y-2 p-4">
            <p className="text-sm text-slate-700">
              The provenance impact audit is off. Set{" "}
              <span className="font-mono">SA360_PROVENANCE_AUDIT_ENABLED=true</span> on the API to
              run this read-only snapshot. It does not change inventory, allocations, or orders.
            </p>
          </div>
        ) : null}
        {model.state === "unavailable" ? (
          <div className="p-4">
            <WarningBanner tone="err" title="Provenance impact is unavailable. This is not a zero result.">
              The audit did not finish a consistent read. No inventory total is shown.
            </WarningBanner>
          </div>
        ) : null}
        {model.state === "ready" ? <ReadyReport report={model.report} /> : null}
      </div>
    </SectionPanel>
  );
}
