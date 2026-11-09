"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { notificationSaveAttempt, preferenceSaveKey } from "@/lib/notification-setup/attempt";
import {
  isRetryableNotificationError,
  notificationErrorMessage,
  type NotificationErrorCode,
  type PreferenceSnapshot,
} from "@/lib/notification-setup/model";
import type { TeamWorkspaceNotificationChoice } from "@/lib/team-workspace/types";

export type NotificationChoiceActions = {
  save: (input: {
    clientAccountId: string;
    requestId: string;
    expectedRevision: number;
    enabled: boolean;
  }) => Promise<
    | { ok: true; preference: PreferenceSnapshot; replayed: boolean; refreshed: boolean }
    | { ok: false; error: NotificationErrorCode; preference: PreferenceSnapshot | null }
  >;
  reload: (
    clientAccountId: string
  ) => Promise<{ ok: true; preference: PreferenceSnapshot } | { ok: false; error: NotificationErrorCode }>;
};

function toChoice(snapshot: PreferenceSnapshot): TeamWorkspaceNotificationChoice {
  return { ...snapshot, readable: true };
}

function successMessage(enabled: boolean, replayed: boolean, refreshed: boolean): string {
  const saved = enabled
    ? "Saved. This client's notification preference is on."
    : "Saved. This client's notification preference is off.";
  const scope = " Production delivery notifications stay unchanged, and this page does not send email.";
  const replay = replayed ? " This matched a save that was already stored." : "";
  const follow = refreshed
    ? ""
    : " The follow-up read did not load. The choice shown is the one the save confirmed.";
  return `${saved}${scope}${replay}${follow}`;
}

export function DeliveryNotificationChoice({
  clientAccountId,
  preference,
  actions,
}: {
  clientAccountId: string;
  preference: TeamWorkspaceNotificationChoice;
  actions: NotificationChoiceActions;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(preference);
  const [phase, setPhase] = useState<"idle" | "saving" | "loading" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<NotificationErrorCode | null>(null);
  const pendingRef = useRef(false);
  const attemptRef = useRef<{ key: string; requestId: string } | null>(null);
  const intentRef = useRef<boolean | null>(null);
  const clientRef = useRef(clientAccountId);

  if (clientRef.current !== clientAccountId) {
    clientRef.current = clientAccountId;
    pendingRef.current = false;
    attemptRef.current = null;
    intentRef.current = null;
    setConfirmed(preference);
    setPhase("idle");
    setMessage(null);
    setErrorCode(null);
  }

  const saving = phase === "saving";
  const loading = phase === "loading";
  const busy = saving || loading;

  async function commit(enabled: boolean) {
    if (pendingRef.current) return;
    if (!confirmed.readable || !confirmed.canEnable) return;
    pendingRef.current = true;
    intentRef.current = enabled;
    setPhase("saving");
    setMessage(null);
    const key = preferenceSaveKey(clientAccountId, confirmed.revision, enabled);
    const attempt = notificationSaveAttempt(attemptRef.current, key);
    attemptRef.current = attempt;
    try {
      const result = await actions.save({
        clientAccountId,
        requestId: attempt.requestId,
        expectedRevision: confirmed.revision,
        enabled,
      });
      if (result.ok) {
        attemptRef.current = null;
        intentRef.current = null;
        setConfirmed(toChoice(result.preference));
        setPhase("saved");
        setErrorCode(null);
        setMessage(successMessage(result.preference.enabled, result.replayed, result.refreshed));
        router.refresh();
        return;
      }
      if (
        result.error === "revision_conflict" ||
        result.error === "request_id_conflict" ||
        result.error === "recipient_not_verified"
      ) {
        attemptRef.current = null;
        intentRef.current = null;
        if (result.preference) setConfirmed(toChoice(result.preference));
      }
      setPhase("error");
      setErrorCode(result.error);
      setMessage(notificationErrorMessage(result.error));
    } catch {
      setPhase("error");
      setErrorCode("request_failed");
      setMessage(notificationErrorMessage("request_failed"));
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
      intentRef.current = null;
      setConfirmed(toChoice(result.preference));
      setPhase("idle");
      setErrorCode(null);
      setMessage("Showing the saved choice.");
      router.refresh();
    } catch {
      setPhase("error");
      setErrorCode("request_failed");
      setMessage(notificationErrorMessage("request_failed"));
    } finally {
      pendingRef.current = false;
    }
  }

  const help = !confirmed.readable
    ? "The preference could not be read. It stays off until the read succeeds."
    : confirmed.canEnable
      ? "This changes only this client's notification preference. Production delivery notifications stay unchanged. It does not send email or change the recipient."
      : "A verified recipient has to be configured in Admin C.O.C. before this can be turned on.";

  return (
    <fieldset aria-busy={busy} className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">Client notification</legend>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={confirmed.enabled}
          disabled={busy || !confirmed.readable || !confirmed.canEnable}
          aria-label="Notify this client when a lead is successfully delivered"
          onChange={(event) => {
            void commit(event.target.checked);
          }}
        />
        <span>Notify this client when a lead is successfully delivered</span>
      </label>
      <p className="mt-2 text-xs text-slate-600">{help}</p>
      {!confirmed.canEnable ? (
        <p className="mt-2 text-xs">
          <Link
            href={`/clients/${encodeURIComponent(clientAccountId)}/notification-recipient`}
            className="font-medium text-sky-800 underline"
          >
            Open recipient setup in Admin C.O.C.
          </Link>
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {phase === "error" && errorCode && isRetryableNotificationError(errorCode) && intentRef.current !== null ? (
          <button
            type="button"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 sm:w-auto"
            onClick={() => {
              if (intentRef.current === null) return;
              void commit(intentRef.current);
            }}
          >
            Retry save
          </button>
        ) : null}
        {phase === "error" && errorCode ? (
          <button
            type="button"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 sm:w-auto"
            onClick={() => {
              void reload();
            }}
          >
            Reload saved choice
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-slate-700" role="status" data-state={phase}>
        {saving ? "Saving…" : loading ? "Loading…" : message}
      </p>
    </fieldset>
  );
}
