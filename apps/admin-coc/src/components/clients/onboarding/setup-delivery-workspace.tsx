"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  approveOnboardingTestWorksheetAction,
  bindOnboardingCampaignWorksheetAction,
  browseResolvedOnboardingFolderAction,
  listOnboardingSpreadsheetsAction,
  listOnboardingTestRunsAction,
  loadOnboardingWorkflowsAction,
  previewOnboardingNoteAction,
  previewOnboardingSpreadsheetAction,
  previewOnboardingStoredLeadAction,
  probeOnboardingSheetWriteAction,
  publishOnboardingColumnMapAction,
  recordOnboardingActivationIntentAction,
  resolveOnboardingFolderAction,
  saveOnboardingDestinationAction,
  saveOnboardingSheetsDestinationAction,
  saveOnboardingSheetsTargetAction,
  saveOnboardingTestIdentityAction,
  saveOnboardingWorkflowAction,
  searchOnboardingDriveAction,
  updateOnboardingColumnMapAction,
  createOnboardingColumnMapAction,
} from "@/app/actions/client-onboarding-v2";
import { Badge } from "@/components/ui/badge";
import {
  actionErrorCopy,
  clientSwitchLine,
  knownProfileRevision,
  selectableStoredLeads,
  sourcesByKind,
  UNCERTAIN_OUTCOME_LABEL,
} from "@/lib/clients/onboarding/view";
import type {
  CompanyConnectionIdentity,
  OnboardingTestAttempt,
  OnboardingTestIdentity,
  OnboardingSummary,
  OnboardingWorksheetPreview,
  OnboardingWorkspaceActions,
  StoredTestRunView,
} from "@/lib/clients/onboarding/types";

import { ActivationPanel, type DispatchInfrastructure } from "./activation-panel";
import { FacebookCard, GhlCard, LeadCaptureCard, SheetsCard } from "./integration-cards";
import { TestConsole } from "./test-console";

export function SetupDeliveryWorkspace({
  clientAccountId,
  summary,
  summaryError,
  connection,
  connectionError,
  dispatch,
  dispatchError,
  initialRuns = [],
  initialIdentity = null,
  profileRevision = null,
  testRunListLoaded = false,
  actions,
}: {
  clientAccountId: string;
  summary: OnboardingSummary | null;
  summaryError: string | null;
  connection: CompanyConnectionIdentity | null;
  connectionError: string | null;
  dispatch: DispatchInfrastructure;
  dispatchError: string | null;
  initialRuns?: StoredTestRunView[];
  initialIdentity?: OnboardingTestIdentity | null;
  /**
   * Persisted ClientOnboardingDestinationProfile.revision when a read supplied it.
   * Null means the summary did not include it. Do not substitute setupRequest.revision or 0.
   */
  profileRevision?: number | null;
  /** True when GET .../onboarding/test-runs returned a list, including an empty one. */
  testRunListLoaded?: boolean;
  /** Tests pass mocked contracts. The page omits this and uses the server actions. */
  actions?: OnboardingWorkspaceActions;
}) {
  const bound = actions ?? liveActions(clientAccountId);
  const revision = knownProfileRevision(profileRevision ?? summary?.destinationProfile?.revision);
  const sources = summary?.sources;
  const leads = useMemo(() => selectableStoredLeads(sources ?? []), [sources]);
  const [viewed, setViewed] = useState<{
    spreadsheetId: string;
    spreadsheetTitle: string;
    worksheet: OnboardingWorksheetPreview;
  } | null>(null);
  const [attempts, setAttempts] = useState<OnboardingTestAttempt[]>(initialRuns.flatMap((run) => run.attempts));
  const clientName = summary?.client.clientDisplayName ?? clientAccountId;

  return (
    <div className="space-y-4" data-testid="setup-delivery-workspace">
      <div>
        <Link href={`/clients/${encodeURIComponent(clientAccountId)}`} className="text-xs text-sky-700 hover:underline">
          ← Client detail
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Setup & Delivery</h1>
        <p className="text-sm text-slate-700">{clientName}</p>
        <p className="font-mono text-sm text-muted-foreground">{clientAccountId}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {summary ? <Badge variant="outline">{summary.client.status}</Badge> : null}
          <Badge variant="outline">Setup request is not an activation</Badge>
          {summary?.runtime ? (
            <Badge variant="outline">
              Activation {summary.runtime.activationEnabled ? "enabled" : "disabled"}
            </Badge>
          ) : null}
        </div>
        {summary?.runtime ? (
          <p className="mt-2 max-w-3xl text-xs text-slate-600">
            Captured-test flag: {summary.runtime.capturedTestEnabled ? "on" : "off"}. GHL location test adapter:{" "}
            {summary.runtime.ghlLocationTestAdapterApproved ? "approved" : "not approved"}. GHL production host: not
            allowed. Sheets execution: {summary.runtime.companySheetsExecutionEnabled ? "on" : "off"}. Sheets dispatch:{" "}
            {summary.runtime.companySheetsDispatchEnabled ? "on" : "off"}.
          </p>
        ) : null}
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          One workspace for the sources and destinations already stored for this client. Search prefers the existing
          client. {clientSwitchLine(summary, dispatch)}
        </p>
      </div>
      {summaryError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
          {actionErrorCopy(summaryError)}
        </p>
      ) : null}
      {summary?.evidenceTruncated ? (
        <p className="text-xs text-amber-800">Evidence was truncated.</p>
      ) : null}
      {summary?.sheets.uncertainJob ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {UNCERTAIN_OUTCOME_LABEL}
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <LeadCaptureCard
          sources={sourcesByKind(sources ?? [], ["leadcapture"])}
          evidenceTruncated={summary?.evidenceTruncated === true}
          proofLoaded={summary !== null}
        />
        <FacebookCard
          sources={sourcesByKind(sources ?? [], ["meta_lead_ads", "zapier_facebook"])}
          proofLoaded={summary !== null}
        />
        <SheetsCard
          clientAccountId={clientAccountId}
          clientName={clientName}
          summary={summary}
          connection={connection}
          connectionError={connectionError}
          dispatch={dispatch}
          actions={bound}
          onViewWorksheet={(worksheet, spreadsheetTitle, spreadsheetId) =>
            setViewed({ worksheet, spreadsheetTitle, spreadsheetId })
          }
        />
        <GhlCard
          clientAccountId={clientAccountId}
          summary={summary}
          actions={bound}
          attempts={attempts}
          profileRevision={revision}
        />
      </div>
      <TestConsole
        leads={leads}
        proofLoaded={summary !== null}
        actions={bound}
        initialRuns={initialRuns}
        initialIdentity={initialIdentity}
        testRunListLoaded={testRunListLoaded}
        viewedWorksheet={viewed}
        onAttempts={setAttempts}
      />
      <ActivationPanel
        clientAccountId={clientAccountId}
        summary={summary}
        dispatch={dispatch}
        dispatchError={dispatchError}
        actions={bound}
        profileRevision={revision}
        viewedWorksheet={viewed}
      />
    </div>
  );
}

