"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionErrorCopy, ACTIVATION_INTENT_CONFIRMATION, gateLabel, requiredGaps } from "@/lib/clients/onboarding/view";
import type {
  OnboardingActivationIntent,
  OnboardingGhlMode,
  OnboardingSummary,
  OnboardingWorkspaceActions,
} from "@/lib/clients/onboarding/types";

import { StatusMark } from "./status-mark";

export type DispatchInfrastructure = {
  dispatchFlagEnabled: boolean;
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
} | null;

export function ActivationPanel({
  summary,
  dispatch,
  dispatchError,
  actions,
}: {
  summary: OnboardingSummary | null;
  dispatch: DispatchInfrastructure;
  dispatchError: string | null;
  actions: OnboardingWorkspaceActions;
}) {
  const gaps = summary ? requiredGaps(summary.gates) : [];
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
          Readiness is a gate list. Delivery stays off until a later reviewed activation. This screen does not turn it on.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
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
          <DestinationForm summary={summary} actions={actions} />
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
          <div className="space-y-2 text-sm text-slate-600">
            <p className="font-medium text-slate-900">Unavailable on this screen</p>
            <p>Exact-v3 worksheet approval is disabled. The mounted header reader returns no header, so approval cannot succeed.</p>
            <p>Sheets permission probe is disabled. writeReadiness stays not verified until a reviewed probe exists.</p>
            <Button type="button" disabled>
              Approve exact-v3 test worksheet
            </Button>
            <Button type="button" disabled>
              Test Sheets write permission
            </Button>
          </div>
          {error ? <p className="text-sm text-amber-800">{actionErrorCopy(error)}</p> : null}
        </div>
      </details>
    </section>
  );
}

function DestinationForm({
  summary,
  actions,
}: {
  summary: OnboardingSummary | null;
  actions: OnboardingWorkspaceActions;
}) {
  const [sheetsSelected, setSheetsSelected] = useState(summary?.sheets.destinationSaved ?? true);
  const [ghlMode, setGhlMode] = useState<OnboardingGhlMode>(summary?.ghl.mode ?? "location_api");
  const [notesEnabled, setNotesEnabled] = useState(summary?.ghl.notesEnabled ?? false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        void actions.saveDestination({ expectedRevision: revision, sheetsSelected, ghlMode, notesEnabled }).then((result) => {
          setPending(false);
          if (!result.ok) {
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
        Saving a profile does not enable delivery. The first save uses revision 0 because the summary does not return the
        profile revision.
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={sheetsSelected} onChange={(event) => setSheetsSelected(event.target.checked)} />
        Sheets selected
      </label>
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
      <Button type="submit" variant="outline" disabled={pending}>
        Save destination profile
      </Button>
      {message ? <p>{actionErrorCopy(message)}</p> : null}
    </form>
  );
}
