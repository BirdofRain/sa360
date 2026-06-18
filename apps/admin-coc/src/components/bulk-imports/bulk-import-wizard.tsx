"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  approveBulkImportDeliveryAction,
  fetchBulkImportDetail,
  fetchBulkImportDestinationOptions,
  normalizeBulkImportAction,
  resetBulkImportAction,
  saveBulkImportMappingAction,
  setBulkImportDestinationAction,
  setBulkImportWizardStepAction,
  simulateBulkImportAction,
  type BulkImportDestinationOption,
} from "@/app/actions/bulk-imports";
import { BulkImportDeliveryNotice } from "@/components/bulk-imports/bulk-import-delivery-notice";
import { BulkImportDestinationSelector } from "@/components/bulk-imports/bulk-import-destination-selector";
import { BulkImportMappingEditor } from "@/components/bulk-imports/bulk-import-mapping-editor";
import {
  BulkImportConfirmDialog,
} from "@/components/bulk-imports/bulk-import-confirm-dialog";
import {
  BulkImportReviewTable,
  type BulkImportReviewRow,
} from "@/components/bulk-imports/bulk-import-review-table";
import { BulkImportSummaryCards } from "@/components/bulk-imports/bulk-import-summary-cards";
import {
  BulkImportSimulationResults,
  type SimulationRowResult,
} from "@/components/bulk-imports/bulk-import-simulation-results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BULK_IMPORT_UPDATED_EVENT,
  type BulkImportUpdatedDetail,
} from "@/lib/bulk-imports/bulk-import-events";
import {
  parseRequestedWizardStep,
  type MappingSuggestion,
  type PreviewRow,
} from "@/lib/bulk-imports/mapping-editor";
import {
  BULK_IMPORT_APPROVE_PHRASE,
  BULK_IMPORT_WIZARD_STEPS,
  type BulkImportWizardStep,
} from "@/lib/bulk-imports/types";
import { BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE, BULK_IMPORT_RESET_CONFIRMATION } from "@sa360/shared";
import {
  clearWizardActionError,
  type WizardActionError,
  type WizardActionKey,
} from "@/lib/bulk-imports/wizard-action-errors";
import {
  canAccessWizardStep,
  deriveWizardStep,
  requiresResetForWizardNavigation,
  resolveActiveWizardStep,
  shouldPollBatchStatus,
  type BulkImportBatchState,
  type BulkImportSummary,
} from "@/lib/bulk-imports/wizard-steps";

type WizardProps = {
  importId: string;
  requestedStep?: string;
  initial: {
    batch: Record<string, unknown>;
    summary: Record<string, unknown>;
  };
};

type ActionKey = WizardActionKey | null;

