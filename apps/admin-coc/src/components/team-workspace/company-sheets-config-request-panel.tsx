"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadTeamWorkspaceCompanySheetsConfigurationAction,
  saveTeamWorkspaceCompanySheetsConfigurationRequestAction,
  type CompanySheetsConfigLoadResult,
  type CompanySheetsConfigSaveResult,
} from "@/app/actions/team-workspace-company-sheets-config";
import { Button } from "@/components/ui/button";
import {
  buildCompanySheetsConfigSubmitBody,
  controlBasisLabel,
  formatCompanySheetsConfigTimestamp,
  presentCompanySheetsConfigProgress,
  reviewCompanySheetsConfig,
  type CompanySheetsConfigContext,
  type CompanySheetsConfigHead,
  type CompanySheetsConfigSubmitBody,
  type CompanySheetsStoredRequest,
} from "@/lib/team-workspace/company-sheets-config-request";

const STEP_CLASS = {
  complete: "border-sky-200 bg-sky-50 text-sky-950",
  current: "border-amber-200 bg-amber-50 text-amber-950",
  waiting: "border-slate-200 bg-white text-slate-600",
} as const;

type Hold = { kind: "submit"; body: CompanySheetsConfigSubmitBody } | { kind: "reload" };

type Confirmation = {
  submittedRequestId: string;
  replayed: boolean;
  matchedCurrent: boolean;
  currentRequestId: string | null;
  currentRevision: number | null;
  spreadsheetId: string;
  worksheetId: number;
  spreadsheetTitle: string;
  worksheetTitle: string;
  controlBasis: string;
  destinationRevision: number | null;
  requestChainRevision: number;
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
};

