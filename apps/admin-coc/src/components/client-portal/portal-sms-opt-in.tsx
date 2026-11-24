"use client";

import { useRef, useState, type FormEvent } from "react";

import { PORTAL_SMS_OPT_IN_PREVIEW, type PortalSmsOptInPreview } from "./portal-sms-disclosure";

export type { PortalSmsOptInPreview };
export { PORTAL_SMS_OPT_IN_PREVIEW };

export type SmsOptInOutcome = "confirmed" | "declined" | "unknown";

export type SmsOptInSubmitResult = { ok: boolean; outcome: SmsOptInOutcome; message: string };

export const SMS_OPT_IN_UNKNOWN_MESSAGE =
  "The confirmation result cannot be confirmed. It may already have been recorded. This page will not send the request again.";

export function PortalSmsOptInForm({
  preview,
  action,
  reconcile,
}: {
  preview: PortalSmsOptInPreview;
  action?: (formData: FormData) => Promise<SmsOptInSubmitResult>;
  reconcile?: () => Promise<SmsOptInSubmitResult>;
}) {
  const [affirmed, setAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SmsOptInSubmitResult | null>(null);
  const lock = useRef(false);
  const unknown = result?.outcome === "unknown" || preview.statusKnown === false;
  const replacingPrior = preview.priorProgram === "external-webhook-sms-v1" || preview.priorProgram === "external-webhook-sms-v2";
  const canSubmit = preview.recordable && affirmed && (replacingPrior || !preview.smsEnabled) && !submitting && !result?.ok && !unknown;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!action) return;
    event.preventDefault();
    if (lock.current || result?.ok) return;
    if (!affirmed) {
      setResult({ ok: false, outcome: "declined", message: "Check the box to confirm. Nothing was submitted." });
      return;
    }
    lock.current = true;
    setSubmitting(true);
    try {
      const outcome = await action(new FormData(event.currentTarget));
      setResult(outcome);
      if (outcome.outcome === "declined") lock.current = false;
    } catch {
      setResult({ ok: false, outcome: "unknown", message: SMS_OPT_IN_UNKNOWN_MESSAGE });
    } finally {
      setSubmitting(false);
    }
  }

  async function onReconcile() {
    if (!reconcile || submitting) return;
    setSubmitting(true);
    try {
      const outcome = await reconcile();
      setResult(outcome);
      lock.current = outcome.outcome !== "declined";
    } catch {
      lock.current = true;
      setResult({ ok: false, outcome: "unknown", message: SMS_OPT_IN_UNKNOWN_MESSAGE });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" onSubmit={onSubmit}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Text notifications</h1>
        <p className="mt-1 text-sm text-slate-600">
          {preview.businessName} can send {preview.program} texts for this purpose: {preview.purpose}.
        </p>
      </div>
      <ul className="space-y-1 text-sm text-slate-700">
        <li>{preview.frequency}</li>
        <li>{preview.rates}</li>
        <li>{preview.stop}</li>
        <li>{preview.help}</li>
      </ul>
      <p className="text-sm text-slate-700">
        {preview.privacyPolicyUrl ? (
          <a className="underline" href={preview.privacyPolicyUrl} rel="noreferrer">
            Privacy Policy
          </a>
        ) : (
          <span>Privacy Policy is not published.</span>
        )}
        <span> · </span>
        {preview.termsUrl ? (
          <a className="underline" href={preview.termsUrl} rel="noreferrer">
            Terms
          </a>
        ) : (
          <span>Terms are not published.</span>
        )}
      </p>
      <label className="flex items-start gap-3 text-sm text-slate-800">
        <input
          className="mt-1"
          type="checkbox"
          name="affirmDisclosure"
          value="true"
          checked={affirmed}
          onChange={(event) => setAffirmed(event.target.checked)}
        />
        <span>
          {replacingPrior
            ? "I agree to the GoHighLevel lead notice above. This is a new consent. My earlier delivery-webhook consent stays on file and is not deleted."
            : "I agree to receive these operational text messages at the mobile number on this form."}
        </span>
      </label>
      {preview.phoneMasked ? (
        <p className="text-sm text-slate-700">Mobile number on this link: {preview.phoneMasked}</p>
      ) : (
        <label className="block text-sm text-slate-700">
          Mobile number
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            name="phoneE164"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1..."
          />
        </label>
      )}
      <button
        className="min-h-10 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300"
        type="submit"
        disabled={!canSubmit}
      >
        Continue
      </button>
      <p className="text-sm text-slate-600">
        The checkbox starts unchecked. Portal login is not required. Submitting this form is what records recipient
        consent. {preview.phoneMasked ? "This number was supplied by staff. It is not proof that the handset sent a message. " : ""}
        {preview.statusKnown === false
          ? "This page cannot show whether consent was recorded. "
          : unknown
            ? "The confirmation result cannot be confirmed from this page. "
            : preview.consentRecorded || result?.outcome === "confirmed"
              ? "Recipient consent is confirmed. "
              : "Recipient consent is not confirmed. "}
        {preview.statusKnown === false
          ? ""
          : preview.handsetProven
            ? "Handset ownership is independently proven. "
            : "Handset ownership is not independently proven. "}
        {unknown ? "" : preview.smsEnabled || result?.outcome === "confirmed" ? "Texts are on." : "Texts are off."}
      </p>
      {result ? <p className="text-sm text-slate-800">{result.message}</p> : null}
      {unknown && reconcile ? (
        <button
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 disabled:bg-slate-100"
          type="button"
          onClick={onReconcile}
          disabled={submitting}
        >
          Check the saved result
        </button>
      ) : null}
    </form>
  );
}
