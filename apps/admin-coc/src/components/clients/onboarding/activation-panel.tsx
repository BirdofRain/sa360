"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

import { actionErrorCopy, ACTIVATION_INTENT_CONFIRMATION, gateLabel, knownProfileRevision, MISSING_PROFILE_REVISION_READ, postActivationEvidence, requiredGaps, sheetPrerequisiteRequired, sheetSelectionPrerequisites } from "@/lib/clients/onboarding/view";
import type {
  OnboardingActivationIntent,
  OnboardingGhlMode,
  OnboardingSummary,
  OnboardingWorksheetPreview,
  OnboardingWorkspaceActions,
} from "@/lib/clients/onboarding/types";

import { StatusMark } from "./status-mark";

export type DispatchInfrastructure = {
  dispatchFlagEnabled: boolean;
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
} | null;

export function ActivationPanel({
  clientAccountId,
  summary,
  dispatch,
  dispatchError,
  actions,
  profileRevision,
  viewedWorksheet = null,
  ghlDeliveryEnabled = null,
}: {
  clientAccountId: string;
  summary: OnboardingSummary | null;
  dispatch: DispatchInfrastructure;
  dispatchError: string | null;
  actions: OnboardingWorkspaceActions;
  profileRevision: number | null;
  viewedWorksheet?: { spreadsheetId: string; spreadsheetTitle: string; worksheet: OnboardingWorksheetPreview } | null;
  ghlDeliveryEnabled?: boolean | null;
}) {
  const gaps = summary ? requiredGaps(summary.gates) : [];
  const evidence = summary ? postActivationEvidence(summary.gates) : [];
  const [confirmation, setConfirmation] = useState("");
  const [destination, setDestination] = useState<"google_sheets_campaign" | "ghl_location_api">("google_sheets_campaign");
  const [intent, setIntent] = useState<OnboardingActivationIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="activation-panel">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Activation</h2>
        <p className="mt-1 text-sm text-slate-600">
          Readiness is a gate list. This screen does not turn delivery on, pause it, or reactivate a destination. The client campaign switch in this panel is the loaded value, or unknown when it was not loaded.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <StatusMark
          label="Sheets campaign delivery"
          state={summary ? (summary.sheets.campaignDispatchEnabled ? "yes" : "no") : "unknown"}
          detail="Independent of GHL. Enable campaign delivery is on the Google Sheets page."
        />
        <StatusMark
          label="GHL ongoing delivery"
          state={ghlDeliveryEnabled === true ? "yes" : ghlDeliveryEnabled === false ? "no" : "unknown"}
          detail="Independent of Sheets. Enable ongoing GHL delivery is in GHL location and workflow. A GHL test does not change this switch."
        />
        <StatusMark
          label="Client campaign switch"
          state={summary ? (summary.sheets.campaignDispatchEnabled ? "yes" : "no") : "unknown"}
          detail="This workspace does not change the client switch."
        />
        <StatusMark
          label="Global infrastructure"
          state={dispatch ? (dispatch.dispatchFlagEnabled ? "yes" : "no") : "unknown"}
          detail={
            dispatchError
              ? actionErrorCopy(dispatchError)
              : dispatch
                ? "Global dispatch flag from the existing Sheets dispatch read."
                : "Global dispatch state was not loaded."
          }
        />
        <StatusMark
          label="Aged dispatch"
          state={summary ? (summary.sheets.agedDispatchEnabled ? "warn" : "no") : "unknown"}
          detail="Reported only. Onboarding does not activate aged dispatch."
        />
        <StatusMark
          label="Onboarding activation"
          state="no"
          detail="liveActivationPerformedByOnboarding is false."
        />
      </div>
      {summary?.externalZapier.preserved ? (
        <p className="text-sm text-slate-700">External Zapier stays in place. This workspace does not disable it.</p>
      ) : null}
      <div>
        <h3 className="text-sm font-medium">Readiness gates</h3>
        {summary ? (
          <ul className="mt-2 space-y-1 text-sm">
            {summary.gates.map((gate) => (
              <li key={gate.id}>
                {gateLabel(gate.id)} · required {gate.required ? "yes" : "no"} · satisfied {gate.satisfied ? "yes" : "no"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-600">Readiness gates are unavailable until the onboarding summary loads.</p>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium">Post-activation evidence</h3>
        {evidence.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">No post-activation evidence is recorded on this summary.</p>
        ) : (
          <>
            <ul className="mt-1 space-y-1 text-sm">
              {evidence.map((gate) => (
                <li key={gate.id}>
                  {gateLabel(gate.id)} · satisfied {gate.satisfied ? "yes" : "no"}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-sm text-slate-600">A missing live writer receipt does not block first activation.</p>
          </>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium">Missing prerequisites and blockers</h3>
        {gaps.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">
            {summary ? "No required gate is unsatisfied. That is not activation." : "Blockers are unknown because the summary did not load."}
          </p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
            {gaps.map((gate) => (
              <li key={gate.id}>{gateLabel(gate.id)}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <Button type="button" disabled data-testid="activate-delivery" aria-describedby="activate-delivery-reason">
          Activate delivery
        </Button>
        <p id="activate-delivery-reason" className="mt-1 text-xs text-slate-600">
          Disabled. The activate endpoint returns activation_disabled. This workspace does not call it and does not call the
          Sheets dispatch switch.
        </p>
      </div>
      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Advanced settings</summary>
        <div className="space-y-4 border-t border-slate-200 p-3">
          <DestinationForm clientAccountId={clientAccountId} summary={summary} actions={actions} profileRevision={profileRevision} />
          <form
            className="space-y-2 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              void actions.recordActivationIntent({ destination, confirmation }).then((result) => {
                setPending(false);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setIntent(result.data);
              });
            }}
          >
            <p className="font-medium">Record a non-operational readiness intent</p>
            <p className="text-xs text-slate-600">
              This writes an intent only. activatesDelivery stays false. Type the confirmation exactly.
            </p>
            <select
              className="h-8 rounded-lg border border-slate-200 px-2"
              value={destination}
              onChange={(event) => setDestination(event.target.value as "google_sheets_campaign" | "ghl_location_api")}
              aria-label="Intent destination"
            >
              <option value="google_sheets_campaign">Google Sheets campaign</option>
              <option value="ghl_location_api">GHL location</option>
            </select>
            <Input
              aria-label="Activation intent confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={pending || confirmation !== ACTIVATION_INTENT_CONFIRMATION}>
              Record intent
            </Button>
            {intent ? (
              <p>
                Intent {intent.id} is {intent.status}. activatesDelivery: no. Onboarding activation performed: no.
              </p>
            ) : null}
          </form>
          <WorksheetApproval actions={actions} viewed={viewedWorksheet} />
          {error ? <p className="text-sm text-amber-800">{actionErrorCopy(error)}</p> : null}
        </div>
      </details>
    </section>
  );
}

function WorksheetApproval({
  actions,
  viewed,
}: {
  actions: OnboardingWorkspaceActions;
  viewed: { spreadsheetId: string; spreadsheetTitle: string; worksheet: OnboardingWorksheetPreview } | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const exact = viewed?.worksheet.classification === "v3_exact_header";
  const canApprove = Boolean(exact && actions.approveTestWorksheet);
  const canProbe = Boolean(viewed && actions.probeSheetWrite);
  return (
    <div className="space-y-2 text-sm text-slate-600">
      <p className="font-medium text-slate-900">Exact-v3 worksheet</p>
      <p>
        {viewed
          ? `${viewed.spreadsheetTitle} · ${viewed.worksheet.title}. Viewing a worksheet does not approve or bind it.`
          : "View a worksheet before approving it or probing write permission. Neither action runs from a recommendation."}
      </p>
      {!canApprove ? (
        <p>Approval stays off until an exact-v3 worksheet is viewed and the approval action is available.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!canApprove || pending}
          onClick={() => {
            if (!viewed || !actions.approveTestWorksheet) return;
            setPending(true);
            void actions
              .approveTestWorksheet({ spreadsheetId: viewed.spreadsheetId, worksheetId: viewed.worksheet.worksheetId })
              .then((result) => {
                setPending(false);
                setMessage(result.ok ? `Approved worksheet ${result.data.worksheetId}. Delivery was not activated.` : result.error);
              });
          }}
        >
          Approve exact-v3 test worksheet
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canProbe || pending}
          onClick={() => {
            if (!viewed || !actions.probeSheetWrite) return;
            setPending(true);
            void actions.probeSheetWrite({ spreadsheetId: viewed.spreadsheetId, worksheetId: viewed.worksheet.worksheetId }).then((result) => {
              setPending(false);
              setMessage(
                result.ok
                  ? `Permission probe finished. Can edit: ${result.data.canEdit === null ? "unknown" : result.data.canEdit ? "yes" : "no"}. No row was written.`
                  : result.error
              );
            });
          }}
        >
          Test Sheets write permission
        </Button>
      </div>
      {message ? <p>{actionErrorCopy(message)}</p> : null}
    </div>
  );
}

function DestinationForm({
  clientAccountId,
  summary,
  actions,
  profileRevision,
}: {
  clientAccountId: string;
  summary: OnboardingSummary | null;
  actions: OnboardingWorkspaceActions;
  profileRevision: number | null;
}) {
  const [sheetsSelected, setSheetsSelected] = useState(summary?.sheets.destinationSaved ?? true);
  const [ghlMode, setGhlMode] = useState<OnboardingGhlMode>(summary?.ghl.mode ?? "location_api");
  const [notesEnabled, setNotesEnabled] = useState(summary?.ghl.notesEnabled ?? false);
  const [revision, setRevision] = useState<number | null>(knownProfileRevision(profileRevision));
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (revision == null) return;
        setPending(true);
        setConflict(false);
        void actions.saveDestination({ expectedRevision: revision, sheetsSelected, ghlMode, notesEnabled }).then((result) => {
          setPending(false);
          if (!result.ok) {
            if (result.error === "revision_conflict") setConflict(true);
            setMessage(result.error);
            return;
          }
          setRevision(result.data.revision);
          setMessage(
            `Saved revision ${result.data.revision}. Delivery switch changed: no. Campaign dispatch ${result.data.campaignDispatchEnabled ? "on" : "off"}.`
          );
        });
      }}
    >
      <p className="font-medium">Destination profile</p>
      <p className="text-xs text-slate-600">
        Saving a profile does not enable delivery.
        {revision == null
          ? ` Save is unavailable. ${MISSING_PROFILE_REVISION_READ}`
          : ` This save sends profile revision ${revision}.`}
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={sheetsSelected} onChange={(event) => setSheetsSelected(event.target.checked)} />
        Sheets selected
      </label>
      {sheetsSelected && summary ? (
        <div data-testid="sheets-selection-prerequisites">
          <p className="font-medium">Sheets prerequisites</p>
          <ul className="space-y-1">
            {sheetSelectionPrerequisites(summary.gates).map((gate) => (
              <li key={gate.id}>
                {gateLabel(gate.id)} · required {sheetPrerequisiteRequired(gate, true) ? "yes" : "no"} · satisfied{" "}
                {gate.satisfied ? "yes" : "no"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <select
        className="h-8 rounded-lg border border-slate-200 px-2"
        value={ghlMode}
        aria-label="GHL mode"
        onChange={(event) => setGhlMode(event.target.value as OnboardingGhlMode)}
      >
        <option value="unset">Unset</option>
        <option value="location_api">Location API</option>
        <option value="inbound_webhook">Inbound webhook</option>
        <option value="external_zapier">External Zapier</option>
      </select>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={notesEnabled}
          disabled={ghlMode !== "location_api"}
          onChange={(event) => setNotesEnabled(event.target.checked)}
        />
        Notes v2 for location API
      </label>
      <Button type="submit" variant="outline" disabled={pending || revision == null || conflict}>
        Save destination profile
      </Button>
      {conflict ? (
        <div data-testid="destination-revision-conflict" role="status">
          <p>The Sheets and GHL choices on this form were kept. Nothing was overwritten.</p>
          <Link href={`/clients/${encodeURIComponent(clientAccountId)}/onboarding`} className="text-sky-700 hover:underline">
            Review stored configuration
          </Link>
        </div>
      ) : null}
      {message ? <p>{actionErrorCopy(message)}</p> : null}
    </form>
  );
}
