"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  actionErrorCopy,
  LIVE_DELIVERY_ADAPTERS_APPROVED,
  runNeedsManualReview,
  schemaForClassification,
  UNCERTAIN_OUTCOME_LABEL,
} from "@/lib/clients/onboarding/view";
import type { SelectableLead } from "@/lib/clients/onboarding/view";
import type {
  OnboardingNotePreview,
  OnboardingTestAttempt,
  OnboardingTestIdentity,
  OnboardingTestRun,
  OnboardingWorksheetPreview,
  OnboardingWorkspaceActions,
  StoredTestRunView,
} from "@/lib/clients/onboarding/types";

export function TestConsole({
  leads,
  proofLoaded,
  actions,
  initialRuns,
  initialIdentity,
  viewedWorksheet,
  onAttempts,
}: {
  leads: SelectableLead[];
  proofLoaded: boolean;
  actions: OnboardingWorkspaceActions;
  initialRuns: StoredTestRunView[];
  initialIdentity: OnboardingTestIdentity | null;
  viewedWorksheet: { spreadsheetTitle: string; worksheet: OnboardingWorksheetPreview } | null;
  onAttempts: (attempts: OnboardingTestAttempt[]) => void;
}) {
  const [eventId, setEventId] = useState(leads[0]?.sourceLeadEventId ?? "");
  const [sheetsOn, setSheetsOn] = useState(true);
  const [ghlOn, setGhlOn] = useState(true);
  const [run, setRun] = useState<OnboardingTestRun | null>(null);
  const [note, setNote] = useState<OnboardingNotePreview | null>(null);
  const [runs, setRuns] = useState<StoredTestRunView[]>(initialRuns);
  const [identity, setIdentity] = useState(initialIdentity);
  const [email, setEmail] = useState(initialIdentity?.email ?? "");
  const [phone, setPhone] = useState(initialIdentity?.phoneE164 ?? "");
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const uncertain =
    runs.some((item) => runNeedsManualReview(item.status)) || runNeedsManualReview(run?.status) ||
    (run?.attempts ?? []).some((attempt) => attempt.status === "uncertain") ||
    runs.some((item) => item.attempts.some((attempt) => attempt.status === "uncertain"));

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="test-console">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Test console</h2>
        <p className="mt-1 text-sm text-slate-600">
          Preview uses a stored source lead. It does not resend the provider webhook. Sheets and GHL results stay independent.
        </p>
      </div>
      {!proofLoaded ? (
        <p className="text-sm text-slate-600">Source proof was not loaded, so no stored lead can be selected.</p>
      ) : leads.length === 0 ? (
        <p className="text-sm text-slate-600">
          No stored source-generated lead is on the source proof. A linked source is not receiving leads.
        </p>
      ) : (
        <Label className="block">
          Stored lead
          <select
            className="mt-1 h-8 w-full max-w-xl rounded-lg border border-slate-200 bg-white px-2 text-sm"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            aria-label="Stored lead"
          >
            {leads.map((lead) => (
              <option key={lead.sourceLeadEventId} value={lead.sourceLeadEventId}>
                {lead.sourceLeadEventId} · {lead.sourceKind}
                {lead.captureOnly ? " · capture only" : ""} · {lead.identity}
              </option>
            ))}
          </select>
        </Label>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sheetsOn} onChange={(event) => setSheetsOn(event.target.checked)} />
          Google Sheets
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={ghlOn} onChange={(event) => setGhlOn(event.target.checked)} />
          GHL location
        </label>
      </div>
      <Button
        type="button"
        disabled={!eventId || pending !== null || (!sheetsOn && !ghlOn)}
        onClick={() => void preview()}
      >
        {pending === "preview" ? "Previewing…" : "Preview stored lead"}
      </Button>
      <div className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-lg border border-slate-200 p-3 text-sm">
          <h3 className="font-medium">Sheets</h3>
          <WorksheetSchema viewed={viewedWorksheet} run={run} />
          {run ? (
            <p className="mt-2 text-xs text-slate-600">
              External Sheets call: {run.externalCalls.sheets ? "yes" : "no"}. Source delivery satisfied: no.
            </p>
          ) : null}
          {error ? <p className="mt-2 text-amber-800">{actionErrorCopy(error)}</p> : null}
        </article>
        <article className="rounded-lg border border-slate-200 p-3 text-sm">
          <h3 className="font-medium">GHL Notes</h3>
          {note ? (
            <div className="mt-2 space-y-2">
              <p>
                {note.contractVersion ?? "note contract unknown"} · posted: no · status {note.status ?? "unknown"} · answers{" "}
                {note.keptAnswerCount ?? "unknown"}
              </p>
              <p>
                Q&A evidence {note.qaEvidence?.status ?? "not returned"}. Completeness asserted:{" "}
                {note.qaEvidence?.fullQaCompletenessAsserted ? "yes" : "no"}.
                {note.qaEvidence?.status === "discarded_duplicates"
                  ? ` Discarded duplicates: ${note.qaEvidence.discardedDuplicateCount}.`
                  : ""}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-800">
                {note.body ?? "The note body was not returned."}
              </pre>
              <p className="text-xs text-slate-500">This preview did not call GHL. HTTP acceptance, note persistence, and enrollment are not claimed.</p>
            </div>
          ) : (
            <p className="mt-2 text-slate-600">No note preview yet.</p>
          )}
          {noteError ? <p className="mt-2 text-amber-800">{actionErrorCopy(noteError)}</p> : null}
        </article>
      </div>
      <div className="rounded-lg border border-slate-200 p-3 text-sm">
        <h3 className="font-medium">Verified test identity</h3>
        {identity ? (
          <p className="mt-1">
            {identity.email || "no email"} · {identity.phoneE164 || "no phone"} · persisted: {identity.persisted ? "yes" : "no"}
          </p>
        ) : (
          <p className="mt-1 text-slate-600">No verified test identity is stored in this session.</p>
        )}
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPending("identity");
            void actions.saveTestIdentity({ email, phoneE164: phone }).then((result) => {
              setPending(null);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setIdentity(result.data);
            });
          }}
        >
          <Input aria-label="Test email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email" className="max-w-xs" />
          <Input aria-label="Test phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15555550100" className="max-w-xs" />
          <Button type="submit" variant="outline" disabled={pending !== null}>
            Save test identity
          </Button>
        </form>
      </div>
      <AttemptList title="This preview" attempts={run?.attempts ?? []} />
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Past attempts</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-600">
            The onboarding API does not list past runs. Attempts already known to this screen are shown here.
          </p>
        ) : (
          runs.map((item) => (
            <article key={item.id} className="rounded-lg border border-slate-100 p-3 text-sm">
              <p>
                {item.id} · {item.kind} · {item.status} · lead {item.sourceLeadEventId ?? "none"} · resend authorized: no
              </p>
              {item.reconcileObservation ? <p className="text-xs text-slate-600">Observation: {item.reconcileObservation}</p> : null}
              <AttemptList title="Attempts" attempts={item.attempts} />
            </article>
          ))
        )}
      </div>
      {uncertain ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950" data-testid="outcome-uncertain">
          {UNCERTAIN_OUTCOME_LABEL}
        </p>
      ) : null}
      <div>
        <Button type="button" disabled data-testid="test-delivery-again" aria-describedby="test-delivery-again-reason">
          Test Delivery Again
        </Button>
        <p id="test-delivery-again-reason" className="mt-1 text-xs text-slate-600">
          {LIVE_DELIVERY_ADAPTERS_APPROVED
            ? "Live adapters are approved."
            : "Disabled while the live Sheets and GHL adapters are not approved. Captured delivery is not called. An uncertain result is not sent again."}
        </p>
      </div>
    </section>
  );

  async function preview() {
    setPending("preview");
    setError(null);
    setNoteError(null);
    const destinations = [
      ...(sheetsOn ? (["google_sheets"] as const) : []),
      ...(ghlOn ? (["ghl_location_api"] as const) : []),
    ];
    const [replay, noteResult] = await Promise.all([
      actions.previewStoredLead({ sourceLeadEventId: eventId, destinations }),
      actions.previewNote(eventId),
    ]);
    setPending(null);
    if (!replay.ok) setError(replay.error);
    else {
      setRun(replay.data);
      onAttempts(replay.data.attempts);
      if (replay.data.testRunId) {
        setRuns((current) => [
          {
            id: replay.data.testRunId!,
            kind: replay.data.kind ?? "captured_event_replay",
            status: replay.data.status ?? "previewed",
            sourceLeadEventId: eventId,
            attempts: replay.data.attempts,
            sheet: replay.data.sheet,
            noteContract: replay.data.noteContract,
            resendAuthorized: false,
            reconcileObservation: null,
          },
          ...current,
        ]);
      }
    }
    if (!noteResult.ok) setNoteError(noteResult.error);
    else setNote(noteResult.data);
  }
}

