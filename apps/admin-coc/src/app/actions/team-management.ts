"use server";

import { requireStaffAdministrator } from "@/lib/admin-coc-session-guard";
import {
  changeTeamAccess,
  createTeamMember,
  disableTeamMember,
  loadTeamMember,
  renewTeamInvitation,
  revokeTeamAccess,
  TeamManagementError,
} from "@/lib/team-management/server";
import type { TeamAccessLevel, TeamMemberDetail, TeamMutationResult } from "@/lib/team-management/types";

function rejected(error: unknown): TeamMutationResult {
  if (error instanceof TeamManagementError) return { ok: false, message: error.message };
  throw error;
}

export async function readTeamMemberAction(input: {
  staffPrincipalId: string;
  email: string;
}): Promise<{ ok: true; detail: TeamMemberDetail } | { ok: false; message: string }> {
  await requireStaffAdministrator();
  try {
    return { ok: true, detail: await loadTeamMember(input.staffPrincipalId, input.email) };
  } catch (error) {
    if (error instanceof TeamManagementError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function inviteTeamMemberAction(input: {
  email: string;
  accessLevel: TeamAccessLevel;
  confirmAdministrator: boolean;
}): Promise<TeamMutationResult> {
  await requireStaffAdministrator();
  try {
    return await createTeamMember(input);
  } catch (error) {
    return rejected(error);
  }
}

export async function changeTeamAccessAction(input: {
  staffPrincipalId: string;
  email: string;
  accessLevel: TeamAccessLevel;
  confirmAdministrator: boolean;
}): Promise<TeamMutationResult> {
  await requireStaffAdministrator();
  try {
    return await changeTeamAccess(input);
  } catch (error) {
    return rejected(error);
  }
}

export async function revokeTeamAccessAction(input: {
  staffPrincipalId: string;
  email: string;
}): Promise<TeamMutationResult> {
  await requireStaffAdministrator();
  try {
    return await revokeTeamAccess(input);
  } catch (error) {
    return rejected(error);
  }
}

export async function disableTeamMemberAction(input: {
  staffPrincipalId: string;
  email: string;
}): Promise<TeamMutationResult> {
  await requireStaffAdministrator();
  try {
    return await disableTeamMember(input);
  } catch (error) {
    return rejected(error);
  }
}

export async function renewTeamInvitationAction(input: {
  staffPrincipalId: string;
  email: string;
}): Promise<TeamMutationResult> {
  await requireStaffAdministrator();
  try {
    return await renewTeamInvitation(input);
  } catch (error) {
    return rejected(error);
  }
}
