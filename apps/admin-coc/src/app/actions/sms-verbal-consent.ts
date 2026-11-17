"use server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { requireStaffWorkspacePermission } from "@/lib/admin-coc-session-guard";
import { normalizeTeamWorkspaceClientId } from "@/lib/team-workspace/contract";
import type { SmsVerbalActionResult } from "@/components/team-workspace/sms-verbal-consent";

const E164 = /^\+[1-9]\d{7,14}$/;

export async function recordVerbalSmsConsentAction(input: {
  clientAccountId: string;
  phoneE164: string;
  affirmativeResponse: string;
  confirmationEmail: string;
  evidence: string;
}): Promise<SmsVerbalActionResult> {
  await requireStaffWorkspacePermission("team_workspace");
  const id = normalizeTeamWorkspaceClientId(input.clientAccountId);
  if (!id || !E164.test(input.phoneE164.trim())) return { ok: false, error: "That mobile number is not valid." };
  const saved = await adminRequestJson<{
    status?: string;
    smsEnabled?: boolean;
    consentRecorded?: boolean;
    email?: string;
  }>("POST", `/admin/v1/team-workspace/clients/${encodeURIComponent(id)}/sms-verbal-consent`, {
    phoneE164: input.phoneE164.trim(),
    affirmativeResponse: input.affirmativeResponse,
    disclosureVersion: "external-webhook-sms-v2",
    confirmationEmail: input.confirmationEmail.trim(),
    evidence: input.evidence.trim() || undefined,
  });
  if (!saved.ok || saved.data.smsEnabled || saved.data.consentRecorded || saved.data.status !== "pending_confirmation") {
    return { ok: false, error: "The verbal note was not saved. Texts stay off." };
  }
  return { ok: true, status: "pending_confirmation", smsEnabled: false, consentRecorded: false, email: saved.data.email ?? "not_sent" };
}

export async function issueSmsOptInLinkAction(input: {
  clientAccountId: string;
  phoneE164: string;
  confirmationEmail: string;
}): Promise<SmsVerbalActionResult> {
  await requireStaffWorkspacePermission("team_workspace");
  const id = normalizeTeamWorkspaceClientId(input.clientAccountId);
  if (!id || !E164.test(input.phoneE164.trim())) return { ok: false, error: "That mobile number is not valid." };
  const saved = await adminRequestJson<{ smsEnabled?: boolean; consentRecorded?: boolean; email?: string }>(
    "POST",
    `/admin/v1/team-workspace/clients/${encodeURIComponent(id)}/sms-opt-in-link`,
    {
      phoneE164: input.phoneE164.trim(),
      confirmationEmail: input.confirmationEmail.trim() || undefined,
    }
  );
  if (!saved.ok || saved.data.smsEnabled || saved.data.consentRecorded) {
    return { ok: false, error: "The confirmation link was not issued. Texts stay off." };
  }
  return { ok: true, status: "link_only", smsEnabled: false, consentRecorded: false, email: saved.data.email ?? "not_sent" };
}
