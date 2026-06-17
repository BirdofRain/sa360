"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveBulkImportDeliveryAction,
  fetchBulkImportDetail,
  fetchBulkImportDestinationOptions,
  normalizeBulkImportAction,
  saveBulkImportMappingAction,
  setBulkImportDestinationAction,
  simulateBulkImportAction,
  type BulkImportDestinationOption,
} from "@/app/actions/bulk-imports";
import { BulkImportDestinationSelector } from "@/components/bulk-imports/bulk-import-destination-selector";
import {
  BulkImportReviewTable,
  type BulkImportReviewRow,
} from "@/components/bulk-imports/bulk-import-review-table";
import { BulkImportSummaryCards } from "@/components/bulk-imports/bulk-import-summary-cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BULK_IMPORT_APPROVE_PHRASE,
  BULK_IMPORT_WIZARD_STEPS,
  type BulkImportWizardStep,
} from "@/lib/bulk-imports/types";
import {
  canAccessWizardStep,
  deriveWizardStep,
  shouldPollBatchStatus,
  type BulkImportBatchState,
  type BulkImportSummary,
} from "@/lib/bulk-imports/wizard-steps";
import { BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE } from "@sa360/shared";

type WizardProps = {
  importId: string;
  initial: {
    batch: Record<string, unknown>;
    summary: Record<string, unknown>;
  };
};

type ActionKey =
  | "mapping"
  | "destination"
  | "normalize"
  | "simulate"
  | "approve"
  | "refresh"
  | null;

export function BulkImportWizard({ importId, initial }: WizardProps) {
  const router = useRouter();
  const [batch, setBatch] = useState<Record<string, unknown>>(initial.batch);
  const [summary, setSummary] = useState<Record<string, unknown>>(initial.summary);
  const [rows, setRows] = useState<BulkImportReviewRow[]>(
    (initial.batch.rows as BulkImportReviewRow[] | undefined) ?? []
  );
  const [destinationOptions, setDestinationOptions] = useState<BulkImportDestinationOption[]>(
    []
  );
  const [activeAction, setActiveAction] = useState<ActionKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [approvalText, setApprovalText] = useState("");
  const [waveSize, setWaveSize] = useState(5);

  const batchState = batch as BulkImportBatchState;
  const summaryState = summary as BulkImportSummary;
  const step = deriveWizardStep(batchState, summaryState);
  const mappingJson = (batch.mappingJson as Record<string, string> | undefined) ?? {};
  const importOptions = (batch.importOptionsJson as Record<string, unknown> | undefined) ?? {};
  const wizardMeta = (batch.wizardStepJson as Record<string, unknown> | undefined) ?? {};

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
      setError(result.message);
      return false;
    }
    setBatch(result.data.batch);
    setSummary(result.data.summary);
    setRows((result.data.batch.rows as BulkImportReviewRow[] | undefined) ?? []);
    router.refresh();
    return true;
  }, [importId, router]);

  useEffect(() => {
    void fetchBulkImportDestinationOptions().then((result) => {
      if (result.ok) setDestinationOptions(result.data.items);
    });
  }, []);

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

  async function runAction<T>(
    key: ActionKey,
    action: () => Promise<{ ok: boolean; message?: string; data?: T }>
  ) {
    setError(null);
    setMessage(null);
    setActiveAction(key);
    const result = await action();
    setActiveAction(null);
    if (!result.ok) {
      setError(result.message ?? "Action failed");
      return false;
    }
    await refreshDetail();
    setMessage("Saved.");
    return true;
  }

  function goToStep(target: BulkImportWizardStep) {
    if (!canAccessWizardStep(target, batchState, summaryState)) return;
    setBatch((prev) => ({
      ...prev,
      wizardStepJson: { ...(prev.wizardStepJson as object), step: target },
    }));
  }

  const destinationLabel =
    String(wizardMeta.destinationClientDisplayName ?? batch.destinationClientAccountId ?? "—");
  const locationLabel = String(
    wizardMeta.destinationLocationName ?? batch.destinationLocationIdGhl ?? "—"
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-xs">
        {BULK_IMPORT_WIZARD_STEPS.filter((s) => s !== "upload").map((s) => {
          const allowed = canAccessWizardStep(s, batchState, summaryState);
          const isCurrent = step === s;
          return (
            <button
              key={s}
              type="button"
              disabled={!allowed}
              onClick={() => goToStep(s)}
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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}

      {step === "map" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Confirm auto-suggested column mapping.</p>
          <pre className="max-h-60 overflow-auto rounded border p-2 text-xs">
            {JSON.stringify(mappingJson, null, 2)}
          </pre>
          <Button
            disabled={activeAction !== null}
            onClick={() =>
              void runAction("mapping", async () => {
                const result = await saveBulkImportMappingAction(importId, mappingJson);
                return result.ok
                  ? { ok: true as const, data: result.data }
                  : { ok: false as const, message: result.message };
              })
            }
          >
            {activeAction === "mapping" ? "Saving mapping…" : "Save mapping"}
          </Button>
        </div>
      )}

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
            {activeAction === "normalize" ? "Normalizing…" : "Normalize & review"}
          </Button>
          {(summary.eligibleForSimulation as number | undefined) === 0 ? (
            <p className="text-sm text-amber-800">
              No eligible rows for simulation. Resolve blockers above before continuing.
            </p>
          ) : null}
        </div>
      )}

      {step === "simulate" && (
        <div className="space-y-4">
          <p className="text-sm">
            Run adapter simulation on eligible rows (no external GHL writes). Eligible:{" "}
            {Number(summary.eligibleForSimulation ?? 0)}
          </p>
          {rows.length > 0 ? <BulkImportReviewTable rows={rows} /> : null}
          <Button
            disabled={
              activeAction !== null || Number(summary.eligibleForSimulation ?? 0) === 0
            }
            onClick={() =>
              void runAction("simulate", async () => {
                const result = await simulateBulkImportAction(importId, 5);
                return result.ok
                  ? { ok: true as const, data: result.data }
                  : { ok: false as const, message: result.message };
              })
            }
          >
            {activeAction === "simulate" ? "Simulating…" : "Simulate first 5 rows"}
          </Button>
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
    </div>
  );
}
