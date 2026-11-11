import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "./db.js";

/**
 * Explicit full Admin C.O.C. grant for one staff principal.
 * A Google session, an email, or a principal row does not create this grant.
 * facebook_association_correction is a different permission and is never written here.
 */

export const STAFF_ADMIN_COC_PERMISSION = "admin_coc" as const;

const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,}$/;
const SUB_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;
const PRINCIPAL_PATTERN = /^c[a-z0-9]{24}$/;

export type StaffAdminCocCode =
  | "rejected"
  | "missing_principal"
  | "email_mismatch"
  | "disabled"
  | "unbound"
  | "missing_grant"
  | "unavailable";

type AdminDb = PrismaClient | Prisma.TransactionClient;

type LockedPrincipal = {
  id: string;
  email: string;
  status: string;
  provider: string;
  providerSubject: string | null;
  disabledAt: Date | null;
};

export type StaffAdminCocGrantRecord = {
  staffPermissionId: string;
  staffPrincipalId: string;
  email: string;
  permission: typeof STAFF_ADMIN_COC_PERMISSION;
  status: "granted" | "revoked";
  grantedAt: Date;
  revokedAt: Date | null;
};

export async function grantStaffAdminCoc(
  input: { staffPrincipalId: string; email: string; now?: Date },
  db: PrismaClient = defaultPrisma
): Promise<{ ok: true; grant: StaffAdminCocGrantRecord; alreadyGranted: boolean } | { ok: false; code: StaffAdminCocCode }> {
  const email = normalizeEmail(input.email);
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId) || !email) return { ok: false, code: "rejected" };
  const now = input.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockPrincipal(tx, input.staffPrincipalId);
      const usable = usableForGrant(locked, email);
      if (!usable.ok) return usable;
      const principal = usable.principal;
      const existing = await grantedRow(tx, principal.id);
      if (existing) {
        return {
          ok: true as const,
          alreadyGranted: true,
          grant: toRecord(existing, principal.id, principal.email, "granted"),
        };
      }
      const created = await tx.staffPermission.create({
        data: {
          staffPrincipalId: principal.id,
          permission: STAFF_ADMIN_COC_PERMISSION,
          status: "granted",
          grantedAt: now,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true, grantedAt: true, revokedAt: true },
      });
      return {
        ok: true as const,
        alreadyGranted: false,
        grant: {
          staffPermissionId: created.id,
          staffPrincipalId: principal.id,
          email: principal.email,
          permission: STAFF_ADMIN_COC_PERMISSION,
          status: "granted" as const,
          grantedAt: created.grantedAt,
          revokedAt: null,
        },
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await grantedRow(db, input.staffPrincipalId);
      const principal = await db.staffPrincipal.findUnique({
        where: { id: input.staffPrincipalId },
        select: { email: true },
      });
      if (existing && principal) {
        return {
          ok: true,
          alreadyGranted: true,
          grant: toRecord(existing, input.staffPrincipalId, principal.email, "granted"),
        };
      }
    }
    return { ok: false, code: "unavailable" };
  }
}

export async function revokeStaffAdminCoc(
  input: { staffPrincipalId: string; email: string; now?: Date },
  db: PrismaClient = defaultPrisma
): Promise<{ ok: true; grant: StaffAdminCocGrantRecord } | { ok: false; code: StaffAdminCocCode }> {
  const email = normalizeEmail(input.email);
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId) || !email) return { ok: false, code: "rejected" };
  const now = input.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const principal = await lockPrincipal(tx, input.staffPrincipalId);
      if (!principal || principal.provider !== "google") return { ok: false as const, code: "missing_principal" as const };
      if (principal.email !== email) return { ok: false as const, code: "email_mismatch" as const };
      const current = await grantedRow(tx, principal.id);
      if (!current) return { ok: false as const, code: "missing_grant" as const };
      const revoked = await tx.$queryRaw<Array<{ id: string; grantedAt: Date; revokedAt: Date }>>`
        UPDATE "StaffPermission"
        SET status = 'revoked'::"StaffPermissionStatus",
            "revokedAt" = ${now},
            "updatedAt" = ${now}
        WHERE id = ${current.id}
          AND "staffPrincipalId" = ${principal.id}
          AND permission = 'admin_coc'::"StaffPermissionKey"
          AND status = 'granted'::"StaffPermissionStatus"
          AND "revokedAt" IS NULL
        RETURNING id, "grantedAt", "revokedAt"
      `;
      const row = revoked[0];
      if (!row?.revokedAt) return { ok: false as const, code: "unavailable" as const };
      return {
        ok: true as const,
        grant: {
          staffPermissionId: row.id,
          staffPrincipalId: principal.id,
          email: principal.email,
          permission: STAFF_ADMIN_COC_PERMISSION,
          status: "revoked" as const,
          grantedAt: row.grantedAt,
          revokedAt: row.revokedAt,
        },
      };
    });
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/**
 * Live authorization predicate. The caller has already verified the session
 * signature, expiry, and Redis registration. This still re-reads the principal
 * and the grant so a disabled principal or a revoked row cannot pass.
 */
