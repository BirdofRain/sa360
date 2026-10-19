"use client";

import { useState } from "react";

import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  HISTORICAL_ASSOCIATION_CONTRACT_VIEW,
  type HistoricalCensusGroupView,
  type HistoricalCensusMeasurementView,
  type HistoricalCensusPanelModel,
  type HistoricalCensusView,
  type HistoricalOrderPanelModel,
  type HistoricalOrderView,
} from "@/lib/fulfillment-ops/historical-campaign-census";

type PanelProps = {
  census: HistoricalCensusPanelModel;
  order: HistoricalOrderPanelModel;
  orderId: string | null;
  censusRequested: boolean;
  requestedOrderNumber: string | null;
};

function preserve(orderId: string | null, censusRequested: boolean, orderNumber: string | null) {
  return (
    <>
      {censusRequested ? <input type="hidden" name="historicalCensus" value="1" /> : null}
      {orderId ? <input type="hidden" name="orderId" value={orderId} /> : null}
      {orderNumber ? <input type="hidden" name="historicalOrder" value={orderNumber} /> : null}
    </>
  );
}

function IdentityNote({
  measurement,
  testId,
}: {
  measurement: HistoricalCensusMeasurementView;
  testId: string;
}) {
  const identity = measurement.databaseIdentity;
  const identityKey = `${identity.name}|${identity.serverAddress}|${identity.capturedAt}`;
  const [verifiedIdentity, setVerifiedIdentity] = useState<string | null>(null);
  const operatorVerified = verifiedIdentity === identityKey;
  return (
    <div data-testid={testId} data-operator-verified={operatorVerified ? "true" : "false"}>
      <WarningBanner
        tone={operatorVerified ? "info" : "warn"}
        title={
          operatorVerified
            ? "Operator verified this PostgreSQL identity is production."
            : "Completed read-only snapshot. Production identity is not verified."
        }
      >
        PostgreSQL reports database {identity.name} at {identity.serverAddress}, captured {identity.capturedAt}. This
        click stays in the browser. The API still reports operatorVerifiedProduction false.
      </WarningBanner>
      {operatorVerified ? null : (
        <button
          type="button"
          className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
          onClick={() => setVerifiedIdentity(identityKey)}
        >
          I verified this PostgreSQL identity is production
        </button>
      )}
    </div>
  );
}

