"use server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { requireStaffWorkspacePermission } from "@/lib/admin-coc-session-guard";
import { normalizeTeamWorkspaceClientId } from "@/lib/team-workspace/contract";
import { tryNormalizeSmsConsentPhone } from "@/lib/sms-consent-phone";
import type { SmsConsentStatusResult, SmsEmailResult, SmsVerbalActionResult } from "@/components/team-workspace/sms-verbal-consent";

const E164 = /^\+[1-9]\d{7,14}$/;

function canonicalSmsPhone(raw: string): string | null {
  const normalized = tryNormalizeSmsConsentPhone(raw);
  if (!normalized.ok || !E164.test(normalized.e164)) return null;
  return normalized.e164;
}

export async function recordVerbalSmsConsentAction(input: {
  clientAccountId: string;
  phoneE164: string;
  affirmativeResponse: string;
  confirmationEmail: string;
  evidence: string;
}): Promise<SmsVerbalActionResult> {
  await requireStaffWorkspacePermission("team_workspace");
  const id = normalizeTeamWorkspaceClientId(input.clientAccountId);
  const phoneE164 = canonicalSmsPhone(input.phoneE164);
  if (!id || !phoneE164) return { ok: false, error: "That mobile number is not valid." };
  const saved = await adminRequestJson<{
    status?: string;
    smsEnabled?: boolean;
    consentRecorded?: boolean;
    email?: string;
  }>("POST", `/admin/v1/team-workspace/clients/${encodeURIComponent(id)}/sms-verbal-consent`, {
    phoneE164,
    affirmativeResponse: input.affirmativeResponse,
    disclosureVersion: "ghl-lead-sms-v1",
    confirmationEmail: input.confirmationEmail.trim(),
    evidence: input.evidence.trim() || undefined,
  });
  if (!saved.ok || saved.data.smsEnabled || saved.data.consentRecorded || saved.data.status !== "pending_confirmation") {
    return { ok: false, error: "The verbal note was not saved. Texts stay off." };
  }
  return { ok: true, status: "pending_confirmation", smsEnabled: false, consentRecorded: false, email: emailResult(saved.data.email) };
}

export async function issueSmsOptInLinkAction(input: {
  clientAccountId: string;
  phoneE164: string;
  confirmationEmail: string;
}): Promise<SmsVerbalActionResult> {
  await requireStaffWorkspacePermission("team_workspace");
  const id = normalizeTeamWorkspaceClientId(input.clientAccountId);
  const phoneE164 = canonicalSmsPhone(input.phoneE164);
  if (!id || !phoneE164) return { ok: false, error: "That mobile number is not valid." };
  const saved = await adminRequestJson<{ smsEnabled?: boolean; consentRecorded?: boolean; email?: string }>(
    "POST",
    `/admin/v1/team-workspace/clients/${encodeURIComponent(id)}/sms-opt-in-link`,
    {
      phoneE164,
      confirmationEmail: input.confirmationEmail.trim() || undefined,
    }
  );
  if (!saved.ok || saved.data.smsEnabled || saved.data.consentRecorded) {
    return { ok: false, error: "The confirmation link was not issued. Texts stay off." };
  }
  return { ok: true, status: "link_only", smsEnabled: false, consentRecorded: false, email: emailResult(saved.data.email) };
}

export async function readSmsConsentStatusAction(input: { clientAccountId: string }): Promise<SmsConsentStatusResult> {
  await requireStaffWorkspacePermission("team_workspace");
  const id = normalizeTeamWorkspaceClientId(input.clientAccountId);
  if (!id) return { ok: false, error: "That client could not be checked." };
  const read = await adminRequestJson<{
    recipientConsentConfirmed?: boolean;
    smsEnabled?: boolean;
    handsetOwnershipProven?: boolean;
    suppression?: string;
    linkOutstanding?: boolean;
    numberOnFile?: boolean;
  }>("GET", `/admin/v1/team-workspace/clients/${encodeURIComponent(id)}/sms-consent-status`);
  if (!read.ok) return { ok: false, error: "The confirmation status could not be checked. Nothing was sent." };
  return {
    ok: true,
    recipientConsentConfirmed: read.data.recipientConsentConfirmed === true,
    smsEnabled: read.data.smsEnabled === true,
    handsetOwnershipProven: read.data.handsetOwnershipProven === true,
    suppression: read.data.suppression === "suppressed" ? "suppressed" : read.data.suppression === "clear" ? "clear" : "unknown",
    linkOutstanding: read.data.linkOutstanding === true,
    numberOnFile: read.data.numberOnFile === true,
  };
}

function emailResult(value: string | undefined): SmsEmailResult {
  if (value === "sent" || value === "email_not_configured" || value === "origin_unconfigured" || value === "invalid_recipient") {
    return value;
  }
  return "not_sent";
}
