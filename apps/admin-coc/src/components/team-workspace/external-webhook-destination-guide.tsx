"use client";

import { useEffect, useRef, useState } from "react";

import {
  activateExternalWebhookDestinationAction,
  deactivateExternalWebhookDestinationAction,
  preflightExternalWebhookDestinationAction,
  readExternalWebhookDestinationAction,
  saveExternalWebhookDestinationAction,
} from "@/app/actions/external-webhook-config";
import { Button } from "@/components/ui/button";
import type {
  ExternalWebhookAuthMode,
  ExternalWebhookBridgePreflightReport,
  ExternalWebhookBridgeResult,
  ExternalWebhookBridgeStatus,
  ExternalWebhookDestinationKind,
} from "@/lib/team-workspace/external-webhook-bridge";

export type ExternalWebhookGuideAccess = {
  canPrepare: boolean;
  canActivate: boolean;
};

const EMPTY_ACCESS: ExternalWebhookGuideAccess = { canPrepare: false, canActivate: false };
const inputClass = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-900";
const DEFAULT_READ_TIMEOUT_MS = 10_000;

type Stage = "select" | "enter" | "checked" | "saved" | "activate";
type ReadState = "loading" | "ready" | "unavailable" | "feature_disabled";

export function ExternalWebhookDestinationGuide({
  clientAccountId,
  access = EMPTY_ACCESS,
  readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
}: {
  clientAccountId: string;
  access?: ExternalWebhookGuideAccess;
  readTimeoutMs?: number;
}) {
  const [status, setStatus] = useState<ExternalWebhookBridgeStatus | null>(null);
  const [readState, setReadState] = useState<ReadState>("loading");
  const [stage, setStage] = useState<Stage>("select");
  const [kind, setKind] = useState<ExternalWebhookDestinationKind>("ghl_inbound");
  const [authMode, setAuthMode] = useState<ExternalWebhookAuthMode>("none");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [preflight, setPreflight] = useState<ExternalWebhookBridgePreflightReport | null>(null);
  const [checkedKey, setCheckedKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>("Loading the saved webhook…");
  const [needsReload, setNeedsReload] = useState(false);
  const [requestBlocked, setRequestBlocked] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const intent = useRef({ key: "", id: "" });
  const activationIntent = useRef("");

  function payloadKey() {
    return JSON.stringify({
      kind,
      authMode: kind === "external_https" ? authMode : "none",
      endpointUrl: endpointUrl.trim(),
      signingSecret,
      revision: status?.revision,
    });
  }

  function requestId(retain: boolean) {
    const key = payloadKey();
    if (retain && intent.current.key === key && intent.current.id) return intent.current.id;
    const id = crypto.randomUUID();
    intent.current = { key, id };
    return id;
  }

  function invalidateCheck() {
    setPreflight(null);
    setCheckedKey("");
    intent.current = { key: "", id: "" };
    setStage((current) => (current === "checked" ? "enter" : current));
  }

  function markUnavailable(nextMessage: string) {
    setReadState("unavailable");
    setStatus(null);
    setPreflight(null);
    setCheckedKey("");
    setCode("unavailable");
    setMessage(nextMessage);
    setNeedsReload(false);
    setRequestBlocked(false);
  }

  function applyRead(result: ExternalWebhookBridgeResult) {
    if (!result.ok || !result.status) {
      if (!result.ok && result.code === "FEATURE_DISABLED") {
        setReadState("feature_disabled");
        setStatus(null);
        setPreflight(null);
        setCheckedKey("");
        setCode("FEATURE_DISABLED");
        setMessage(result.message);
        return;
      }
      markUnavailable(result.ok ? "The saved webhook could not be read. Nothing was changed." : result.message);
      return;
    }
    setReadState("ready");
    setStatus(result.status);
    setNeedsReload(false);
    setCode(null);
    setMessage(null);
    if (result.status.kind) setKind(result.status.kind);
    if (result.status.kind === "external_https" && result.status.authMode) setAuthMode(result.status.authMode);
    setEndpointUrl("");
    setSigningSecret("");
    setPreflight(null);
    setCheckedKey("");
    setStage(result.status.present ? "saved" : "select");
  }

  function readSaved(isCancelled: () => boolean) {
    return new Promise<ExternalWebhookBridgeResult | "timeout" | "throw" | "cancelled">((resolve) => {
      let settled = false;
      const finish = (value: ExternalWebhookBridgeResult | "timeout" | "throw" | "cancelled") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(isCancelled() ? "cancelled" : "timeout"), readTimeoutMs);
      readExternalWebhookDestinationAction(clientAccountId)
        .then((result) => finish(isCancelled() ? "cancelled" : result))
        .catch(() => finish(isCancelled() ? "cancelled" : "throw"));
    });
  }

  function applyReadOutcome(outcome: ExternalWebhookBridgeResult | "timeout" | "throw" | "cancelled") {
    if (outcome === "cancelled") return;
    if (outcome === "timeout") {
      markUnavailable("The saved webhook could not be read in time. Nothing was changed.");
      return;
    }
    if (outcome === "throw") {
      markUnavailable("The saved webhook could not be read. Nothing was changed.");
      return;
    }
    applyRead(outcome);
  }

  async function load() {
    setReadState("loading");
    setPending("Loading the saved webhook…");
    setStatus(null);
    setPreflight(null);
    setCheckedKey("");
    setMessage(null);
    setCode(null);
    let cancelled = false;
    try {
      applyReadOutcome(await readSaved(() => cancelled));
    } finally {
      cancelled = true;
      setPending(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setReadState("loading");
    setStatus(null);
    setPending("Loading the saved webhook…");
    setPreflight(null);
    setCheckedKey("");
    void readSaved(() => cancelled)
      .then((outcome) => {
        if (!cancelled) applyReadOutcome(outcome);
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
    // applyReadOutcome closes over the latest setters and is recreated each render.
    // The read is keyed only by the client and the deadline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientAccountId, readTimeoutMs]);

  function applyFailure(result: Extract<ExternalWebhookBridgeResult, { ok: false }>, retainRequest: boolean) {
    setCode(result.code);
    setMessage(result.message);
    setNeedsReload(result.needsReload || result.code === "revision_conflict");
    setRequestBlocked(result.code === "request_id_conflict");
    if (result.code === "FEATURE_DISABLED") {
      setReadState("feature_disabled");
      setStatus(null);
      setPreflight(null);
      setCheckedKey("");
    }
    if (retainRequest && result.code !== "request_id_conflict") requestId(true);
    if (result.code !== "request_id_conflict" && result.code !== "revision_conflict" && result.code !== "unavailable") {
      intent.current = { key: "", id: "" };
    }
  }

  async function runPreflight() {
    if (readState !== "ready" || !status || !access.canPrepare) return;
    setPending("Checking the endpoint…");
    setMessage(null);
    const mode = kind === "external_https" ? authMode : "none";
    const key = payloadKey();
    try {
      const result = await preflightExternalWebhookDestinationAction({
        clientAccountId,
        expectedRevision: status.revision,
        kind,
        authMode: mode,
        endpointUrl: endpointUrl.trim(),
        ...(mode === "hmac_sha256" && signingSecret ? { signingSecret } : {}),
      });
      if (payloadKey() !== key) {
        setPreflight(null);
        setCheckedKey("");
        setStage("enter");
        setMessage("The endpoint changed during the check. Check it again. Nothing was saved.");
        return;
      }
      if (!result.ok || !result.preflight) {
        applyFailure(result.ok ? { ok: false, code: "unavailable", message: "The check did not finish. Nothing was saved.", replayed: false, needsReload: false, status: null, preflight: null } : result, result.ok ? false : result.code === "unavailable");
        return;
      }
      setPreflight(result.preflight);
      setCheckedKey(key);
      setCode(null);
      setStage("checked");
    } catch {
      setMessage("The check did not finish. Nothing was saved.");
      setCode("unavailable");
      requestId(true);
    } finally {
      setPending(null);
    }
  }

  const checkIsCurrent = checkedKey !== "" && checkedKey === payloadKey();
  const saveAllowed = Boolean(
    readState === "ready" &&
      status &&
      access.canPrepare &&
      checkIsCurrent &&
      preflight?.endpointValid &&
      preflight.authValid &&
      preflight.credentialsReady &&
      preflight.revisionMatches &&
      !preflight.primaryCrmConflict &&
      !needsReload &&
      !requestBlocked,
  );

  async function saveDisabled() {
    if (!saveAllowed || !status) return;
    setPending("Saving the disabled destination…");
    const mode = kind === "external_https" ? authMode : "none";
    const id = requestId(code === "unavailable");
    try {
      const result = await saveExternalWebhookDestinationAction({
        clientAccountId,
        requestId: id,
        expectedRevision: status.revision,
        kind,
        authMode: mode,
        endpointUrl: endpointUrl.trim(),
        ...(mode === "hmac_sha256" && signingSecret ? { signingSecret } : {}),
      });
      if (!result.ok || !result.status) {
        applyFailure(result.ok ? { ok: false, code: "unavailable", message: "The save did not finish. SA360 cannot confirm whether the destination was saved.", replayed: false, needsReload: false, status: null, preflight: null } : result, !result.ok && result.code === "unavailable");
        return;
      }
      setReadState("ready");
      setStatus(result.status);
      setEndpointUrl("");
      setSigningSecret("");
      setPreflight(null);
      setCheckedKey("");
      setCode(null);
      setRequestBlocked(false);
      setMessage("External webhook destination saved and disabled.");
      setStage("saved");
      intent.current = { key: "", id: "" };
    } catch {
      setMessage("The save did not finish. SA360 cannot confirm whether the destination was saved. Retry uses the same request.");
      setCode("unavailable");
      requestId(true);
    } finally {
      setPending(null);
    }
  }

  async function changeActivation(enabled: boolean) {
    if (readState !== "ready" || !access.canActivate || !status || !confirmed) return;
    setPending(enabled ? "Enabling the saved destination…" : "Turning the saved destination off…");
    if (!activationIntent.current) activationIntent.current = crypto.randomUUID();
    const id = activationIntent.current;
    try {
      const action = enabled ? activateExternalWebhookDestinationAction : deactivateExternalWebhookDestinationAction;
      const result = await action({ clientAccountId, requestId: id, expectedRevision: status.revision });
      if (!result.ok || !result.status) {
        if (!result.ok && result.code !== "unavailable") activationIntent.current = "";
        if (result.ok || result.code === "unavailable") {
          await reconcileActivation(status);
          return;
        }
        applyFailure(result, false);
        return;
      }
      activationIntent.current = "";
      setConfirmed(false);
      setStatus(result.status);
      setMessage(
        enabled
          ? "The destination row is enabled. This screen does not show whether the global delivery switch is on."
          : "The destination row is off. Native GoHighLevel and Company Sheets were not changed.",
      );
      setCode(null);
      setStage("saved");
    } catch {
      await reconcileActivation(status);
    } finally {
      setPending(null);
    }
  }

  async function reconcileActivation(before: ExternalWebhookBridgeStatus) {
    setCode("unavailable");
    try {
      const read = await readExternalWebhookDestinationAction(clientAccountId);
      if (!read.ok || !read.status) {
        setMessage("Activation did not finish. The saved row could not be read back, so this screen cannot confirm whether it changed.");
        return;
      }
      setReadState("ready");
      setStatus(read.status);
      const unchanged = read.status.revision === before.revision && read.status.enabled === before.enabled;
      if (unchanged) {
        setMessage("Activation did not finish. The saved row was read again and is unchanged.");
        return;
      }
      activationIntent.current = "";
      setConfirmed(false);
      setCode(null);
      setStage(read.status.present ? "saved" : "select");
      setMessage("Activation did not finish. The saved row was read again and shows the current destination.");
    } catch {
      setMessage("Activation did not finish. The saved row could not be read back, so this screen cannot confirm whether it changed.");
    }
  }

  const busy = Boolean(pending);
  const ready = readState === "ready";

  return (
    <section className="grid gap-4 rounded-md border border-slate-200 p-4" aria-label="External webhook destination">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium text-slate-950">External webhook</h3>
        <p className="text-sm text-slate-600">
          This is a separate operational configuration. It is not the onboarding intention above, and it is not native
          GoHighLevel. An external GoHighLevel inbound webhook and Make or custom HTTPS are alternative primary CRM
          methods. Company Sheets can stay on beside either one. Saving here does not turn native GoHighLevel or Company
          Sheets off. Email and SMS notification delivery is managed separately and is not enabled by saving this webhook.
        </p>
      </div>
      {pending ? <p className="text-sm text-slate-600">{pending}</p> : null}
      {readState === "ready" && status ? <StatusLine status={status} /> : null}
      {readState === "feature_disabled" ? (
        <p className="text-sm text-slate-700">External webhook configuration is turned off. Nothing can be saved or enabled from this screen.</p>
      ) : null}
      {message ? (
        <p className="text-sm text-amber-900" role="status">
          {message}
        </p>
      ) : null}
      {needsReload && ready ? (
        <div>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>
            Reload saved configuration
          </Button>
        </div>
      ) : null}
      {requestBlocked && ready ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              intent.current = { key: "", id: "" };
              setRequestBlocked(false);
              setPreflight(null);
              setCheckedKey("");
              setStage("enter");
              setMessage("The previous request id was cleared. Check the endpoint again before saving.");
            }}
          >
            Start a new request
          </Button>
        </div>
      ) : null}
      {code === "primary_crm_conflict" ? (
        <p className="text-sm text-slate-700">Another primary CRM is already active. Native GoHighLevel and Company Sheets were not changed.</p>
      ) : null}
      {readState === "unavailable" && !pending ? (
        <div>
          <Button type="button" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}
      {ready && code === "unavailable" && !pending ? (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void (stage === "checked" ? saveDisabled() : stage === "activate" && status ? changeActivation(!status.enabled) : load())}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {ready && stage === "select" ? (
        <fieldset className="grid gap-2" disabled={busy}>
          <legend className="text-sm font-medium text-slate-950">External webhook type</legend>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="radio"
              name="external-webhook-kind"
              checked={kind === "ghl_inbound"}
              onChange={() => {
                setKind("ghl_inbound");
                setAuthMode("none");
                setSigningSecret("");
                invalidateCheck();
              }}
            />
            GoHighLevel inbound webhook
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="radio"
              name="external-webhook-kind"
              checked={kind === "external_https"}
              onChange={() => {
                setKind("external_https");
                invalidateCheck();
              }}
            />
            Make or custom HTTPS webhook
          </label>
          <p className="text-sm text-slate-600">Neither choice is native GoHighLevel, and neither one is selected by the onboarding intention.</p>
          <div>
            <Button type="button" disabled={busy} onClick={() => setStage("enter")}>
              Continue
            </Button>
          </div>
        </fieldset>
      ) : null}

      {ready && stage === "enter" ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runPreflight();
          }}
        >
          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-950" htmlFor="external-webhook-url">
              Webhook URL
            </label>
            <input
              id="external-webhook-url"
              className={inputClass}
              name="endpointUrl"
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={endpointUrl}
              disabled={busy || !access.canPrepare}
              onChange={(event) => {
                setEndpointUrl(event.target.value);
                invalidateCheck();
              }}
            />
          </div>
          {kind === "external_https" ? (
            <fieldset className="grid gap-2" disabled={busy || !access.canPrepare}>
              <legend className="text-sm font-medium text-slate-950">Authentication</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="external-webhook-auth"
                  checked={authMode === "none"}
                  onChange={() => {
                    setAuthMode("none");
                    setSigningSecret("");
                    invalidateCheck();
                  }}
                />
                None
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="external-webhook-auth"
                  checked={authMode === "hmac_sha256"}
                  onChange={() => {
                    setAuthMode("hmac_sha256");
                    invalidateCheck();
                  }}
                />
                HMAC signature
              </label>
            </fieldset>
          ) : null}
          {kind === "external_https" && authMode === "hmac_sha256" ? (
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-950" htmlFor="external-webhook-secret">
                Signing secret
              </label>
              <input
                id="external-webhook-secret"
                className={inputClass}
                name="signingSecret"
                type="password"
                autoComplete="new-password"
                value={signingSecret}
                disabled={busy || !access.canPrepare}
                onChange={(event) => {
                  setSigningSecret(event.target.value);
                  invalidateCheck();
                }}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={busy || !access.canPrepare || endpointUrl.trim() === ""}>
              {busy ? "Checking…" : "Check this endpoint"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStage("select")}>
              Back
            </Button>
          </div>
          {!access.canPrepare ? <p className="text-sm text-slate-600">This session can review the saved webhook. It cannot check or save a new one.</p> : null}
        </form>
      ) : null}

      {ready && stage === "checked" && preflight ? (
        <div className="grid gap-3">
          <ul className="grid gap-1 text-sm text-slate-700">
            <li>Endpoint: {preflight.endpointValid ? "Valid HTTPS" : "Not valid"}{preflight.hostname ? ` · ${preflight.hostname}` : ""}</li>
            <li>Authentication: {preflight.authValid ? "Valid" : "Not valid"}</li>
            <li>Credentials: {preflight.credentialsReady ? "Ready on the server" : "Not ready"}</li>
            <li>Primary CRM: {preflight.primaryCrmConflict ? "Another primary CRM is active" : "No conflict reported"}</li>
            <li>Revision: {preflight.revisionMatches ? `Matches saved revision ${preflight.currentRevision}` : "Does not match the saved revision"}</li>
          </ul>
          <p className="text-sm text-slate-600">This check does not send a lead.</p>
          {preflight.primaryCrmConflict ? (
            <p className="text-sm text-slate-700">Another primary CRM is already active. Native GoHighLevel and Company Sheets were not changed.</p>
          ) : null}
          {!saveAllowed ? (
            <p className="text-sm text-slate-700">Save stays off until this check matches the current URL, authentication, credentials, and saved revision, with no primary CRM conflict.</p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" disabled={busy || !saveAllowed} onClick={() => void saveDisabled()}>
              {busy ? "Saving…" : "Save disabled configuration"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setStage("enter"); }}>
              Edit URL
            </Button>
          </div>
        </div>
      ) : null}

      {ready && stage === "saved" && status?.present ? (
        <div className="grid gap-3">
          <p className="text-sm text-slate-800">
            {status.enabled
              ? "This destination row is enabled. That is separate from the global delivery switch, which this screen does not read. Enabling the row does not prove delivery."
              : "External webhook destination saved and disabled. Native GoHighLevel and Company Sheets were not changed. This screen does not show whether the global delivery switch is on."}
          </p>
          <p className="text-sm text-slate-600">
            {kindLabel(status.kind)} · {status.hostname ?? "Hostname unavailable"} · revision {status.revision}.{" "}
            {status.enabled ? "Destination row enabled." : "Destination row disabled."}
          </p>
          <AttemptNote attempt={status.latestAttempt} />
          <div className="flex flex-col gap-2 sm:flex-row">
            {access.canPrepare ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setStage("select");
                  setEndpointUrl("");
                  setSigningSecret("");
                  setPreflight(null);
                  setCheckedKey("");
                }}
              >
                Replace saved URL
              </Button>
            ) : null}
            {access.canActivate ? (
              <Button type="button" disabled={busy} onClick={() => { setConfirmed(false); setStage("activate"); }}>
                {status.enabled ? "Review turning this off" : "Review activation"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {ready && stage === "activate" && status && access.canActivate ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void changeActivation(!status.enabled);
          }}
        >
          <ul className="grid gap-1 text-sm text-slate-700">
            <li>Type: {kindLabel(status.kind)}</li>
            <li>Hostname: {status.hostname ?? "Unavailable"}</li>
            <li>Revision: {status.revision}</li>
            <li>{status.primaryCrmConflict ? "A native GoHighLevel destination already owns primary CRM delivery." : "No native GoHighLevel primary-CRM conflict was reported."}</li>
            <li>This confirmation does not read or change the global delivery switch. Enabling this row is not the same as that switch being on.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" name="confirmActivation" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I understand this {status.enabled ? "turns the saved row off" : "enables the saved row"} and does not by itself prove a contact was created.
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={busy || !confirmed}>
              {busy ? "Saving…" : status.enabled ? "Turn this destination off" : "Enable this destination"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStage("saved")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function StatusLine({ status }: { status: ExternalWebhookBridgeStatus }) {
  const label = !status.present
    ? "Not configured"
    : status.primaryCrmConflict || !status.configurationValid
      ? "Conflict or invalid"
      : status.enabled
        ? "Configured, destination row enabled"
        : "Configured, destination row disabled";
  return (
    <p className="text-sm font-medium text-slate-950" data-webhook-state={label}>
      {label}
    </p>
  );
}

function AttemptNote({ attempt }: { attempt: ExternalWebhookBridgeStatus["latestAttempt"] }) {
  if (!attempt) return <p className="text-sm text-slate-600">No delivery attempt is on file.</p>;
  if (attempt.httpAccepted) {
    return <p className="text-sm text-slate-700">The destination returned a successful HTTP response. This does not prove a contact was created in the receiving CRM.</p>;
  }
  if (attempt.outcome === "uncertain" || attempt.state === "uncertain") {
    return <p className="text-sm text-slate-700">SA360 cannot confirm whether the receiver accepted this request. Do not blindly resend.</p>;
  }
  return <p className="text-sm text-slate-700">SA360 did not confirm delivery. State: {attempt.state}{attempt.httpStatus ? `, HTTP ${attempt.httpStatus}` : ""}.</p>;
}

function kindLabel(kind: ExternalWebhookDestinationKind | null): string {
  if (kind === "ghl_inbound") return "GoHighLevel inbound webhook";
  if (kind === "external_https") return "Make or custom HTTPS";
  return "Webhook";
}
