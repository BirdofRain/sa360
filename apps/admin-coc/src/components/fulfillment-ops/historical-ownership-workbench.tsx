"use client";

import { useMemo, useState } from "react";

import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  campaignSelectionKey,
  ownershipWorkbenchNotice,
  PROTECTED_RESERVATION_ORDER_NUMBER,
  type CatalogCampaignView,
  type CatalogView,
  type PreviewView,
} from "@/lib/fulfillment-ops/historical-ownership-preview";

type ClientOption = { id: string; label: string };

const CATALOG_PATH = "/api/fulfillment-ops/historical-campaign-catalog";
const PREVIEW_PATH = "/api/fulfillment-ops/historical-campaign-ownership-preview";
const MAPPING_MAX_CHARS = 65_536;

async function postWorkbench(path: string, body: unknown): Promise<{ catalog: CatalogView | null; preview: PreviewView | null; code: string | null }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    state?: string;
    code?: string;
    catalog?: CatalogView;
    preview?: PreviewView;
  } | null;
  if (payload?.state === "ready" && payload.catalog) return { catalog: payload.catalog, preview: null, code: null };
  if (payload?.state === "ready" && payload.preview) return { catalog: null, preview: payload.preview, code: null };
  return { catalog: null, preview: null, code: payload?.code ?? "historical_ownership_preview_unavailable" };
}

function messageFor(code: string): string {
  return ownershipWorkbenchNotice(code);
}

