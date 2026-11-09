"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notificationSaveAttempt, recipientSaveKey } from "@/lib/notification-setup/attempt";
import {
  isRetryableNotificationError,
  normalizeNotificationRecipient,
  notificationErrorMessage,
  type NotificationErrorCode,
  type RecipientSnapshot,
} from "@/lib/notification-setup/model";

export type RecipientFormActions = {
  save: (input: {
    clientAccountId: string;
    requestId: string;
    expectedRevision: number;
    recipientEmail: string;
  }) => Promise<
    | { ok: true; recipient: RecipientSnapshot; replayed: boolean; refreshed: boolean }
    | { ok: false; error: NotificationErrorCode; recipient: RecipientSnapshot | null }
  >;
  reload: (
    clientAccountId: string
  ) => Promise<{ ok: true; recipient: RecipientSnapshot } | { ok: false; error: NotificationErrorCode }>;
};

function formatVerifiedAt(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  })} ET`;
}

function successMessage(
  previous: RecipientSnapshot,
  next: RecipientSnapshot,
  replayed: boolean,
  refreshed: boolean
): string {
  const changed = previous.recipientEmail !== next.recipientEmail;
  const saved = changed
    ? "Saved. The notification preference is off until it is turned on again in Team Workspace."
    : next.enabled
      ? "Saved. The recipient is verified and the notification preference is still on."
      : "Saved. The recipient is verified. The notification preference stays off until it is turned on in Team Workspace.";
  const replay = replayed ? " This matched a save that was already stored." : "";
  const follow = refreshed
    ? ""
    : " The follow-up read did not load. The address shown is the one the save confirmed.";
  return `${saved}${replay}${follow}`;
}

export function NotificationRecipientForm({
  clientAccountId,
  recipient,
  actions,
}: {
  clientAccountId: string;
  recipient: RecipientSnapshot;
  actions: RecipientFormActions;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(recipient);
  const [email, setEmail] = useState(recipient.recipientEmail ?? "");
  const [phase, setPhase] = useState<"idle" | "saving" | "loading" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<NotificationErrorCode | null>(null);
  const pendingRef = useRef(false);
  const attemptRef = useRef<{ key: string; requestId: string } | null>(null);
  const clientRef = useRef(clientAccountId);
  if (clientRef.current !== clientAccountId) {
    clientRef.current = clientAccountId;
    pendingRef.current = false;
    attemptRef.current = null;
    setConfirmed(recipient);
    setEmail(recipient.recipientEmail ?? "");
    setPhase("idle");
    setMessage(null);
    setErrorCode(null);
  }
  const verifiedLabel = formatVerifiedAt(confirmed.recipientEmailVerifiedAt);
  const saving = phase === "saving";
  const loading = phase === "loading";
  const busy = saving || loading;
  const retryable = errorCode !== null && isRetryableNotificationError(errorCode);

  async function commit(rawEmail: string) {
    if (pendingRef.current) return;
    const recipientEmail = normalizeNotificationRecipient(rawEmail);
    if (!recipientEmail) {
      setPhase("error");
      setErrorCode("invalid_recipient");
      setMessage(notificationErrorMessage("invalid_recipient"));
      return;
    }
    pendingRef.current = true;
    setPhase("saving");
    setMessage(null);
    const key = recipientSaveKey(clientAccountId, confirmed.revision, recipientEmail);
    const attempt = notificationSaveAttempt(attemptRef.current, key);
    attemptRef.current = attempt;
    const previous = confirmed;
    try {
      const result = await actions.save({
        clientAccountId,
        requestId: attempt.requestId,
        expectedRevision: confirmed.revision,
        recipientEmail,
      });
      if (result.ok) {
        attemptRef.current = null;
        setConfirmed(result.recipient);
        setEmail(result.recipient.recipientEmail ?? "");
        setPhase("saved");
        setErrorCode(null);
        setMessage(successMessage(previous, result.recipient, result.replayed, result.refreshed));
        router.refresh();
        return;
      }
      if (result.error === "revision_conflict" || result.error === "request_id_conflict") {
        attemptRef.current = null;
        if (result.recipient) {
          setConfirmed(result.recipient);
          setEmail(result.recipient.recipientEmail ?? "");
        }
      }
      setPhase("error");
      setErrorCode(result.error);
      setMessage(notificationErrorMessage(result.error));
    } finally {
      pendingRef.current = false;
    }
  }

  async function reload() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPhase("loading");
    setMessage(null);
    try {
      const result = await actions.reload(clientAccountId);
      if (!result.ok) {
        setPhase("error");
        setErrorCode(result.error);
        setMessage(notificationErrorMessage(result.error));
        return;
      }
      attemptRef.current = null;
      setConfirmed(result.recipient);
      setEmail(result.recipient.recipientEmail ?? "");
      setPhase("idle");
      setErrorCode(null);
      setMessage("Showing the saved recipient.");
      router.refresh();
    } finally {
      pendingRef.current = false;
    }
  }

  return (
    <div className="space-y-4">
      <WarningBanner tone="warn" title="Changing the recipient turns notification off">
        Saving a different address turns this notification off until it is turned on again in Team Workspace.
        {confirmed.enabled ? " It is on for the saved recipient." : " It is off now."}
      </WarningBanner>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold text-slate-950">Current recipient</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-slate-500">Address</dt>
            <dd className="mt-1 break-all text-slate-900">{confirmed.recipientEmail ?? "None saved"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Verification</dt>
            <dd className="mt-1 text-slate-900">
              {confirmed.recipientVerified ? `Verified ${verifiedLabel ?? ""}`.trim() : "Not verified"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Preference</dt>
            <dd className="mt-1 text-slate-900">{confirmed.enabled ? "On" : "Off"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-600">
          Revision {confirmed.revision}. One address. This screen does not copy a portal sign-in address and does not
          send email.
        </p>
      </section>
      <form
        noValidate
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void commit(email);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="notification-recipient">Email address</Label>
          <Input
            id="notification-recipient"
            name="delivery-notification-recipient"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            aria-invalid={errorCode === "invalid_recipient"}
            aria-describedby="notification-recipient-help"
            placeholder="name@example.com"
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p id="notification-recipient-help" className="text-xs text-slate-600">
            Enter the one mailbox that should receive a notice after a successful delivery.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="submit" disabled={busy}>
            {saving ? "Saving…" : "Save recipient"}
          </Button>
          {phase === "error" && retryable ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void commit(email);
              }}
            >
              Retry save
            </Button>
          ) : null}
          {phase === "error" && errorCode && !retryable ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void reload();
              }}
            >
              Reload saved recipient
            </Button>
          ) : null}
          <Link
            href={`/team-workspace/${encodeURIComponent(clientAccountId)}`}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800"
          >
            Open Team Workspace
          </Link>
        </div>
        <p className="text-sm text-slate-700" role="status" data-state={phase}>
          {saving ? "Saving…" : loading ? "Loading…" : message}
        </p>
      </form>
    </div>
  );
}
