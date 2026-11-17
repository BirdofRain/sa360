import type { Metadata } from "next";

import { PortalSmsOptInForm, type SmsOptInSubmitResult } from "@/components/client-portal/portal-sms-opt-in";
import {
  PORTAL_SMS_OPT_IN_PREVIEW,
  type PortalSmsOptInPreview,
} from "@/components/client-portal/portal-sms-disclosure";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm text notifications",
  description: "Confirm operational text notifications from Life Agent Launch. The checkbox starts unchecked.",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function PublicSmsOptInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = TOKEN.test(token) ? await loadPublicOptIn(token) : unpublished("This link is not valid. Consent is not on file.");

  async function confirmOptIn(formData: FormData): Promise<SmsOptInSubmitResult> {
    "use server";
    if (!TOKEN.test(token) || formData.get("affirmDisclosure") !== "true") {
      return { ok: false, message: "Check the box to confirm. Consent was not recorded." };
    }
    const base = apiBase();
    if (!base) {
      return { ok: false, message: "This page could not reach the confirmation service. Consent was not recorded." };
    }
    try {
      const response = await fetch(`${base}/public/sms-opt-in/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ affirmDisclosure: true }),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; smsEnabled?: boolean; consentRecorded?: boolean };
      if (response.ok && body.consentRecorded === true && body.smsEnabled === true) {
        return {
          ok: true,
          message: "Recipient consent is confirmed for the staff-supplied number. Texts are on. Handset ownership was not independently proven.",
        };
      }
      return { ok: false, message: confirmFailureMessage(body.error) };
    } catch {
      return { ok: false, message: "The confirmation could not be completed. Consent was not recorded and texts stay off." };
    }
  }

  return <PortalSmsOptInForm preview={preview} action={confirmOptIn} />;
}

async function loadPublicOptIn(token: string): Promise<PortalSmsOptInPreview> {
  const base = apiBase();
  if (!base) return unpublished("This link could not be checked. Consent is not on file.");
  try {
    const response = await fetch(`${base}/public/sms-opt-in/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!response.ok) return unpublished("This link is not active. Consent is not on file.");
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
      return unpublished("This link could not be checked. Consent is not on file.");
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
    return unpublished("This link could not be checked. Consent is not on file.");
  }
}

function confirmFailureMessage(error: string | undefined): string {
  if (error === "legal_urls_missing") return "Privacy Policy and Terms are not published, so consent was not recorded.";
  if (error === "stop_suppressed") return "This number is stopped. Consent was not recorded and texts stay off.";
  if (error === "token_expired" || error === "token_invalid") return "This link is not active. Consent was not recorded.";
  if (error === "disclosure_mismatch") return "The disclosure changed, so consent was not recorded.";
  return "Consent was not recorded and texts stay off.";
}

function unpublished(purpose: string): PortalSmsOptInPreview {
  return { ...PORTAL_SMS_OPT_IN_PREVIEW, purpose, recordable: false, privacyPolicyUrl: null, termsUrl: null };
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
