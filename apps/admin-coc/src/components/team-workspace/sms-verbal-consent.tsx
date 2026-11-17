"use client";

import { useState } from "react";

export type SmsEmailResult = "sent" | "email_not_configured" | "origin_unconfigured" | "invalid_recipient" | "not_sent";

export type SmsVerbalActionResult =
  | { ok: true; status: "pending_confirmation" | "link_only"; smsEnabled: false; consentRecorded: false; email: SmsEmailResult }
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
  const [email, setEmail] = useState<SmsEmailResult | null>(null);
  const [draft, setDraft] = useState<{ phoneE164: string; confirmationEmail: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onVerbal(formData: FormData) {
    const phoneE164 = String(formData.get("phoneE164") ?? "");
    const confirmationEmail = String(formData.get("confirmationEmail") ?? "");
    setDraft({ phoneE164, confirmationEmail });
    setPending(true);
    const result = await actions.recordVerbal({
      clientAccountId,
      phoneE164,
      affirmativeResponse: String(formData.get("affirmativeResponse") ?? ""),
      confirmationEmail,
      evidence: String(formData.get("evidence") ?? ""),
    });
    setPending(false);
    setEmail(result.ok ? result.email : null);
    setMessage(result.ok ? emailFeedback("The verbal note is pending confirmation. It is not consent and texts stay off.", result.email) : result.error);
  }

  async function onLink(formData: FormData) {
    const phoneE164 = String(formData.get("phoneE164") ?? "");
    const confirmationEmail = String(formData.get("confirmationEmail") ?? "");
    setDraft({ phoneE164, confirmationEmail });
    setPending(true);
    const result = await actions.issueLink({
      clientAccountId,
      phoneE164,
      confirmationEmail,
    });
    setPending(false);
    setEmail(result.ok ? result.email : null);
    setMessage(result.ok ? emailFeedback("A confirmation link is on file. It does not record verbal consent and texts stay off.", result.email) : result.error);
  }

  async function onRetry() {
    if (!draft || pending) return;
    setPending(true);
    const result = await actions.issueLink({ clientAccountId, ...draft });
    setPending(false);
    setEmail(result.ok ? result.email : null);
    setMessage(result.ok ? emailFeedback("The confirmation email was tried again. Texts stay off.", result.email) : result.error);
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h4 className="text-sm font-semibold text-slate-950">SMS confirmation</h4>
      <p className="text-sm text-slate-700">
        A verbal note from Matt, Alex, or Aaron stays pending confirmation. The mobile number is staff-supplied. Saving
        it does not prove handset ownership and does not record recipient consent. Texts stay off until the recipient
        checks the confirmation page. Portal login is not required.
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
      {email && email !== "sent" && draft ? (
        <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 disabled:bg-slate-100" type="button" onClick={onRetry} disabled={pending}>
          Try the confirmation email again
        </button>
      ) : null}
    </div>
  );
}

function emailFeedback(saved: string, email: SmsEmailResult): string {
  if (email === "sent") {
    return `${saved} The email provider accepted the confirmation message. Inbox delivery is not confirmed here.`;
  }
  if (email === "email_not_configured") {
    return `${saved} The confirmation email was not sent because email is not configured.`;
  }
  if (email === "origin_unconfigured") {
    return `${saved} The confirmation email was not sent because the public page origin is not configured.`;
  }
  if (email === "invalid_recipient") {
    return `${saved} The confirmation email was not sent because the address could not be used.`;
  }
  return `${saved} The confirmation email was not sent.`;
}
