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

type Stage = "select" | "enter" | "checked" | "saved" | "activate";

export function ExternalWebhookDestinationGuide({
  clientAccountId,
  access = EMPTY_ACCESS,
}: {
  clientAccountId: string;
  access?: ExternalWebhookGuideAccess;
}) {
  const [status, setStatus] = useState<ExternalWebhookBridgeStatus | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [kind, setKind] = useState<ExternalWebhookDestinationKind>("ghl_inbound");
  const [authMode, setAuthMode] = useState<ExternalWebhookAuthMode>("none");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [preflight, setPreflight] = useState<Extract<ExternalWebhookBridgeResult, { ok: true }>["preflight"]>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>("Loading the saved webhook…");
  const [featureOff, setFeatureOff] = useState(false);
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
      revision: status?.revision ?? 0,
    });
  }

  function requestId(retain: boolean) {
    const key = payloadKey();
    if (retain && intent.current.key === key && intent.current.id) return intent.current.id;
    const id = crypto.randomUUID();
    intent.current = { key, id };
    return id;
  }

  function applyFailure(result: Extract<ExternalWebhookBridgeResult, { ok: false }>, retainRequest: boolean) {
    setCode(result.code);
    setMessage(result.message);
    setNeedsReload(result.needsReload || result.code === "revision_conflict");
    setRequestBlocked(result.code === "request_id_conflict");
    setFeatureOff(result.code === "FEATURE_DISABLED");
    if (retainRequest && result.code !== "request_id_conflict") requestId(true);
    if (result.code !== "request_id_conflict" && result.code !== "revision_conflict" && result.code !== "unavailable") {
      intent.current = { key: "", id: "" };
    }
  }

  async function load() {
    setPending("Loading the saved webhook…");
    setMessage(null);
    try {
      const result = await readExternalWebhookDestinationAction(clientAccountId);
      if (!result.ok || !result.status) {
        applyFailure(result.ok ? { ok: false, code: "unavailable", message: "The saved webhook could not be read.", replayed: false, needsReload: false, status: null, preflight: null } : result, false);
        return;
      }
      setStatus(result.status);
      setFeatureOff(false);
      setNeedsReload(false);
      setCode(null);
      if (result.status.kind) setKind(result.status.kind);
      if (result.status.kind === "external_https" && result.status.authMode) setAuthMode(result.status.authMode);
      setEndpointUrl("");
      setSigningSecret("");
      setStage(result.status.present ? "saved" : "select");
    } catch {
      setMessage("The saved webhook could not be read. Nothing was changed.");
      setCode("unavailable");
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void readExternalWebhookDestinationAction(clientAccountId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || !result.status) {
          setFeatureOff(!result.ok && result.code === "FEATURE_DISABLED");
          setMessage(result.ok ? "The saved webhook could not be read." : result.message);
          setCode(result.ok ? "unavailable" : result.code);
          return;
        }
        setStatus(result.status);
        if (result.status.kind) setKind(result.status.kind);
        if (result.status.kind === "external_https" && result.status.authMode) setAuthMode(result.status.authMode);
        setStage(result.status.present ? "saved" : "select");
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("The saved webhook could not be read. Nothing was changed.");
          setCode("unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientAccountId]);

  async function runPreflight() {
    if (!access.canPrepare || featureOff) return;
    setPending("Checking the endpoint…");
    setMessage(null);
    const mode = kind === "external_https" ? authMode : "none";
    try {
      const result = await preflightExternalWebhookDestinationAction({
        clientAccountId,
        expectedRevision: status?.revision ?? 0,
        kind,
        authMode: mode,
        endpointUrl: endpointUrl.trim(),
        ...(mode === "hmac_sha256" && signingSecret ? { signingSecret } : {}),
      });
      if (!result.ok || !result.preflight) {
        applyFailure(result.ok ? { ok: false, code: "unavailable", message: "The check did not finish. Nothing was saved.", replayed: false, needsReload: false, status: null, preflight: null } : result, result.ok ? false : result.code === "unavailable");
        return;
      }
      setPreflight(result.preflight);
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

  async function saveDisabled() {
    if (!access.canPrepare || featureOff || needsReload || requestBlocked) return;
    setPending("Saving the disabled destination…");
    const mode = kind === "external_https" ? authMode : "none";
    const id = requestId(code === "unavailable" || code === "request_id_conflict");
    try {
      const result = await saveExternalWebhookDestinationAction({
        clientAccountId,
        requestId: id,
        expectedRevision: status?.revision ?? 0,
        kind,
        authMode: mode,
        endpointUrl: endpointUrl.trim(),
        ...(mode === "hmac_sha256" && signingSecret ? { signingSecret } : {}),
      });
      if (!result.ok || !result.status) {
        applyFailure(result.ok ? { ok: false, code: "unavailable", message: "The save did not finish.", replayed: false, needsReload: false, status: null, preflight: null } : result, !result.ok && result.code === "unavailable");
        return;
      }
      setStatus(result.status);
      setEndpointUrl("");
      setSigningSecret("");
      setPreflight(null);
      setCode(null);
      setMessage("Configuration saved. Lead delivery is OFF.");
      setStage("saved");
      intent.current = { key: "", id: "" };
    } catch {
      setMessage("The save did not finish. Lead delivery was not turned on.");
      setCode("unavailable");
      requestId(true);
    } finally {
      setPending(null);
    }
  }

  async function changeActivation(enabled: boolean) {
    if (!access.canActivate || !status || featureOff || !confirmed) return;
    setPending(enabled ? "Enabling the saved destination…" : "Turning the saved destination off…");
    if (!activationIntent.current) activationIntent.current = crypto.randomUUID();
    const id = activationIntent.current;
    try {
      const action = enabled ? activateExternalWebhookDestinationAction : deactivateExternalWebhookDestinationAction;
      const result = await action({ clientAccountId, requestId: id, expectedRevision: status.revision });
      if (!result.ok || !result.status) {
        if (result.ok || result.code !== "unavailable") activationIntent.current = "";
        applyFailure(result.ok ? { ok: false, code: "unavailable", message: "Activation did not finish. The destination was not changed.", replayed: false, needsReload: false, status: null, preflight: null } : result, false);
        return;
      }
      activationIntent.current = "";
      setConfirmed(false);
      setStatus(result.status);
      setMessage(enabled ? "The destination row is enabled. The global delivery switch was not changed." : "The destination row is off. Lead delivery was not started.");
      setCode(null);
      setStage("saved");
    } catch {
      setMessage("Activation did not finish. The destination was not changed.");
      setCode("unavailable");
    } finally {
      setPending(null);
    }
  }

  const busy = Boolean(pending);

  return (
    <section className="grid gap-4 rounded-md border border-slate-200 p-4" aria-label="External webhook destination">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium text-slate-950">External webhook</h3>
        <p className="text-sm text-slate-600">
          GoHighLevel inbound webhook and Make or custom HTTPS are alternative primary CRM methods. Company Sheets can
          stay on beside either one. Choosing a webhook here does not replace a saved native GoHighLevel destination.
          Email and SMS notification delivery is managed separately and is not enabled by saving this webhook.
        </p>
      </div>
      {pending ? <p className="text-sm text-slate-600">{pending}</p> : null}
      {status ? <StatusLine status={status} /> : null}
      {featureOff ? <p className="text-sm text-slate-700">External webhook configuration is turned off. Nothing can be saved or enabled from this screen.</p> : null}
      {message ? (
        <p className="text-sm text-amber-900" role="status">
          {message}
        </p>
      ) : null}
      {needsReload ? (
        <div>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>
            Reload saved configuration
          </Button>
        </div>
      ) : null}
      {requestBlocked ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              intent.current = { key: "", id: "" };
              setRequestBlocked(false);
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
      {code === "unavailable" && !pending ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void (stage === "checked" ? saveDisabled() : stage === "activate" && status ? changeActivation(!status.enabled) : load())}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {!featureOff && stage === "select" && !(pending && !status) ? (
        <fieldset className="grid gap-2" disabled={busy}>
          <legend className="text-sm font-medium text-slate-950">Primary CRM method</legend>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="radio" name="external-webhook-kind" checked={kind === "ghl_inbound"} onChange={() => { setKind("ghl_inbound"); setAuthMode("none"); intent.current = { key: "", id: "" }; }} />
            GoHighLevel inbound webhook
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="radio" name="external-webhook-kind" checked={kind === "external_https"} onChange={() => { setKind("external_https"); intent.current = { key: "", id: "" }; }} />
            Make or custom HTTPS webhook
          </label>
          <div>
            <Button type="button" disabled={busy} onClick={() => setStage("enter")}>
              Continue
            </Button>
          </div>
        </fieldset>
      ) : null}

      {!featureOff && stage === "enter" ? (
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
                intent.current = { key: "", id: "" };
              }}
            />
          </div>
          {kind === "external_https" ? (
            <fieldset className="grid gap-2" disabled={busy || !access.canPrepare}>
              <legend className="text-sm font-medium text-slate-950">Authentication</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="external-webhook-auth" checked={authMode === "none"} onChange={() => { setAuthMode("none"); setSigningSecret(""); intent.current = { key: "", id: "" }; }} />
                None
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="external-webhook-auth" checked={authMode === "hmac_sha256"} onChange={() => { setAuthMode("hmac_sha256"); intent.current = { key: "", id: "" }; }} />
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
                  intent.current = { key: "", id: "" };
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

      {!featureOff && stage === "checked" && preflight ? (
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
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" disabled={busy || !access.canPrepare || needsReload || requestBlocked || !preflight.endpointValid || preflight.primaryCrmConflict} onClick={() => void saveDisabled()}>
              {busy ? "Saving…" : "Save disabled configuration"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStage("enter")}>
              Edit URL
            </Button>
          </div>
        </div>
      ) : null}

      {!featureOff && stage === "saved" && status?.present ? (
        <div className="grid gap-3">
          <p className="text-sm text-slate-800">
            {status.enabled
              ? "This row is enabled. That does not prove leads are being delivered. The global delivery switch is separate and was not changed by this screen."
              : "Configuration saved. Lead delivery is OFF until an administrator enables this row. The global delivery switch is still separate."}
          </p>
          <p className="text-sm text-slate-600">
            {kindLabel(status.kind)} · {status.hostname ?? "Hostname unavailable"} · revision {status.revision}.{" "}
            {status.enabled ? "This row is enabled." : "This row is disabled."} Enabling the row does not prove leads are being delivered.
          </p>
          <AttemptNote attempt={status.latestAttempt} />
          <div className="flex flex-col gap-2 sm:flex-row">
            {access.canPrepare ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setStage("select"); setEndpointUrl(""); setSigningSecret(""); }}>
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

      {!featureOff && stage === "activate" && status && access.canActivate ? (
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
            <li>The global webhook delivery feature is not changed by this confirmation. A row can be enabled while that feature is still off.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" name="confirmActivation" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I understand this {status.enabled ? "turns the saved row off" : "enables the saved row"} and does not by itself prove delivery.
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
        ? "Configured, enabled"
        : "Configured, disabled";
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
