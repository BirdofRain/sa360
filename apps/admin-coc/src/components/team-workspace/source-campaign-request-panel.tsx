"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  rejectSourceCampaignRequestAction,
  submitSourceCampaignRequestAction,
  type SourceCampaignRequestActionResult,
  type SourceCampaignRequestEcho,
} from "@/app/actions/source-campaign-request";
import { Button } from "@/components/ui/button";
import type { ClientSetupData } from "@/lib/clients/types";
import type { GuidedSetupDraft } from "@/lib/team-workspace/onboarding-guide";
import {
  disabledSourceCampaignRequest,
  draftMatchesSavedSetup,
  echoSavedSourceCampaignIdentity,
  formatRequestTimestamp,
  presentSourceCampaignRequestProgress,
  type SourceCampaignRequestView,
} from "@/lib/team-workspace/source-campaign-request";
import type { SourceCampaignReviewView } from "@/lib/team-workspace/source-campaign-review";

type PendingAttempt = {
  kind: "request" | "reject";
  requestId: string;
  echo: SourceCampaignRequestEcho;
  uncertain: boolean;
};

const STEP_CLASS = {
  complete: "border-sky-200 bg-sky-50 text-sky-950",
  current: "border-amber-200 bg-amber-50 text-amber-950",
  waiting: "border-slate-200 bg-white text-slate-600",
} as const;

