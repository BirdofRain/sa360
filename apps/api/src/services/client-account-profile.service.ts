import type { Prisma } from "@prisma/client";

import {
  findClientAccountById,
  updateClientAccount,
} from "../repositories/client-account.repository.js";
import type { ClientAccountProfilePatchBody } from "../schemas/client-account-profile.schema.js";
import {
  evaluateClientProfileCompleteness,
  presentClientAccountProfile,
  type ClientAccountProfileDto,
  type ClientProfileRequiredField,
} from "./client-account-profile.present.js";

export type ClientAccountProfileServiceDeps = {
  findClientAccountByIdImpl?: typeof findClientAccountById;
  updateClientAccountImpl?: typeof updateClientAccount;
};

export type ClientAccountProfileSuccess = {
  ok: true;
  account: ClientAccountProfileDto;
};

export type ClientAccountProfileNotFound = { ok: false; notFound: true };

export type ClientAccountProfileIncomplete = {
  ok: false;
  code: "PROFILE_INCOMPLETE";
  error: string;
  account: ClientAccountProfileDto;
  missingFields: ClientProfileRequiredField[];
};

export type ClientAccountProfileNotEligible = {
  ok: false;
  code: "ACCOUNT_NOT_ELIGIBLE";
  error: string;
  account: ClientAccountProfileDto;
};

export type GetClientAccountProfileResult = ClientAccountProfileSuccess | ClientAccountProfileNotFound;

export type PatchClientAccountProfileResult = ClientAccountProfileSuccess | ClientAccountProfileNotFound;

export type CompleteClientAccountOnboardingResult =
  | ClientAccountProfileSuccess
  | ClientAccountProfileNotFound
  | ClientAccountProfileIncomplete
  | ClientAccountProfileNotEligible;

function stringListToJson(value?: string[]): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value;
}

function applyProfilePatch(
  existing: {
    clientDisplayName: string;
    portalDisplayName: string | null;
    primaryNicheKeys: unknown;
    primaryProductTypes: unknown;
  },
  patch: ClientAccountProfilePatchBody
) {
  return {
    clientDisplayName:
      patch.clientDisplayName !== undefined ? patch.clientDisplayName : existing.clientDisplayName,
    portalDisplayName:
      patch.portalDisplayName !== undefined ? patch.portalDisplayName : existing.portalDisplayName,
    primaryNicheKeys:
      patch.primaryNicheKeys !== undefined ? patch.primaryNicheKeys : existing.primaryNicheKeys,
    primaryProductTypes:
      patch.primaryProductTypes !== undefined
        ? patch.primaryProductTypes
        : existing.primaryProductTypes,
  };
}

function profileUpdateData(patch: ClientAccountProfilePatchBody): Prisma.ClientAccountUpdateInput {
  const data: Prisma.ClientAccountUpdateInput = {};
  if (patch.clientDisplayName !== undefined) data.clientDisplayName = patch.clientDisplayName;
  if (patch.portalDisplayName !== undefined) data.portalDisplayName = patch.portalDisplayName;
  if (patch.primaryNicheKeys !== undefined) {
    data.primaryNicheKeys = stringListToJson(patch.primaryNicheKeys) ?? [];
  }
  if (patch.primaryProductTypes !== undefined) {
    data.primaryProductTypes = stringListToJson(patch.primaryProductTypes) ?? [];
  }
  return data;
}

export async function getClientAccountProfile(
  clientAccountId: string,
  deps: ClientAccountProfileServiceDeps = {}
): Promise<GetClientAccountProfileResult> {
  const find = deps.findClientAccountByIdImpl ?? findClientAccountById;
  const row = await find(clientAccountId);
  if (!row) return { ok: false, notFound: true };
  return { ok: true, account: presentClientAccountProfile(row) };
}

export async function patchClientAccountProfile(
  clientAccountId: string,
  patch: ClientAccountProfilePatchBody,
  deps: ClientAccountProfileServiceDeps = {}
): Promise<PatchClientAccountProfileResult> {
  const find = deps.findClientAccountByIdImpl ?? findClientAccountById;
  const update = deps.updateClientAccountImpl ?? updateClientAccount;
  const existing = await find(clientAccountId);
  if (!existing) return { ok: false, notFound: true };

  const data = profileUpdateData(patch);
  const updated =
    Object.keys(data).length === 0 ? existing : await update(clientAccountId, data);
  return { ok: true, account: presentClientAccountProfile(updated) };
}

export async function completeClientAccountOnboarding(
  clientAccountId: string,
  patch: ClientAccountProfilePatchBody,
  deps: ClientAccountProfileServiceDeps = {}
): Promise<CompleteClientAccountOnboardingResult> {
  const find = deps.findClientAccountByIdImpl ?? findClientAccountById;
  const update = deps.updateClientAccountImpl ?? updateClientAccount;
  const existing = await find(clientAccountId);
  if (!existing) return { ok: false, notFound: true };

  const nextFields = applyProfilePatch(existing, patch);
  const completeness = evaluateClientProfileCompleteness(nextFields);

  if (existing.status === "paused" || existing.status === "archived") {
    return {
      ok: false,
      code: "ACCOUNT_NOT_ELIGIBLE",
      error: "This account is not accepting onboarding completion right now.",
      account: presentClientAccountProfile(existing),
    };
  }

  if (!completeness.complete) {
    const data = profileUpdateData(patch);
    const updated =
      Object.keys(data).length === 0 ? existing : await update(clientAccountId, data);
    const account = presentClientAccountProfile(updated);
    return {
      ok: false,
      code: "PROFILE_INCOMPLETE",
      error: "Add the required account details before finishing setup.",
      account,
      missingFields: account.missingFields,
    };
  }

  const data = profileUpdateData(patch);
  if (existing.status === "onboarding") {
    data.status = "active";
  }

  const updated =
    Object.keys(data).length === 0 ? existing : await update(clientAccountId, data);
  return { ok: true, account: presentClientAccountProfile(updated) };
}
