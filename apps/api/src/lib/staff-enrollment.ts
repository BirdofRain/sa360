import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createStaffEnrollmentSecret,
  staffEnrollmentSecretDigest,
  STAFF_ENROLLMENT_TTL_SECONDS,
} from "@sa360/shared/staff-enrollment";

import { prisma as defaultPrisma } from "./db.js";

/**
 * Provision, invite, cancel, disable, and bind a staff principal.
 * Binding writes providerSubject once. It does not grant a permission,
 * clear a binding, or accept a caller-selected principal id.
 */

const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,}$/;
const SUB_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;
const PRINCIPAL_PATTERN = /^c[a-z0-9]{24}$/;

export type StaffEnrollmentCode =
  | "rejected"
  | "missing_principal"
  | "disabled"
  | "already_bound"
  | "expired"
  | "canceled"
  | "reused"
  | "email_mismatch"
  | "unverified_email"
  | "collision"
  | "unavailable";

export type StaffEnrollmentResult = { ok: true; staffPrincipalId: string } | { ok: false; code: StaffEnrollmentCode };

type EnrollmentDb = PrismaClient;

class EnrollmentAbort extends Error {
  constructor(readonly code: StaffEnrollmentCode) {
    super(code);
    this.name = "EnrollmentAbort";
  }
}

export async function provisionUnboundStaffPrincipal(
  input: { email: string; displayName?: string | null },
  db: EnrollmentDb = defaultPrisma
): Promise<StaffEnrollmentResult> {
  const email = normalizeEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName);
  if (!email || displayName === false) return { ok: false, code: "rejected" };
  try {
    const row = await db.staffPrincipal.create({
      data: {
        email,
        displayName,
        status: "active",
        disabledAt: null,
        provider: "google",
        providerSubject: null,
        emailVerified: false,
      },
      select: { id: true },
    });
    return { ok: true, staffPrincipalId: row.id };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, code: "rejected" };
    return { ok: false, code: "unavailable" };
  }
}

export async function issueStaffEnrollment(
  input: { staffPrincipalId: string; now?: Date },
  db: EnrollmentDb = defaultPrisma
): Promise<
  | { ok: true; staffPrincipalId: string; grantId: string; enrollmentSecret: string; expiresAt: Date }
  | { ok: false; code: StaffEnrollmentCode }
> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId)) return { ok: false, code: "rejected" };
  const secret = createStaffEnrollmentSecret();
  const digest = staffEnrollmentSecretDigest(secret);
  if (!digest) return { ok: false, code: "unavailable" };
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + STAFF_ENROLLMENT_TTL_SECONDS * 1000);
  try {
    return await db.$transaction(async (tx) => {
      const principal = await lockPrincipal(tx, input.staffPrincipalId);
      if (!principal) return { ok: false as const, code: "missing_principal" as const };
      const usable = usablePrincipal(principal);
      if (!usable.ok) return usable;
      const pending = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "StaffEnrollmentGrant"
        WHERE "staffPrincipalId" = ${principal.id} AND status = 'pending'::"StaffEnrollmentGrantStatus"
        LIMIT 1
      `;
      if (pending.length > 0) return { ok: false as const, code: "rejected" as const };
      const grant = await tx.staffEnrollmentGrant.create({
        data: {
          staffPrincipalId: principal.id,
          secretDigest: digest,
          status: "pending",
          expiresAt,
          createdAt: now,
        },
        select: { id: true },
      });
      await tx.staffEnrollmentEvent.create({
        data: { grantId: grant.id, staffPrincipalId: principal.id, kind: "issued", createdAt: now },
      });
      return {
        ok: true as const,
        staffPrincipalId: principal.id,
        grantId: grant.id,
        enrollmentSecret: secret,
        expiresAt,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, code: "rejected" };
    return { ok: false, code: "unavailable" };
  }
}

export async function cancelStaffEnrollment(
  input: { grantId: string; now?: Date },
  db: EnrollmentDb = defaultPrisma
): Promise<{ ok: true } | { ok: false; code: StaffEnrollmentCode }> {
  if (!PRINCIPAL_PATTERN.test(input.grantId) && !/^c[a-z0-9]{20,32}$/.test(input.grantId)) {
    return { ok: false, code: "rejected" };
  }
  const now = input.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; staffPrincipalId: string; status: string }>>`
        SELECT id, "staffPrincipalId", status::text AS status
        FROM "StaffEnrollmentGrant"
        WHERE id = ${input.grantId}
        FOR UPDATE
      `;
      const grant = rows[0];
      if (!grant) return { ok: false as const, code: "rejected" as const };
      if (grant.status === "canceled") return { ok: true as const };
      if (grant.status === "consumed") return { ok: false as const, code: "reused" as const };
      const updated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "StaffEnrollmentGrant"
        SET status = 'canceled'::"StaffEnrollmentGrantStatus",
            "canceledAt" = ${now},
            "updatedAt" = ${now}
        WHERE id = ${grant.id}
          AND status = 'pending'::"StaffEnrollmentGrantStatus"
          AND "canceledAt" IS NULL
          AND "consumedAt" IS NULL
        RETURNING id
      `;
      if (updated.length !== 1) throw new EnrollmentAbort("rejected");
      await tx.staffEnrollmentEvent.create({
        data: { grantId: grant.id, staffPrincipalId: grant.staffPrincipalId, kind: "canceled", createdAt: now },
      });
      return { ok: true as const };
    });
  } catch (err) {
    if (err instanceof EnrollmentAbort) return { ok: false, code: err.code };
    return { ok: false, code: "unavailable" };
  }
}

