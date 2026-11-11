import "server-only";

import { cookies } from "next/headers";

import { readStaffGoogleBrowserConfig } from "@sa360/shared/staff-google-oidc";
import { STAFF_GOOGLE_SERVICE_HEADER, readStaffGoogleServiceSecret } from "@sa360/shared/staff-google-service";
import { STAFF_SESSION_COOKIE, STAFF_SESSION_HEADER } from "@sa360/shared/staff-google-session";

import { requireStaffAdministrator } from "@/lib/admin-coc-session-guard";
import { readStaffAdminCocOrigin } from "@/lib/staff-admin-coc-decision";

import type { TeamAccessLevel, TeamMember, TeamMemberDetail, TeamMutationResult } from "./types";

export function staffSignInUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const config = readStaffGoogleBrowserConfig(env);
  if (!config) return null;
  try {
    return `${new URL(config.redirectUri).origin}/staff/google/start`;
  } catch {
    return null;
  }
}

export async function loadTeamDirectory(): Promise<{ members: TeamMember[]; signInUrl: string | null }> {
  const result = await teamRequest<{ members: TeamMember[] }>("/internal/staff/team/members", {});
  if (!result.ok) throw new TeamManagementError(result.message);
  return { members: result.data.members, signInUrl: staffSignInUrl() };
}

export async function loadTeamMember(staffPrincipalId: string, email: string): Promise<TeamMemberDetail> {
  const result = await teamRequest<TeamMemberDetail>("/internal/staff/team/members/get", { staffPrincipalId, email });
  if (!result.ok) throw new TeamManagementError(result.message);
  return result.data;
}

export async function createTeamMember(input: {
  email: string;
  accessLevel: TeamAccessLevel;
  confirmAdministrator: boolean;
}): Promise<TeamMutationResult> {
  const result = await teamRequest<{ member: TeamMember; emailDelivery: string; emailDetail: string }>(
    "/internal/staff/team/members/create",
    { ...input, signInUrl: staffSignInUrl() }
  );
  if (!result.ok) return result;
  return { ok: true, member: result.data.member, message: invitationMessage(result.data.emailDelivery, result.data.emailDetail) };
}

export async function changeTeamAccess(input: {
  staffPrincipalId: string;
  email: string;
  accessLevel: TeamAccessLevel;
  confirmAdministrator: boolean;
}): Promise<TeamMutationResult> {
  const result = await teamRequest<{ member: TeamMember }>("/internal/staff/team/members/access", input);
  if (!result.ok) return result;
  return { ok: true, member: result.data.member, message: "Access updated." };
}

export async function revokeTeamAccess(input: { staffPrincipalId: string; email: string }): Promise<TeamMutationResult> {
  const result = await teamRequest<{ member: TeamMember }>("/internal/staff/team/members/revoke", { ...input, confirm: true });
  if (!result.ok) return result;
  return { ok: true, member: result.data.member, message: "Permissions revoked. Existing grants stay in the audit history." };
}

export async function disableTeamMember(input: { staffPrincipalId: string; email: string }): Promise<TeamMutationResult> {
  const result = await teamRequest<{ member: TeamMember }>("/internal/staff/team/members/disable", { ...input, confirm: true });
  if (!result.ok) return result;
  return { ok: true, member: result.data.member, message: "Account disabled. Sign-in is now denied." };
}

export async function renewTeamInvitation(input: { staffPrincipalId: string; email: string }): Promise<TeamMutationResult> {
  const result = await teamRequest<{ member: TeamMember; emailDelivery: string; emailDetail: string }>(
    "/internal/staff/team/members/invitation/renew",
    { ...input, signInUrl: staffSignInUrl() }
  );
  if (!result.ok) return result;
  return { ok: true, member: result.data.member, message: invitationMessage(result.data.emailDelivery, result.data.emailDetail) };
}

export class TeamManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamManagementError";
  }
}

async function teamRequest<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  await requireStaffAdministrator();
  const env = process.env;
  const origin = readStaffAdminCocOrigin(env.SA360_API_INTERNAL_URL ?? env.NEXT_PUBLIC_SA360_API_BASE_URL);
  const serviceSecret = readStaffGoogleServiceSecret(env);
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  if (!origin || !serviceSecret || !token) {
    return { ok: false, message: "Staff sign-in is not configured for team management." };
  }
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [STAFF_GOOGLE_SERVICE_HEADER]: serviceSecret,
        [STAFF_SESSION_HEADER]: token,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return { ok: false, message: "The team service could not be reached. Nothing was changed." };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    return { ok: false, message: messageForCode(codeOf(payload), response.status) };
  }
  return { ok: true, data: payload as T };
}

function codeOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const code = (payload as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z0-9_]{1,80}$/.test(code) ? code : null;
}

function messageForCode(code: string | null, status: number): string {
  if (code === "duplicate") return "An account with that email already exists.";
  if (code === "confirmation_required") return "Administrator access needs the confirmation checkbox.";
  if (code === "forbidden" || status === 403) return "This Google session cannot manage the team.";
  if (code === "disabled") return "That account is disabled.";
  if (code === "already_bound") return "That person has already connected a Google account.";
  if (code === "expired") return "That invitation is expired. Renew it and send the sign-in link again.";
  if (code === "email_mismatch") return "That email does not match the selected person.";
  if (code === "unavailable" || status === 503) return "The team service is unavailable. Nothing was changed.";
  if (status === 404) return "Team management is not enabled on the API.";
  return "The team request was rejected. Check the company email and try again.";
}

function invitationMessage(delivery: string, detail: string): string {
  if (delivery === "sent") return "Invitation recorded and the sign-in email was sent.";
  if (detail === "not_configured") {
    return "Invitation recorded. Email is not configured, so no message was sent. Copy the sign-in link.";
  }
  if (detail === "delivery_failed") {
    return "Invitation recorded, but the email was not sent. Copy the sign-in link.";
  }
  return "Invitation recorded. No email was sent. Copy the sign-in link.";
}
