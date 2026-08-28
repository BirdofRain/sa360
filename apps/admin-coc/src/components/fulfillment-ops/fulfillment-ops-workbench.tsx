"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CANONICAL_US_STATE_CODES, isCanonicalUsStateCode } from "@sa360/shared";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionErrorBoundary } from "@/components/dashboard/section-error-boundary";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { MarkSpreadsheetDeliveredDialog, SPREADSHEET_DELIVERY_CONFIRM_PHRASE } from "@/components/fulfillment-ops/mark-spreadsheet-delivered-dialog";
import { OpsBadge } from "@/components/fulfillment-ops/ops-badge";
import { PplExportContextPanel } from "@/components/fulfillment-ops/ppl-export-context-panel";
import { PplHoldBucketsDisplay } from "@/components/fulfillment-ops/ppl-hold-buckets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clientActivateOrder,
  clientCreateClientLeadOrder,
  clientEligibilityPreview,
  clientFetchEvidence,
  clientFetchOrderLatestEvidence,
  clientFetchPplPricingCatalog,
  clientListOrders,
  clientPrepareCandidate,
  clientPplExportCommit,
  clientPplExportPreview,
  clientPplListReplacements,
  clientPplMarkSpreadsheetDelivered,
  clientPplReplacementDecision,
  clientPplReplacementPreview,
  clientPplReplacementRequest,
  clientPplSelectionCommit,
  clientPplSelectionPreview,
  clientReserveAllocation,
  clientSimulateInstruction,
  pplExportDownloadUrl,
  type PplExportCommitResult,
  type PplExportPreviewResult,
  type PplReplacementItem,
  type PplSelectionFailure,
  type PplSelectionResult,
  type PplSpreadsheetDeliveryResult,
} from "@/lib/fulfillment-ops/client-api";
import {
  labelForAllocation,
  labelForAttempt,
  labelForEligibility,
  labelForInventoryStatus,
} from "@/lib/fulfillment-ops/status";
import {
  findSelectableBucket,
  formatUsdFromCents,
  presentationLabelForBucket,
  type PplPricingCatalog,
} from "@/lib/fulfillment-ops/ppl-pricing-catalog";
import type {
  FulfillmentOpsBootstrap,
  FulfillmentOpsCandidate,
  FulfillmentOpsEligibilityPreview,
  FulfillmentOpsEvidence,
  FulfillmentOpsOrder,
  FulfillmentOpsPrepareResult,
} from "@/lib/fulfillment-ops/types";

type Props = {
  bootstrap: FulfillmentOpsBootstrap;
  orders: FulfillmentOpsOrder[];
  clients: Array<{ id: string; label: string }>;
  pricingCatalog?: PplPricingCatalog | null;
  pricingError?: string | null;
  loadError: string | null;
  initialOrderId: string | null;
  initialExportCommit?: PplExportCommitResult | null;
};

function errorText(error: string, details?: unknown): string {
  if (details && typeof details === "object" && details !== null) {
    const obj = details as { error?: string; code?: string; reasons?: string[] };
    if (Array.isArray(obj.reasons) && obj.reasons.length > 0) {
      return `${obj.code ?? obj.error ?? error}: ${obj.reasons.join(", ")}`;
    }
    if (typeof obj.code === "string") return obj.code;
    if (typeof obj.error === "string") return obj.error;
  }
  return error;
}

/** Prominent incomplete-search warning for FOWB Stage 2b (exported for unit tests). */
export function PplScanLimitWarning({ failure }: { failure: PplSelectionFailure }) {
  const diagnostics = failure.diagnostics;
  return (
    <WarningBanner
      tone="err"
      title="SEARCH INCOMPLETE"
    >
      SEARCH INCOMPLETE — selection search reached its safe scan limit before the requested
      quantity could be verified. This is not an inventory shortage. No leads were reserved.
      Narrow the states or age buckets and retry.
      <div className="mt-2 grid gap-2 md:grid-cols-3 text-sm">
        <div>Rows scanned: {diagnostics?.rowsScanned ?? "—"}</div>
        <div>Pages read: {diagnostics?.pagesRead ?? "—"}</div>
        <div>Eligible found so far: {failure.eligibleQuantity ?? diagnostics?.eligibleQuantity ?? 0}</div>
      </div>
      <div className="mt-2 text-sm">
        Commit / Reserve stays disabled. Potential refund/credit is not confirmed.
      </div>
    </WarningBanner>
  );
}