export async function disableStaffPrincipal(
  input: { staffPrincipalId: string; now?: Date },
  db: EnrollmentDb = defaultPrisma
): Promise<StaffEnrollmentResult> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId)) return { ok: false, code: "rejected" };
  const now = input.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const principal = await lockPrincipal(tx, input.staffPrincipalId);
      if (!principal) return { ok: false as const, code: "missing_principal" as const };
      if (principal.status === "disabled" && principal.disabledAt != null) {
        return { ok: true as const, staffPrincipalId: principal.id };
      }
      const updated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "StaffPrincipal"
        SET status = 'disabled'::"StaffPrincipalStatus",
            "disabledAt" = ${now},
            "updatedAt" = ${now}
        WHERE id = ${principal.id}
          AND status = 'active'::"StaffPrincipalStatus"
          AND "disabledAt" IS NULL
          AND provider = 'google'::"StaffIdentityProvider"
          AND "providerSubject" IS NOT DISTINCT FROM ${principal.providerSubject}
        RETURNING id
      `;
      if (updated.length !== 1) throw new EnrollmentAbort("rejected");
      return { ok: true as const, staffPrincipalId: principal.id };
    });
  } catch (err) {
    if (err instanceof EnrollmentAbort) return { ok: false, code: err.code };
    return { ok: false, code: "unavailable" };
  }
}

export async function readStaffEnrollmentStatus(
  input: { staffPrincipalId: string },
  db: EnrollmentDb = defaultPrisma
): Promise<
  | {
      ok: true;
      staffPrincipalId: string;
      email: string;
      status: "active" | "disabled";
      providerSubject: string | null;
      pendingGrantId: string | null;
    }
  | { ok: false; code: StaffEnrollmentCode }
> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId)) return { ok: false, code: "rejected" };
  try {
    const principal = await db.staffPrincipal.findUnique({
      where: { id: input.staffPrincipalId },
      select: { id: true, email: true, status: true, provider: true, providerSubject: true },
    });
    if (!principal || principal.provider !== "google") return { ok: false, code: "missing_principal" };
    const pending = await db.staffEnrollmentGrant.findFirst({
      where: { staffPrincipalId: principal.id, status: "pending" },
      select: { id: true },
    });
    return {
      ok: true,
      staffPrincipalId: principal.id,
      email: principal.email,
      status: principal.status === "active" ? "active" : "disabled",
      providerSubject: principal.providerSubject,
      pendingGrantId: pending?.id ?? null,
    };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function previewStaffEnrollment(
  input: { enrollmentSecret: string; now?: Date },
  db: EnrollmentDb = defaultPrisma
): Promise<{ ok: true } | { ok: false; code: StaffEnrollmentCode }> {
  const looked = await lookupGrant(input.enrollmentSecret, input.now ?? new Date(), db);
  if (!looked.ok) return looked;
  return { ok: true };
}

export async function bindStaffEnrollment(
  input: {
    enrollmentSecret: string;
    identity: { sub: string; email: string; emailVerified: boolean };
    now?: Date;
  },
  db: EnrollmentDb = defaultPrisma
): Promise<StaffEnrollmentResult> {
  if (input.identity.emailVerified !== true) return { ok: false, code: "unverified_email" };
  const email = normalizeEmail(input.identity.email);
  const digest = staffEnrollmentSecretDigest(input.enrollmentSecret);
  if (!email || !digest || !SUB_PATTERN.test(input.identity.sub)) return { ok: false, code: "rejected" };
  const now = input.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const grants = await tx.$queryRaw<
        Array<{ id: string; staffPrincipalId: string; status: string; expiresAt: Date; canceledAt: Date | null; consumedAt: Date | null }>
      >`
        SELECT id, "staffPrincipalId", status::text AS status, "expiresAt", "canceledAt", "consumedAt"
        FROM "StaffEnrollmentGrant"
        WHERE "secretDigest" = ${digest}
        FOR UPDATE
      `;
      const grant = grants[0];
      if (!grant) return { ok: false as const, code: "rejected" as const };
      if (grant.status === "canceled" || grant.canceledAt) return { ok: false as const, code: "canceled" as const };
      if (grant.status === "consumed" || grant.consumedAt) return { ok: false as const, code: "reused" as const };
      if (grant.expiresAt.getTime() <= now.getTime()) return { ok: false as const, code: "expired" as const };
      const principal = await lockPrincipal(tx, grant.staffPrincipalId);
      if (!principal) throw new EnrollmentAbort("missing_principal");
      if (principal.status !== "active" || principal.disabledAt != null || principal.provider !== "google") {
        return { ok: false as const, code: "disabled" as const };
      }
      if (principal.providerSubject) return { ok: false as const, code: "already_bound" as const };
      if (principal.email !== email) return { ok: false as const, code: "email_mismatch" as const };
      const bound = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "StaffPrincipal"
        SET "providerSubject" = ${input.identity.sub},
            "emailVerified" = true,
            "updatedAt" = ${now}
        WHERE id = ${principal.id}
          AND provider = 'google'::"StaffIdentityProvider"
          AND "providerSubject" IS NULL
          AND status = 'active'::"StaffPrincipalStatus"
          AND "disabledAt" IS NULL
          AND email = ${email}
        RETURNING id
      `;
      if (bound.length !== 1) throw new EnrollmentAbort("already_bound");
      const consumed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "StaffEnrollmentGrant"
        SET status = 'consumed'::"StaffEnrollmentGrantStatus",
            "consumedAt" = ${now},
            "updatedAt" = ${now}
        WHERE id = ${grant.id}
          AND "staffPrincipalId" = ${principal.id}
          AND status = 'pending'::"StaffEnrollmentGrantStatus"
          AND "canceledAt" IS NULL
          AND "consumedAt" IS NULL
          AND "expiresAt" > ${now}
        RETURNING id
      `;
      if (consumed.length !== 1) throw new EnrollmentAbort("expired");
      await tx.staffEnrollmentEvent.create({
        data: {
          grantId: grant.id,
          staffPrincipalId: principal.id,
          kind: "consumed",
          googleSub: input.identity.sub,
          createdAt: now,
        },
      });
      return { ok: true as const, staffPrincipalId: principal.id };
    });
  } catch (err) {
    if (err instanceof EnrollmentAbort) return { ok: false, code: err.code };
    if (isUniqueViolation(err)) return { ok: false, code: "collision" };
    return { ok: false, code: "unavailable" };
  }
}

async function lookupGrant(
  secret: string,
  now: Date,
  db: EnrollmentDb
): Promise<{ ok: true } | { ok: false; code: StaffEnrollmentCode }> {
  const digest = staffEnrollmentSecretDigest(secret);
  if (!digest) return { ok: false, code: "rejected" };
  try {
    const grants = await db.$queryRaw<
      Array<{ staffPrincipalId: string; status: string; expiresAt: Date; canceledAt: Date | null; consumedAt: Date | null }>
    >`
      SELECT "staffPrincipalId", status::text AS status, "expiresAt", "canceledAt", "consumedAt"
      FROM "StaffEnrollmentGrant"
      WHERE "secretDigest" = ${digest}
      LIMIT 1
    `;
    const grant = grants[0];
    if (!grant) return { ok: false, code: "rejected" };
    if (grant.status === "canceled" || grant.canceledAt) return { ok: false, code: "canceled" };
    if (grant.status === "consumed" || grant.consumedAt) return { ok: false, code: "reused" };
    if (grant.expiresAt.getTime() <= now.getTime()) return { ok: false, code: "expired" };
    const principal = await db.staffPrincipal.findUnique({
      where: { id: grant.staffPrincipalId },
      select: { status: true, disabledAt: true, provider: true, providerSubject: true },
    });
    if (!principal || principal.provider !== "google") return { ok: false, code: "missing_principal" };
    if (principal.status !== "active" || principal.disabledAt != null) return { ok: false, code: "disabled" };
    if (principal.providerSubject) return { ok: false, code: "already_bound" };
    return { ok: true };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

type LockedPrincipal = {
  id: string;
  email: string;
  status: string;
  provider: string;
  providerSubject: string | null;
  disabledAt: Date | null;
};

async function lockPrincipal(tx: Prisma.TransactionClient, id: string): Promise<LockedPrincipal | null> {
  const rows = await tx.$queryRaw<LockedPrincipal[]>`
    SELECT id, email, status::text AS status, provider::text AS provider, "providerSubject", "disabledAt"
    FROM "StaffPrincipal"
    WHERE id = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function usablePrincipal(principal: LockedPrincipal): { ok: true } | { ok: false; code: StaffEnrollmentCode } {
  if (principal.provider !== "google") return { ok: false, code: "rejected" };
  if (principal.status !== "active" || principal.disabledAt != null) return { ok: false, code: "disabled" };
  if (principal.providerSubject) return { ok: false, code: "already_bound" };
  return { ok: true };
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 320 || email.includes(" ")) return null;
  return email;
}

function normalizeDisplayName(value: string | null | undefined): string | null | false {
  if (value == null || value === "") return null;
  const displayName = value.trim();
  if (displayName.length < 1 || displayName.length > 200 || displayName !== value.trim()) return false;
  return displayName;
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2010")) {
    return err.code === "P2002" || JSON.stringify(err.meta ?? {}).includes("23505");
  }
  const text = err instanceof Error ? err.message : String(err);
  return text.includes("23505") || text.includes("StaffPrincipal_provider_subject_key") || text.includes("StaffEnrollmentGrant_one_pending_key");
}