export function CompanySheetsConfigRequestPanel({
  clientAccountId,
  context,
  onReviewStoredSpreadsheet,
}: {
  clientAccountId: string;
  context: CompanySheetsConfigContext;
  onReviewStoredSpreadsheet: (spreadsheetId: string) => void;
}) {
  const [head, setHead] = useState<CompanySheetsConfigHead | null>(null);
  const [pending, setPending] = useState<string | null>("Loading the configuration request…");
  const [message, setMessage] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [hold, setHold] = useState<Hold | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const inflight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setHead(null);
    setHold(null);
    setDisabled(false);
    setReplaceConfirmed(false);
    setConfirmation(null);
    setMessage(null);
    setPending("Loading the configuration request…");
    void loadTeamWorkspaceCompanySheetsConfigurationAction(clientAccountId)
      .then((result) => {
        if (cancelled) return;
        applyLoaded(result);
      })
      .catch(() => {
        if (cancelled) return;
        setMessage("You do not have permission to read this configuration request. Portal and observer access are not accepted.");
        setDisabled(true);
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientAccountId]);

  useEffect(() => {
    setReplaceConfirmed(false);
  }, [context.spreadsheetId, context.worksheetId]);

  function applyLoaded(result: CompanySheetsConfigLoadResult) {
    if (!result.ok || !result.head) {
      setHead(null);
      setDisabled(result.code === "FEATURE_DISABLED");
      setMessage(result.message);
      return;
    }
    setDisabled(false);
    setHead(result.head);
  }

  const review = useMemo(() => reviewCompanySheetsConfig({ context, head }), [context, head]);
  const steps = presentCompanySheetsConfigProgress(head);
  const stored = head?.configuration ?? null;
  const locked = Boolean(pending || hold);
  const canSave = Boolean(head) && !disabled && !locked && review.canSubmit && (!stored || replaceConfirmed);

  async function reload(
    mode: "manual" | "reconcile" | "after-save" | "after-replay",
    expectedRequestId?: string,
    saved?: CompanySheetsConfigSaveResult
  ) {
    if (inflight.current) return;
    const pendingBody = hold?.kind === "submit" ? hold.body : null;
    inflight.current = true;
    setPending("Reloading the stored configuration request…");
    try {
      const result = await loadTeamWorkspaceCompanySheetsConfigurationAction(clientAccountId);
      if (!result.ok || !result.head) {
        if ((mode === "after-save" || mode === "after-replay") && expectedRequestId) {
          setHold({ kind: "reload" });
          setMessage(
            `The save response was received for request ${expectedRequestId}, and the follow-up read did not finish. Reload before starting another request.`
          );
          return;
        }
        if (mode === "reconcile" && pendingBody) {
          setMessage(unconfirmedReadMessage(result.message, pendingBody.requestId));
          return;
        }
        setHold({ kind: "reload" });
        setMessage(result.message ?? "The configuration request could not be read. Retry the read before another request.");
        return;
      }
      setHead(result.head);
      setDisabled(false);
      const current = result.head.configuration;
      const matched = Boolean(expectedRequestId && current?.requestId === expectedRequestId);
      if (mode === "after-save" || mode === "after-replay") {
        setHold(null);
        setReplaceConfirmed(false);
        if (saved?.storedRequest && expectedRequestId) {
          setConfirmation(confirmationFrom(saved, result.head, matched));
        }
        setMessage(mode === "after-replay" ? replayReloadMessage(expectedRequestId, current, matched) : saveReloadMessage(expectedRequestId, current, matched));
        return;
      }
      if (mode === "reconcile" && pendingBody) {
        if (matched && current) {
          setHold(null);
          setReplaceConfirmed(false);
          setConfirmation({
            submittedRequestId: pendingBody.requestId,
            replayed: false,
            matchedCurrent: true,
            currentRequestId: current.requestId,
            currentRevision: current.revision,
            spreadsheetId: current.spreadsheetId,
            worksheetId: current.worksheetId,
            spreadsheetTitle: current.spreadsheetTitle,
            worksheetTitle: current.worksheetTitle,
            controlBasis: current.controlBasis,
            destinationRevision: result.head.operationalDestination.destinationRevision,
            requestChainRevision: result.head.revision,
            campaignDispatchEnabled: result.head.operationalDestination.campaignDispatchEnabled,
            agedDispatchEnabled: result.head.operationalDestination.agedDispatchEnabled,
          });
          setMessage("The earlier request is stored. The operational destination was not changed.");
          return;
        }
        setMessage(unconfirmedCurrentMessage(pendingBody.requestId, current));
        return;
      }
      setHold(null);
      setConfirmation(null);
      setMessage("The stored configuration request was reloaded.");
    } catch {
      if (mode === "reconcile" && pendingBody) {
        setMessage(unconfirmedReadMessage(null, pendingBody.requestId));
        return;
      }
      setHold({ kind: "reload" });
      setMessage("The configuration request could not be read. Retry the read before another request.");
    } finally {
      inflight.current = false;
      setPending(null);
    }
  }

  async function send(body: CompanySheetsConfigSubmitBody) {
    if (inflight.current) return;
    inflight.current = true;
    setPending("Saving the configuration request…");
    try {
      const result = await saveTeamWorkspaceCompanySheetsConfigurationRequestAction({ clientAccountId, ...body });
      await finishSave(result, body);
    } catch {
      setHold({ kind: "submit", body });
      setMessage(
        "The configuration request did not finish. Retry uses the same request id and the same payload. Nothing on this page was marked stored."
      );
    } finally {
      inflight.current = false;
      setPending(null);
    }
  }

  async function finishSave(result: CompanySheetsConfigSaveResult, body: CompanySheetsConfigSubmitBody) {
    const sent = result.sent ?? body;
    if (result.uncertain || result.retainRequestId) {
      setHold({ kind: "submit", body: sent });
      setMessage(result.message);
      return;
    }
    if (result.needsReload) {
      setHold({ kind: "reload" });
      setMessage(result.message);
      return;
    }
    if (!result.stored) {
      setHold(null);
      setMessage(result.message);
      return;
    }
    setMessage(result.message);
    inflight.current = false;
    await reload(result.replayed ? "after-replay" : "after-save", result.requestId ?? sent.requestId, result);
  }

  function submit() {
    if (hold?.kind === "submit") {
      setMessage("An earlier request is still unconfirmed. Retry that request before starting another.");
      return;
    }
    if (hold?.kind === "reload") {
      setMessage("Reload the stored configuration request before starting another.");
      return;
    }
    if (stored && !replaceConfirmed) {
      setMessage("A configuration request is already stored. Confirm replacement before submitting another.");
      return;
    }
    if (!head || !review.canSubmit || !context.spreadsheetId || context.worksheetId == null) {
      setMessage(review.blockers[0] ?? "The configuration request is incomplete. Nothing was stored.");
      return;
    }
    const requestId = globalThis.crypto?.randomUUID?.();
    if (!requestId) {
      setMessage("A request id could not be created. Reload and try again. Nothing was submitted.");
      return;
    }
    const body = buildCompanySheetsConfigSubmitBody({
      requestId,
      head,
      spreadsheetId: context.spreadsheetId,
      worksheetId: context.worksheetId,
    });
    if (!body) {
      setMessage("The configuration request is incomplete. Nothing was submitted.");
      return;
    }
    void send(body);
  }

  return (
    <section className="grid gap-4 rounded-md border border-slate-200 p-4" aria-label="Company Sheets configuration request" aria-busy={Boolean(pending)}>
      <div className="grid gap-1">
        <h3 className="text-sm font-medium text-slate-950">Configuration request</h3>
        <p className="text-sm text-slate-600">
          Choose a company-controlled spreadsheet and a grid worksheet, then save an intended request. Saving does not
          change the operational destination, bind a tab, publish a column map, or turn delivery on.
        </p>
      </div>
      {pending ? (
        <p className="text-sm text-slate-600" role="status">
          {pending}
        </p>
      ) : null}
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Configuration request progress">
        {steps.map((step) => (
          <li key={step.id} data-config-step={step.id} data-state={step.state} className={`rounded-md border px-3 py-2 ${STEP_CLASS[step.state]}`}>
            <div className="text-sm font-medium">{step.label}</div>
            <p className="mt-1 text-sm">{step.detail}</p>
          </li>
        ))}
      </ol>
      <div className="grid gap-3 sm:grid-cols-2">
        <StateCard
          kind="operational-destination"
          title="Saved operational destination"
          body={review.operationalDetail}
          extra={
            head
              ? `Revision ${head.operationalDestination.destinationRevision ?? "none"}. Campaign dispatch ${onOff(head.operationalDestination.campaignDispatchEnabled)}. Aged dispatch ${onOff(head.operationalDestination.agedDispatchEnabled)}.`
              : "Not loaded."
          }
        />
        <StateCard
          kind="stored-request"
          title="Stored configuration request"
          body={
            stored
              ? `${stored.spreadsheetTitle}, worksheet ${stored.worksheetId} (${stored.worksheetTitle}). Request ${stored.requestId}.`
              : head
                ? "No configuration request is stored. A missing request is not an operational destination."
                : "Not loaded."
          }
          extra={stored ? `Request revision ${stored.revision}. Chain revision ${head?.revision ?? "not loaded"}. ${controlBasisLabel(stored.controlBasis)}.` : `Chain revision ${head ? String(head.revision) : "not loaded"}.`}
        />
        <StateCard
          kind="unsaved-selection"
          title="Unsaved selection"
          body={`${review.spreadsheetDetail} ${review.worksheetDetail}`}
          extra="This selection is not stored until the request succeeds."
        />
        <StateCard
          kind="session-verification"
          title="Verification from this session"
          body={review.controlDetail}
          extra={review.sessionVerified ? "Verified for this selection only." : "Not verified for this selection."}
        />
      </div>
      <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <Fact term="Operational destination revision" value={revisionText(head)} />
        <Fact term="Request-chain revision" value={head ? String(head.revision) : "Not loaded"} />
      </dl>
      {review.activeDeliveryWarning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
          {review.activeDeliveryWarning}
        </p>
      ) : null}
      {hold?.kind === "submit" ? (
        <p className="text-sm text-amber-800" role="status" data-unconfirmed-request={hold.body.requestId}>
          Unconfirmed request {hold.body.requestId} is still pending. Retry sends that request id and its original payload. A different current stored request does not resolve it.
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-amber-800" role="status">
          {message}
        </p>
      ) : null}
      {confirmation ? <ConfirmationCard confirmation={confirmation} /> : null}
      {stored ? <StoredRequestCard stored={stored} chainRevision={head?.revision ?? null} /> : null}
      {!disabled ? (
        <div className="grid gap-4">
          <div className="grid gap-2 rounded-md border border-slate-200 p-3 text-sm text-slate-700" aria-label="Configuration request summary">
            <h4 className="text-sm font-medium text-slate-950">Review before saving</h4>
            <p>{review.connectionDetail}</p>
            <p>{review.storageDetail}</p>
            <p>{review.spreadsheetDetail}</p>
            <p>{review.worksheetDetail}</p>
            <p>{review.controlDetail}</p>
            {review.blockers.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {review.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : (
              <p>The summary is ready to submit. The backend still checks ownership, the worksheet, and both revisions.</p>
            )}
            {stored ? (
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={replaceConfirmed}
                  disabled={locked}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                />
                Replace the stored configuration request. The operational destination and dispatch stay unchanged.
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" disabled={!canSave} onClick={submit}>
              {pending && pending.startsWith("Saving") ? "Saving…" : "Save configuration request"}
            </Button>
            {hold?.kind === "submit" ? (
              <Button type="button" variant="outline" disabled={Boolean(pending)} onClick={() => void send(hold.body)}>
                Retry the same configuration request
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(pending)}
              onClick={() => void reload(hold?.kind === "submit" ? "reconcile" : "manual", hold?.kind === "submit" ? hold.body.requestId : undefined)}
            >
              Reload the configuration request
            </Button>
            {stored ? (
              <Button type="button" variant="outline" disabled={locked} onClick={() => onReviewStoredSpreadsheet(stored.spreadsheetId)}>
                Review the stored spreadsheet
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function confirmationFrom(saved: CompanySheetsConfigSaveResult, head: CompanySheetsConfigHead, matchedCurrent: boolean): Confirmation {
  const stored = saved.storedRequest;
  const current = head.configuration;
  return {
    submittedRequestId: saved.requestId ?? stored?.requestId ?? "",
    replayed: saved.replayed,
    matchedCurrent,
    currentRequestId: current?.requestId ?? null,
    currentRevision: current?.revision ?? null,
    spreadsheetId: stored?.spreadsheetId ?? current?.spreadsheetId ?? "",
    worksheetId: stored?.worksheetId ?? current?.worksheetId ?? 0,
    spreadsheetTitle: stored?.spreadsheetTitle ?? current?.spreadsheetTitle ?? "",
    worksheetTitle: stored?.worksheetTitle ?? current?.worksheetTitle ?? "",
    controlBasis: stored?.controlBasis ?? current?.controlBasis ?? "",
    destinationRevision: head.operationalDestination.destinationRevision,
    requestChainRevision: head.revision,
    campaignDispatchEnabled: head.operationalDestination.campaignDispatchEnabled,
    agedDispatchEnabled: head.operationalDestination.agedDispatchEnabled,
  };
}

function ConfirmationCard({ confirmation }: { confirmation: Confirmation }) {
  const current =
    confirmation.currentRequestId == null
      ? "No configuration request is current."
      : confirmation.matchedCurrent
        ? `It is the current stored request at revision ${confirmation.currentRevision}.`
        : `The current stored request is ${confirmation.currentRequestId} at revision ${confirmation.currentRevision}.`;
  return (
    <div className="grid gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950" aria-label="Configuration request confirmation" data-confirmation="company-sheets-request">
      <h4 className="font-medium">Configuration request stored</h4>
      <p>
        Request {confirmation.submittedRequestId} {confirmation.replayed ? "was already stored" : "was stored"} for spreadsheet {confirmation.spreadsheetTitle} ({confirmation.spreadsheetId}), worksheet {confirmation.worksheetId} ({confirmation.worksheetTitle}). {current}
      </p>
      <p>
        Company control on the request: {controlBasisLabel(confirmation.controlBasis)}. Operational destination revision {confirmation.destinationRevision ?? "none"}. Request-chain revision {confirmation.requestChainRevision}. Campaign dispatch {onOff(confirmation.campaignDispatchEnabled)}. Aged dispatch {onOff(confirmation.agedDispatchEnabled)}.
      </p>
      <p>This request is not an active delivery destination. The operational destination and dispatch were not changed.</p>
    </div>
  );
}

function StoredRequestCard({ stored, chainRevision }: { stored: CompanySheetsStoredRequest; chainRevision: number | null }) {
  const checked = formatCompanySheetsConfigTimestamp(stored.controlCheckedAt);
  return (
    <div className="grid gap-1 rounded-md border border-slate-200 p-3 text-sm text-slate-700" aria-label="Authoritative stored request">
      <h4 className="font-medium text-slate-950">Authoritative stored request</h4>
      <p>
        {stored.spreadsheetTitle} ({stored.spreadsheetId}), worksheet id {stored.worksheetId} ({stored.worksheetTitle}). Control {controlBasisLabel(stored.controlBasis)}
        {checked ? `, checked ${checked}` : ""}.
      </p>
      <p>
        Request {stored.requestId}, request revision {stored.revision}, chain revision {chainRevision ?? "not loaded"}. A stored request is not the operational destination and does not turn delivery on.
      </p>
    </div>
  );
}

function StateCard({ kind, title, body, extra }: { kind: string; title: string; body: string; extra: string }) {
  return (
    <div data-state-panel={kind} className="rounded-md border border-slate-200 p-3 text-sm">
      <h4 className="font-medium text-slate-950">{title}</h4>
      <p className="mt-1 text-slate-700">{body}</p>
      <p className="mt-1 text-slate-600">{extra}</p>
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function revisionText(head: CompanySheetsConfigHead | null): string {
  if (!head) return "Not loaded";
  if (!head.operationalDestination.exists) return "No operational destination";
  return String(head.operationalDestination.destinationRevision);
}

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

function unconfirmedReadMessage(detail: string | null | undefined, requestId: string): string {
  const reason = detail?.trim() || "The configuration request could not be read.";
  return `${reason} Request ${requestId} is still unconfirmed. Retry sends that request id and its original payload.`;
}

function unconfirmedCurrentMessage(requestId: string, current: CompanySheetsStoredRequest | null): string {
  const currentText = current
    ? `The current stored request is ${current.requestId} at revision ${current.revision}.`
    : "No configuration request is current.";
  return `${currentText} That does not show whether request ${requestId} was stored. Retry sends that request id and its original payload.`;
}

function saveReloadMessage(requestId: string | undefined, current: CompanySheetsStoredRequest | null, matched: boolean): string {
  if (matched || !requestId) return "The configuration request was stored. The operational destination was not changed.";
  if (!current) return `Request ${requestId} was stored. No configuration request is current. The operational destination was not changed.`;
  return `Request ${requestId} was stored. The current stored request is ${current.requestId} at revision ${current.revision}. The operational destination was not changed.`;
}

function replayReloadMessage(requestId: string | undefined, current: CompanySheetsStoredRequest | null, matched: boolean): string {
  if (matched || !requestId) return "This configuration request was already stored. The operational destination was not changed.";
  if (!current) return `Request ${requestId} was already stored. No configuration request is current. The operational destination was not changed.`;
  return `Request ${requestId} was already stored. The current stored request is ${current.requestId} at revision ${current.revision}. The operational destination was not changed.`;
}
