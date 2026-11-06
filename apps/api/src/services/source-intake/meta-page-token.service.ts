import type { MetaGraphCredentialKind, MetaGraphCredentialStatus, Prisma } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  decryptMetaToken,
  encryptMetaToken,
  isMetaTokenEncryptionConfigured,
  metaTokenFingerprint,
  redactMetaSecretText,
} from "../../lib/meta-token-encryption.js";
import {
  resolveMetaPageAccessToken,
  type MetaPageTokenConfig,
  type MetaPageTokenResolution,
} from "../../lib/meta-webhook.js";
import { readFacebookId } from "./facebook-form-association.js";

/**
 * Scopes required to read a Lead Ads lead with a Page or System User token.
 * An empty stored scope list means diagnostics have not run yet, so the fetch
 * is allowed and Graph's own permission error remains the classifier.
 */
export const META_LEAD_RETRIEVAL_SCOPES = [
  "leads_retrieval",
  "pages_manage_ads",
  "pages_read_engagement",
] as const;

const NUMERIC_PAGE_ID = /^[0-9]{5,32}$/;

export type MetaPageCredentialPublic = {
  id: string;
  kind: MetaGraphCredentialKind;
  label: string;
  tokenFingerprint: string;
  tokenVersion: number;
  appId: string | null;
  expiresAt: string | null;
  scopes: string[];
  status: MetaGraphCredentialStatus;
  lastCheckedAt: string | null;
  lastDiagnostic: string | null;
  pages: Array<{ pageId: string; pageName: string | null; captureEnabled: boolean }>;
};

export type MetaPageGrantInput = {
  pageId: string;
  pageName?: string | null;
  captureEnabled?: boolean;
};

type GrantWithCredential = {
  pageId: string;
  captureEnabled: boolean;
  credential: {
    id: string;
    status: MetaGraphCredentialStatus;
    expiresAt: Date | null;
    scopes: Prisma.JsonValue;
    tokenCiphertext: string;
    tokenFingerprint: string;
    lastDiagnostic: string | null;
  };
};

export type MetaPageTokenDeps = {
  findGrantImpl?: (pageId: string) => Promise<GrantWithCredential | null>;
  now?: () => Date;
};

function scopesOf(value: Prisma.JsonValue | string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) scopes.push(item);
  }
  return scopes;
}

function fail(
  reason: Extract<MetaPageTokenResolution, { ok: false }>["reason"],
  diagnostic: string,
  credentialId?: string
): MetaPageTokenResolution {
  return {
    ok: false,
    reason,
    diagnostic: redactMetaSecretText(diagnostic),
    ...(credentialId ? { credentialId } : {}),
  };
}

/**
 * Select the Graph token for one notification Page.
 *
 * Order:
 * 1. A stored grant for this exact numeric Page ID, if one exists. A disabled
 *    grant, expired token, or missing scope fails closed and does not fall
 *    through to another Page's token or the env token.
 * 2. The env token, only when it is bound to this Page, or when the explicit
 *    unbound opt-in is on.
 * Non-numeric Page IDs skip the database so unit fixtures keep using the env
 * resolver. Production Meta Page IDs are numeric.
 */
export async function resolveMetaCapturePageToken(
  pageId: string | null | undefined,
  config: MetaPageTokenConfig,
  deps: MetaPageTokenDeps = {}
): Promise<MetaPageTokenResolution> {
  const requested = pageId?.trim() || "";
  if (NUMERIC_PAGE_ID.test(requested)) {
    const findGrant = deps.findGrantImpl ?? defaultFindGrant;
    const grant = await findGrant(requested);
    if (grant) return resolutionFromGrant(grant, (deps.now ?? (() => new Date()))());
  }
  return resolveMetaPageAccessToken(pageId, config);
}

async function defaultFindGrant(pageId: string): Promise<GrantWithCredential | null> {
  const row = await prisma.metaPageCaptureGrant.findUnique({
    where: { pageId },
    select: {
      pageId: true,
      captureEnabled: true,
      credential: {
        select: {
          id: true,
          status: true,
          expiresAt: true,
          scopes: true,
          tokenCiphertext: true,
          tokenFingerprint: true,
          lastDiagnostic: true,
        },
      },
    },
  });
  return row;
}

