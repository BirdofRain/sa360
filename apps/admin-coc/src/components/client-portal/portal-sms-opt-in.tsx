"use client";

import { useState } from "react";

import { PORTAL_SMS_OPT_IN_PREVIEW, type PortalSmsOptInPreview } from "./portal-sms-disclosure";

export type { PortalSmsOptInPreview };
export { PORTAL_SMS_OPT_IN_PREVIEW };

export function PortalSmsOptInForm({
  preview,
  action,
}: {
  preview: PortalSmsOptInPreview;
  action?: (formData: FormData) => void | Promise<void>;
}) {
  const [affirmed, setAffirmed] = useState(false);
  const canSubmit = preview.recordable && affirmed && !preview.smsEnabled;

  return (
    <form className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" action={action}>
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
          <a className="underline" href={preview.privacyPolicyUrl}>
            Privacy Policy
          </a>
        ) : (
          <span>Privacy Policy is not published.</span>
        )}
        <span> · </span>
        {preview.termsUrl ? (
          <a className="underline" href={preview.termsUrl}>
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
        <span>I agree to receive these operational text messages at the mobile number on this form.</span>
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
        The checkbox starts unchecked. Portal login is not required. Submitting this form is what records consent.
        {preview.consentRecorded ? " Consent is on file." : " Consent is not on file."}{" "}
        {preview.smsEnabled ? "Texts are enabled." : "Texts are off."}
      </p>
    </form>
  );
}