export function OwnershipPreviewReadout({ preview }: { preview: PreviewView }) {
  return (
    <div className="space-y-3" data-testid="ownership-preview-readout">
      <WarningBanner tone="warn" title="UNVERIFIED">
        <span data-testid="ownership-verification-status" data-status="UNVERIFIED">
          Every proposed mapping is UNVERIFIED. This preview does not confirm ownership, write a registry alias, or
          stamp inventory.
        </span>
      </WarningBanner>
      {preview.lo1053ReservedAllocations > 0 ? (
        <WarningBanner tone="err" title={`${PROTECTED_RESERVATION_ORDER_NUMBER} reservations affected`}>
          <span data-testid="lo-1053-warning">
            Selected campaigns include {preview.lo1053ReservedAllocations} reserved allocations on{" "}
            {PROTECTED_RESERVATION_ORDER_NUMBER}. This preview does not release, deliver, export, cancel, or modify
            them.
          </span>
        </WarningBanner>
      ) : (
        <p className="text-sm text-slate-600" data-testid="lo-1053-clear">
          {PROTECTED_RESERVATION_ORDER_NUMBER} reserved allocations affected: 0.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label="Campaigns" value={preview.proposals.length} />
        <StatTile
          label="Matched rows"
          value={preview.proposals.reduce((sum, row) => sum + row.inventoryRows, 0)}
        />
        <StatTile label="Unlabeled in scope" value={preview.unlabeledRowsInSelectedScopes} />
        <StatTile label="LO-1053 reserved" value={preview.lo1053ReservedAllocations} />
      </div>
      {preview.unlabeledRowsInSelectedScopes > 0 ? (
        <p className="text-sm text-slate-700" data-testid="unlabeled-scope-note">
          {preview.unlabeledRowsInSelectedScopes} July-blank inventory rows in the selected lot and import are not part
          of these campaigns.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">July identity</th>
              <th className="py-2 pr-3 font-medium">Lot / import</th>
              <th className="py-2 pr-3 font-medium">Rows</th>
              <th className="py-2 pr-3 font-medium">Reserved</th>
              <th className="py-2 pr-3 font-medium">Missing labels</th>
              <th className="py-2 pr-3 font-medium">Same client</th>
              <th className="py-2 pr-3 font-medium">Other client</th>
              <th className="py-2 pr-3 font-medium">Conflicts</th>
              <th className="py-2 pr-3 font-medium">Persisted decision</th>
              <th className="py-2 font-medium">Hypothetical decision</th>
            </tr>
          </thead>
          <tbody>
            {preview.proposals.map((row) => (
              <tr key={campaignSelectionKey({ lotKey: row.lotKey ?? "", importRequest: row.importRequest ?? "", normalizedLabel: row.normalizedLabel })} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-medium">UNVERIFIED</td>
                <td className="py-2 pr-3 font-mono text-xs">{row.normalizedLabel}</td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {row.lotKey ?? "—"}
                  <br />
                  {row.importRequest ?? "—"}
                </td>
                <td className="py-2 pr-3">{row.inventoryRows}</td>
                <td className="py-2 pr-3">{row.reservedRows}</td>
                <td className="py-2 pr-3">{row.missingLabelRows}</td>
                <td className="py-2 pr-3">{row.alreadyStampedToSameClient}</td>
                <td className="py-2 pr-3">{row.alreadyStampedToOtherClient}</td>
                <td className="py-2 pr-3">
                  {row.conflict}
                  {row.scopeConflict !== "none" ? ` / ${row.scopeConflict}` : ""}
                  {row.conflictingLabelRows > 0 ? ` / labels ${row.conflictingLabelRows}` : ""}
                  {row.lo1053ReservedAllocations > 0 ? ` / LO-1053 ${row.lo1053ReservedAllocations}` : ""}
                </td>
                <td className="py-2 pr-3">
                  {row.persistedDecision}: {row.persistedReason}
                  {row.persistedOriginClientAccountId ? ` (${row.persistedOriginClientAccountId})` : ""}
                </td>
                <td className="py-2">
                  {row.hypotheticalDecision}: {row.hypotheticalReason}
                  <div className="text-xs text-slate-500">Not persisted. Buyer exclusion rows {row.rowsThatWouldExcludeProposedClientAsBuyer}.</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HistoricalOwnershipWorkbench({ clients }: { clients: ClientOption[] }) {
  const [lotKey, setLotKey] = useState("");
  const [importRequest, setImportRequest] = useState("");
  const [niche, setNiche] = useState("");
  const [label, setLabel] = useState("");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [selected, setSelected] = useState<Map<string, CatalogCampaignView>>(new Map());
  const [clientId, setClientId] = useState("");
  const [mappingText, setMappingText] = useState("");
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedCount = selected.size;
  const pageCount = catalog ? Math.max(1, Math.ceil(catalog.totalCampaigns / catalog.pageSize)) : 1;
  const clientLabel = useMemo(() => clients.find((client) => client.id === clientId)?.label ?? "", [clients, clientId]);

  async function search(nextPage: number) {
    setPending(true);
    setNotice(null);
    setPreview(null);
    const result = await postWorkbench(CATALOG_PATH, {
      lotKey: lotKey.trim() || undefined,
      importRequest: importRequest.trim() || undefined,
      niche: niche.trim() || undefined,
      label: label.trim() || undefined,
      page: nextPage,
      pageSize: 25,
    });
    setPending(false);
    if (!result.catalog) {
      setCatalog(null);
      setNotice(messageFor(result.code ?? "historical_campaign_catalog_unavailable"));
      return;
    }
    setPage(nextPage);
    setCatalog(result.catalog);
  }

  async function previewSelection() {
    if (!clientId || (selected.size === 0 && mappingText.trim() === "")) {
      setNotice("Select an original client and at least one campaign or mapping file.");
      return;
    }
    setPending(true);
    setNotice(null);
    const result = await postWorkbench(PREVIEW_PATH, {
      proposedOriginClientAccountId: clientId,
      campaigns: [...selected.values()].map((row) => ({
        lotKey: row.lotKey,
        importRequest: row.importRequest,
        normalizedLabel: row.normalizedLabel,
      })),
      ...(mappingText.trim() ? { mappingText } : {}),
    });
    setPending(false);
    if (!result.preview) {
      setPreview(null);
      setNotice(messageFor(result.code ?? "historical_ownership_preview_unavailable"));
      return;
    }
    setPreview(result.preview);
  }

  function toggle(row: CatalogCampaignView) {
    const key = campaignSelectionKey(row);
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(key)) next.delete(key);
      else next.set(key, row);
      return next;
    });
  }

  return (
    <SectionPanel title="Historical Campaign Ownership">
      <div className="space-y-4 p-4" data-testid="historical-ownership-workbench">
        <WarningBanner tone="info" title="UNVERIFIED preview">
          <span data-testid="ownership-workbench-unverified">
            Proposed mappings stay UNVERIFIED. Searching and previewing do not write ownership or inventory.
          </span>
        </WarningBanner>
        <p className="text-sm text-slate-600" data-testid="ownership-confirm-absent">
          Ownership confirmation is not available in this workbench.
        </p>
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void search(1);
          }}
        >
          <label className="text-sm text-slate-700">
            Inventory lot
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
              value={lotKey}
              onChange={(event) => setLotKey(event.target.value)}
              data-testid="ownership-lot-filter"
            />
          </label>
          <label className="text-sm text-slate-700">
            Import request
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
              value={importRequest}
              onChange={(event) => setImportRequest(event.target.value)}
              data-testid="ownership-import-filter"
            />
          </label>
          <label className="text-sm text-slate-700">
            Niche
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={niche}
              onChange={(event) => setNiche(event.target.value)}
              data-testid="ownership-niche-filter"
            />
          </label>
          <label className="text-sm text-slate-700">
            July label
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              data-testid="ownership-label-filter"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 md:col-span-4 md:w-fit"
            disabled={pending}
          >
            Search campaigns
          </button>
        </form>
        {notice ? (
          <WarningBanner tone="warn" title="Ownership workbench">
            {notice}
          </WarningBanner>
        ) : null}
        {catalog ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <StatTile label="Campaigns in scope" value={catalog.totalCampaigns} />
              <StatTile label="Missing July labels" value={catalog.missingLabelRows} />
              <StatTile label="Conflicting labels" value={catalog.conflictingLabelRows} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[72rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Select</th>
                    <th className="py-2 pr-3 font-medium">July label</th>
                    <th className="py-2 pr-3 font-medium">Normalized identity</th>
                    <th className="py-2 pr-3 font-medium">Lot</th>
                    <th className="py-2 pr-3 font-medium">Import</th>
                    <th className="py-2 pr-3 font-medium">Niche</th>
                    <th className="py-2 pr-3 font-medium">Rows</th>
                    <th className="py-2 pr-3 font-medium">Available</th>
                    <th className="py-2 pr-3 font-medium">Reserved</th>
                    <th className="py-2 font-medium">Registry</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.campaigns.map((row) => {
                    const key = campaignSelectionKey(row);
                    return (
                      <tr key={key} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            aria-label={`Select ${row.normalizedLabel}`}
                            onChange={() => toggle(row)}
                          />
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{row.displayLabel}</td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {row.normalizedLabel}
                          {row.whitespaceVariantCount > 1 ? (
                            <div className="text-slate-500">Whitespace variants {row.whitespaceVariantCount}</div>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{row.lotKey}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{row.importRequest}</td>
                        <td className="py-2 pr-3">{row.nicheKey}</td>
                        <td className="py-2 pr-3">{row.inventoryRows}</td>
                        <td className="py-2 pr-3">{row.availableRows}</td>
                        <td className="py-2 pr-3">{row.reservedRows}</td>
                        <td className="py-2 text-xs">
                          {row.persistedDecision}: {row.persistedReason}
                          {row.originConflict ? " · origin conflict" : ""}
                          {row.conflictingAttributionRows > 0 ? ` · conflicting ${row.conflictingAttributionRows}` : ""}
                          <div>
                            Lot {row.lotAliasStatus}
                            {row.lotConfirmedOriginClientAccountId ? ` ${row.lotConfirmedOriginClientAccountId}` : ""}
                          </div>
                          <div>
                            Import {row.importAliasStatus}
                            {row.importConfirmedOriginClientAccountId
                              ? ` ${row.importConfirmedOriginClientAccountId}`
                              : ""}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1"
                disabled={pending || page <= 1}
                onClick={() => void search(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {pageCount}
              </span>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1"
                disabled={pending || page >= pageCount}
                onClick={() => void search(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No campaign list is loaded.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-700">
            Proposed original client
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              data-testid="ownership-client-select"
            >
              <option value="">Select a ClientAccount</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Optional mapping file
            <input
              type="file"
              accept=".csv,text/csv"
              className="mt-1 block w-full text-sm"
              data-testid="ownership-mapping-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  setMappingText("");
                  return;
                }
                if (file.size > MAPPING_MAX_CHARS) {
                  setMappingText("");
                  setNotice(messageFor("mapping_rejected"));
                  return;
                }
                void file.text().then((text) => {
                  setMappingText(text);
                  setNotice(null);
                });
              }}
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          {selectedCount} campaign{selectedCount === 1 ? "" : "s"} selected
          {clientLabel ? ` for ${clientLabel}` : ""}.
          {mappingText ? " Mapping file attached." : ""}
        </p>
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
          disabled={pending}
          onClick={() => void previewSelection()}
        >
          Preview ownership
        </button>
        {preview ? <OwnershipPreviewReadout preview={preview} /> : null}
      </div>
    </SectionPanel>
  );
}
