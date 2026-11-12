import type { PrismaClient } from "@prisma/client";

import { STAFF_ASSERTION_HEADER, verifyStaffAssertion } from "@sa360/shared/staff-assertion";

/**
 * Actor stored on onboarding setup audits and configuration requests.
 * ADMIN is the shared admin key. A named staff write stores StaffPrincipal.id.
 * The id comes from a verified staff assertion plus a live principal read.
 * x-sa360-admin-actor, emails, and form fields are not actors.
 */

export const SHARED_ADMIN_ACTOR = "ADMIN";

const PRINCIPAL_ACTOR = /^c[a-z0-9]{24}$/;

export type OnboardingActorResolution =
  | { ok: true; actor: string }
  | { ok: false; statusCode: 401 | 403; error: "staff_unauthenticated" | "forbidden" };

export function acceptedOnboardingActor(actor: string | undefined): string | null {
  const value = actor ?? SHARED_ADMIN_ACTOR;
  if (value === SHARED_ADMIN_ACTOR || PRINCIPAL_ACTOR.test(value)) return value;
  return null;
}

/**
 * Resolve the actor for one onboarding write.
 * No assertion header means the shared admin key. A present header must verify
 * and match a live bound principal who may write. Failure does not become ADMIN.
 */
export async function resolveOnboardingStaffActor(
  headers: { readonly [key: string]: string | string[] | undefined },
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env
): Promise<OnboardingActorResolution> {
  const token = assertionToken(headers);
  if (token === undefined) return { ok: true, actor: SHARED_ADMIN_ACTOR };
  if (token === null) return { ok: false, statusCode: 401, error: "staff_unauthenticated" };
  const verified = verifyStaffAssertion(token, { env });
  if (!verified.ok) return { ok: false, statusCode: 401, error: "staff_unauthenticated" };
  try {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT s.id
      FROM "StaffPrincipal" s
      WHERE s.id = ${verified.claims.sub}
        AND s.status = 'active'::"StaffPrincipalStatus"
        AND s."disabledAt" IS NULL
        AND s.provider = 'google'::"StaffIdentityProvider"
        AND s."providerSubject" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "StaffPermission" p
          WHERE p."staffPrincipalId" = s.id
            AND p.status = 'granted'::"StaffPermissionStatus"
            AND p."revokedAt" IS NULL
            AND p.permission IN (
              'team_manager'::"StaffPermissionKey",
              'admin_coc'::"StaffPermissionKey"
            )
        )
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.id !== verified.claims.sub) return { ok: false, statusCode: 403, error: "forbidden" };
    return { ok: true, actor: row.id };
  } catch {
    return { ok: false, statusCode: 403, error: "forbidden" };
  }
}

function assertionToken(
  headers: { readonly [key: string]: string | string[] | undefined }
): string | null | undefined {
  const raw = headers[STAFF_ASSERTION_HEADER];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return raw;
}