export function BulkImportWizard({ importId, requestedStep, initial }: WizardProps) {
  const router = useRouter();
  const navRef = useRef<HTMLDivElement>(null);
  const [batch, setBatch] = useState<Record<string, unknown>>(initial.batch);
  const [summary, setSummary] = useState<Record<string, unknown>>(initial.summary);
  const [rows, setRows] = useState<BulkImportReviewRow[]>(
    (initial.batch.rows as BulkImportReviewRow[] | undefined) ?? []
  );
  const [destinationOptions, setDestinationOptions] = useState<BulkImportDestinationOption[]>([]);
  const [activeAction, setActiveAction] = useState<ActionKey>(null);
  const [error, setError] = useState<WizardActionError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [approvalText, setApprovalText] = useState("");
  const [waveSize, setWaveSize] = useState(5);
  const [navResetPrompt, setNavResetPrompt] = useState<{
    target: BulkImportWizardStep;
    resetTarget: "mapping" | "destination" | "review";
    message: string;
  } | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [navResetLoading, setNavResetLoading] = useState(false);
  const [navResetError, setNavResetError] = useState<string | null>(null);
  const [mappingReturnStep, setMappingReturnStep] = useState<BulkImportWizardStep | null>(null);

  useEffect(() => {
    setBatch(initial.batch);
    setSummary(initial.summary);
    setRows((initial.batch.rows as BulkImportReviewRow[] | undefined) ?? []);
  }, [initial.batch, initial.summary]);

  const batchState = batch as BulkImportBatchState;
  const summaryState = summary as BulkImportSummary;
  const step = resolveActiveWizardStep(
    batchState,
    summaryState,
    parseRequestedWizardStep(requestedStep)
  );
  const mappingJson = (batch.mappingJson as Record<string, string> | undefined) ?? {};
  const importOptions = (batch.importOptionsJson as Record<string, unknown> | undefined) ?? {};
  const wizardMeta = (batch.wizardStepJson as Record<string, unknown> | undefined) ?? {};
  const headers = (wizardMeta.headers as string[] | undefined) ?? [];
  const suggestions = (wizardMeta.suggestions as MappingSuggestion[] | undefined) ?? [];
  const previewRows = (wizardMeta.previewRows as PreviewRow[] | undefined) ?? [];
  const missingRequired = (wizardMeta.missingRequired as string[] | undefined) ?? [];
  const mappingConfirmed = Boolean(
    wizardMeta.mappingConfirmed ?? (summary as BulkImportSummary).mappingConfirmed
  );
  const displayHeaders = useMemo(
    () => (headers.length > 0 ? headers : Object.keys(mappingJson)),
    [headers, mappingJson]
  );
  const simulationResults =
    (wizardMeta.simulationResults as SimulationRowResult[] | undefined) ?? [];
  const syncKey = `${importId}:${String(batch.updatedAt ?? "")}:${String(batch.status ?? "")}`;

  const eligibleSimulatedCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          !r.excluded &&
          r.validationStatus === "ready_for_simulation" &&
          r.deliveryStatus === "simulated"
      ).length,
    [rows]
  );

  const refreshDetail = useCallback(async () => {
    setActiveAction("refresh");
    const result = await fetchBulkImportDetail(importId);
    setActiveAction(null);
    if (!result.ok) {
      setError({ action: "refresh", message: result.message });
      return false;
    }
    const nextSummary = result.data.summary;
    setBatch(result.data.batch);
    setSummary(nextSummary);
    setRows((result.data.batch.rows as BulkImportReviewRow[] | undefined) ?? []);
    setError((prev) =>
      clearWizardActionError(prev, {
        eligibleForSimulation: Number(nextSummary.eligibleForSimulation ?? 0),
      })
    );
    router.refresh();
    return {
      eligibleForSimulation: Number(nextSummary.eligibleForSimulation ?? 0),
      normalizedSourceEvents: Number(nextSummary.normalizedSourceEvents ?? 0),
    };
  }, [importId, router]);

  useEffect(() => {
    void fetchBulkImportDestinationOptions().then((result) => {
      if (result.ok) setDestinationOptions(result.data.items);
    });
  }, []);

  useEffect(() => {
    function onBulkImportUpdated(event: Event) {
      const detail = (event as CustomEvent<BulkImportUpdatedDetail>).detail;
      if (detail.importId !== importId) return;
      void refreshDetail().then(() => {
        navRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    window.addEventListener(BULK_IMPORT_UPDATED_EVENT, onBulkImportUpdated);
    return () => window.removeEventListener(BULK_IMPORT_UPDATED_EVENT, onBulkImportUpdated);
  }, [importId, refreshDetail]);

  useEffect(() => {
    const max = Math.min(
      eligibleSimulatedCount || Number(summary.simulatedRows ?? 0) || 5,
      BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE
    );
    setWaveSize((prev) => (prev > max ? max : prev || max));
  }, [eligibleSimulatedCount, summary.simulatedRows]);

  useEffect(() => {
    const status = String(batch.status ?? "");
    if (!shouldPollBatchStatus(status)) return;
    const timer = setInterval(() => {
      void refreshDetail();
    }, 5000);
    return () => clearInterval(timer);
  }, [batch.status, refreshDetail]);

  const eligibleForSimulation = Number(summary.eligibleForSimulation ?? 0);

  useEffect(() => {
    setError((prev) => clearWizardActionError(prev, { importChanged: true }));
  }, [importId]);

  useEffect(() => {
    setError((prev) => clearWizardActionError(prev, { stepChanged: true }));
  }, [step]);

  useEffect(() => {
    setError((prev) =>
      clearWizardActionError(prev, { eligibleForSimulation })
    );
  }, [eligibleForSimulation]);
  const missingSourceEvent = Number(summary.missingSourceEvent ?? 0);
  const hasDownstreamArtifacts =
    Number(summary.normalizedSourceEvents ?? 0) > 0 ||
    Number(summary.simulatedRows ?? 0) > 0 ||
    (batchState.simulatedRows ?? 0) > 0;
  const mappingInitialMode =
    !mappingConfirmed || batchState.status === "mapping_required"
      ? "edit"
      : "view";

  async function runAction<T>(
    key: ActionKey,
    action: () => Promise<{ ok: boolean; message?: string; error?: string; data?: T }>,
    options?: { clearErrorOnStart?: boolean }
  ) {
    if (options?.clearErrorOnStart !== false) {
      setError(null);
    }
    setMessage(null);
    setActiveAction(key);
    const result = await action();
    setActiveAction(null);
    if (!result.ok) {
      if (key) {
        setError({
          action: key,
          code: result.error,
          message: result.message ?? "Action failed",
        });
      }
      return false;
    }
    setError(null);
    const refreshed = await refreshDetail();
    if (key === "normalize" && refreshed) {
      const normalizedCount = refreshed.normalizedSourceEvents;
      if (normalizedCount > 0) {
        setMessage(
          `${normalizedCount} Source Intake record${normalizedCount === 1 ? "" : "s"} created. No GHL writes occurred.`
        );
      } else {
        setMessage("Saved.");
      }
    } else if (key === "simulate" && refreshed) {
      setMessage(
        refreshed.eligibleForSimulation > 0
          ? "Simulation complete. Review results below."
          : "Saved."
      );
    } else {
      setMessage("Saved.");
    }
    return true;
  }

  async function goToStep(target: BulkImportWizardStep) {
    if (!canAccessWizardStep(target, batchState, summaryState)) return;
    if (target === "map" && step !== "map") {
      setMappingReturnStep(step);
    }
    const resetNeeded =
      target !== "map" ? requiresResetForWizardNavigation(target, batchState, summaryState) : null;
    if (resetNeeded) {
      setNavResetError(null);
      setNavResetPrompt({
        target,
        resetTarget: resetNeeded.target,
        message: resetNeeded.message,
      });
      return;
    }
    const result = await setBulkImportWizardStepAction(importId, target);
    if (!result.ok) {
      setError({ action: "mapping", message: result.message });
      return;
    }
    setBatch((prev) => ({
      ...prev,
      wizardStepJson: { ...(prev.wizardStepJson as object), step: target },
    }));
    router.replace(`/source-intake/imports/${importId}?step=${target}`);
  }

  async function confirmNavReset() {
    if (!navResetPrompt) return;
    setNavResetLoading(true);
    setNavResetError(null);
    const prompt = navResetPrompt;
    const result = await resetBulkImportAction(importId, prompt.resetTarget, resetConfirmText);
    if (!result.ok) {
      setNavResetLoading(false);
      setNavResetError(result.message);
      return;
    }
    const stepResult = await setBulkImportWizardStepAction(importId, prompt.target);
    if (!stepResult.ok) {
      setNavResetLoading(false);
      setNavResetError(stepResult.message);
      return;
    }
    setNavResetPrompt(null);
    setResetConfirmText("");
    setNavResetLoading(false);
    await refreshDetail();
    router.replace(`/source-intake/imports/${importId}?step=${prompt.target}`);
  }

  const destinationLabel =
    String(wizardMeta.destinationClientDisplayName ?? batch.destinationClientAccountId ?? "—");
  const locationLabel = String(
    wizardMeta.destinationLocationName ?? batch.destinationLocationIdGhl ?? "—"
  );

  return (
    <div className="space-y-6" key={syncKey}>
      <BulkImportDeliveryNotice
        batch={{
          status: String(batch.status ?? ""),
          rows: rows.map((r) => ({
            sourceLeadEventId: (r as { sourceLeadEventId?: string }).sourceLeadEventId,
            deliveryStatus: r.deliveryStatus,
          })),
        }}
      />

      <div ref={navRef} className="flex flex-wrap gap-2 text-xs">
        {BULK_IMPORT_WIZARD_STEPS.filter((s) => s !== "upload").map((s) => {
          const allowed = canAccessWizardStep(s, batchState, summaryState);
          const isCurrent = step === s;
          return (
            <button
              key={s}
              type="button"
              disabled={!allowed}
              onClick={() => void goToStep(s)}
              className={`rounded-full border px-2 py-1 capitalize ${
                isCurrent ? "bg-primary text-primary-foreground" : ""
              } ${!allowed ? "opacity-40" : ""}`}
            >
              {s}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-sm">
          <strong>File:</strong> {String(batch.fileName)} · <strong>Status:</strong>{" "}
          {String(batch.status)}
        </p>
        <BulkImportSummaryCards summary={summary} batchStatus={String(batch.status)} />
      </div>

      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}

      {step === "map" ? (
        displayHeaders.length > 0 ? (
        <BulkImportMappingEditor
          key={`mapping-${syncKey}`}
          headers={displayHeaders}
          suggestions={suggestions}
          previewRows={previewRows}
          savedMapping={mappingJson}
          missingRequired={missingRequired}
          mappingConfirmed={mappingConfirmed}
          destinationClientAccountId={batch.destinationClientAccountId as string | null}
          destinationLocationIdGhl={batch.destinationLocationIdGhl as string | null}
          hasDownstreamArtifacts={hasDownstreamArtifacts}
          initialMode={mappingInitialMode}
          returnStep={mappingReturnStep ?? undefined}
          loading={activeAction === "mapping"}
            onReturnToStep={() => {
            const target =
              mappingReturnStep ?? deriveWizardStep(batchState, summaryState);
            void goToStep(target);
          }}
          onSave={async (nextMapping, options) => {
            setError(null);
            setMessage(null);
            setActiveAction("mapping");
            const result = await saveBulkImportMappingAction(importId, nextMapping, undefined, options);
            setActiveAction(null);
            if (!result.ok) {
              if (result.error === "mapping_change_requires_reset" && result.impact) {
                return {
                  ok: false as const,
                  message: result.message,
                  resetRequired: true,
                  impact: result.impact as import("@/lib/bulk-imports/mapping-editor").MappingChangeImpactPreview,
                };
              }
              return { ok: false as const, message: result.message };
            }
            await refreshDetail();
            const nextStep = (result.data.nextStep as BulkImportWizardStep | undefined) ?? "destination";
            if (result.data.mappingChanged) {
              if (nextStep !== "map") {
                router.replace(`/source-intake/imports/${importId}?step=${nextStep}`);
              }
              if (result.data.resetPerformed) {
                setMessage("Mapping saved. Normalize the rows again to apply the new mapping.");
              }
            }
            return {
              ok: true as const,
              mappingChanged: Boolean(result.data.mappingChanged),
              resetPerformed: Boolean(result.data.resetPerformed),
              nextStep,
            };
          }}
        />
        ) : (
          <p className="text-sm text-destructive">
            Mapping metadata is missing and could not be reconstructed.
          </p>
        )
      ) : null}

      {step === "destination" && (
        <BulkImportDestinationSelector
          options={destinationOptions}
          initialClientId={String(batch.destinationClientAccountId ?? "")}
          initialLocationId={String(batch.destinationLocationIdGhl ?? "")}
          loading={activeAction === "destination"}
          onSave={(payload) =>
            void runAction("destination", async () => {
              const result = await setBulkImportDestinationAction(importId, payload);
              return result.ok
                ? { ok: true as const, data: result.data }
                : { ok: false as const, message: result.message };
            })
          }
        />
      )}

      {step === "review" && (
        <div className="space-y-4">
          <p className="text-sm">
            Normalize rows into Source Intake events (no GHL writes). Review classifications before
            simulation.
          </p>
          {rows.length > 0 ? <BulkImportReviewTable rows={rows} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={activeAction !== null}
              onClick={() =>
                void runAction("normalize", async () => {
                  const result = await normalizeBulkImportAction(importId);
                  return result.ok
                    ? { ok: true as const, data: result.data }
                    : { ok: false as const, message: result.message };
                })
              }
            >
              {activeAction === "normalize"
                ? "Normalizing…"
                : missingSourceEvent > 0
                  ? "Repair normalization"
                  : "Normalize & review"}
            </Button>
          </div>
          {missingSourceEvent > 0 ? (
            <p className="text-sm text-amber-800">
              {missingSourceEvent} row(s) passed identity checks but do not have valid Source Intake
              records. Run repair normalization to rebuild them.
            </p>
          ) : null}
          {eligibleForSimulation === 0 && missingSourceEvent === 0 ? (
            <p className="text-sm text-amber-800">
              No eligible rows for simulation. Resolve blockers above before continuing.
            </p>
          ) : null}
        </div>
      )}

      {step === "simulate" && (
        <div className="space-y-4">
          <p className="text-sm">
            Run adapter simulation on eligible rows (no external GHL writes). Eligible for
            simulation: {eligibleForSimulation}
          </p>
          {missingSourceEvent > 0 ? (
            <p className="text-sm text-amber-800">
              {missingSourceEvent} row(s) need normalization repair before simulation.
            </p>
          ) : null}
          {simulationResults.length > 0 ? (
            <BulkImportSimulationResults
              results={simulationResults}
              targetRowCount={simulationResults.length}
              simulatedRows={simulationResults.filter((r) => r.status === "simulated").length}
              failedRows={simulationResults.filter((r) => r.status === "failed").length}
            />
          ) : null}
          {rows.length > 0 ? <BulkImportReviewTable rows={rows} /> : null}
          <div className="flex flex-wrap gap-2">
            {missingSourceEvent > 0 ? (
              <Button
                variant="outline"
                disabled={activeAction !== null}
                onClick={() =>
                  void runAction("normalize", async () => {
                    const result = await normalizeBulkImportAction(importId);
                    return result.ok
                      ? { ok: true as const, data: result.data }
                      : { ok: false as const, message: result.message, error: result.error };
                  })
                }
              >
                {activeAction === "normalize" ? "Repairing…" : "Repair normalization"}
              </Button>
            ) : null}
            <Button
              disabled={activeAction !== null || eligibleForSimulation === 0}
              onClick={() =>
                void runAction("simulate", async () => {
                  const limit = Math.min(eligibleForSimulation, 5);
                  const result = await simulateBulkImportAction(importId, limit);
                  return result.ok
                    ? { ok: true as const, data: result.data }
                    : {
                        ok: false as const,
                        message: result.message,
                        error: result.error,
                      };
                })
              }
            >
              {activeAction === "simulate"
                ? "Simulating adapter…"
                : `Simulate ${Math.min(eligibleForSimulation, 5)} eligible row${Math.min(eligibleForSimulation, 5) === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}

      {step === "approve" && (
        <div className="grid max-w-2xl gap-4">
          <div className="rounded-lg border bg-muted/20 p-4 text-sm space-y-2">
            <p>
              <strong>Destination client:</strong> {destinationLabel}
            </p>
            <p>
              <strong>GHL location:</strong> {locationLabel}
            </p>
            <p>
              <strong>Rows to approve:</strong> {eligibleSimulatedCount}
            </p>
            <p>
              <strong>Excluded:</strong> {Number(summary.excluded ?? 0)} ·{" "}
              <strong>Blocked:</strong> {Number(summary.blockedIdentity ?? 0)}
            </p>
            <p>
              <strong>Workflow strategy:</strong>{" "}
              {String(importOptions.workflowStrategy ?? "source_tag_only")}
            </p>
            <p className="text-muted-foreground">
              No new-lead or AI workflow trigger will be added for source_tag_only.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="wave-size">
              Delivery wave size (max {BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE})
            </label>
            <Input
              id="wave-size"
              type="number"
              min={1}
              max={Math.min(eligibleSimulatedCount, BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE)}
              value={waveSize}
              onChange={(e) => setWaveSize(Number(e.target.value))}
            />
          </div>

          <p className="text-sm text-amber-700">
            Type {BULK_IMPORT_APPROVE_PHRASE} to approve delivery.
          </p>
          <Input value={approvalText} onChange={(e) => setApprovalText(e.target.value)} />
          <Button
            variant="destructive"
            disabled={
              activeAction !== null ||
              approvalText.trim() !== BULK_IMPORT_APPROVE_PHRASE ||
              eligibleSimulatedCount === 0
            }
            onClick={() =>
              void runAction("approve", async () => {
                const result = await approveBulkImportDeliveryAction(
                  importId,
                  approvalText,
                  waveSize
                );
                return result.ok
                  ? { ok: true as const, data: result.data }
                  : { ok: false as const, message: result.message };
              })
            }
          >
            {activeAction === "approve" ? "Approving…" : "Approve delivery wave"}
          </Button>
        </div>
      )}

      {step === "monitor" && (
        <div className="space-y-3">
          <p className="text-sm">Delivery is running. Status refreshes automatically.</p>
          <Button
            variant="outline"
            disabled={activeAction !== null}
            onClick={() => void refreshDetail()}
          >
            {activeAction === "refresh" ? "Refreshing status…" : "Refresh now"}
          </Button>
        </div>
      )}

      {step === "results" && (
        <div className="space-y-3">
          <p className="text-sm">Import results</p>
          {rows.length > 0 ? <BulkImportReviewTable rows={rows} /> : null}
        </div>
      )}

      <BulkImportConfirmDialog
        open={Boolean(navResetPrompt)}
        title="Reset later wizard steps?"
        description={<p className="text-sm">{navResetPrompt?.message}</p>}
        requiredPhrase={BULK_IMPORT_RESET_CONFIRMATION}
        confirmLabel="Reset later steps and continue"
        loading={navResetLoading}
        loadingLabel="Resetting…"
        error={navResetError}
        confirmationValue={resetConfirmText}
        onConfirmationChange={setResetConfirmText}
        destructive
        onCancel={() => {
          if (navResetLoading) return;
          setNavResetPrompt(null);
          setResetConfirmText("");
          setNavResetError(null);
        }}
        onConfirm={() => void confirmNavReset()}
      />
    </div>
  );
}
