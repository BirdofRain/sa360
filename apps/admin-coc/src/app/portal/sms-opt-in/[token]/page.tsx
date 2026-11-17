import type { Metadata } from "next";

import { PortalSmsOptInForm } from "@/components/client-portal/portal-sms-opt-in";
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

  async function confirmOptIn(formData: FormData) {
    "use server";
    if (!TOKEN.test(token) || formData.get("affirmDisclosure") !== "true") return;
    const base = apiBase();
    if (!base) return;
    await fetch(`${base}/public/sms-opt-in/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ affirmDisclosure: true }),
      cache: "no-store",
    }).catch(() => undefined);
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
      portalLoginRequired: false,
    };
  } catch {
    return unpublished("This link could not be checked. Consent is not on file.");
  }
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
