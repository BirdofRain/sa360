"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionErrorBoundary } from "@/components/dashboard/section-error-boundary";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { OpsBadge } from "@/components/fulfillment-ops/ops-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clientActivateOrder,
  clientCreateDemoOrder,
  clientEligibilityPreview,
  clientFetchEvidence,
  clientFetchOrderLatestEvidence,
  clientListOrders,
  clientPrepareCandidate,
  clientReserveAllocation,
  clientSimulateInstruction,
} from "@/lib/fulfillment-ops/client-api";
import {
  labelForAllocation,
  labelForAttempt,
  labelForEligibility,
  labelForInventoryStatus,
} from "@/lib/fulfillment-ops/status";
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
  loadError: string | null;
  initialOrderId: string | null;
};

function errorText(error: string, details?: unknown): string {
  if (details && typeof details === "object" && details !== null) {
    const obj = details as { error?: string; reasons?: string[] };
    if (Array.isArray(obj.reasons) && obj.reasons.length > 0) {
      return `${obj.error ?? error}: ${obj.reasons.join(", ")}`;
    }
    if (typeof obj.error === "string") return obj.error;
  }
  return error;
}

export function FulfillmentOpsWorkbench({
  bootstrap,
  orders: initialOrders,
  clients,
  loadError,
  initialOrderId,
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
  const [demoVolume, setDemoVolume] = useState("3");
  const [createError, setCreateError] = useState<string | null>(null);

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
  }, [summary, reviewCounts, selectedOrder, eligibility, evidence, prepareResult]);

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
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("orderId", order.id);
      window.history.replaceState({}, "", url.toString());
    }
    startTransition(async () => {
      const ev = await clientFetchOrderLatestEvidence(order.id);
      if (ev.ok) setEvidence(ev.data);
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

  function runCreateDemo() {
    setCreateError(null);
    const states = demoStates
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const volume = Number(demoVolume);
    if (!demoClientId || states.length === 0 || !Number.isFinite(volume) || volume < 1) {
      setCreateError("Client, states, and lead volume are required.");
      return;
    }
    startTransition(async () => {
      const result = await clientCreateDemoOrder({
        clientAccountId: demoClientId,
        nicheKey: demoNiche.trim() || "vet",
        states,
        leadVolume: volume,
      });
      if (!result.ok) {
        setCreateError(errorText(result.error, result.details));
        return;
      }
      setOrders((prev) => [result.data, ...prev]);
      selectOrder(result.data);
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
            {loadError}
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
              <EmptyState title="No order selected" hint="Select an order or create a demo order below." />
            )}

            {orderError ? (
              <WarningBanner tone="err" title="Order action failed">
                {orderError}
              </WarningBanner>
            ) : null}

            <div className="rounded-lg border border-dashed border-slate-200 p-3">
              <h4 className="mb-2 text-sm font-medium">Create demo LeadOrder (LF2 fields set)</h4>
              <div className="grid gap-2 md:grid-cols-4">
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
                <Input value={demoStates} onChange={(e) => setDemoStates(e.target.value)} placeholder="States" />
                <Input value={demoVolume} onChange={(e) => setDemoVolume(e.target.value)} placeholder="Volume" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button type="button" disabled={pending} onClick={runCreateDemo}>
                  Create demo order
                </Button>
                {createError ? <span className="text-sm text-red-700">{createError}</span> : null}
              </div>
            </div>
          </div>
        </SectionPanel>
      </SectionErrorBoundary>

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
    </div>
  );
}