function resolutionFromGrant(grant: GrantWithCredential, now: Date): MetaPageTokenResolution {
  const credentialId = grant.credential.id;
  if (!grant.captureEnabled) {
    return fail(
      "capture_not_allowlisted",
      `Page ${grant.pageId} has a stored Meta credential, but its capture grant is disabled. Graph was not called. Enable the Page capture grant when this Page is ready for the batch, then requeue. Global intake flags were not changed.`,
      credentialId
    );
  }
  if (grant.credential.status === "disabled") {
    return fail(
      "credential_disabled",
      `The Meta credential for Page ${grant.pageId} is disabled. Graph was not called. Rotate or re-enable the credential, then requeue.`,
      credentialId
    );
  }
  if (grant.credential.status === "revoked") {
    return fail(
      "credential_revoked",
      `The Meta credential for Page ${grant.pageId} is revoked. Graph was not called. Store a replacement token, then requeue.`,
      credentialId
    );
  }
  if (grant.credential.status === "expired" || grant.credential.status === "missing_permission") {
    return fail(
      grant.credential.status === "expired" ? "token_expired" : "missing_permission",
      grant.credential.lastDiagnostic?.trim() ||
        `The Meta credential for Page ${grant.pageId} is ${grant.credential.status}. Graph was not called. Repair the token or scopes, then requeue.`,
      credentialId
    );
  }
  if (grant.credential.expiresAt && grant.credential.expiresAt.getTime() <= now.getTime()) {
    return fail(
      "token_expired",
      `The Meta credential for Page ${grant.pageId} expired at ${grant.credential.expiresAt.toISOString()}. Graph was not called. Rotate the token, then requeue.`,
      credentialId
    );
  }
  const scopes = scopesOf(grant.credential.scopes);
  if (scopes.length > 0) {
    const missing = META_LEAD_RETRIEVAL_SCOPES.filter((scope) => !scopes.includes(scope));
    if (missing.length > 0) {
      return fail(
        "missing_permission",
        `The Meta credential for Page ${grant.pageId} is missing ${missing.join(", ")}. Graph was not called. Grant those permissions, update the stored scopes, then requeue.`,
        credentialId
      );
    }
  }
  let accessToken: string;
  try {
    accessToken = decryptMetaToken(grant.credential.tokenCiphertext);
  } catch {
    return fail(
      "credential_unreadable",
      `The Meta credential for Page ${grant.pageId} could not be decrypted. Graph was not called. Confirm META_TOKEN_ENCRYPTION_KEY matches the key used to store it, then requeue.`,
      credentialId
    );
  }
  return {
    ok: true,
    accessToken,
    scope: "page_bound",
    source: "stored_page",
    credentialId,
    tokenFingerprint: grant.credential.tokenFingerprint,
  };
}

const publicCredentialSelect = {
  id: true,
  kind: true,
  label: true,
  tokenFingerprint: true,
  tokenVersion: true,
  appId: true,
  expiresAt: true,
  scopes: true,
  status: true,
  lastCheckedAt: true,
  lastDiagnostic: true,
  pageGrants: {
    select: { pageId: true, pageName: true, captureEnabled: true },
    orderBy: { pageId: "asc" as const },
  },
} satisfies Prisma.MetaGraphCredentialSelect;

type PublicCredentialRow = Prisma.MetaGraphCredentialGetPayload<{ select: typeof publicCredentialSelect }>;

export function toPublicMetaCredential(row: PublicCredentialRow): MetaPageCredentialPublic {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    tokenFingerprint: row.tokenFingerprint,
    tokenVersion: row.tokenVersion,
    appId: row.appId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    scopes: scopesOf(row.scopes),
    status: row.status,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastDiagnostic: row.lastDiagnostic,
    pages: row.pageGrants.map((page) => ({
      pageId: page.pageId,
      pageName: page.pageName,
      captureEnabled: page.captureEnabled,
    })),
  };
}

export type CredentialWriteResult =
  | { ok: true; credential: MetaPageCredentialPublic }
  | { ok: false; error: "encryption_not_configured" | "invalid_page" | "page_grant_exists" | "not_found" | "invalid_token" };

function cleanPages(pages: MetaPageGrantInput[]): { ok: true; pages: Array<{ pageId: string; pageName: string | null; captureEnabled: boolean }> } | { ok: false; error: "invalid_page" } {
  const seen = new Set<string>();
  const cleaned = [];
  for (const page of pages) {
    const id = readFacebookId(page.pageId);
    if (!id.ok) return { ok: false, error: "invalid_page" };
    if (seen.has(id.value)) return { ok: false, error: "invalid_page" };
    seen.add(id.value);
    const name = page.pageName?.trim() || null;
    cleaned.push({
      pageId: id.value,
      pageName: name,
      captureEnabled: page.captureEnabled === true,
    });
  }
  return { ok: true, pages: cleaned };
}

async function loadPublic(id: string): Promise<MetaPageCredentialPublic | null> {
  const row = await prisma.metaGraphCredential.findUnique({
    where: { id },
    select: publicCredentialSelect,
  });
  return row ? toPublicMetaCredential(row) : null;
}

