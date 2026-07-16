"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_QUARANTINE_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_REJECT_CONFIRMATION,
} from "@sa360/shared";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";

type ReviewSummary = {
  counts: {
    pendingReview: number;
    eligibleNow: number;
    blocked: number;
    available: number;
    quarantined: number;
    rejected: number;
  };
  batches: Array<{
    requestId: string;
    lotKey: string | null;
    sourceLane: string;
    imported: number;
    pending: number;
    eligible: number;
    blocked: number;
    available: number;
    quarantined: number;
    rejected: number;
    createdAt: string;
    committedAt: string | null;
  }>;
};

type ReviewItem = {
  inventoryItemId: string;
  maskedInventoryReference: string;
  lotKey: string | null;
  lotDisplayName: string;
  normalizedState: string;
  generatedAt: string;
  ageDays: number | null;
  ageBandKey: string | null;
  nicheKey: string;
  productType: string | null;
  sourceLane: string;
  duplicateStatus: string;
  provenanceStatus: string;
  eligible: boolean;
  blockerCount: number;
  blockerCodes: string[];
  status: string;
};

type PreviewResponse = {
  ok: true;
  writesPerformed: number;
  selectionFingerprint: string;
  eligibleCount: number;
  blockedCount: number;
  confirmationPhraseRequired: string;
  eligibleItems: Array<{ inventoryItemId: string; maskedInventoryReference: string }>;
  blockedItems: Array<{
    inventoryItemId: string;
    maskedInventoryReference: string;
    blockerCodes: string[];
  }>;
};

type ActionType = "make_available" | "quarantine" | "reject";

const PHRASES: Record<ActionType, string> = {
  make_available: LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
  quarantine: LEAD_INVENTORY_REVIEW_QUARANTINE_CONFIRMATION,
  reject: LEAD_INVENTORY_REVIEW_REJECT_CONFIRMATION,
};

const QUARANTINE_REASONS = [
  "duplicate_requires_investigation",
  "identity_requires_investigation",
  "provenance_requires_investigation",
  "invalid_geography",
  "invalid_age",
  "source_lane_requires_investigation",
  "compliance_requires_investigation",
  "operator_quarantine",
] as const;

const REJECT_REASONS = [
  "invalid_record",
  "confirmed_duplicate",
  "unusable_identity",
  "unsupported_geography",
  "unsupported_product",
  "missing_required_provenance",
  "operator_rejected",
] as const;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? "request_failed");
  return data;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string; code?: string };
  if (!res.ok) throw new Error(data.code ?? data.error ?? "request_failed");
  return data;
}