export function FulfillmentOpsWorkbench({
  bootstrap,
  orders: initialOrders,
  clients,
  pricingCatalog: initialPricingCatalog,
  pricingError: initialPricingError = null,
  loadError,
  initialOrderId,
  initialExportCommit = null,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [orders, setOrders] = useState<FulfillmentOpsOrder[]>(initialOrders);
  const [selectedOrder, setSelectedOrder] = useState<FulfillmentOpsOrder | null>(() => {
    if (bootstrap.selectedOrder) return bootstrap.selectedOrder;
    if (initialOrderId) {
      return initialOrders.find((row) => row.id === initialOrderId) ?? null;
    }
    return null;
  });
  const [orderError, setOrderError] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<FulfillmentOpsEligibilityPreview | null>(null);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<FulfillmentOpsCandidate | null>(null);
  const [prepareResult, setPrepareResult] = useState<FulfillmentOpsPrepareResult | null>(null);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [simulateOkMessage, setSimulateOkMessage] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<FulfillmentOpsEvidence | null>(
    () => bootstrap.latestEvidence ?? null
  );
  const [demoClientId, setDemoClientId] = useState(clients[0]?.id ?? "");
  const [demoNiche, setDemoNiche] = useState("vet");
  const [demoStates, setDemoStates] = useState("NC");
  const [demoVolume, setDemoVolume] = useState("1");
  const [demoBucket, setDemoBucket] = useState("COMMERCE_3_6_MO");
  const [createError, setCreateError] = useState<string | null>(null);
  const [pplBuckets, setPplBuckets] = useState(
    "COMMERCE_1_3_MO,COMMERCE_3_6_MO,COMMERCE_6_9_MO,COMMERCE_9_12_MO,COMMERCE_12_MO_PLUS"
  );
  const [pplQty, setPplQty] = useState("1");
  const [pricingCatalog, setPricingCatalog] = useState<PplPricingCatalog | null>(
    initialPricingCatalog ?? null
  );
  const [pricingError, setPricingError] = useState<string | null>(initialPricingError);
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [legacyOpsOpen, setLegacyOpsOpen] = useState(false);
  const [replacementOpsOpen, setReplacementOpsOpen] = useState(false);

  useEffect(() => {
    if (pricingCatalog || initialPricingCatalog !== undefined) return;
    let cancelled = false;
    void clientFetchPplPricingCatalog().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPricingCatalog(null);
        setPricingError(result.error);
        return;
      }
      setPricingCatalog(result.data);
      setPricingError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [pricingCatalog, initialPricingCatalog]);

  const selectableBuckets = pricingCatalog?.activeAgedBuckets ?? [];
  const selectedCreateBucket = findSelectableBucket(pricingCatalog, demoBucket);
  const createQty = Number(demoVolume);
  const createUnitPriceCents = selectedCreateBucket?.unitPriceCents ?? null;
  const createOrderTotalCents =
    createUnitPriceCents != null && Number.isFinite(createQty) && createQty >= 1
      ? createQty * createUnitPriceCents
      : null;
  const pricingUnavailable = !pricingCatalog || selectableBuckets.length === 0;
  const pricedOrderBucket = selectedOrder?.pricing?.commerceAgeBucketKey ?? null;
  const isPricedPplOrder = Boolean(selectedOrder?.pricing);
  const replacementFlagEnabled = bootstrap.safety.flags.SA360_PPL_REPLACEMENT_ENABLED === true;
  const showReplacementWorkbench = !isPricedPplOrder || replacementFlagEnabled;
  const [pplSelection, setPplSelection] = useState<PplSelectionResult | null>(null);
  const [pplSelectionFailure, setPplSelectionFailure] = useState<PplSelectionFailure | null>(
    null
  );
  const [pplSelectionError, setPplSelectionError] = useState<string | null>(null);
  const selectionCommitBlocked =
    pplSelectionFailure?.code === "scan_limit_reached" ||
    pplSelection?.diagnostics?.selectionComplete === false;
  const [pplExportPreview, setPplExportPreview] = useState<PplExportPreviewResult | null>(null);
  const [pplExportCommit, setPplExportCommit] = useState<PplExportCommitResult | null>(
    initialExportCommit
  );
  const [pplExportError, setPplExportError] = useState<string | null>(null);
  const [pplDeliveryResult, setPplDeliveryResult] = useState<PplSpreadsheetDeliveryResult | null>(
    null
  );
  const [pplDeliveryError, setPplDeliveryError] = useState<string | null>(null);
  const [pplReplacementAllocationId, setPplReplacementAllocationId] = useState("");
  const [pplReplacementReason, setPplReplacementReason] = useState("Buyer reported duplicate");
  const [pplReplacementConfirm, setPplReplacementConfirm] = useState("");
  const [pplReplacements, setPplReplacements] = useState<PplReplacementItem[]>([]);
  const [pplReplacementError, setPplReplacementError] = useState<string | null>(null);
  const [pplReplacementPreview, setPplReplacementPreview] = useState<string | null>(null);

  const safety = bootstrap.safety;
  const reviewBlocked = !bootstrap.inventory.review.featureEnabled;
  const summary = bootstrap.inventory.summary;
  const reviewCounts = bootstrap.inventory.review.counts;

  const timeline = useMemo(() => {
    return [
      {
        label: "Inventory imported",
        done: (summary?.totalItems ?? 0) > 0,
        detail: `${summary?.totalItems ?? 0} items`,
      },
      {
        label: "Inventory reviewed",
        done: (reviewCounts?.available ?? summary?.available ?? 0) > 0,
        detail: `${reviewCounts?.available ?? summary?.available ?? 0} available`,
      },
      {
        label: "Order created",
        done: Boolean(selectedOrder),
        detail: selectedOrder?.orderNumber ?? "none",
      },
      {
        label: "Order activated",
        done: selectedOrder?.status === "active",
        detail: selectedOrder?.status ?? "n/a",
      },
      {
        label: "Eligibility evaluated",
        done: Boolean(eligibility),
        detail: eligibility
          ? `${eligibility.eligibleCount} eligible / ${eligibility.excludedCount} excluded`
          : "pending",
      },
      {
        label: "Candidate reserved",
        done: evidence?.allocationStatus === "reserved" || evidence?.allocationStatus === "committed" || evidence?.allocationStatus === "delivering",
        detail: evidence?.allocationStatus ?? prepareResult?.allocationStatus ?? "none",
      },
      {
        label: "Buyer CSV exported",
        done: Boolean(pplExportCommit),
        detail: pplExportCommit
          ? `${pplExportCommit.rowCount} rows · ${pplExportCommit.contentSha256.slice(0, 12)}…`
          : "pending",
      },
      {
        label: "Approved & released",
        done: Boolean(pplDeliveryResult),
        detail: pplDeliveryResult
          ? `${pplDeliveryResult.identityCount} identities · ${pplDeliveryResult.evidenceNote}`
          : "pending",
      },
      {
        label: "Simulation attempted",
        done: (evidence?.simulationAttemptCount ?? 0) > 0,
        detail: `${evidence?.simulationAttemptCount ?? 0} attempt(s)`,
      },
      {
        label: "Simulation completed or failed",
        done:
          (evidence?.simulationSucceededCount ?? 0) > 0 ||
          (evidence?.simulationFailedCount ?? 0) > 0,
        detail:
          (evidence?.simulationSucceededCount ?? 0) > 0
            ? "succeeded"
            : (evidence?.simulationFailedCount ?? 0) > 0
              ? "failed"
              : "pending",
      },
    ];
  }, [
    summary,
    reviewCounts,
    selectedOrder,
    eligibility,
    evidence,
    prepareResult,
    pplExportCommit,
    pplDeliveryResult,
  ]);

  function selectOrder(order: FulfillmentOpsOrder) {
    setSelectedOrder(order);
    setOrderError(null);
    setEligibility(null);
    setEligibilityError(null);
    setSelectedCandidate(null);
    setPrepareResult(null);
    setReserveError(null);
    setSimulateError(null);
    setSimulateOkMessage(null);
    setEvidence(null);
    setPplReplacementError(null);
    setPplReplacementPreview(null);
    setPplReplacements([]);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("orderId", order.id);
      window.history.replaceState({}, "", url.toString());
    }
    startTransition(async () => {
      const [ev, replacements] = await Promise.all([
        clientFetchOrderLatestEvidence(order.id),
        clientPplListReplacements(order.id),
      ]);
      if (ev.ok) setEvidence(ev.data);
      if (replacements.ok) setPplReplacements(replacements.data);
    });
  }

  function runActivate() {
    if (!selectedOrder) return;
    setOrderError(null);
    startTransition(async () => {
      const result = await clientActivateOrder(selectedOrder.id);
      if (!result.ok) {
        setOrderError(errorText(result.error, result.details));
        return;
      }
      setSelectedOrder(result.data);
      setOrders((prev) => prev.map((row) => (row.id === result.data.id ? result.data : row)));
    });
  }

  function runCreateClientLeadOrder() {
    setCreateError(null);
    const requestedStates = demoStates
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const invalidStates = requestedStates.filter((state) => !isCanonicalUsStateCode(state));
    const states = requestedStates.filter(isCanonicalUsStateCode);
    const volume = Number(demoVolume);
    if (invalidStates.length > 0) {
      setCreateError(`States must be canonical US codes. Invalid: ${invalidStates.join(", ")}`);
      return;
    }
    if (!demoClientId || states.length === 0 || !Number.isFinite(volume) || volume < 1) {
      setCreateError("Client, canonical states, quantity (≥ 1), and age bucket are required.");
      return;
    }
    if (pricingUnavailable || !selectedCreateBucket) {
      setCreateError("Pricing unavailable. Priced order creation is blocked until the server catalog loads.");
      return;
    }
    if (!demoBucket) {
      setCreateError("Select exactly one commerce age bucket.");
      return;
    }
    const clientLabel = clients.find((c) => c.id === demoClientId)?.label;
    startTransition(async () => {
      const result = await clientCreateClientLeadOrder({
        clientAccountId: demoClientId,
        clientDisplayName: clientLabel,
        nicheKey: demoNiche.trim() || "vet",
        states,
        requestedQuantity: volume,
        commerceAgeBucketKey: demoBucket,
      });
      if (!result.ok) {
        setCreateError(errorText(result.error, result.details));
        return;
      }
      setOrders((prev) => [result.data, ...prev]);
      selectOrder(result.data);
      if (result.data.pricing?.commerceAgeBucketKey) {
        setPplBuckets(result.data.pricing.commerceAgeBucketKey);
        setPplQty(String(result.data.pricing.requestedQuantity));
      }
    });
  }

  function runEligibility() {
    if (!selectedOrder) return;
    setEligibilityError(null);
    startTransition(async () => {
      const result = await clientEligibilityPreview(selectedOrder.id);
      if (!result.ok) {
        setEligibilityError(errorText(result.error, result.details));
        setEligibility(null);
        return;
      }
      setEligibility(result.data);
      setSelectedCandidate(null);
      setPrepareResult(null);
    });
  }

  function runPrepareAndReserve() {
    if (!selectedOrder || !selectedCandidate) return;
    setReserveError(null);
    setSimulateError(null);
    setSimulateOkMessage(null);
    startTransition(async () => {
      const prepared = await clientPrepareCandidate({
        leadOrderId: selectedOrder.id,
        inventoryItemId: selectedCandidate.inventoryItemId,
      });
      if (!prepared.ok) {
        setReserveError(errorText(prepared.error, prepared.details));
        return;
      }
      setPrepareResult(prepared.data);
      const reserved = await clientReserveAllocation(prepared.data.allocationId);
      if (!reserved.ok) {
        setReserveError(errorText(reserved.error, reserved.details));
        const ev = await clientFetchEvidence(prepared.data.allocationId);
        if (ev.ok) setEvidence(ev.data);
        return;
      }
      const orderRes = await clientListOrders();
      if (orderRes.ok) {
        const updated = orderRes.data.find((row) => row.id === selectedOrder.id) ?? null;
        if (updated) {
          setSelectedOrder(updated);
          setOrders(orderRes.data);
        }
      }
      const ev = await clientFetchEvidence(prepared.data.allocationId);
      if (ev.ok) setEvidence(ev.data);
    });
  }

  function runSimulate() {
    const instructionId =
      prepareResult?.deliveryInstructionId ?? evidence?.instructions[0]?.id ?? null;
    const allocationId = prepareResult?.allocationId ?? evidence?.allocationId ?? null;
    if (!instructionId || !allocationId) {
      setSimulateError("No delivery instruction available. Prepare and reserve a candidate first.");
      return;
    }
    setSimulateError(null);
    setSimulateOkMessage(null);
    startTransition(async () => {
      const result = await clientSimulateInstruction(instructionId);
      if (!result.ok) {
        setSimulateError(errorText(result.error, result.details));
        const ev = await clientFetchEvidence(allocationId);
        if (ev.ok) setEvidence(ev.data);
        return;
      }
      setSimulateOkMessage(
        "Simulation succeeded. No live external write occurred (executionMode=simulation)."
      );
      const ev = await clientFetchEvidence(allocationId);
      if (ev.ok) setEvidence(ev.data);
      if (selectedOrder) {
        const orderRes = await clientListOrders();
        if (orderRes.ok) {
          const updated = orderRes.data.find((row) => row.id === selectedOrder.id) ?? null;
          if (updated) setSelectedOrder(updated);
        }
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Fulfillment Operations</h1>
            <p className="text-sm text-muted-foreground">
              Internal operator path over existing Lead Inventory + LF2 reservation/simulation APIs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OpsBadge label="SIMULATION ONLY" tone="warn" />
            <OpsBadge label="LIVE DISABLED" tone="danger" />
            <OpsBadge
              label={
                safety.inventoryReviewEnabled ? "REVIEW ENABLED" : "REVIEW DISABLED"
              }
              tone={safety.inventoryReviewEnabled ? "success" : "warn"}
            />
            <OpsBadge
              label={safety.lf2ExecutionEnabled ? "LF2 EXEC ON" : "LF2 EXEC OFF"}
              tone={safety.lf2ExecutionEnabled ? "danger" : "success"}
            />
            <OpsBadge
              label={safety.lf2GhlCanaryEnabled ? "GHL CANARY ON" : "GHL CANARY OFF"}
              tone={safety.lf2GhlCanaryEnabled ? "danger" : "success"}
            />
          </div>
        </div>
        <WarningBanner tone="info" title="Simulation only — no external delivery will occur.">
          Runtime: {safety.runtimeMode}. Live delivery is expected to stay disabled. LF2 GHL canary and
          allowlists remain closed for this workbench.
          {selectedOrder ? (
            <span className="mt-1 block">
              Selected order: <span className="font-mono">{selectedOrder.orderNumber}</span> (
              {selectedOrder.status})
            </span>
          ) : (
            <span className="mt-1 block">No order selected.</span>
          )}
        </WarningBanner>
        {loadError ? (
          <WarningBanner tone="warn" title="Bootstrap partially unavailable">
            {loadError.includes("<!DOCTYPE") || loadError.includes("<html")
              ? "Admin API temporarily unavailable. The upstream response was not JSON."
              : loadError}
          </WarningBanner>
        ) : null}
        {bootstrap.unavailableSections && bootstrap.unavailableSections.length > 0 ? (
          <WarningBanner tone="warn" title="Some bootstrap sections unavailable">
            <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
              {bootstrap.unavailableSections.map((section) => (
                <li key={`${section.section}:${section.code}`}>
                  {section.section}: {section.summary} ({section.code})
                </li>
              ))}
            </ul>
          </WarningBanner>
        ) : null}
      </div>

      <SectionErrorBoundary title="Inventory">
        <SectionPanel
          title="Stage 1 — Inventory"
          action={
            <div className="flex gap-2 text-sm">
              <Link className="text-blue-700 underline" href="/lead-inventory">
                Open Lead Inventory
              </Link>
            </div>
          }
        >
          <div className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <StatTile label="Total items" value={summary?.totalItems ?? 0} />
              <StatTile label="Pending review" value={reviewCounts?.pendingReview ?? 0} />
              <StatTile label="Available" value={reviewCounts?.available ?? summary?.available ?? 0} />
              <StatTile
                label="Rejected / quarantined"
                value={(reviewCounts?.rejected ?? 0) + (reviewCounts?.quarantined ?? summary?.quarantined ?? 0)}
              />
            </div>
            {reviewBlocked ? (
              <WarningBanner tone="warn" title="Inventory review feature blocked">
                `SA360_LEAD_INVENTORY_REVIEW_ENABLED` is off. Import and summary still work; activation
                commits stay disabled until the flag is enabled in a demo environment.
              </WarningBanner>
            ) : (
              <p className="text-sm text-muted-foreground">
                Review activation is enabled. Use the Lead Inventory page to import aged CSV and run the
                review queue.
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-2 text-sm font-medium">Niche distribution</h4>
                {bootstrap.inventory.nicheDistribution.length === 0 ? (
                  <EmptyState title="No inventory niches yet" hint="Import aged inventory to populate." />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {bootstrap.inventory.nicheDistribution.map((row) => (
                      <li key={row.nicheKey} className="flex justify-between border-b py-1">
                        <span>{row.nicheKey}</span>
                        <span className="font-mono">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium">State distribution (available/pending)</h4>
                {bootstrap.inventory.stateDistribution.length === 0 ? (
                  <EmptyState title="No state rows yet" hint="Import or activate inventory first." />
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-auto text-sm">
                    {bootstrap.inventory.stateDistribution.map((row) => (
                      <li key={row.state} className="flex justify-between border-b py-1">
                        <span>{row.state}</span>
                        <span className="font-mono">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {(bootstrap.inventory.invalidStateReviewCount ?? 0) > 0 ? (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    Invalid state / needs review: {bootstrap.inventory.invalidStateReviewCount}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </SectionPanel>
      </SectionErrorBoundary>

      <SectionErrorBoundary title="Lead order">
        <SectionPanel title="Stage 2 — Lead Order">
          <div className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <select
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={selectedOrder?.id ?? ""}
                onChange={(e) => {
                  const found = orders.find((row) => row.id === e.target.value) ?? null;
                  if (found) selectOrder(found);
                }}
                disabled={pending}
              >
                <option value="">Select an existing order…</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.orderNumber} — {order.nicheKey} — {order.status}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" disabled={!selectedOrder || pending} onClick={runActivate}>
                Activate order
              </Button>
            </div>

            {selectedOrder ? (
              <div className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm md:grid-cols-3">
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <div className="font-medium uppercase">{selectedOrder.status}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Niche / states</div>
                  <div className="font-medium">
                    {selectedOrder.nicheKey} / {selectedOrder.states.join(", ") || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Qty (req / reserved / fulfilled)</div>
                  <div className="font-mono">
                    {selectedOrder.requestedQuantity ?? selectedOrder.leadVolume} /{" "}
                    {selectedOrder.reservedQuantity} / {selectedOrder.fulfilledQuantity}
                  </div>
                </div>
                <div className="md:col-span-3">
                  {selectedOrder.allocationReady ? (
                    <OpsBadge label="ACTIVE" tone="success" />
                  ) : (
                    <div className="space-y-1">
                      <OpsBadge label="NOT ALLOCATION READY" tone="warn" />
                      <p className="text-xs text-muted-foreground">
                        Blockers: {selectedOrder.allocationBlockers.join(", ") || "unknown"}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                title="No order selected"
                hint="Select an order or create a Client Lead Order below."
              />
            )}

            {orderError ? (
              <WarningBanner tone="err" title="Order action failed">
                {orderError}
              </WarningBanner>
            ) : null}

            <div className="rounded-lg border border-dashed border-slate-200 p-3">
              <h4 className="mb-2 text-sm font-medium">Client Lead Order (CSV / manual fulfillment)</h4>
              <p className="mb-2 text-xs text-muted-foreground">
                Creates a real internal pay_per_lead / pooled_matching order. No GHL configuration
                required. External delivery remains SIMULATION ONLY / LIVE DISABLED until separately
                enabled.
              </p>
              {pricingUnavailable ? (
                <WarningBanner tone="err" title="Pricing unavailable">
                  {pricingError ?? "Server pricing catalog could not be loaded."} Priced order
                  creation is blocked. Prices are never taken from a local cents table.
                </WarningBanner>
              ) : null}
              <PplHoldBucketsDisplay buckets={pricingCatalog?.holdBuckets ?? []} />
              <div className="grid gap-2 md:grid-cols-5">
                <select
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={demoClientId}
                  onChange={(e) => setDemoClientId(e.target.value)}
                >
                  <option value="">Client…</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.label}
                    </option>
                  ))}
                </select>
                <Input value={demoNiche} onChange={(e) => setDemoNiche(e.target.value)} placeholder="Niche" />
                <Input
                  value={demoStates}
                  onChange={(e) => setDemoStates(e.target.value)}
                  placeholder="States"
                  list="canonical-us-states"
                />
                <datalist id="canonical-us-states">
                  {CANONICAL_US_STATE_CODES.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
                <select
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={selectedCreateBucket?.key ?? ""}
                  onChange={(e) => setDemoBucket(e.target.value)}
                  disabled={pricingUnavailable}
                  data-testid="commerce-bucket-select"
                >
                  <option value="">Commerce age bucket…</option>
                  {selectableBuckets.map((bucket) => (
                    <option key={bucket.key} value={bucket.key}>
                      {presentationLabelForBucket(bucket.key, bucket.label)} ·{" "}
                      {formatUsdFromCents(bucket.unitPriceCents)}/lead
                    </option>
                  ))}
                </select>
                <Input
                  value={demoVolume}
                  onChange={(e) => setDemoVolume(e.target.value)}
                  placeholder="Requested qty (≥1)"
                />
              </div>
              <div className="mt-2 grid gap-2 text-sm md:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Age bucket</div>
                  <div className="font-medium">
                    {selectedCreateBucket
                      ? presentationLabelForBucket(selectedCreateBucket.key, selectedCreateBucket.label)
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Price per lead</div>
                  <div className="font-medium">
                    {createUnitPriceCents != null ? formatUsdFromCents(createUnitPriceCents) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Quantity</div>
                  <div className="font-medium">
                    {Number.isFinite(createQty) && createQty >= 1 ? createQty : "—"} leads
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Quoted order total</div>
                  <div className="font-medium">
                    {createOrderTotalCents != null ? formatUsdFromCents(createOrderTotalCents) : "—"}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Fresh — HOLD and Semi-Fresh — HOLD remain visible above and are not selectable.
                One commerce bucket per priced order. Unit price comes from the server catalog and
                cannot be entered manually.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  disabled={pending || pricingUnavailable}
                  onClick={runCreateClientLeadOrder}
                >
                  Create Client Lead Order
                </Button>
                {createError ? <span className="text-sm text-red-700">{createError}</span> : null}
              </div>
            </div>
          </div>
        </SectionPanel>
      </SectionErrorBoundary>

      <SectionErrorBoundary title="PPL selection">
        <SectionPanel
          title="Stage 2b — Selection Preview / Commit Reserve"
          action={
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedOrder || pending}
                onClick={() => {
                  if (!selectedOrder) return;
                  setPplSelectionError(null);
                  setPplSelectionFailure(null);
                  startTransition(async () => {
                    const buckets = pricedOrderBucket
                      ? [pricedOrderBucket]
                      : pplBuckets
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean);
                    const qty = Number.parseInt(pplQty, 10);
                    const result = await clientPplSelectionPreview(selectedOrder.id, {
                      commerceAgeBucketKeys: buckets,
                      requestedQuantity: Number.isFinite(qty) ? qty : undefined,
                    });
                    if (!result.ok) {
                      setPplSelection(null);
                      setPplSelectionFailure(result.selectionFailure ?? null);
                      setPplSelectionError(
                        result.selectionFailure?.code === "scan_limit_reached"
                          ? null
                          : errorText(result.error, result.details)
                      );
                      return;
                    }
                    setPplSelectionFailure(null);
                    setPplSelection(result.data);
                  });
                }}
              >
                Selection Preview
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!selectedOrder || pending || selectionCommitBlocked}
                onClick={() => {
                  if (!selectedOrder || selectionCommitBlocked) return;
                  setPplSelectionError(null);
                  setPplSelectionFailure(null);
                  startTransition(async () => {
                    const buckets = pricedOrderBucket
                      ? [pricedOrderBucket]
                      : pplBuckets
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean);
                    const qty = Number.parseInt(pplQty, 10);
                    const result = await clientPplSelectionCommit(selectedOrder.id, {
                      commerceAgeBucketKeys: buckets,
                      requestedQuantity: Number.isFinite(qty) ? qty : undefined,
                      idempotencyKey: `ppl-select:${selectedOrder.id}:${qty}:${buckets.join("|")}`,
                    });
                    if (!result.ok) {
                      setPplSelection(null);
                      setPplSelectionFailure(result.selectionFailure ?? null);
                      setPplSelectionError(
                        result.selectionFailure?.code === "scan_limit_reached"
                          ? null
                          : errorText(result.error, result.details)
                      );
                      return;
                    }
                    setPplSelectionFailure(null);
                    setPplSelection(result.data);
                  });
                }}
              >
                Commit / Reserve Leads
              </Button>
            </div>
          }
        >
          <div className="space-y-3 p-4">
            <WarningBanner tone="info" title="Partial fulfillment allowed">
              Requires `SA360_PPL_SELECTION_ENABLED=true`. Quantity ≥ 1. True inventory exhaustion
              may reserve a partial set and report shortfall (requested qty unchanged). If the safe
              scan limit is reached first, preview returns `scan_limit_reached` and commit refuses
              to reserve. Same-buyer prior delivery, batch dedupe, and protected-agent exclusions
              apply. Preview tables do not show raw PII.
            </WarningBanner>
            {selectedOrder?.pricing ? (
              <WarningBanner tone="info" title="Priced order bucket locked">
                Selection must use {selectedOrder.pricing.label} (
                {selectedOrder.pricing.commerceAgeBucketKey}) at{" "}
                {formatUsdFromCents(selectedOrder.pricing.unitPriceCents)} / lead. Requested order
                value {formatUsdFromCents(selectedOrder.pricing.lineTotalCents)}. Fresh / Semi-Fresh
                are not available.
              </WarningBanner>
            ) : null}
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                value={pricedOrderBucket ?? pplBuckets}
                onChange={(e) => setPplBuckets(e.target.value)}
                placeholder="Commerce age bucket keys"
                disabled={Boolean(pricedOrderBucket)}
              />
              <Input
                value={pplQty}
                onChange={(e) => setPplQty(e.target.value)}
                placeholder="Requested quantity"
              />
            </div>
            {pplSelectionFailure?.code === "scan_limit_reached" ? (
              <PplScanLimitWarning failure={pplSelectionFailure} />
            ) : null}
            {pplSelectionError ? (
              <WarningBanner tone="err" title="Selection failed">
                {pplSelectionError}
              </WarningBanner>
            ) : null}
            {pplSelection ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <StatTile label="Requested" value={pplSelection.requestedQuantity} />
                  <StatTile label="Eligible" value={pplSelection.eligibleQuantity} />
                  <StatTile label="Selected" value={pplSelection.selectedQuantity} />
                  <StatTile label="Shortfall" value={pplSelection.shortfallQuantity ?? 0} />
                </div>
                {pplSelection.economics ? (
                  <div className="grid gap-3 md:grid-cols-4">
                    <StatTile
                      label="Quoted unit price"
                      value={formatUsdFromCents(pplSelection.economics.unitPriceCents)}
                    />
                    <StatTile
                      label="Requested order value"
                      value={formatUsdFromCents(pplSelection.economics.requestedOrderValueCents)}
                    />
                    <StatTile
                      label="Delivered value"
                      value={formatUsdFromCents(pplSelection.economics.deliveredValueCents)}
                    />
                    <StatTile
                      label={
                        pplSelection.economics.creditStatus === "search_incomplete"
                          ? "Search incomplete"
                          : "Potential refund/credit"
                      }
                      value={
                        pplSelection.economics.potentialCreditCents == null
                          ? "not confirmed"
                          : formatUsdFromCents(pplSelection.economics.potentialCreditCents)
                      }
                    />
                  </div>
                ) : null}
                {pplSelection.diagnostics ? (
                  <div className="grid gap-3 md:grid-cols-4">
                    <StatTile label="Rows scanned" value={pplSelection.diagnostics.rowsScanned} />
                    <StatTile label="Pages read" value={pplSelection.diagnostics.pagesRead} />
                    <StatTile
                      label="Scan complete"
                      value={pplSelection.diagnostics.selectionComplete ? "yes" : "no"}
                    />
                    <StatTile
                      label="Scan ceiling"
                      value={pplSelection.diagnostics.scanCeilingHit ? "hit" : "ok"}
                    />
                  </div>
                ) : null}
                {pplSelection.exclusionCounts ? (
                  <div className="grid gap-3 md:grid-cols-4">
                    <StatTile
                      label="Excluded same buyer"
                      value={pplSelection.exclusionCounts.sameBuyerPriorDelivery}
                    />
                    <StatTile
                      label="Excluded duplicate"
                      value={pplSelection.exclusionCounts.currentBatchDuplicate}
                    />
                    <StatTile
                      label="Excluded protected agent"
                      value={pplSelection.exclusionCounts.protectedAgent}
                    />
                    <StatTile
                      label="Invalid identity"
                      value={pplSelection.exclusionCounts.invalidIdentity}
                    />
                  </div>
                ) : null}
                {(pplSelection.shortfallQuantity ?? 0) > 0 &&
                pplSelection.diagnostics?.selectionComplete !== false ? (
                  <WarningBanner tone="warn" title="Shortfall — partial fulfillment">
                    Requested {pplSelection.requestedQuantity}, selected{" "}
                    {pplSelection.selectedQuantity}. Shortfall{" "}
                    {pplSelection.shortfallQuantity} is retained on the order for later
                    reconciliation (no automatic refund). Confirmed only after the candidate search
                    exhausted matching inventory.
                  </WarningBanner>
                ) : null}
              </div>
            ) : pplSelectionFailure?.code === "scan_limit_reached" ? null : (
              <EmptyState
                title="No PPL selection yet"
                hint="Run Selection Preview, then Commit / Reserve Leads for the active order."
              />
            )}
          </div>
        </SectionPanel>
      </SectionErrorBoundary>

      <SectionErrorBoundary title="PPL buyer CSV export">
        <SectionPanel
          title="Stage 2c — Review / Approve & Release"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedOrder || pending}
                onClick={() => {
                  if (!selectedOrder) return;
                  setPplExportError(null);
                  startTransition(async () => {
                    const result = await clientPplExportPreview(selectedOrder.id);
                    if (!result.ok) {
                      setPplExportPreview(null);
                      setPplExportError(errorText(result.error, result.details));
                      return;
                    }
                    setPplExportPreview(result.data);
                  });
                }}
              >
                Export Preview
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!selectedOrder || pending}
                onClick={() => {
                  if (!selectedOrder) return;
                  setPplExportError(null);
                  startTransition(async () => {
                    const result = await clientPplExportCommit(selectedOrder.id, {
                      idempotencyKey: `ppl-export:${selectedOrder.id}:${pplSelection?.selectedQuantity ?? "all"}`,
                    });
                    if (!result.ok) {
                      setPplExportCommit(null);
                      setPplExportError(errorText(result.error, result.details));
                      return;
                    }
                    setPplExportCommit(result.data);
                  });
                }}
              >
                Commit Export
              </Button>
              {pplExportCommit ? (
                <a
                  className="inline-flex h-8 items-center rounded-md border px-3 text-sm"
                  href={pplExportDownloadUrl(pplExportCommit.exportId)}
                  download={pplExportCommit.filename}
                >
                  Download CSV
                </a>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!pplExportCommit || pending || Boolean(pplDeliveryResult)}
                data-testid="mark-spreadsheet-delivered"
                onClick={() => {
                  if (!pplExportCommit || pplDeliveryResult) return;
                  setPplDeliveryError(null);
                  setDeliveryDialogOpen(true);
                }}
              >
                Approve &amp; Release
              </Button>
            </div>
          }
        >
          <div className="space-y-3 p-4">
            {selectedOrder ? (
              <PplExportContextPanel
                order={selectedOrder}
                selectedQuantity={pplSelection?.selectedQuantity ?? null}
                exportRowCount={pplExportCommit?.rowCount ?? pplExportPreview?.rowCount ?? null}
                shortfallQuantity={pplSelection?.shortfallQuantity ?? null}
                deliveredValueCents={pplSelection?.economics?.deliveredValueCents ?? null}
                potentialCreditCents={pplSelection?.economics?.potentialCreditCents ?? null}
                creditConfirmed={pplSelection?.economics?.creditStatus === "confirmed_shortfall"}
              />
            ) : null}
            <WarningBanner tone="info" title="Generated ≠ released">
              Requires `SA360_PPL_CSV_EXPORT_ENABLED=true`. Commit generates an operator-only
              package. Internal download is for review and does not release it to the customer.
              Approve &amp; Release is the only action that makes the spreadsheet
              customer-accessible and writes BuyerDeliveredIdentity. No automatic release after
              generation. No Sheets API / external CRM write.
            </WarningBanner>
            {pplDeliveryResult ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="export-package-status">
                <OpsBadge label="Released" tone="success" />
                <span className="text-sm text-slate-700">
                  This spreadsheet is customer-accessible.
                </span>
              </div>
            ) : pplExportCommit ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="export-package-status">
                <OpsBadge label="Spreadsheet ready for review" tone="warn" />
                <span className="text-sm text-slate-700">
                  Download internally, then Approve &amp; Release. The customer cannot see this
                  package yet.
                </span>
              </div>
            ) : null}
            {pplExportError ? (
              <WarningBanner tone="err" title="Export failed">
                {pplExportError}
              </WarningBanner>
            ) : null}
            {pplDeliveryError ? (
              <WarningBanner tone="err" title="Delivery recording failed">
                {pplDeliveryError}
              </WarningBanner>
            ) : null}
            {pplDeliveryResult ? (
              <div
                className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3"
                data-testid="spreadsheet-delivered-success"
              >
                <div className="text-sm font-semibold text-emerald-900">Released</div>
                <div className="grid gap-3 md:grid-cols-4">
                  <StatTile label="Identities recorded" value={pplDeliveryResult.identityCount} />
                  <StatTile label="Evidence" value={pplDeliveryResult.evidenceNote} />
                  <StatTile
                    label="Delivered timestamp"
                    value={new Date(pplDeliveryResult.deliveredAt).toLocaleString()}
                  />
                  <StatTile
                    label="Delivered by"
                    value={pplDeliveryResult.deliveredBy ?? "not captured"}
                  />
                </div>
              </div>
            ) : null}
            {pplExportCommit ? (
              <div className="grid gap-3 md:grid-cols-4">
                <StatTile label="Rows" value={pplExportCommit.rowCount} />
                <StatTile label="Schema" value={pplExportCommit.fieldSchemaVersion} />
                <StatTile
                  label="SHA256"
                  value={`${pplExportCommit.contentSha256.slice(0, 12)}…`}
                />
                <StatTile
                  label="Replay"
                  value={pplExportCommit.idempotentReplay ? "yes" : "no"}
                />
              </div>
            ) : pplExportPreview ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <StatTile label="Rows" value={pplExportPreview.rowCount} />
                  <StatTile label="Allocations" value={pplExportPreview.allocationIds.length} />
                  <StatTile label="Schema" value={pplExportPreview.fieldSchemaVersion} />
                  <StatTile label="Niche" value={pplExportPreview.niche ?? "—"} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Columns: {pplExportPreview.columns.join(", ")}
                </div>
                {pplExportPreview.optionalFieldCoverage ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {Object.entries(pplExportPreview.optionalFieldCoverage).map(
                      ([field, coverage]) => (
                        <div key={field} className="text-sm">
                          <span className="font-mono">{field}</span>: {coverage.populated} /{" "}
                          {coverage.total} populated
                        </div>
                      )
                    )}
                  </div>
                ) : null}
                <StatTile
                  label="SHA256"
                  value={`${pplExportPreview.contentSha256.slice(0, 12)}…`}
                />
              </div>
            ) : (
              <EmptyState
                title="No CSV export yet"
                hint="Preview or commit a buyer-safe CSV package for reserved allocations."
              />
            )}
          </div>
        </SectionPanel>
      </SectionErrorBoundary>

      <SectionErrorBoundary title="PPL duplicate replacement">
        {!showReplacementWorkbench ? (
          <SectionPanel title="Replacement fulfillment — Beta restricted">
            <div className="space-y-2 p-4">
              <p className="text-sm text-muted-foreground">
                Replacement operations remain restricted during Alex beta. Priced replacement
                candidates are server-locked to the snapshotted commerce bucket, but this workflow
                is hidden unless `SA360_PPL_REPLACEMENT_ENABLED=true`.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReplacementOpsOpen((open) => !open)}
              >
                {replacementOpsOpen ? "Hide restricted tools" : "Show restricted tools"}
              </Button>
              {!replacementOpsOpen ? (
                <EmptyState
                  title="Replacement fulfillment — Beta restricted"
                  hint="Not part of the initial priced PPL CSV workflow."
                />
              ) : null}
            </div>
          </SectionPanel>
        ) : null}
        {showReplacementWorkbench || replacementOpsOpen ? (
        <SectionPanel
          title="Stage 2d — Duplicate-Only Replacement"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedOrder || pending || !pplReplacementAllocationId.trim()}
                onClick={() => {
                  if (!selectedOrder) return;
                  setPplReplacementError(null);
                  startTransition(async () => {
                    const result = await clientPplReplacementRequest({
                      originalAllocationId: pplReplacementAllocationId.trim(),
                      reason: pplReplacementReason.trim() || "duplicate",
                      requestId: `ppl-replace-req:${selectedOrder.id}:${pplReplacementAllocationId.trim()}`,
                      reasonCode: "duplicate",
                    });
                    if (!result.ok) {
                      setPplReplacementError(errorText(result.error, result.details));
                      return;
                    }
                    const list = await clientPplListReplacements(selectedOrder.id);
                    if (list.ok) setPplReplacements(list.data);
                  });
                }}
              >
                Request replacement
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedOrder || pending || pplReplacements.length === 0}
                onClick={() => {
                  const latest = pplReplacements[0];
                  if (!latest) return;
                  setPplReplacementError(null);
                  startTransition(async () => {
                    const result = await clientPplReplacementPreview(latest.id);
                    if (!result.ok) {
                      setPplReplacementPreview(null);
                      setPplReplacementError(errorText(result.error, result.details));
                      return;
                    }
                    setPplReplacementPreview(
                      `eligible=${String(result.data.eligibleQuantity)} selected=${String(result.data.selectedItemId ?? "none")}`
                    );
                  });
                }}
              >
                Preview latest
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!selectedOrder || pending || pplReplacements.length === 0}
                onClick={() => {
                  const latest = pplReplacements.find((row) => row.status === "requested");
                  if (!latest) {
                    setPplReplacementError("No requested replacement to approve");
                    return;
                  }
                  setPplReplacementError(null);
                  startTransition(async () => {
                    const result = await clientPplReplacementDecision(latest.id, {
                      action: "approve",
                      confirmationPhrase: pplReplacementConfirm.trim(),
                      requestId: `ppl-replace-dec:${latest.id}`,
                    });
                    if (!result.ok) {
                      setPplReplacementError(errorText(result.error, result.details));
                      return;
                    }
                    if (selectedOrder) {
                      const list = await clientPplListReplacements(selectedOrder.id);
                      if (list.ok) setPplReplacements(list.data);
                    }
                  });
                }}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedOrder || pending || pplReplacements.length === 0}
                onClick={() => {
                  const latest = pplReplacements.find((row) => row.status === "requested");
                  if (!latest) {
                    setPplReplacementError("No requested replacement to deny");
                    return;
                  }
                  setPplReplacementError(null);
                  startTransition(async () => {
                    const result = await clientPplReplacementDecision(latest.id, {
                      action: "deny",
                      decisionNote: "Denied by operator",
                    });
                    if (!result.ok) {
                      setPplReplacementError(errorText(result.error, result.details));
                      return;
                    }
                    if (selectedOrder) {
                      const list = await clientPplListReplacements(selectedOrder.id);
                      if (list.ok) setPplReplacements(list.data);
                    }
                  });
                }}
              >
                Deny
              </Button>
            </div>
          }
        >
          <div className="space-y-3 p-4">
            <WarningBanner tone="info" title="Duplicate complaints only">
              Requires `SA360_PPL_REPLACEMENT_ENABLED=true` and prior buyer delivery. One-for-one
              only. Original inventory never returns to available. Approve confirmation phrase:
              APPROVE REPLACEMENT.
            </WarningBanner>
            <div className="grid gap-2 md:grid-cols-3">
              <Input
                value={pplReplacementAllocationId}
                onChange={(e) => setPplReplacementAllocationId(e.target.value)}
                placeholder="Original allocation id"
              />
              <Input
                value={pplReplacementReason}
                onChange={(e) => setPplReplacementReason(e.target.value)}
                placeholder="Reason"
              />
              <Input
                value={pplReplacementConfirm}
                onChange={(e) => setPplReplacementConfirm(e.target.value)}
                placeholder="APPROVE REPLACEMENT"
              />
            </div>
            {pplReplacementError ? (
              <WarningBanner tone="err" title="Replacement failed">
                {pplReplacementError}
              </WarningBanner>
            ) : null}
            {pplReplacementPreview ? (
              <WarningBanner tone="info" title="Preview">
                {pplReplacementPreview}
              </WarningBanner>
            ) : null}
            {pplReplacements.length > 0 ? (
              <div className="space-y-2 text-sm">
                {pplReplacements.slice(0, 5).map((row) => (
                  <div key={row.id} className="flex flex-wrap gap-3 border-b pb-2">
                    <span>
                      <OpsBadge label={row.status} />
                    </span>
                    <span>orig {row.originalAllocationId.slice(0, 10)}…</span>
                    <span>
                      repl{" "}
                      {row.replacementAllocationId
                        ? `${row.replacementAllocationId.slice(0, 10)}…`
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No replacement requests"
                hint="After CSV export, request a duplicate-only replacement for a delivered allocation."
              />
            )}
          </div>
        </SectionPanel>
        ) : null}
      </SectionErrorBoundary>

      {isPricedPplOrder ? (
        <SectionErrorBoundary title="Legacy / Simulation Operations">
          <SectionPanel
            title="Legacy / Simulation Operations"
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLegacyOpsOpen((open) => !open)}
              >
                {legacyOpsOpen ? "Hide diagnostics" : "Show diagnostics"}
              </Button>
            }
          >
            <div className="space-y-2 p-4">
              <p className="text-sm text-muted-foreground">
                Not used for priced PPL CSV fulfillment. Stages 3–6 are advanced simulation
                diagnostics from the older reservation/simulation lane and are not the next
                required operator steps for this order.
              </p>
              {!legacyOpsOpen ? (
                <EmptyState
                  title="Advanced Simulation Diagnostics"
                  hint="Stage 2 is the CSV fulfillment workflow for this priced PPL order."
                />
              ) : null}
            </div>
          </SectionPanel>
        </SectionErrorBoundary>
      ) : null}

      {!isPricedPplOrder || legacyOpsOpen ? (
      <>
      <SectionErrorBoundary title="Eligibility">
        <SectionPanel
          title="Stage 3 — Eligibility Preview"
          action={
            <Button type="button" size="sm" disabled={!selectedOrder || pending} onClick={runEligibility}>
              Run eligibility preview
            </Button>
          }
        >
          <div className="space-y-3 p-4">
            <WarningBanner tone="info" title="Matching limitation">
              Preview uses available Lead Inventory items filtered by order niche/states. It is not
              inventory-SKU-aware beyond those filters, and it does not use Inventory Explorer fixtures.
            </WarningBanner>
            {eligibilityError ? (
              <WarningBanner tone="err" title="Eligibility preview failed">
                {eligibilityError}
              </WarningBanner>
            ) : null}
            {!eligibility ? (
              <EmptyState
                title="No eligibility preview yet"
                hint="Select an active order, then run eligibility preview."
              />
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <StatTile label="Scanned" value={eligibility.scanned} />
                  <StatTile label="Eligible" value={eligibility.eligibleCount} />
                  <StatTile label="Excluded" value={eligibility.excludedCount} />
                  <StatTile
                    label="Reservation-ready rows"
                    value={eligibility.candidates.filter((c) => c.reservationPermitted).length}
                  />
                </div>
                {Object.keys(eligibility.exclusionReasonCounts).length > 0 ? (
                  <div className="text-sm">
                    <div className="mb-1 font-medium">Exclusion reasons</div>
                    <ul className="grid gap-1 md:grid-cols-2">
                      {Object.entries(eligibility.exclusionReasonCounts).map(([code, count]) => (
                        <li key={code} className="flex justify-between border-b py-1 font-mono text-xs">
                          <span>{code}</span>
                          <span>{count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="px-2 py-2">Select</th>
                        <th className="px-2 py-2">Item</th>
                        <th className="px-2 py-2">State</th>
                        <th className="px-2 py-2">Age</th>
                        <th className="px-2 py-2">Inventory</th>
                        <th className="px-2 py-2">Eligibility</th>
                        <th className="px-2 py-2">Proof / dupe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibility.candidates.map((candidate) => {
                        const elig = labelForEligibility(candidate.predictedEligibilityStatus);
                        const inv = labelForInventoryStatus(candidate.inventoryStatus);
                        return (
                          <tr key={candidate.inventoryItemId} className="border-b">
                            <td className="px-2 py-2">
                              <input
                                type="radio"
                                name="candidate"
                                disabled={!candidate.reservationPermitted || pending}
                                checked={selectedCandidate?.inventoryItemId === candidate.inventoryItemId}
                                onChange={() => setSelectedCandidate(candidate)}
                              />
                            </td>
                            <td className="px-2 py-2 font-mono text-xs">
                              {candidate.maskedItemId}
                            </td>
                            <td className="px-2 py-2">{candidate.normalizedState}</td>
                            <td className="px-2 py-2">
                              {candidate.ageDays}d
                              {candidate.ageBandKey ? ` (${candidate.ageBandKey})` : ""}
                            </td>
                            <td className="px-2 py-2">
                              <OpsBadge label={inv.label} tone={inv.tone} />
                            </td>
                            <td className="px-2 py-2">
                              <OpsBadge label={elig.label} tone={elig.tone} />
                            </td>
                            <td className="px-2 py-2 text-xs">
                              {candidate.proofStatus ?? "—"} / {candidate.duplicateStatus ?? "—"}
                              {candidate.warnings.length > 0 ? (
                                <div className="text-amber-700">{candidate.warnings.join(", ")}</div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </SectionPanel>
      </SectionErrorBoundary>

      <SectionErrorBoundary title="Reservation">
        <SectionPanel title="Stage 4 — Reservation">
          <div className="space-y-3 p-4">
            <WarningBanner tone="info" title="Simulation only — no external delivery will occur.">
              Reservation is an explicit operator action. Double reservation is blocked by allocation
              idempotency and exclusive source-lead protection.
            </WarningBanner>
            {selectedCandidate && selectedOrder ? (
              <div className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-3">
                <div>
                  <div className="text-muted-foreground">Order</div>
                  <div className="font-mono">{selectedOrder.orderNumber}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Candidate</div>
                  <div className="font-mono">{selectedCandidate.maskedItemId}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Niche / state / age</div>
                  <div>
                    {selectedCandidate.nicheKey} / {selectedCandidate.normalizedState} /{" "}
                    {selectedCandidate.ageDays}d
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No candidate selected"
                hint="Choose an eligible candidate from Stage 3."
              />
            )}
            <Button
              type="button"
              disabled={!selectedOrder || !selectedCandidate || pending}
              onClick={runPrepareAndReserve}
            >
              Prepare + reserve candidate
            </Button>
            {reserveError ? (
              <WarningBanner tone="err" title="Reservation failed">
                {reserveError}
              </WarningBanner>
            ) : null}
            {prepareResult ? (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 text-sm">
                <div className="mb-2 flex flex-wrap gap-2">
                  <OpsBadge {...labelForAllocation(prepareResult.allocationStatus)} />
                  {prepareResult.simulationReady ? (
                    <OpsBadge label="SIMULATION READY" tone="info" />
                  ) : null}
                </div>
                <div className="grid gap-1 font-mono text-xs md:grid-cols-2">
                  <div>allocation: {prepareResult.allocationId}</div>
                  <div>instruction: {prepareResult.deliveryInstructionId}</div>
                  <div>adapter: {prepareResult.deliveryTargetAdapterKey}</div>
                  <div>external write: {String(prepareResult.externalWriteOccurred)}</div>
                </div>
              </div>
            ) : null}
          </div>
        </SectionPanel>
      </SectionErrorBoundary>

      <SectionErrorBoundary title="Simulation">
        <SectionPanel title="Stage 5 — Simulated Delivery">
          <div className="space-y-3 p-4">
            <WarningBanner tone="info" title="Simulation only — no external delivery will occur.">
              Execution mode is forced to `simulate` via `test.simulated.v1`. This workbench never calls LF2
              GHL live canary endpoints.
            </WarningBanner>
            <Button
              type="button"
              disabled={
                pending ||
                !(
                  prepareResult?.deliveryInstructionId ||
                  evidence?.instructions[0]?.id
                )
              }
              onClick={runSimulate}
            >
              Run simulated delivery
            </Button>
            {simulateError ? (
              <WarningBanner tone="err" title="Simulation failed">
                {simulateError}
              </WarningBanner>
            ) : null}
            {simulateOkMessage ? (
              <WarningBanner tone="info" title="Simulation completed">
                {simulateOkMessage}
              </WarningBanner>
            ) : null}
            {evidence ? (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <OpsBadge {...labelForAllocation(evidence.allocationStatus)} />
                  <OpsBadge
                    label={`LIVE ATTEMPTS: ${evidence.liveAttemptCount}`}
                    tone={evidence.liveAttemptCount === 0 ? "success" : "danger"}
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-3 font-mono text-xs">
                  <div>sim attempts: {evidence.simulationAttemptCount}</div>
                  <div>sim succeeded: {evidence.simulationSucceededCount}</div>
                  <div>sim failed: {evidence.simulationFailedCount}</div>
                </div>
                {evidence.instructions.map((instruction) => {
                  const latest = instruction.latestAttempt;
                  const badge = latest
                    ? labelForAttempt(latest.status, latest.executionMode)
                    : { label: "NO ATTEMPT", tone: "neutral" as const };
                  return (
                    <div key={instruction.id} className="rounded border border-slate-100 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{instruction.adapterKey}</span>
                        <OpsBadge label={badge.label} tone={badge.tone} />
                        <span className="text-xs text-muted-foreground">
                          instruction {instruction.status} · attempts {instruction.attemptCount}
                        </span>
                      </div>
                      {latest ? (
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          #{latest.attemptNumber} mode={latest.executionMode} status={latest.status}
                          {latest.errorSummary ? ` · ${latest.errorSummary}` : ""}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </SectionPanel>
      </SectionErrorBoundary>

      <SectionErrorBoundary title="Evidence">
        <SectionPanel title="Stage 6 — Operational Evidence">
          <div className="space-y-4 p-4">
            <ol className="space-y-2">
              {timeline.map((step) => (
                <li
                  key={step.label}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span className={step.done ? "font-medium text-emerald-800" : "text-muted-foreground"}>
                    {step.done ? "✓" : "○"} {step.label}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{step.detail}</span>
                </li>
              ))}
            </ol>
            <div className="grid gap-3 md:grid-cols-4">
              <StatTile label="Eligible candidates" value={eligibility?.eligibleCount ?? 0} />
              <StatTile label="Excluded candidates" value={eligibility?.excludedCount ?? 0} />
              <StatTile label="Simulations succeeded" value={evidence?.simulationSucceededCount ?? 0} />
              <StatTile label="Live attempts" value={evidence?.liveAttemptCount ?? 0} />
            </div>
            {evidence ? (
              <div className="rounded-lg border bg-slate-50 p-3 text-xs font-mono">
                order counters: req={evidence.orderCounters.requestedQuantity ?? "null"} proposed=
                {evidence.orderCounters.proposedQuantity} reserved=
                {evidence.orderCounters.reservedQuantity} fulfilled=
                {evidence.orderCounters.fulfilledQuantity}
                <div className="mt-1">
                  reservedAt={evidence.reservedAt ?? "null"} · externalWriteOccurred=
                  {String(evidence.externalWriteOccurred)}
                </div>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Refresh preserves backend state. Returns, billing, marketplace checkout, and live delivery remain
              out of scope.
            </p>
          </div>
        </SectionPanel>
      </SectionErrorBoundary>
      </>
      ) : null}

      <MarkSpreadsheetDeliveredDialog
        open={deliveryDialogOpen}
        pending={pending}
        clientLabel={
          selectedOrder?.clientDisplayName?.trim() || selectedOrder?.clientAccountId || "—"
        }
        orderNumber={selectedOrder?.orderNumber ?? "—"}
        niche={selectedOrder?.nicheKey ?? "—"}
        bucketLabel={
          selectedOrder?.pricing?.label ?? selectedOrder?.pricing?.commerceAgeBucketKey ?? "—"
        }
        rowCount={pplExportCommit?.rowCount ?? 0}
        onCancel={() => setDeliveryDialogOpen(false)}
        onConfirm={() => {
          if (!pplExportCommit) return;
          setDeliveryDialogOpen(false);
          setPplDeliveryError(null);
          startTransition(async () => {
            const result = await clientPplMarkSpreadsheetDelivered(pplExportCommit.exportId, {
              confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
              idempotencyKey: `ppl-delivered:${pplExportCommit.exportId}`,
            });
            if (!result.ok) {
              setPplDeliveryResult(null);
              setPplDeliveryError(errorText(result.error, result.details));
              return;
            }
            setPplDeliveryResult(result.data);
          });
        }}
      />
    </div>
  );
}
