"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  approveBulkImportDeliveryAction,
  fetchBulkImportDetail,
  fetchBulkImportDestinationOptions,
  fetchBulkImportLiveCanaryPreflight,
  normalizeBulkImportAction,
  resetBulkImportAction,
  saveBulkImportMappingAction,
  setBulkImportDestinationAction,
  setBulkImportWizardStepAction,
  simulateBulkImportAction,
  type BulkImportDestinationOption,
  type BulkImportLiveCanaryPreflight,
} from "@/app/actions/bulk-imports";
import { BulkImportDeliveryNotice } from "@/components/bulk-imports/bulk-import-delivery-notice";
import { BulkImportDestinationSelector, type DestinationDraft, type DestinationSaveDiagnostic } from "@/components/bulk-imports/bulk-import-destination-selector";
import { BulkImportWizardFooter } from "@/components/bulk-imports/bulk-import-wizard-footer";
import { BulkImportMappingEditor } from "@/components/bulk-imports/bulk-import-mapping-editor";
import {
  BulkImportConfirmDialog,
} from "@/components/bulk-imports/bulk-import-confirm-dialog";
import {
  BulkImportReviewTable,
  type BulkImportReviewRow,
} from "@/components/bulk-imports/bulk-import-review-table";
import {
  BulkImportMonitorPanel,
  type BulkImportDeliveryMonitor,
  type BulkImportLiveDeliverySnapshot,
} from "@/components/bulk-imports/bulk-import-monitor-panel";
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
import { BULK_IMPORT_INITIAL_CANARY_MAX_ROWS, BULK_IMPORT_RESET_CONFIRMATION } from "@sa360/shared";
import {
  clearWizardActionError,
  type WizardActionError,
  type WizardActionKey,
} from "@/lib/bulk-imports/wizard-action-errors";
import {
  applyWizardAdvancePayload,
  resolvePostActionWizardStep,
  type WizardAdvancePayload,
} from "@/lib/bulk-imports/wizard-advance";
import {
  applyMappingSaveToBatchState,
  resolveMappingSaveWizardStep,
  shouldAdvanceWizardAfterMappingSave,
} from "@/lib/bulk-imports/mapping-save-progression";
import {
  canAccessWizardStep,
  deriveProgressStep,
  requiresResetForWizardNavigation,
  resolveViewStep,
  shouldPollBatchStatus,
  type BulkImportBatchState,
  type BulkImportSummary,
} from "@/lib/bulk-imports/wizard-steps";
import { resolveWizardFooterConfig } from "@/lib/bulk-imports/wizard-footer-config";
import {
  loadingMessageForStep,
  messageForViewStep,
  successMessageForStep,
  type WizardMessage,
} from "@/lib/bulk-imports/wizard-messages";
import {
  applyValidatedBulkImportDetail,
  detailRowsToReviewRows,
  extractDeliveryMonitor,
} from "@/lib/bulk-imports/apply-bulk-import-detail";
import type { BulkImportDetailDto } from "@/lib/bulk-imports/bulk-import-detail-contract";

type WizardProps = {
  importId: string;
  requestedStep?: string;
  initial: {
    batch: Record<string, unknown>;
    summary: Record<string, unknown>;
  };
};

type BulkImportMutation =
  | "mapping"
  | "destination"
  | "normalize"
  | "simulate"
  | "approve"
  | null;

type ActionKey = Exclude<BulkImportMutation, null>;