export async function createMetaPageCredential(input: {
  kind: MetaGraphCredentialKind;
  label: string;
  accessToken: string;
  appId?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
  pages: MetaPageGrantInput[];
}): Promise<CredentialWriteResult> {
  if (!isMetaTokenEncryptionConfigured()) return { ok: false, error: "encryption_not_configured" };
  const token = input.accessToken.trim();
  if (token.length < 20 || token.length > 4096) return { ok: false, error: "invalid_token" };
  const pages = cleanPages(input.pages);
  if (!pages.ok) return pages;
  if (pages.pages.length === 0) return { ok: false, error: "invalid_page" };
  const ciphertext = encryptMetaToken(token);
  const fingerprint = metaTokenFingerprint(token);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const credential = await tx.metaGraphCredential.create({
        data: {
          kind: input.kind,
          label: input.label.trim().slice(0, 120),
          tokenCiphertext: ciphertext,
          tokenFingerprint: fingerprint,
          appId: input.appId?.trim() || null,
          expiresAt: input.expiresAt ?? null,
          scopes: input.scopes ?? [],
          status: "active",
        },
      });
      await tx.metaPageCaptureGrant.createMany({
        data: pages.pages.map((page) => ({
          pageId: page.pageId,
          pageName: page.pageName,
          credentialId: credential.id,
          captureEnabled: page.captureEnabled,
        })),
      });
      return credential.id;
    });
    const credential = await loadPublic(created);
    if (!credential) return { ok: false, error: "not_found" };
    return { ok: true, credential };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "page_grant_exists" };
    throw err;
  }
}

export async function rotateMetaPageCredential(input: {
  credentialId: string;
  accessToken: string;
  expiresAt?: Date | null;
  scopes?: string[];
  appId?: string | null;
}): Promise<CredentialWriteResult> {
  if (!isMetaTokenEncryptionConfigured()) return { ok: false, error: "encryption_not_configured" };
  const token = input.accessToken.trim();
  if (token.length < 20 || token.length > 4096) return { ok: false, error: "invalid_token" };
  const existing = await prisma.metaGraphCredential.findUnique({
    where: { id: input.credentialId },
    select: { id: true, tokenVersion: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  await prisma.metaGraphCredential.update({
    where: { id: existing.id },
    data: {
      tokenCiphertext: encryptMetaToken(token),
      tokenFingerprint: metaTokenFingerprint(token),
      tokenVersion: existing.tokenVersion + 1,
      expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt,
      scopes: input.scopes === undefined ? undefined : input.scopes,
      appId: input.appId === undefined ? undefined : input.appId?.trim() || null,
      status: "active",
      lastDiagnostic: null,
    },
  });
  const credential = await loadPublic(existing.id);
  if (!credential) return { ok: false, error: "not_found" };
  return { ok: true, credential };
}

export async function addMetaPageGrant(input: {
  credentialId: string;
  pageId: string;
  pageName?: string | null;
  captureEnabled?: boolean;
}): Promise<CredentialWriteResult> {
  const pages = cleanPages([input]);
  if (!pages.ok) return pages;
  const page = pages.pages[0];
  if (!page) return { ok: false, error: "invalid_page" };
  const credential = await prisma.metaGraphCredential.findUnique({
    where: { id: input.credentialId },
    select: { id: true },
  });
  if (!credential) return { ok: false, error: "not_found" };
  try {
    await prisma.metaPageCaptureGrant.create({
      data: {
        pageId: page.pageId,
        pageName: page.pageName,
        credentialId: credential.id,
        captureEnabled: page.captureEnabled,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "page_grant_exists" };
    throw err;
  }
  const loaded = await loadPublic(credential.id);
  if (!loaded) return { ok: false, error: "not_found" };
  return { ok: true, credential: loaded };
}

export async function updateMetaPageGrant(input: {
  pageId: string;
  captureEnabled?: boolean;
  credentialId?: string;
  pageName?: string | null;
}): Promise<CredentialWriteResult | { ok: false; error: "invalid_page" | "not_found" | "page_grant_exists" }> {
  const page = readFacebookId(input.pageId);
  if (!page.ok) return { ok: false, error: "invalid_page" };
  const existing = await prisma.metaPageCaptureGrant.findUnique({
    where: { pageId: page.value },
    select: { id: true, credentialId: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (input.credentialId && input.credentialId !== existing.credentialId) {
    const next = await prisma.metaGraphCredential.findUnique({
      where: { id: input.credentialId },
      select: { id: true },
    });
    if (!next) return { ok: false, error: "not_found" };
  }
  await prisma.metaPageCaptureGrant.update({
    where: { id: existing.id },
    data: {
      ...(input.captureEnabled === undefined ? {} : { captureEnabled: input.captureEnabled }),
      ...(input.credentialId ? { credentialId: input.credentialId } : {}),
      ...(input.pageName === undefined ? {} : { pageName: input.pageName?.trim() || null }),
    },
  });
  const credentialId = input.credentialId ?? existing.credentialId;
  const loaded = await loadPublic(credentialId);
  if (!loaded) return { ok: false, error: "not_found" };
  return { ok: true, credential: loaded };
}

export async function listMetaPageCredentials(): Promise<MetaPageCredentialPublic[]> {
  const rows = await prisma.metaGraphCredential.findMany({
    select: publicCredentialSelect,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPublicMetaCredential);
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002");
}