export function SourceCampaignRequestPanel({
  clientAccountId,
  setup,
  draft,
  review,
  request,
  busy = false,
}: {
  clientAccountId: string;
  setup: { revision: number; repairRequired: boolean; data: ClientSetupData } | null;
  draft: Pick<GuidedSetupDraft, "providerFunnelId" | "providerCampaignId">;
  review: SourceCampaignReviewView | null | undefined;
  request: SourceCampaignRequestView | null | undefined;
  busy?: boolean;
}) {
  const router = useRouter();
  const view = request ?? disabledSourceCampaignRequest("request_flag");
  const echo = setup && !setup.repairRequired ? echoSavedSourceCampaignIdentity(setup.data) : null;
  const draftMatches = setup ? draftMatchesSavedSetup(draft, setup.data) : false;
  const steps = presentSourceCampaignRequestProgress({
    setupReadable: Boolean(setup && !setup.repairRequired),
    setupRevision: setup && !setup.repairRequired ? setup.revision : null,
    draftMatchesSaved: draftMatches,
    echo,
    review,
    request: view,
  });
  const open = view.availability === "ready" ? view.openRequest : null;
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "submitting" | "rejecting">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttempt | null>(null);
  const inflight = useRef(false);
  const working = busy || phase !== "idle";
  const chainReady = view.availability === "ready" && Boolean(setup) && !setup?.repairRequired && Boolean(echo);
  const needsReplacement = Boolean(open);
  const canSubmit =
    chainReady &&
    draftMatches &&
    Boolean(echo?.complete) &&
    !pending?.uncertain &&
    (!needsReplacement || replaceOpen) &&
    !working;
  const canReject = chainReady && Boolean(open) && !pending?.uncertain && !working;

  function currentEcho(): SourceCampaignRequestEcho {
    return {
      expectedRevision: view.availability === "ready" ? view.revision : 0,
      setupRevision: setup?.revision ?? 0,
      providerFunnelId: echo?.providerFunnelId ?? null,
      parentUrlKey: echo?.parentUrlKey ?? null,
      providerCampaignId: echo?.providerCampaignId ?? null,
      replaceOpenProposal: replaceOpen,
    };
  }

  function newRequestId(): string | null {
    const value = globalThis.crypto?.randomUUID?.();
    return typeof value === "string" ? value : null;
  }

  function applyResult(kind: PendingAttempt["kind"], requestId: string, echoValue: SourceCampaignRequestEcho, result: SourceCampaignRequestActionResult) {
    const sent = result.sent ?? echoValue;
    setPending(result.retainRequestId ? { kind, requestId, echo: sent, uncertain: true } : null);
    setMessage(result.message);
    if (result.stored) router.refresh();
  }

  async function run(kind: PendingAttempt["kind"], requestId: string, echoValue: SourceCampaignRequestEcho) {
    if (inflight.current) return;
    inflight.current = true;
    setPhase(kind === "request" ? "submitting" : "rejecting");
    setMessage(kind === "request" ? "Submitting the proposal." : "Recording the operator rejection.");
    try {
      const result =
        kind === "request"
          ? await submitSourceCampaignRequestAction({ clientAccountId, requestId, ...echoValue })
          : await rejectSourceCampaignRequestAction({
              clientAccountId,
              requestId,
              expectedRevision: echoValue.expectedRevision,
              setupRevision: echoValue.setupRevision,
            });
      applyResult(kind, requestId, echoValue, result);
    } catch {
      setPending({ kind, requestId, echo: echoValue, uncertain: true });
      setMessage("The request did not finish. Retry uses the same request id. Nothing on this page was marked stored.");
    } finally {
      inflight.current = false;
      setPhase("idle");
    }
  }

  function submit() {
    if (!canSubmit) {
      if (pending?.uncertain) {
        setMessage("An earlier request is still unconfirmed. Retry that request before starting another.");
      } else if (needsReplacement && !replaceOpen) {
        setMessage("An open proposal is already stored. Confirm replacement before submitting another.");
      }
      return;
    }
    const requestId = newRequestId();
    if (!requestId) {
      setMessage("A request id could not be created. Reload and try again. Nothing was submitted.");
      return;
    }
    void run("request", requestId, currentEcho());
  }

  function reject() {
    if (!canReject) return;
    const requestId = newRequestId();
    if (!requestId) {
      setMessage("A request id could not be created. Reload and try again. Nothing was rejected.");
      return;
    }
    void run("reject", requestId, currentEcho());
  }

  function retry() {
    if (!pending?.uncertain || inflight.current) return;
    void run(pending.kind, pending.requestId, pending.echo);
  }

  const submittedAt = open ? formatRequestTimestamp(open.createdAt) : null;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-3" aria-labelledby="source-campaign-request-title" aria-busy={phase !== "idle"} data-request-panel="true">
      <h3 id="source-campaign-request-title" className="text-sm font-medium text-slate-950">
        Source and campaign request
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Submit the saved draft as a proposal. The proposal waits for operational review. This step uses the saved setup, not unsaved form edits.
      </p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Source and campaign request progress">
        {steps.map((step) => (
          <li key={step.id} data-request-step={step.id} data-state={step.state} className={`rounded-md border px-3 py-2 ${STEP_CLASS[step.state]}`}>
            <div className="text-sm font-medium">{step.label}</div>
            <p className="mt-1 text-sm">{step.detail}</p>
          </li>
        ))}
      </ol>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium text-slate-800">Request-chain revision</dt>
          <dd className="text-slate-700">{view.availability === "ready" ? view.revision : "Not loaded"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-800">Open proposal</dt>
          <dd className="text-slate-700">{open ? "Yes" : view.availability === "ready" ? "No" : "Not loaded"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-800">Saved funnel id</dt>
          <dd className="break-all font-mono text-xs text-slate-700">{echo?.providerFunnelId ?? "None"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-800">Saved page URL key</dt>
          <dd className="break-all font-mono text-xs text-slate-700">{echo?.parentUrlKey ?? "None"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-800">Saved campaign id</dt>
          <dd className="break-all font-mono text-xs text-slate-700">{echo?.providerCampaignId ?? "None"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-800">Setup revision</dt>
          <dd className="text-slate-700">{setup && !setup.repairRequired ? setup.revision : "Not loaded"}</dd>
        </div>
        {open ? (
          <>
            <div>
              <dt className="font-medium text-slate-800">Proposal status</dt>
              <dd className="text-slate-700">requested</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Submitted</dt>
              <dd className="text-slate-700">{submittedAt ?? open.createdAt}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Proposal setup revision</dt>
              <dd className="text-slate-700">{open.setupRevision}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Proposal request id</dt>
              <dd className="break-all font-mono text-xs text-slate-700">{open.requestId}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {review?.sourceAssociated ? (
        <p className="mt-3 text-sm text-slate-700">
          The source check above shows this source is confirmed for this client. That record is separate from this proposal.
        </p>
      ) : null}
      {review?.sourceStatus === "confirmed_for_other_client" ? (
        <p className="mt-3 text-sm text-amber-950">A matching source belongs to another client. Submitting records that result and does not move the source.</p>
      ) : null}
      {review?.sourceStatus === "ambiguous" ? (
        <p className="mt-3 text-sm text-amber-950">More than one source matches. Submitting records that result.</p>
      ) : null}
      {review?.campaignOwnership === "another_client" || review?.campaignOwnership === "both" ? (
        <p className="mt-3 text-sm text-amber-950">A campaign rule for this id belongs to another client. Submitting records that result and does not change the rule.</p>
      ) : null}
      {view.availability !== "ready" ? <p className="mt-3 text-sm text-slate-700">{view.message}</p> : null}
      {needsReplacement ? (
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-1"
            checked={replaceOpen}
            disabled={working}
            onChange={(event) => setReplaceOpen(event.target.checked)}
          />
          <span>Replace the open proposal. An accepted submission supersedes it. The new proposal still waits for operational review.</span>
        </label>
      ) : null}
      <p className="mt-3 text-sm text-slate-600">
        Reject open proposal records an operator rejection. An ownership conflict is recorded by the API when a proposal is submitted, and that result stays separate.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" disabled={!canSubmit} onClick={submit}>
          {phase === "submitting" ? "Submitting proposal…" : "Submit proposal"}
        </Button>
        <Button type="button" variant="outline" disabled={!canReject} onClick={reject}>
          {phase === "rejecting" ? "Rejecting proposal…" : "Reject open proposal"}
        </Button>
        {pending?.uncertain ? (
          <Button type="button" variant="outline" disabled={working} onClick={retry}>
            Retry the same request
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={working} onClick={() => router.refresh()}>
          Reload request chain
        </Button>
      </div>
      {pending?.uncertain ? (
        <p className="mt-2 break-all font-mono text-xs text-slate-600">Unconfirmed request id {pending.requestId}</p>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm text-slate-800">
          {message}
        </p>
      ) : null}
    </section>
  );
}
