import type { Metadata } from "next";

import {
  PortalSmsOptInForm,
  SMS_OPT_IN_UNKNOWN_MESSAGE,
  type SmsOptInSubmitResult,
} from "@/components/client-portal/portal-sms-opt-in";
import {
  PORTAL_SMS_OPT_IN_PREVIEW,
  type PortalSmsOptInPreview,
} from "@/components/client-portal/portal-sms-disclosure";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm text notifications",
  description: "Confirm operational text notifications from Life Agent Launch. The checkbox starts unchecked.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function PublicSmsOptInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = TOKEN.test(token) ? await loadPublicOptIn(token) : unpublished(LINK_CANNOT_SHOW);

  async function confirmOptIn(formData: FormData): Promise<SmsOptInSubmitResult> {
    "use server";
    if (!TOKEN.test(token) || formData.get("affirmDisclosure") !== "true") {
      return { ok: false, outcome: "declined", message: "Check the box to confirm. Nothing was submitted." };
    }
    const base = apiBase();
    if (!base) {
      return { ok: false, outcome: "unknown", message: SMS_OPT_IN_UNKNOWN_MESSAGE };
    }
    try {
      const response = await fetch(`${base}/public/sms-opt-in/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ affirmDisclosure: true }),
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      return await confirmationResult(response);
    } catch {
      return { ok: false, outcome: "unknown", message: SMS_OPT_IN_UNKNOWN_MESSAGE };
    }
  }

  async function reconcileOptIn(): Promise<SmsOptInSubmitResult> {
    "use server";
    if (!TOKEN.test(token)) {
      return { ok: false, outcome: "unknown", message: LINK_CANNOT_SHOW };
    }
    const base = apiBase();
    if (!base) return { ok: false, outcome: "unknown", message: SMS_OPT_IN_UNKNOWN_MESSAGE };
    try {
      const response = await fetch(`${base}/public/sms-opt-in/${encodeURIComponent(token)}`, {
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const body = (await response.json().catch(() => null)) as {
        recipientConsentConfirmed?: boolean;
        smsEnabled?: boolean;
      } | null;
      if (response.ok && body?.recipientConsentConfirmed === false) {
        return {
          ok: false,
          outcome: "declined",
          message: "Recipient consent is not confirmed. Texts are off. You can submit this form once.",
        };
      }
      if (response.ok && body?.recipientConsentConfirmed === true && body.smsEnabled === true) {
        return {
          ok: true,
          outcome: "confirmed",
          message:
            "Recipient consent is confirmed for the staff-supplied number. Texts are on. Handset ownership was not independently proven.",
        };
      }
      return { ok: false, outcome: "unknown", message: LINK_CANNOT_SHOW };
    } catch {
      return { ok: false, outcome: "unknown", message: SMS_OPT_IN_UNKNOWN_MESSAGE };
    }
  }

  return <PortalSmsOptInForm preview={preview} action={confirmOptIn} reconcile={reconcileOptIn} />;
}

const LINK_CANNOT_SHOW =
  "This link cannot show whether consent was recorded. A used link stays used. An authorized operator can check the account.";

async function confirmationResult(response: Response): Promise<SmsOptInSubmitResult> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    smsEnabled?: boolean;
    consentRecorded?: boolean;
  } | null;
  if (response.ok && body?.consentRecorded === true && body.smsEnabled === true) {
    return {
      ok: true,
      outcome: "confirmed",
      message:
        "Recipient consent is confirmed for the staff-supplied number. Texts are on. Handset ownership was not independently proven.",
    };
  }
  if (response.status >= 500 || !body || typeof body.error !== "string") {
    return { ok: false, outcome: "unknown", message: SMS_OPT_IN_UNKNOWN_MESSAGE };
  }
  const declined = confirmFailureMessage(body.error);
  if (!declined) return { ok: false, outcome: "unknown", message: SMS_OPT_IN_UNKNOWN_MESSAGE };
  return { ok: false, outcome: "declined", message: declined };
}

async function loadPublicOptIn(token: string): Promise<PortalSmsOptInPreview> {
  const base = apiBase();
  if (!base) return unpublished(LINK_CANNOT_SHOW);
  try {
    const response = await fetch(`${base}/public/sms-opt-in/${encodeURIComponent(token)}`, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) return unpublished(LINK_CANNOT_SHOW);
    const body = (await response.json()) as {
      disclosure?: Partial<PortalSmsOptInPreview>;
      phoneMasked?: string;
      phoneSource?: "staff_supplied" | "not_recorded";
      handsetOwnershipProven?: boolean;
      consentRecorded?: boolean;
      smsEnabled?: boolean;
    };
    const disclosure = body.disclosure;
    if (!disclosure?.businessName || !disclosure.frequency || !disclosure.rates || !disclosure.stop || !disclosure.help) {
      return unpublished(LINK_CANNOT_SHOW);
    }
    return {
      ...PORTAL_SMS_OPT_IN_PREVIEW,
      ...disclosure,
      privacyPolicyUrl: disclosure.privacyPolicyUrl ?? null,
      termsUrl: disclosure.termsUrl ?? null,
      recordable: disclosure.recordable === true,
      consentRecorded: body.consentRecorded === true,
      smsEnabled: body.smsEnabled === true,
      phoneMasked: body.phoneMasked ?? null,
      phoneSource: body.phoneSource === "staff_supplied" ? "staff_supplied" : "not_recorded",
      handsetProven: body.handsetOwnershipProven === true,
      portalLoginRequired: false,
    };
  } catch {
    return unpublished(LINK_CANNOT_SHOW);
  }
}

function confirmFailureMessage(error: string): string | null {
  if (error === "legal_urls_missing") return "Privacy Policy and Terms are not published, so consent was not recorded.";
  if (error === "stop_suppressed") return "This number is stopped. Consent was not recorded and texts stay off.";
  if (error === "token_expired" || error === "token_invalid") return null;
  if (error === "consent_not_affirmed") return "Check the box to confirm. Nothing was submitted.";
  if (error === "disclosure_mismatch") return "The disclosure changed, so consent was not recorded.";
  if (error === "prior_consent_retained") return "Earlier consent is unchanged. This form did not replace it.";
  return null;
}

function unpublished(purpose: string): PortalSmsOptInPreview {
  return {
    ...PORTAL_SMS_OPT_IN_PREVIEW,
    purpose,
    recordable: false,
    privacyPolicyUrl: null,
    termsUrl: null,
    statusKnown: false,
  };
}

function apiBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_SA360_API_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