function GroupTable<T extends HistoricalCensusGroupView>({
  caption,
  rows,
  label,
}: {
  caption: string;
  rows: T[];
  label: keyof T;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-left text-sm">
        <caption className="mb-2 text-left text-xs font-medium text-slate-500">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500">
            <th className="py-2 pr-3 font-medium">Key</th>
            <th className="py-2 pr-3 font-medium">Rows</th>
            <th className="py-2 pr-3 font-medium">Distinct labels</th>
            <th className="py-2 pr-3 font-medium">Unresolved</th>
            <th className="py-2 pr-3 font-medium">Stamped</th>
            <th className="py-2 pr-3 font-medium">Consistent</th>
            <th className="py-2 pr-3 font-medium">Missing</th>
            <th className="py-2 pr-3 font-medium">Conflicting</th>
            <th className="py-2 font-medium">Reserved</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="py-2 text-slate-500" colSpan={9}>
                No historical rows in this snapshot.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${caption}:${String(row[label])}`} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-mono text-xs">{String(row[label])}</td>
                <td className="py-2 pr-3">{row.inventoryRows}</td>
                <td className="py-2 pr-3">{row.distinctOriginalLabels}</td>
                <td className="py-2 pr-3">{row.unresolvedOriginRows}</td>
                <td className="py-2 pr-3">{row.stampedOriginRows}</td>
                <td className="py-2 pr-3">{row.consistentOriginalLabelRows}</td>
                <td className="py-2 pr-3">{row.missingAttributionRows}</td>
                <td className="py-2 pr-3">{row.conflictingAttributionRows}</td>
                <td className="py-2">{row.reservedRows}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CensusReady({ report }: { report: HistoricalCensusView }) {
  const population = report.population;
  const labels = report.labelPopulations;
  return (
    <div className="space-y-4 p-4">
      <IdentityNote measurement={report.measurement} testId="historical-census-measurement" />
      <p className="text-sm text-slate-600">
        Historical manual_import / csv_import rows only. July sourceCampaignName is classified and omitted. A matching
        client name is not ownership. Policy {report.policyId}. Recovery policy {report.recoveryPolicyId}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="historical-census-rows">
        <StatTile label="Historical rows" value={population.inventoryRows} />
        <StatTile label="Unresolved origin" value={population.unresolvedOriginRows} tone="warn" />
        <StatTile label="Stamped origin" value={population.stampedOriginRows} />
        <StatTile label="Distinct original labels" value={population.distinctOriginalLabels} />
        <StatTile label="Consistent original label" value={population.consistentOriginalLabelRows} />
        <StatTile label="Missing attribution" value={population.missingAttributionRows} />
        <StatTile label="Conflicting attribution" value={population.conflictingAttributionRows} tone="warn" />
        <StatTile label="Open allocations" value={report.openAllocations.rows} />
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3" data-testid="historical-census-label-sizes">
        <div>Labels with 1 row: {labels.oneRow}</div>
        <div>Labels with 2–10 rows: {labels.twoToTenRows}</div>
        <div>Labels with 11–100 rows: {labels.elevenToOneHundredRows}</div>
        <div>Labels with 101–1,000 rows: {labels.oneHundredOneToOneThousandRows}</div>
        <div>Labels with more than 1,000 rows: {labels.overOneThousandRows}</div>
        <div>Largest label, rows: {labels.largestLabelInventoryRows}</div>
      </dl>
      <GroupTable caption="By niche" rows={report.byNiche} label="nicheKey" />
      <GroupTable caption="By inventory lot" rows={report.byLot} label="lotKey" />
      <GroupTable
        caption="By niche and lot"
        rows={report.byNicheAndLot.map((row) => ({
          ...row,
          nicheAndLot: `${row.nicheKey} / ${row.lotKey}`,
        }))}
        label="nicheAndLot"
      />
      <GroupTable caption="By import request" rows={report.byImportRequest} label="importRequest" />
      <GroupTable caption="By original-label agreement" rows={report.byAgreement} label="agreement" />
      <GroupTable caption="By inventory status" rows={report.byInventoryStatus} label="status" />
      <div>
        <h4 className="text-sm font-medium text-slate-800">Already-stamped original clients</h4>
        {report.stampedOriginClients.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">No stamped origin in this snapshot.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {report.stampedOriginClients.map((client) => (
              <li key={client.originClientAccountId} className="flex justify-between gap-3 border-b py-1">
                <span className="font-mono text-xs">{client.originClientAccountId}</span>
                <span>{client.inventoryRows}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="text-sm font-medium text-slate-800">Open allocations on historical rows</h4>
        {report.openAllocations.byStatus.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">None in this snapshot.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {report.openAllocations.byStatus.map((row) => (
              <li key={row.status} className="flex justify-between border-b py-1">
                <span className="font-mono text-xs">{row.status}</span>
                <span>{row.allocations}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function OrderReady({ report }: { report: HistoricalOrderView }) {
  const policy = report.reservedRevisedPolicy;
  return (
    <div className="space-y-4 p-4" data-testid="historical-order-ready">
      <IdentityNote measurement={report.measurement} testId="historical-order-measurement" />
      <p className="text-sm text-slate-600">
        Order {report.orderNumber} is {report.orderStatus}. Buyer client account{" "}
        <span className="font-mono" data-testid="historical-order-buyer">
          {report.buyerClientAccountId}
        </span>
        . Resale authorization is not stored. This view does not release, export, cancel, or stamp ownership.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="historical-order-reserved">
        <StatTile label="Allocations" value={report.allocations.rows} />
        <StatTile label="Reserved" value={report.allocations.reservedRows} />
        <StatTile label="Origin equals buyer" value={report.allocations.originEqualsBuyerRows} tone="warn" />
        <StatTile label="Origin is another client" value={report.allocations.originOtherClientRows} />
        <StatTile label="Origin unstamped" value={report.allocations.originUnstampedRows} />
        <StatTile label="Missing inventory" value={report.allocations.missingInventoryRows} />
      </div>
      <div data-testid="historical-order-policy">
        <h4 className="text-sm font-medium text-slate-800">Reserved rows under historical-campaign-recovery-v1</h4>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>Would block, unresolved origin: {policy.wouldBlockUnresolvedOrigin}</div>
          <div>Would block, same origin: {policy.wouldBlockSameOrigin}</div>
          <div>Would block until resale authorization: {policy.wouldBlockUntilResaleAuthorization}</div>
          <div>Outside the historical gate: {policy.outsideHistoricalGate}</div>
          <div>Would block, missing inventory: {policy.wouldBlockMissingInventory}</div>
        </dl>
      </div>
      <div className="grid gap-4 lg:grid-cols-3 text-sm">
        <CountList title="Allocation status" rows={report.allocations.byStatus.map((row) => [row.status, row.allocations])} />
        <CountList
          title="Provenance"
          rows={report.allocations.byProvenance.map((row) => [row.provenance, row.allocations])}
        />
        <CountList title="Lot" rows={report.allocations.byLot.map((row) => [row.lotKey, row.allocations])} />
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="historical-order-delivery">
        <div>Export packages: {report.delivery.packages}</div>
        <div>Spreadsheet delivered: {report.delivery.spreadsheetDeliveredPackages}</div>
        <div>
          Notify statuses:{" "}
          {report.delivery.notifyByStatus.map((row) => `${row.status} ${row.packages}`).join(", ") || "none"}
        </div>
        <div>
          Delivery instructions:{" "}
          {report.delivery.instructionsByStatus.map((row) => `${row.status} ${row.instructions}`).join(", ") || "none"}
        </div>
        <div>
          Replacements: {report.replacementsByStatus.map((row) => `${row.status} ${row.requests}`).join(", ") || "none"}
        </div>
      </dl>
    </div>
  );
}

function CountList({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div>
      <h4 className="font-medium text-slate-800">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-1 text-slate-600">None.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map(([key, count]) => (
            <li key={`${title}:${key}`} className="flex justify-between gap-3">
              <span className="font-mono text-xs">{key}</span>
              <span>{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssociationContract() {
  const contract = HISTORICAL_ASSOCIATION_CONTRACT_VIEW;
  return (
    <SectionPanel title="Historical campaign association">
      <div className="space-y-3 p-4 text-sm text-slate-700" data-testid="historical-association-contract">
        <p>
          Contract {contract.contractId} is not implemented. Original-client ownership and resale authorization stay
          separate. A client may own many import-scoped labels. The same display text in another import is a different
          identity. Preview comes before confirmation. A client-name match does not establish ownership.
        </p>
        <p>
          Auth header <span className="font-mono">{contract.authHeader}</span>. The provenance audit credential is not
          accepted. Flag <span className="font-mono">{contract.featureFlag}</span> stays off.
        </p>
        <ul className="space-y-2">
          {contract.routes.map((route) => (
            <li key={route.path}>
              <span className="font-mono text-xs">
                {route.method} {route.path}
              </span>
              <div>{route.effect}</div>
            </li>
          ))}
        </ul>
      </div>
    </SectionPanel>
  );
}

export function HistoricalCampaignCensusPanel({
  census,
  order,
  orderId,
  censusRequested,
  requestedOrderNumber,
}: PanelProps) {
  const preserveOrder = order.state === "invalid" ? null : requestedOrderNumber;
  return (
    <div className="space-y-4">
      <SectionPanel title="Historical campaign census">
        <div data-testid="historical-census-panel" data-state={census.state}>
          <form action="/fulfillment-ops" method="get" className="flex flex-wrap items-center gap-2 px-4 pt-4">
            {preserve(orderId, false, preserveOrder)}
            <input type="hidden" name="historicalCensus" value="1" />
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              Run read-only census
            </button>
            <span className="text-xs text-slate-500">One snapshot. A second request while it runs does not return zeros.</span>
          </form>
          {census.state === "idle" ? (
            <p className="p-4 text-sm text-slate-700">
              The census is not loaded. Set SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED=true on the API, then run it. No
              inventory total is shown before a completed snapshot.
            </p>
          ) : null}
          {census.state === "disabled" ? (
            <p className="p-4 text-sm text-slate-700">
              The historical campaign census is off. Set SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED=true on the API. No
              inventory total is shown.
            </p>
          ) : null}
          {census.state === "unavailable" ? (
            <div className="p-4">
              <WarningBanner tone="err" title="Historical census is unavailable. This is not a zero result.">
                The snapshot did not finish. No inventory total is shown.
              </WarningBanner>
            </div>
          ) : null}
          {census.state === "ready" ? <CensusReady report={census.report} /> : null}
        </div>
      </SectionPanel>

      <SectionPanel title="Reserved order drill-down">
        <div data-testid="historical-order-panel" data-state={order.state}>
          <form action="/fulfillment-ops" method="get" className="flex flex-wrap items-end gap-2 px-4 pt-4">
            {preserve(orderId, censusRequested, null)}
            <label className="text-sm text-slate-700">
              Order number
              <input
                name="historicalOrder"
                defaultValue={requestedOrderNumber ?? "LO-1053"}
                className="mt-1 block rounded-md border border-slate-300 px-2 py-1 font-mono text-sm"
                data-testid="historical-order-input"
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              Open read-only drill-down
            </button>
          </form>
          {order.state === "idle" ? (
            <p className="p-4 text-sm text-slate-700">
              No order is loaded. Submit an order number to count its allocations. LO-1053 is the default text and is
              not queried until you submit.
            </p>
          ) : null}
          {order.state === "disabled" ? (
            <p className="p-4 text-sm text-slate-700">
              The drill-down is off with the census flag. No allocation total is shown.
            </p>
          ) : null}
          {order.state === "invalid" ? (
            <p className="p-4 text-sm text-slate-700">
              That order number is not accepted. Use uppercase letters, digits, and hyphens.
            </p>
          ) : null}
          {order.state === "not_found" ? (
            <div className="p-4">
              <WarningBanner tone="warn" title={`${order.orderNumber} was not found. This is not a zero result.`}>
                No allocation total is shown.
              </WarningBanner>
            </div>
          ) : null}
          {order.state === "unavailable" ? (
            <div className="p-4">
              <WarningBanner tone="err" title="Order drill-down is unavailable. This is not a zero result.">
                The snapshot did not finish. No allocation total is shown.
              </WarningBanner>
            </div>
          ) : null}
          {order.state === "ready" ? <OrderReady report={order.report} /> : null}
        </div>
      </SectionPanel>

      <AssociationContract />
    </div>
  );
}