function liveActions(clientAccountId: string): OnboardingWorkspaceActions {
  return {
    searchDrive: (input) => searchOnboardingDriveAction(clientAccountId, input),
    resolveFolder: (folder) => resolveOnboardingFolderAction(clientAccountId, folder),
    listSpreadsheets: () => listOnboardingSpreadsheetsAction(clientAccountId),
    browseResolvedFolder: (folderId) => browseResolvedOnboardingFolderAction(clientAccountId, folderId),
    previewSpreadsheet: (spreadsheetId) => previewOnboardingSpreadsheetAction(clientAccountId, spreadsheetId),
    approveTestWorksheet: (input) => approveOnboardingTestWorksheetAction(clientAccountId, input),
    probeSheetWrite: (input) => probeOnboardingSheetWriteAction(clientAccountId, input),
    listTestRuns: () => listOnboardingTestRunsAction(clientAccountId),
    saveSheetsDestination: (input) => saveOnboardingSheetsDestinationAction(clientAccountId, input),
    bindCampaignWorksheet: (input) => bindOnboardingCampaignWorksheetAction(clientAccountId, input),
    saveDestination: (input) => saveOnboardingDestinationAction(clientAccountId, input),
    loadWorkflows: () => loadOnboardingWorkflowsAction(clientAccountId),
    saveWorkflow: (input) => saveOnboardingWorkflowAction(clientAccountId, input),
    previewNote: (sourceLeadEventId) => previewOnboardingNoteAction(clientAccountId, sourceLeadEventId),
    saveTestIdentity: (input) => saveOnboardingTestIdentityAction(clientAccountId, input),
    previewStoredLead: (input) => previewOnboardingStoredLeadAction(clientAccountId, input),
    recordActivationIntent: (input) => recordOnboardingActivationIntentAction(clientAccountId, input),
    saveSheetsTarget: (input) => saveOnboardingSheetsTargetAction(clientAccountId, input),
    createColumnMap: (input) => createOnboardingColumnMapAction(clientAccountId, input),
    updateColumnMap: (mapId, input) => updateOnboardingColumnMapAction(clientAccountId, mapId, input),
    publishColumnMap: (mapId, expectedRevision) => publishOnboardingColumnMapAction(clientAccountId, mapId, expectedRevision),
  };
}
