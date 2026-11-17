"use client";

import { useState } from "react";

export type SmsVerbalActionResult =
  | { ok: true; status: "pending_confirmation" | "link_only"; smsEnabled: false; consentRecorded: false; email: string }
  | { ok: false; error: string };

export type SmsVerbalActions = {
  recordVerbal: (input: {
    clientAccountId: string;
    phoneE164: string;
    affirmativeResponse: string;
    confirmationEmail: string;
    evidence: string;
  }) => Promise<SmsVerbalActionResult>;
  issueLink: (input: {
    clientAccountId: string;
    phoneE164: string;
    confirmationEmail: string;
  }) => Promise<SmsVerbalActionResult>;
};

export function SmsVerbalConsentPanel({
  clientAccountId,
  actions,
}: {
  clientAccountId: string;
  actions: SmsVerbalActions;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onVerbal(formData: FormData) {
    setPending(true);
    const result = await actions.recordVerbal({
      clientAccountId,
      phoneE164: String(formData.get("phoneE164") ?? ""),
      affirmativeResponse: String(formData.get("affirmativeResponse") ?? ""),
      confirmationEmail: String(formData.get("confirmationEmail") ?? ""),
      evidence: String(formData.get("evidence") ?? ""),
    });
    setPending(false);
    setMessage(
      result.ok
        ? "Saved as pending confirmation. Texts stay off until the recipient checks the confirmation page. This note is not consent."
        : result.error
    );
  }

  async function onLink(formData: FormData) {
    setPending(true);
    const result = await actions.issueLink({
      clientAccountId,
      phoneE164: String(formData.get("phoneE164") ?? ""),
      confirmationEmail: String(formData.get("confirmationEmail") ?? ""),
    });
    setPending(false);
    setMessage(
      result.ok
        ? "A confirmation link was offered. It does not record verbal consent, and texts stay off until the recipient submits the page."
        : result.error
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h4 className="text-sm font-semibold text-slate-950">SMS confirmation</h4>
      <p className="text-sm text-slate-700">
        A verbal note from Matt, Alex, or Aaron stays pending confirmation. It does not enable texts. The recipient
        confirms on a one-time link, with the checkbox unchecked until they choose it. Portal login is not required.
      </p>
      <form className="space-y-2">
        <input className="w-full rounded border border-slate-300 px-2 py-1 text-sm" name="phoneE164" placeholder="+1..." aria-label="Mobile number" />
        <textarea className="w-full rounded border border-slate-300 px-2 py-1 text-sm" name="affirmativeResponse" aria-label="Affirmative response" placeholder="The words the recipient actually said" />
        <input className="w-full rounded border border-slate-300 px-2 py-1 text-sm" name="confirmationEmail" aria-label="Confirmation email" placeholder="recipient@example.com" />
        <input className="w-full rounded border border-slate-300 px-2 py-1 text-sm" name="evidence" aria-label="Supporting evidence" placeholder="Call note or other evidence" />
        <div className="flex flex-wrap gap-2">
          <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:bg-slate-300" type="submit" formAction={onVerbal} disabled={pending}>
            Save pending verbal note
          </button>
          <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 disabled:bg-slate-100" type="submit" formAction={onLink} disabled={pending}>
            Send confirmation link only
          </button>
        </div>
      </form>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}
