import type { PrismaClient } from "@prisma/client";

import { decryptGoogleToken, encryptGoogleToken } from "../../lib/google-token-encryption.js";
import {
  generateGoogleOAuthState,
  generatePkceVerifier,
  hashGoogleOAuthState,
} from "../../lib/google-oauth-state.js";
import { assertSafePortalReturnTo } from "../../lib/safe-portal-return-to.js";
import {
  consumeGoogleOAuthPendingAuthOnce,
  createGoogleOAuthPendingAuth,
  wipeConsumedGoogleOAuthPendingAuthVerifier,
} from "../../repositories/google-oauth-pending-auth.repository.js";
import { presentGoogleOAuthPendingAuth } from "./google-connection.present.js";

export const GOOGLE_OAUTH_PENDING_AUTH_TTL_MS = 15 * 60 * 1000;

export type CreateGoogleOAuthPendingAuthInput = {
  clientAccountId: string;
  returnTo?: string | null;
  pkceVerifier?: string;
  expiresAt?: Date;
};

export type CreateGoogleOAuthPendingAuthResult =
  | {
      ok: true;
      state: string;
      pending: ReturnType<typeof presentGoogleOAuthPendingAuth>;
    }
  | { ok: false; reason: "invalid_return_to" | "invalid_input" };

export async function createGoogleOAuthPendingAuthForClient(
  input: CreateGoogleOAuthPendingAuthInput,
  db?: PrismaClient
): Promise<CreateGoogleOAuthPendingAuthResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, reason: "invalid_input" };

  let returnTo: string;
  try {
    returnTo = assertSafePortalReturnTo(input.returnTo);
  } catch {
    return { ok: false, reason: "invalid_return_to" };
  }

  const { rawState, stateHash } = generateGoogleOAuthState();
  const pkceVerifier = input.pkceVerifier?.trim() || generatePkceVerifier();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + GOOGLE_OAUTH_PENDING_AUTH_TTL_MS);

  const row = await createGoogleOAuthPendingAuth(
    {
      clientAccount: { connect: { clientAccountId } },
      stateHash,
      pkceVerifierEncrypted: encryptGoogleToken(pkceVerifier),
      returnTo,
      expiresAt,
    },
    db
  );

  return {
    ok: true,
    state: rawState,
    pending: presentGoogleOAuthPendingAuth(row),
  };
}

export type ConsumeGoogleOAuthPendingAuthServiceResult =
  | {
      ok: true;
      pending: ReturnType<typeof presentGoogleOAuthPendingAuth>;
      pkceVerifier: string;
      returnTo: string;
    }
  | {
      ok: false;
      reason: "not_found" | "tenant_mismatch" | "expired" | "already_consumed" | "invalid_input";
    };

/**
 * Consume pending auth for the bound ClientAccount only. Raw state is hashed
 * for lookup; the PKCE verifier is decrypted in memory and then wiped from disk.
 */
export async function consumeGoogleOAuthPendingAuthForClient(
  input: { rawState: string; clientAccountId: string; now?: Date },
  db?: PrismaClient
): Promise<ConsumeGoogleOAuthPendingAuthServiceResult> {
  const rawState = input.rawState.trim();
  const clientAccountId = input.clientAccountId.trim();
  if (!rawState || !clientAccountId) return { ok: false, reason: "invalid_input" };

  const consumed = await consumeGoogleOAuthPendingAuthOnce(
    {
      stateHash: hashGoogleOAuthState(rawState),
      clientAccountId,
      now: input.now,
    },
    db
  );

  if (!consumed.ok) return consumed;

  let pkceVerifier: string;
  try {
    pkceVerifier = decryptGoogleToken(consumed.row.pkceVerifierEncrypted);
  } catch {
    return { ok: false, reason: "not_found" };
  }

  await wipeConsumedGoogleOAuthPendingAuthVerifier(
    { id: consumed.row.id, clientAccountId },
    db
  );

  return {
    ok: true,
    pending: presentGoogleOAuthPendingAuth({ ...consumed.row, consumedAt: input.now ?? new Date() }),
    pkceVerifier,
    returnTo: consumed.row.returnTo,
  };
}