function WorksheetSchema({
  viewed,
  run,
}: {
  viewed: { spreadsheetTitle: string; worksheet: OnboardingWorksheetPreview } | null;
  run: OnboardingTestRun | null;
}) {
  const schema = viewed ? schemaForClassification(viewed.worksheet.classification) : run?.sheet?.schemaVersion;
  return (
    <div className="mt-2 space-y-1 text-xs text-slate-700">
      <p>Selected worksheet: {viewed?.worksheet.title ?? run?.sheet?.worksheetTitle ?? "none viewed"}</p>
      <p>Spreadsheet: {viewed?.spreadsheetTitle ?? "not viewed"}</p>
      <p>Schema: {schema ?? "not in the preview payload"}</p>
      <p>Values hash: {run?.sheet?.valuesSha256 ?? "not returned"}</p>
      {run?.sheet?.values ? (
        <p>Mapped row: {run.sheet.values.join(" | ")}</p>
      ) : (
        <p>Mapped row cells are not in the captured-test preview payload. Header cells above are the worksheet preview.</p>
      )}
      {viewed ? (
        <p>
          Compatibility: {viewed.worksheet.classification}. Fast path: {viewed.worksheet.fastPath ? "yes" : "no"}. Bound by
          preview: no.
        </p>
      ) : null}
    </div>
  );
}

function AttemptList({ title, attempts }: { title: string; attempts: OnboardingTestAttempt[] }) {
  if (attempts.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-slate-600">{title}</p>
      <ul className="mt-1 space-y-1 text-xs">
        {attempts.map((attempt) => (
          <li key={`${attempt.destination}-${attempt.id}`}>
            {attempt.destination} · {attempt.status} · external call {attempt.externalCallExecuted ? "yes" : "no"} · proves{" "}
            {attempt.proves.join(", ") || "nothing"} · does not prove {attempt.doesNotProve.join(", ") || "nothing listed"} ·
            downstream executed: no
          </li>
        ))}
      </ul>
    </div>
  );
}