export function LeadInventoryReviewQueue() {
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionType, setActionType] = useState<ActionType>("make_available");
  const [reasonCode, setReasonCode] = useState("review_passed");
  const [operatorNote, setOperatorNote] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [requestId, setRequestId] = useState(() => `review-${Date.now()}`);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: "pending_review",
    normalizedState: "",
    sourceLane: "",
    ageBandKey: "",
    nicheKey: "",
    blockerCode: "",
    importBatchRequestId: "",
  });

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("status", filters.status || "pending_review");
      qs.set("limit", "100");
      if (filters.normalizedState) qs.set("normalizedState", filters.normalizedState);
      if (filters.sourceLane) qs.set("sourceLane", filters.sourceLane);
      if (filters.ageBandKey) qs.set("ageBandKey", filters.ageBandKey);
      if (filters.nicheKey) qs.set("nicheKey", filters.nicheKey);
      if (filters.blockerCode) qs.set("blockerCode", filters.blockerCode);
      if (filters.importBatchRequestId) qs.set("importBatchRequestId", filters.importBatchRequestId);

      const [summaryRes, itemsRes] = await Promise.all([
        getJson<{ ok: true; featureEnabled: boolean; summary: ReviewSummary }>(
          "/api/lead-inventory/review/summary"
        ),
        getJson<{ ok: true; featureEnabled: boolean; items: ReviewItem[] }>(
          `/api/lead-inventory/review/items?${qs.toString()}`
        ),
      ]);
      setFeatureEnabled(summaryRes.featureEnabled);
      setSummary(summaryRes.summary);
      setItems(itemsRes.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "load_failed");
    }
  }, [filters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  }

  async function openDetail(itemId: string) {
    setError(null);
    try {
      const res = await getJson<{ ok: true; item: Record<string, unknown> }>(
        `/api/lead-inventory/review/items/${encodeURIComponent(itemId)}`
      );
      setDetail(res.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "detail_failed");
    }
  }

  async function runPreview() {
    if (!featureEnabled || selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    setCommitMessage(null);
    setPreview(null);
    try {
      const result = await postJson<PreviewResponse>("/api/lead-inventory/review/actions/preview", {
        requestId,
        actionType,
        itemIds: selectedIds,
        reasonCode: actionType === "make_available" ? "review_passed" : reasonCode,
        operatorNote: operatorNote || null,
      });
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "preview_failed");
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!featureEnabled || !preview) return;
    if (confirmation !== PHRASES[actionType]) {
      setError("Exact confirmation phrase required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{
        ok: true;
        idempotentReplay?: boolean;
        action: { requestId: string; appliedCount: number; blockedCount: number; actionStatus: string };
      }>("/api/lead-inventory/review/actions/commit", {
        requestId,
        actionType,
        itemIds: selectedIds,
        reasonCode: actionType === "make_available" ? "review_passed" : reasonCode,
        operatorNote: operatorNote || null,
        selectionFingerprint: preview.selectionFingerprint,
        confirmationPhrase: confirmation,
      });
      setCommitMessage(
        `${result.idempotentReplay ? "Idempotent replay" : "Applied"}: ${result.action.actionStatus} (applied ${result.action.appliedCount}, blocked ${result.action.blockedCount}). RequestId: ${result.action.requestId}`
      );
      setPreview(null);
      setConfirmation("");
      setSelected(new Set());
      setRequestId(`review-${Date.now()}`);
      await refresh();
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "commit_failed"}. If the network response was ambiguous, recover with requestId ${requestId} — do not auto-retry.`
      );
    } finally {
      setBusy(false);
    }
  }

  async function recoverByRequestId() {
    setBusy(true);
    setError(null);
    try {
      const result = await getJson<{
        ok: true;
        action: { requestId: string; actionStatus: string; appliedCount: number; blockedCount: number };
      }>(`/api/lead-inventory/review/actions/${encodeURIComponent(requestId)}`);
      setCommitMessage(
        `Recovered ${result.action.requestId}: ${result.action.actionStatus} (applied ${result.action.appliedCount}, blocked ${result.action.blockedCount})`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "recovery_failed");
    } finally {
      setBusy(false);
    }
  }

  const reasonOptions =
    actionType === "quarantine"
      ? QUARANTINE_REASONS
      : actionType === "reject"
        ? REJECT_REASONS
        : (["review_passed"] as const);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Review Queue</h2>
        <p className="text-sm text-muted-foreground">
          Guarded activation for pending inventory. Availability requires explicit confirmation.
        </p>
      </div>

      {!featureEnabled ? (
        <WarningBanner tone="warn" title="Review activation is disabled">
          SA360_LEAD_INVENTORY_REVIEW_ENABLED is off. Queue visibility may load, but mutation actions are
          disabled and will not be sent.
        </WarningBanner>
      ) : null}

      {loadError ? (
        <WarningBanner tone="warn" title="Review queue unavailable">
          {loadError}
        </WarningBanner>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Pending review" value={summary?.counts.pendingReview ?? 0} />
        <StatTile label="Eligible now" value={summary?.counts.eligibleNow ?? 0} />
        <StatTile label="Blocked" value={summary?.counts.blocked ?? 0} />
        <StatTile label="Available" value={summary?.counts.available ?? 0} />
        <StatTile label="Quarantined" value={summary?.counts.quarantined ?? 0} />
        <StatTile label="Rejected" value={summary?.counts.rejected ?? 0} />
      </div>

      <SectionPanel title="Import batch summary">
        {(summary?.batches.length ?? 0) === 0 ? (
          <EmptyState title="No committed import batches" hint="Batches appear after aged CSV import commit." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-3 py-2">Request</th>
                  <th className="px-3 py-2">Lot</th>
                  <th className="px-3 py-2">Lane</th>
                  <th className="px-3 py-2">Imported</th>
                  <th className="px-3 py-2">Pending</th>
                  <th className="px-3 py-2">Eligible</th>
                  <th className="px-3 py-2">Blocked</th>
                  <th className="px-3 py-2">Available</th>
                  <th className="px-3 py-2">Quarantined</th>
                  <th className="px-3 py-2">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {summary?.batches.map((batch) => (
                  <tr key={batch.requestId} className="border-b">
                    <td className="px-3 py-2 font-mono text-xs">{batch.requestId}</td>
                    <td className="px-3 py-2">{batch.lotKey ?? "—"}</td>
                    <td className="px-3 py-2">{batch.sourceLane}</td>
                    <td className="px-3 py-2">{batch.imported}</td>
                    <td className="px-3 py-2">{batch.pending}</td>
                    <td className="px-3 py-2">{batch.eligible}</td>
                    <td className="px-3 py-2">{batch.blocked}</td>
                    <td className="px-3 py-2">{batch.available}</td>
                    <td className="px-3 py-2">{batch.quarantined}</td>
                    <td className="px-3 py-2">{batch.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionPanel>

      <SectionPanel title="Filters">
        <div className="grid gap-3 p-4 md:grid-cols-3 lg:grid-cols-4">
          {(
            [
              ["status", "Status"],
              ["importBatchRequestId", "Batch requestId"],
              ["normalizedState", "State"],
              ["ageBandKey", "Age band"],
              ["sourceLane", "Source lane"],
              ["nicheKey", "Niche"],
              ["blockerCode", "Blocker"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-sm">
              <span className="mb-1 block text-muted-foreground">{label}</span>
              <input
                className="w-full rounded-md border px-2 py-1"
                value={filters[key]}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, [key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel title="Pending inventory">
        {items.length === 0 ? (
          <EmptyState title="No review items" hint="Adjust filters or import aged inventory first." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-3 py-2">Select</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Lot</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Generated</th>
                  <th className="px-3 py-2">Age</th>
                  <th className="px-3 py-2">Niche</th>
                  <th className="px-3 py-2">Lane</th>
                  <th className="px-3 py-2">Duplicate</th>
                  <th className="px-3 py-2">Provenance</th>
                  <th className="px-3 py-2">Eligible</th>
                  <th className="px-3 py-2">Blockers</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.inventoryItemId} className="border-b">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(item.inventoryItemId)}
                        disabled={!featureEnabled}
                        onChange={() => toggle(item.inventoryItemId)}
                        aria-label={`Select ${item.maskedInventoryReference}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void openDetail(item.inventoryItemId)}
                      >
                        {item.maskedInventoryReference}
                      </button>
                    </td>
                    <td className="px-3 py-2">{item.lotKey ?? item.lotDisplayName}</td>
                    <td className="px-3 py-2">{item.normalizedState}</td>
                    <td className="px-3 py-2">{item.generatedAt.slice(0, 10)}</td>
                    <td className="px-3 py-2">
                      {item.ageDays ?? "—"} / {item.ageBandKey ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {item.nicheKey}
                      {item.productType ? ` / ${item.productType}` : ""}
                    </td>
                    <td className="px-3 py-2">{item.sourceLane}</td>
                    <td className="px-3 py-2">{item.duplicateStatus}</td>
                    <td className="px-3 py-2">{item.provenanceStatus}</td>
                    <td className="px-3 py-2">{item.eligible ? "yes" : "no"}</td>
                    <td className="px-3 py-2">{item.blockerCount}</td>
                    <td className="px-3 py-2">{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionPanel>

      {detail ? (
        <SectionPanel title="Item detail">
          <div className="space-y-2 p-4 text-sm">
            <div>Reference: {String(detail.maskedInventoryReference)}</div>
            <div>Status: {String(detail.status)}</div>
            <div>Import request: {String(detail.importRequestId ?? "—")}</div>
            <div>Lot: {String(detail.lotKey ?? detail.inventoryLotId)}</div>
            <div>Lane / provider: {String(detail.sourceLane)} / {String(detail.sourceProvider)}</div>
            <div>
              State / generated: {String(detail.normalizedState)} / {String(detail.generatedAt)}
            </div>
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs">
              {JSON.stringify(detail.eligibility, null, 2)}
            </pre>
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs">
              {JSON.stringify(detail.reviewHistory, null, 2)}
            </pre>
            <button type="button" className="rounded-md border px-3 py-1" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
        </SectionPanel>
      ) : null}

      <SectionPanel title="Review actions">
        <div className="space-y-3 p-4 text-sm">
          <p className="text-muted-foreground">
            Selected {selectedIds.length} / 100. Do not enter contact PII in operator notes.
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="mb-1 block text-muted-foreground">Action</span>
              <select
                className="w-full rounded-md border px-2 py-1"
                value={actionType}
                disabled={!featureEnabled}
                onChange={(event) => {
                  const next = event.target.value as ActionType;
                  setActionType(next);
                  setPreview(null);
                  setConfirmation("");
                  setReasonCode(
                    next === "make_available"
                      ? "review_passed"
                      : next === "quarantine"
                        ? "operator_quarantine"
                        : "operator_rejected"
                  );
                }}
              >
                <option value="make_available">Make available</option>
                <option value="quarantine">Quarantine</option>
                <option value="reject">Reject</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-muted-foreground">Reason code</span>
              <select
                className="w-full rounded-md border px-2 py-1"
                value={reasonCode}
                disabled={!featureEnabled || actionType === "make_available"}
                onChange={(event) => setReasonCode(event.target.value)}
              >
                {reasonOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-muted-foreground">
                Operator note (optional, sanitized, max 500 — no contact PII)
              </span>
              <input
                className="w-full rounded-md border px-2 py-1"
                value={operatorNote}
                disabled={!featureEnabled}
                maxLength={500}
                onChange={(event) => setOperatorNote(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-1 disabled:opacity-50"
              disabled={!featureEnabled || busy || selectedIds.length === 0}
              onClick={() => void runPreview()}
            >
              Preview action
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-1 disabled:opacity-50"
              disabled={busy}
              onClick={() => void recoverByRequestId()}
            >
              Recover by requestId
            </button>
            <span className="self-center font-mono text-xs text-muted-foreground">requestId: {requestId}</span>
          </div>

          {preview ? (
            <div className="space-y-2 rounded-md border p-3">
              <div>
                Preview writesPerformed={preview.writesPerformed}. Eligible {preview.eligibleCount}, blocked{" "}
                {preview.blockedCount}.
              </div>
              {preview.blockedItems.length > 0 ? (
                <div className="text-xs text-muted-foreground">
                  Blocked examples:{" "}
                  {preview.blockedItems
                    .slice(0, 5)
                    .map((item) => `${item.maskedInventoryReference} (${item.blockerCodes.join(",")})`)
                    .join("; ")}
                </div>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-muted-foreground">
                  Type exact phrase: <code>{PHRASES[actionType]}</code>
                </span>
                <input
                  className="w-full rounded-md border px-2 py-1 font-mono"
                  value={confirmation}
                  disabled={!featureEnabled || busy}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-1 text-white disabled:opacity-50"
                disabled={
                  !featureEnabled ||
                  busy ||
                  confirmation !== PHRASES[actionType] ||
                  preview.eligibleCount === 0
                }
                onClick={() => void runCommit()}
              >
                Commit (no auto-retry)
              </button>
            </div>
          ) : null}

          {error ? (
            <WarningBanner tone="warn" title="Action error">
              {error}
            </WarningBanner>
          ) : null}
          {commitMessage ? (
            <WarningBanner tone="info" title="Action result">
              {commitMessage}
            </WarningBanner>
          ) : null}
        </div>
      </SectionPanel>
    </div>
  );
}