export function BulkImportWizard({ importId, requestedStep, initial }: WizardProps) {
  const router = useRouter();
  const navRef = useRef<HTMLDivElement>(null);
  const mutationLockRef = useRef(false);
  const mappingConfirmRef = useRef<(() => void) | null>(null);
  const batchUpdatedAtRef = useRef(String(initial.batch.updatedAt ?? ""));
  const [batch, setBatch] = useState<Record<string, unknown>>(initial.batch);
  const [summary, setSummary] = useState<Record<string, unknown>>(initial.summary);
  const [rows, setRows] = useState<BulkImportReviewRow[]>(() =>
    detailRowsToReviewRows(
      Array.isArray(initial.batch.rows)
        ? (initial.batch.rows as BulkImportDetailDto["batch"]["rows"])
        : []
    )
  );
  const [destinationOptions, setDestinationOptions] = useState<BulkImportDestinationOption[]>([]);
  const [activeMutation, setActiveMutation] = useState<BulkImportMutation>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<WizardActionError | null>(null);
  const [transitionMessage, setTransitionMessage] = useState<WizardMessage | null>(null);
  const [destinationDraft, setDestinationDraft] = useState<DestinationDraft>({
    clientId: String(initial.batch.destinationClientAccountId ?? ""),
    locationId: String(initial.batch.destinationLocationIdGhl ?? ""),
  });
  const [destinationDirty, setDestinationDirty] = useState(false);
  const [destinationSaveDiagnostic, setDestinationSaveDiagnostic] =
    useState<DestinationSaveDiagnostic | null>(null);
  const [approvalText, setApprovalText] = useState("");
  const [waveSize, setWaveSize] = useState(BULK_IMPORT_INITIAL_CANARY_MAX_ROWS);
  const [liveCanaryPreflight, setLiveCanaryPreflight] =
    useState<BulkImportLiveCanaryPreflight | null>(null);
  const [deliveryMonitor, setDeliveryMonitor] = useState<BulkImportDeliveryMonitor | null>(null);
  const [navResetPrompt, setNavResetPrompt] = useState<{
    target: BulkImportWizardStep;
    resetTarget: "mapping" | "destination" | "review";
    message: string;
  } | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [navResetLoading, setNavResetLoading] = useState(false);
  const [navResetError, setNavResetError] = useState<string | null>(null);

  useEffect(() => {
    setBatch(initial.batch);
    setSummary(initial.summary);
    setRows(
      detailRowsToReviewRows(
        Array.isArray(initial.batch.rows)
          ? (initial.batch.rows as BulkImportDetailDto["batch"]["rows"])
          : []
      )
    );
  }, [initial.batch, initial.summary]);

  useEffect(() => {
    if (destinationDirty) return;
    setDestinationDraft({
      clientId: String(batch.destinationClientAccountId ?? ""),
      locationId: String(batch.destinationLocationIdGhl ?? ""),
    });
  }, [importId, batch.destinationClientAccountId, batch.destinationLocationIdGhl, destinationDirty, batch]);

  const batchState = batch as BulkImportBatchState;
  const summaryState = summary as BulkImportSummary;
  const viewStep = resolveViewStep(
    batchState,
    summaryState,
    parseRequestedWizardStep(requestedStep)
  );
  const progressStep = deriveProgressStep(batchState, summaryState);
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

  const deliveredRowSnapshots = useMemo(
    () =>
      rows
        .filter((r) => r.deliveryStatus === "delivered")
        .map((r) => {
          const extended = r as BulkImportReviewRow & {
            ghlContactId?: string | null;
            liveDelivery?: BulkImportLiveDeliverySnapshot | null;
          };
          return {
            rowNumber: extended.rowNumber,
            name: extended.name,
            ghlContactId: extended.ghlContactId ?? null,
            liveDelivery: extended.liveDelivery ?? null,
          };
        }),
    [rows]
  );

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

  const refreshDetail = useCallback(
    async (opts?: { background?: boolean; preserveLocalStateWhenOlder?: boolean }) => {
      if (!opts?.background) setIsRefreshing(true);
      try {
        const result = await fetchBulkImportDetail(importId);
        if (!result.ok) {
          if (!opts?.background) {
            setError({ action: "mapping", message: result.message });
          }
          return false;
        }
        const serverBatch = result.data.batch;
        const serverUpdatedAt = String(serverBatch.updatedAt ?? "");
        const localUpdatedAt = batchUpdatedAtRef.current;
        if (
          opts?.preserveLocalStateWhenOlder &&
          serverUpdatedAt &&
          localUpdatedAt &&
          Date.parse(serverUpdatedAt) < Date.parse(localUpdatedAt)
        ) {
          return {
            batch: batch,
            summary: summary,
            eligibleForSimulation: Number(summary.eligibleForSimulation ?? 0),
            normalizedSourceEvents: Number(summary.normalizedSourceEvents ?? 0),
          };
        }
        batchUpdatedAtRef.current = serverUpdatedAt || localUpdatedAt;
        const nextSummary = result.data.summary;
        const validated = applyValidatedBulkImportDetail(
          {
            batch: serverBatch,
            summary: nextSummary,
            deliveryMonitor: result.data.deliveryMonitor ?? null,
          },
          { action: "refresh", importId }
        );
        if (!validated.ok) {
          if (!opts?.background) {
            setError({
              action: "mapping",
              code: "invalid_detail_response",
              message: `${validated.message} Reference: ${validated.correlationId}`,
            });
          }
          return false;
        }
        setBatch(validated.data.batch);
        setSummary(validated.data.summary);
        setRows(detailRowsToReviewRows(validated.data.batch.rows));
        setDeliveryMonitor(extractDeliveryMonitor(validated.data));
        if (!destinationDirty) {
          setDestinationDraft({
            clientId: String(serverBatch.destinationClientAccountId ?? ""),
            locationId: String(serverBatch.destinationLocationIdGhl ?? ""),
          });
        }
        setError((prev) =>
          clearWizardActionError(prev, {
            eligibleForSimulation: Number(nextSummary.eligibleForSimulation ?? 0),
          })
        );
        if (!opts?.background) {
          router.refresh();
        }
        return {
          eligibleForSimulation: Number(nextSummary.eligibleForSimulation ?? 0),
          normalizedSourceEvents: Number(nextSummary.normalizedSourceEvents ?? 0),
          batch: validated.data.batch,
          summary: validated.data.summary,
        };
      } finally {
        if (!opts?.background) setIsRefreshing(false);
      }
    },
    [importId, router, batch, summary, destinationDirty]
  );

  const applyDetailDtoToState = useCallback(
    (detail: BulkImportDetailDto, payload?: WizardAdvancePayload) => {
      let nextBatch = detail.batch as Record<string, unknown>;
      if (payload?.results?.length) {
        nextBatch = applyWizardAdvancePayload(nextBatch, payload);
      }
      batchUpdatedAtRef.current = String(nextBatch.updatedAt ?? batchUpdatedAtRef.current);
      setBatch(nextBatch);
      setSummary(detail.summary);
      setRows(detailRowsToReviewRows(detail.batch.rows));
      setDeliveryMonitor(extractDeliveryMonitor(detail));
      if (!destinationDirty) {
        setDestinationDraft({
          clientId: String(nextBatch.destinationClientAccountId ?? ""),
          locationId: String(nextBatch.destinationLocationIdGhl ?? ""),
        });
      }
    },
    [destinationDirty]
  );

  const refreshAndAdvance = useCallback(
    async (payload?: WizardAdvancePayload, actionKey: ActionKey = "normalize") => {
      let nextBatch = batch;
      let nextSummary = summary;
      let nextStep = payload?.nextStep;

      if (payload?.batch && payload.summary) {
        const validated = applyValidatedBulkImportDetail(payload, {
          action: actionKey,
          importId,
        });
        if (!validated.ok) {
          setError({
            action: actionKey,
            code: "invalid_mutation_response",
            message: `${validated.message} Reference: ${validated.correlationId}`,
          });
          await refreshDetail();
          return false;
        }
        applyDetailDtoToState(validated.data, payload);
        nextBatch = validated.data.batch as Record<string, unknown>;
        nextSummary = validated.data.summary;
        nextStep = validated.data.nextStep ?? nextStep;
      } else {
        const refreshed = await refreshDetail();
        if (!refreshed) return false;
        nextBatch = refreshed.batch as Record<string, unknown>;
        nextSummary = refreshed.summary as Record<string, unknown>;
      }

      const resolvedStep = resolvePostActionWizardStep(
        nextStep,
        nextBatch as BulkImportBatchState,
        nextSummary as BulkImportSummary
      );

      router.replace(`/source-intake/imports/${importId}?step=${resolvedStep}`);
      router.refresh();
      navRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    },
    [batch, summary, importId, refreshDetail, router, applyDetailDtoToState]
  );

  useEffect(() => {
    void fetchBulkImportDestinationOptions().then((result) => {
      if (result.ok) setDestinationOptions(result.data.items);
    });
  }, []);

  useEffect(() => {
    function onBulkImportUpdated(event: Event) {
      const detail = (event as CustomEvent<BulkImportUpdatedDetail>).detail;
      if (detail.importId !== importId) return;
      void refreshDetail({ background: true, preserveLocalStateWhenOlder: true }).then(() => {
        navRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    window.addEventListener(BULK_IMPORT_UPDATED_EVENT, onBulkImportUpdated);
    return () => window.removeEventListener(BULK_IMPORT_UPDATED_EVENT, onBulkImportUpdated);
  }, [importId, refreshDetail]);

  const eligibleForSimulation = Number(summary.eligibleForSimulation ?? 0);

  useEffect(() => {
    const max = Math.min(
      eligibleSimulatedCount || Number(summary.simulatedRows ?? 0) || BULK_IMPORT_INITIAL_CANARY_MAX_ROWS,
      BULK_IMPORT_INITIAL_CANARY_MAX_ROWS
    );
    setWaveSize((prev) => (prev > max ? max : prev || max));
  }, [eligibleSimulatedCount, summary.simulatedRows]);

  useEffect(() => {
    if (viewStep !== "approve") return;
    void fetchBulkImportLiveCanaryPreflight(importId).then((result) => {
      if (result.ok) setLiveCanaryPreflight(result.data.preflight);
    });
  }, [importId, viewStep, batchState.destinationClientAccountId, batchState.destinationLocationIdGhl]);

  useEffect(() => {
    const status = String(batch.status ?? "");
    if (!shouldPollBatchStatus(status)) return;
    const timer = setInterval(() => {
      void refreshDetail({ background: true, preserveLocalStateWhenOlder: true });
    }, 5000);
    return () => clearInterval(timer);
  }, [batch.status, refreshDetail]);

  useEffect(() => {
    setError((prev) => clearWizardActionError(prev, { importChanged: true }));
    setTransitionMessage(null);
  }, [importId]);

  useEffect(() => {
    setError((prev) => clearWizardActionError(prev, { stepChanged: true }));
    setTransitionMessage((prev) => (prev?.kind === "success" ? null : prev));
  }, [viewStep]);

  const missingSourceEvent = Number(summary.missingSourceEvent ?? 0);
  const hasDownstreamArtifacts =
    Number(summary.normalizedSourceEvents ?? 0) > 0 ||
    Number(summary.simulatedRows ?? 0) > 0 ||
    (batchState.simulatedRows ?? 0) > 0;
  const mappingInitialMode =
    !mappingConfirmed || batchState.status === "mapping_required"
      ? "edit"
      : "view";

  async function runMutation<T extends WizardAdvancePayload>(
    key: ActionKey,
    action: () => Promise<{
      ok: boolean;
      message?: string;
      error?: string;
      data?: T;
    }>,
    options?: {
      clearErrorOnStart?: boolean;
      loadingMessage?: string;
      successMessage?: (data?: T) => string;
      advanceOnFailure?: boolean;
      skipAdvance?: boolean;
    }
  ) {
    if (mutationLockRef.current) {
      setError({
        action: key,
        code: "mutation_in_progress",
        message: "Another import action is still running.",
      });
      return false;
    }
    mutationLockRef.current = true;
    setActiveMutation(key);
    if (options?.clearErrorOnStart !== false) {
      setError(null);
    }
    if (options?.loadingMessage) {
      setTransitionMessage(loadingMessageForStep(viewStep, options.loadingMessage));
    }
    try {
      const result = await action();
      if (!result.ok) {
        if (options?.advanceOnFailure && result.data) {
          await refreshAndAdvance(result.data, key);
          setTransitionMessage(null);
          setError({
            action: key,
            code: result.error,
            message: result.message ?? "Action failed",
          });
          return false;
        }
        setTransitionMessage(null);
        setError({
          action: key,
          code: result.error,
          message: result.message ?? "Action failed",
        });
        return false;
      }

      setError(null);
      if (!options?.skipAdvance) {
        await refreshAndAdvance(result.data, key);
      }
      const successText = options?.successMessage?.(result.data);
      if (successText) {
        setTransitionMessage(successMessageForStep(viewStep, successText));
      }
      return true;
    } catch (err) {
      const message =
        key === "destination"
          ? `Destination could not be saved. ${err instanceof Error ? err.message : "Unexpected error."}`
          : err instanceof Error
            ? err.message
            : "Unexpected error.";
      setTransitionMessage(null);
      setError({ action: key, code: "unexpected_error", message });
      return false;
    } finally {
      mutationLockRef.current = false;
      setActiveMutation(null);
    }
  }

  async function saveDestination() {
    const payload = {
      destinationClientAccountId: destinationDraft.clientId,
      destinationLocationIdGhl: destinationDraft.locationId,
      workflowStrategy: "source_tag_only" as const,
      workflowWarningAcknowledged: true,
    };
    if (mutationLockRef.current) {
      setError({
        action: "destination",
        code: "mutation_in_progress",
        message: "Another import action is still running.",
      });
      return false;
    }
    mutationLockRef.current = true;
    setActiveMutation("destination");
    setError(null);
    setTransitionMessage(loadingMessageForStep("destination", "Saving destination…"));
    try {
      const result = await setBulkImportDestinationAction(importId, payload);
      const diagnostic: DestinationSaveDiagnostic = {
        attemptedClientAccountId: payload.destinationClientAccountId,
        attemptedLocationIdGhl: payload.destinationLocationIdGhl,
        ok: result.ok,
        error: result.ok ? undefined : result.message,
        nextStep: result.ok ? result.data.nextStep : undefined,
        batchStatus: result.ok ? String(result.data.batch?.status ?? "") : undefined,
        timestamp: new Date().toISOString(),
      };
      setDestinationSaveDiagnostic(diagnostic);
      if (!result.ok) {
        setTransitionMessage(null);
        setError({
          action: "destination",
          code: result.error,
          message: result.message,
        });
        return false;
      }
      const validated = applyValidatedBulkImportDetail(result.data, {
        action: "destination",
        importId,
      });
      if (!validated.ok) {
        setTransitionMessage(null);
        setError({
          action: "destination",
          code: "invalid_mutation_response",
          message: `${validated.message} Reference: ${validated.correlationId}`,
        });
        setDestinationSaveDiagnostic({
          ...diagnostic,
          ok: false,
          error: validated.message,
        });
        await refreshDetail();
        return false;
      }
      applyDetailDtoToState(validated.data);
      setDestinationDirty(false);
      setDestinationDraft({
        clientId: String(
          validated.data.batch.destinationClientAccountId ?? destinationDraft.clientId
        ),
        locationId: String(
          validated.data.batch.destinationLocationIdGhl ?? destinationDraft.locationId
        ),
      });
      setTransitionMessage(null);
      const nextStep = validated.data.nextStep ?? "review";
      setTransitionMessage(
        successMessageForStep("review", "Destination saved. Opening Review…")
      );
      router.replace(`/source-intake/imports/${importId}?step=${nextStep}`);
      router.refresh();
      return true;
    } catch (err) {
      setTransitionMessage(null);
      setError({
        action: "destination",
        code: "unexpected_error",
        message: `Destination could not be saved. ${err instanceof Error ? err.message : "Unexpected error."}`,
      });
      return false;
    } finally {
      mutationLockRef.current = false;
      setActiveMutation(null);
    }
  }

  async function runAction<T extends WizardAdvancePayload>(
    key: ActionKey,
    action: () => Promise<{
      ok: boolean;
      message?: string;
      error?: string;
      data?: T;
    }>,
    options?: {
      clearErrorOnStart?: boolean;
      loadingMessage?: string;
      successMessage?: (data?: T) => string;
      advanceOnFailure?: boolean;
    }
  ) {
    return runMutation(key, action, options);
  }

  function goToViewStep(target: BulkImportWizardStep) {
    if (!canAccessWizardStep(target, batchState, summaryState)) {
      setError({
        action: "mapping",
        message: `The ${target} step is not available yet.`,
      });
      return;
    }
    const resetNeeded = requiresResetForWizardNavigation(target, batchState, summaryState);
    if (resetNeeded) {
      setNavResetError(null);
      setNavResetPrompt({
        target,
        resetTarget: resetNeeded.target,
        message: resetNeeded.message,
      });
      return;
    }
    setTransitionMessage(null);
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
  const destinationSaved = Boolean(
    batch.destinationClientAccountId && batch.destinationLocationIdGhl
  );
  const selectedDestinationOption = destinationOptions.find(
    (o) =>
      o.clientAccountId === destinationDraft.clientId &&
      o.locationIdGhl === destinationDraft.locationId
  );
  const destinationDraftValid = Boolean(
    destinationDraft.clientId &&
      destinationDraft.locationId &&
      selectedDestinationOption?.readyForSimulation
  );
  const scopedMessage = messageForViewStep(transitionMessage, viewStep);
  const footerConfig = resolveWizardFooterConfig({
    viewStep,
    batch: batchState,
    summary: summaryState,
    mappingConfirmed,
    destinationDraftValid,
    destinationSaved,
    eligibleForSimulation,
    eligibleSimulatedCount,
    missingSourceEvent,
    mutationActive: activeMutation !== null,
    preflightReady: liveCanaryPreflight ? liveCanaryPreflight.ready : null,
    approvalPhraseValid: approvalText.trim() === BULK_IMPORT_APPROVE_PHRASE,
  });

  function handleFooterPrimary() {
    switch (footerConfig.primaryAction) {
      case "confirm-mapping":
        mappingConfirmRef.current?.();
        return;
      case "save-destination":
        void saveDestination();
        return;
      case "normalize":
        void runAction(
          "normalize",
          async () => {
            const result = await normalizeBulkImportAction(importId);
            return result.ok
              ? { ok: true as const, data: result.data }
              : { ok: false as const, message: result.message, error: result.error };
          },
          {
            loadingMessage:
              missingSourceEvent > 0 ? "Repairing normalization…" : "Normalizing…",
            successMessage: (data) => {
              const normalized = Number(data?.summary?.normalizedSourceEvents ?? 0);
              const eligible = Number(data?.summary?.eligibleForSimulation ?? 0);
              if (eligible > 0) {
                return `${normalized} Source Intake record${normalized === 1 ? "" : "s"} ready. Opening Simulation…`;
              }
              return `${normalized} Source Intake record${normalized === 1 ? "" : "s"} created. No GHL writes occurred.`;
            },
          }
        );
        return;
      case "simulate": {
        const limit = Math.min(eligibleForSimulation, 5);
        void runAction(
          "simulate",
          async () => {
            const result = await simulateBulkImportAction(importId, limit);
            if (result.ok) return { ok: true as const, data: result.data };
            return {
              ok: false as const,
              message: result.message,
              error: result.error,
              data: result.data as WizardAdvancePayload,
            };
          },
          {
            loadingMessage: `Simulating ${limit} row${limit === 1 ? "" : "s"}…`,
            successMessage: () => "Simulation complete. Opening Approval…",
            advanceOnFailure: true,
          }
        );
        return;
      }
      case "approve":
        void runAction(
          "approve",
          async () => {
            const result = await approveBulkImportDeliveryAction(importId, approvalText, waveSize);
            if (!result.ok) {
              return { ok: false as const, message: result.message, error: result.error };
            }
            if (!result.data.queueJobs?.length) {
              return {
                ok: false as const,
                message: "Approval did not create any delivery jobs.",
                error: "queue_enqueue_failed",
              };
            }
            return { ok: true as const, data: result.data };
          },
          {
            loadingMessage: "Approving delivery…",
            successMessage: () => "Delivery approved. Opening Monitor…",
          }
        );
        return;
      case "navigate":
        if (footerConfig.primaryTargetStep) {
          goToViewStep(footerConfig.primaryTargetStep);
        }
        return;
      default:
        return;
    }
  }

  function handleFooterPrevious() {
    if (footerConfig.previousViewStep) {
      goToViewStep(footerConfig.previousViewStep);
    }
  }

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
          const isCurrent = viewStep === s;
          return (
            <button
              key={s}
              type="button"
              disabled={!allowed}
              onClick={() => goToViewStep(s)}
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
      {scopedMessage ? (
        <p
          className={
            scopedMessage.kind === "loading"
              ? "text-sm text-muted-foreground"
              : scopedMessage.kind === "warning"
                ? "text-sm text-amber-800"
                : "text-sm text-green-700"
          }
        >
          {scopedMessage.text}
        </p>
      ) : null}
      {isRefreshing ? (
        <p className="text-xs text-muted-foreground">Refreshing import status…</p>
      ) : null}

      {viewStep === "map" ? (
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
          loading={activeMutation === "mapping"}
          returnStep={progressStep !== "map" ? progressStep : undefined}
          confirmActionRef={mappingConfirmRef}
          onReturnToStep={() => {
            goToViewStep(progressStep === "map" ? "destination" : progressStep);
          }}
          onSave={async (nextMapping, options) => {
            if (mutationLockRef.current) {
              return {
                ok: false as const,
                message: "Another import action is still running.",
              };
            }
            mutationLockRef.current = true;
            setActiveMutation("mapping");
            setError(null);
            try {
              const result = await saveBulkImportMappingAction(
                importId,
                nextMapping,
                undefined,
                options
              );
              if (!result.ok) {
                if (result.error === "mapping_change_requires_reset" && result.impact) {
                  return {
                    ok: false as const,
                    message: result.message,
                    resetRequired: true,
                    impact: result.impact as import("@/lib/bulk-imports/mapping-editor").MappingChangeImpactPreview,
                  };
                }
                setError({ action: "mapping", message: result.message });
                return { ok: false as const, message: result.message };
              }

              const validated = applyValidatedBulkImportDetail(result.data, {
                action: "mapping",
                importId,
                requireRows: false,
              });
              if (!validated.ok) {
                setError({
                  action: "mapping",
                  code: "invalid_mutation_response",
                  message: `${validated.message} Reference: ${validated.correlationId}`,
                });
                await refreshDetail();
                return { ok: false as const, message: validated.message };
              }

              const applied = applyMappingSaveToBatchState(
                validated.data.batch as Record<string, unknown>
              );
              batchUpdatedAtRef.current = String(
                validated.data.batch.updatedAt ?? batchUpdatedAtRef.current
              );
              applyDetailDtoToState({
                ...validated.data,
                batch: {
                  ...validated.data.batch,
                  ...applied.batch,
                },
              });
              setSummary((prev) => ({
                ...validated.data.summary,
                mappingConfirmed: applied.mappingConfirmed,
              }));

              const nextStep = resolveMappingSaveWizardStep(validated.data.nextStep);
              if (result.data.resetPerformed) {
                setTransitionMessage(
                  successMessageForStep(
                    "map",
                    "Mapping saved. Normalize the rows again to apply the new mapping."
                  )
                );
              } else if (result.data.confirmationChanged) {
                setTransitionMessage(successMessageForStep("map", "Mapping confirmed."));
              }

              if (shouldAdvanceWizardAfterMappingSave(nextStep)) {
                router.replace(`/source-intake/imports/${importId}?step=${nextStep}`);
              }
              void refreshDetail({ background: true, preserveLocalStateWhenOlder: true });

              return {
                ok: true as const,
                mappingChanged: Boolean(result.data.mappingChanged),
                mappingConfirmed: Boolean(result.data.mappingConfirmed),
                confirmationChanged: Boolean(result.data.confirmationChanged),
                resetPerformed: Boolean(result.data.resetPerformed),
                nextStep,
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : "Mapping could not be saved.";
              setError({ action: "mapping", message });
              return { ok: false as const, message };
            } finally {
              mutationLockRef.current = false;
              setActiveMutation(null);
            }
          }}
        />
        ) : (
          <p className="text-sm text-destructive">
            Mapping metadata is missing and could not be reconstructed.
          </p>
        )
      ) : null}

      {viewStep === "destination" && (
        <BulkImportDestinationSelector
          options={destinationOptions}
          draft={destinationDraft}
          isDirty={destinationDirty}
          onDraftChange={(nextDraft, dirty) => {
            setDestinationDraft(nextDraft);
            setDestinationDirty(dirty);
          }}
          lastSaveDiagnostic={destinationSaveDiagnostic}
        />
      )}

      {viewStep === "review" && (
        <div className="space-y-4">
          <p className="text-sm">
            Normalize rows into Source Intake events (no GHL writes). Review classifications before
            simulation.
          </p>
          {rows.length > 0 ? <BulkImportReviewTable rows={rows} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={activeMutation !== null}
              onClick={() => {
                const rowCount = Math.max(
                  missingSourceEvent,
                  Number(summary.totalRows ?? rows.length) - Number(summary.excluded ?? 0)
                );
                void runAction(
                  "normalize",
                  async () => {
                    const result = await normalizeBulkImportAction(importId);
                    return result.ok
                      ? { ok: true as const, data: result.data }
                      : { ok: false as const, message: result.message, error: result.error };
                  },
                  {
                    loadingMessage:
                      rowCount > 0 ? `Normalizing ${rowCount} row${rowCount === 1 ? "" : "s"}…` : "Normalizing…",
                    successMessage: (data) => {
                      const eligible = Number(data?.summary?.eligibleForSimulation ?? 0);
                      const normalized = Number(data?.summary?.normalizedSourceEvents ?? 0);
                      if (eligible > 0) {
                        return `${normalized} Source Intake record${normalized === 1 ? "" : "s"} ready. Opening Simulation…`;
                      }
                      return `${normalized} Source Intake record${normalized === 1 ? "" : "s"} created. No GHL writes occurred.`;
                    },
                  }
                );
              }}
            >
              {activeMutation === "normalize"
                ? missingSourceEvent > 0
                  ? "Repairing normalization…"
                  : "Normalizing…"
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

      {viewStep === "simulate" && (
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
                type="button"
                variant="outline"
                disabled={activeMutation !== null}
                onClick={() =>
                  void runAction("normalize", async () => {
                    const result = await normalizeBulkImportAction(importId);
                    return result.ok
                      ? { ok: true as const, data: result.data }
                      : { ok: false as const, message: result.message, error: result.error };
                  })
                }
              >
                {activeMutation === "normalize" ? "Repairing…" : "Repair normalization"}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={activeMutation !== null || eligibleForSimulation === 0}
              onClick={() => {
                const limit = Math.min(eligibleForSimulation, 5);
                void runAction(
                  "simulate",
                  async () => {
                    const result = await simulateBulkImportAction(importId, limit);
                    if (result.ok) {
                      return { ok: true as const, data: result.data };
                    }
                    return {
                      ok: false as const,
                      message: result.message,
                      error: result.error,
                      data: result.data as WizardAdvancePayload,
                    };
                  },
                  {
                    loadingMessage: `Simulating ${limit} row${limit === 1 ? "" : "s"}…`,
                    successMessage: () => "Simulation complete. Opening Approval…",
                    advanceOnFailure: true,
                  }
                );
              }}
            >
              {activeMutation === "simulate"
                ? `Simulating ${Math.min(eligibleForSimulation, 5)} row${Math.min(eligibleForSimulation, 5) === 1 ? "" : "s"}…`
                : `Simulate ${Math.min(eligibleForSimulation, 5)} eligible row${Math.min(eligibleForSimulation, 5) === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}

      {viewStep === "approve" && (
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
              Delivery wave size (initial live canary max {BULK_IMPORT_INITIAL_CANARY_MAX_ROWS})
            </label>
            <Input
              id="wave-size"
              type="number"
              min={1}
              max={Math.min(eligibleSimulatedCount, BULK_IMPORT_INITIAL_CANARY_MAX_ROWS)}
              value={waveSize}
              onChange={(e) => setWaveSize(Number(e.target.value))}
            />
          </div>

          {liveCanaryPreflight ? (
            <div className="rounded-lg border p-4 text-sm space-y-2">
              <p className="font-medium">Live canary preflight</p>
              <p>
                <strong>Ready:</strong> {liveCanaryPreflight.ready ? "Yes" : "No"}
              </p>
              <p>
                <strong>Runtime mode:</strong> {liveCanaryPreflight.effectiveRuntimeMode}
              </p>
              <p>
                <strong>Worker configured:</strong>{" "}
                {liveCanaryPreflight.workerConfigured ? "Yes" : "No"}
              </p>
              {Array.isArray(liveCanaryPreflight.blockers) &&
              liveCanaryPreflight.blockers.length > 0 ? (
                <ul className="list-disc pl-5 text-destructive">
                  {liveCanaryPreflight.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-green-700">All live canary preflight checks passed.</p>
              )}
            </div>
          ) : null}

          <p className="text-sm text-amber-700">
            Type {BULK_IMPORT_APPROVE_PHRASE} to approve delivery.
          </p>
          <Input value={approvalText} onChange={(e) => setApprovalText(e.target.value)} />
          <Button
            type="button"
            variant="destructive"
            disabled={
              activeMutation !== null ||
              approvalText.trim() !== BULK_IMPORT_APPROVE_PHRASE ||
              eligibleSimulatedCount === 0 ||
              (liveCanaryPreflight !== null && !liveCanaryPreflight.ready)
            }
            onClick={() =>
              void runAction(
                "approve",
                async () => {
                  const result = await approveBulkImportDeliveryAction(
                    importId,
                    approvalText,
                    waveSize
                  );
                  if (!result.ok) {
                    return { ok: false as const, message: result.message, error: result.error };
                  }
                  if (!result.data.queueJobs?.length) {
                    return {
                      ok: false as const,
                      message: "Approval did not create any delivery jobs.",
                      error: "queue_enqueue_failed",
                    };
                  }
                  return { ok: true as const, data: result.data };
                },
                {
                  loadingMessage: "Approving delivery…",
                  successMessage: () => "Delivery approved. Opening Monitor…",
                }
              )
            }
          >
            {activeMutation === "approve" ? "Approving…" : "Approve delivery wave"}
          </Button>
        </div>
      )}

      {viewStep === "monitor" && (
        <div className="space-y-3">
          <p className="text-sm">Delivery status refreshes automatically while jobs are active.</p>
          <BulkImportMonitorPanel monitor={deliveryMonitor} deliveredRows={deliveredRowSnapshots} />
          <Button
            type="button"
            variant="outline"
            disabled={isRefreshing}
            onClick={() => void refreshDetail()}
          >
            {isRefreshing ? "Refreshing status…" : "Refresh now"}
          </Button>
        </div>
      )}

      {viewStep === "results" && (
        <div className="space-y-3">
          <p className="text-sm">Import results</p>
          <BulkImportMonitorPanel monitor={deliveryMonitor} deliveredRows={deliveredRowSnapshots} />
          {rows.length > 0 ? <BulkImportReviewTable rows={rows} /> : null}
        </div>
      )}

      <BulkImportWizardFooter
        config={footerConfig}
        viewStep={viewStep}
        loading={activeMutation !== null}
        onPrevious={footerConfig.previousViewStep ? handleFooterPrevious : undefined}
        onPrimary={handleFooterPrimary}
        statusText={
          activeMutation === "destination"
            ? "Saving destination…"
            : scopedMessage?.kind === "loading"
              ? scopedMessage.text
              : null
        }
      />

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