export async function staffAdminCocAllows(
  input: { staffPrincipalId: string; googleSub: string },
  db: PrismaClient = defaultPrisma
): Promise<"allowed" | "absent" | "unavailable"> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId) || !SUB_PATTERN.test(input.googleSub)) return "absent";
  try {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT p.id
      FROM "StaffPermission" p
      JOIN "StaffPrincipal" s ON s.id = p."staffPrincipalId"
      WHERE p."staffPrincipalId" = ${input.staffPrincipalId}
        AND p.permission = 'admin_coc'::"StaffPermissionKey"
        AND p.status = 'granted'::"StaffPermissionStatus"
        AND p."revokedAt" IS NULL
        AND s.status = 'active'::"StaffPrincipalStatus"
        AND s."disabledAt" IS NULL
        AND s.provider = 'google'::"StaffIdentityProvider"
        AND s."providerSubject" = ${input.googleSub}
      LIMIT 1
    `;
    return rows.length === 1 ? "allowed" : "absent";
  } catch {
    return "unavailable";
  }
}

export async function readStaffAdminCocStatus(
  input: { staffPrincipalId: string },
  db: PrismaClient = defaultPrisma
): Promise<
  | {
      ok: true;
      staffPrincipalId: string;
      email: string;
      status: "active" | "disabled";
      providerSubject: string | null;
      adminCoc: "granted" | "absent";
      staffPermissionId: string | null;
    }
  | { ok: false; code: StaffAdminCocCode }
> {
  if (!PRINCIPAL_PATTERN.test(input.staffPrincipalId)) return { ok: false, code: "rejected" };
  try {
    const principal = await db.staffPrincipal.findUnique({
      where: { id: input.staffPrincipalId },
      select: { id: true, email: true, status: true, provider: true, providerSubject: true, disabledAt: true },
    });
    if (!principal || principal.provider !== "google") return { ok: false, code: "missing_principal" };
    const grant = await grantedRow(db, principal.id);
    const active = principal.status === "active" && principal.disabledAt == null;
    return {
      ok: true,
      staffPrincipalId: principal.id,
      email: principal.email,
      status: active ? "active" : "disabled",
      providerSubject: principal.providerSubject,
      adminCoc: grant ? "granted" : "absent",
      staffPermissionId: grant?.id ?? null,
    };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

function usableForGrant(
  principal: LockedPrincipal | null,
  email: string
): { ok: true; principal: LockedPrincipal } | { ok: false; code: StaffAdminCocCode } {
  if (!principal || principal.provider !== "google") return { ok: false, code: "missing_principal" };
  if (principal.email !== email) return { ok: false, code: "email_mismatch" };
  if (principal.status !== "active" || principal.disabledAt != null) return { ok: false, code: "disabled" };
  if (!principal.providerSubject || !SUB_PATTERN.test(principal.providerSubject)) return { ok: false, code: "unbound" };
  return { ok: true, principal };
}

async function grantedRow(
  db: AdminDb,
  staffPrincipalId: string
): Promise<{ id: string; grantedAt: Date; revokedAt: Date | null } | null> {
  return db.staffPermission.findFirst({
    where: {
      staffPrincipalId,
      permission: STAFF_ADMIN_COC_PERMISSION,
      status: "granted",
      revokedAt: null,
    },
    select: { id: true, grantedAt: true, revokedAt: true },
  });
}

function toRecord(
  row: { id: string; grantedAt: Date; revokedAt: Date | null },
  staffPrincipalId: string,
  email: string,
  status: "granted" | "revoked"
): StaffAdminCocGrantRecord {
  return {
    staffPermissionId: row.id,
    staffPrincipalId,
    email,
    permission: STAFF_ADMIN_COC_PERMISSION,
    status,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
  };
}

async function lockPrincipal(tx: Prisma.TransactionClient, id: string): Promise<LockedPrincipal | null> {
  const rows = await tx.$queryRaw<LockedPrincipal[]>`
    SELECT id, email, status::text AS status, provider::text AS provider, "providerSubject", "disabledAt"
    FROM "StaffPrincipal"
    WHERE id = ${id}
    FOR UPDATE
  `;
  const row = rows[0] ?? null;
  return row;
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 320 || email.includes(" ")) return null;
  return email;
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return true;
  const text = err instanceof Error ? err.message : String(err);
  return text.includes("23505") || text.includes("StaffPermission_one_effective_grant_key");
}
