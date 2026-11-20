import type { PrismaClient } from "@prisma/client";

import { STAFF_ASSERTION_HEADER, verifyStaffAssertion } from "@sa360/shared/staff-assertion";

import { SHARED_ADMIN_ACTOR } from "./onboarding-staff-actor.js";

/**
 * Actor for a campaign GHL execution grant.
 * ADMIN is the shared admin key. A named staff write stores StaffPrincipal.id
 * only when the assertion verifies and the principal has admin_coc.
 * team_manager, team_workspace, and team_operations do not qualify.
 * x-sa360-admin-actor, emails, and form fields are not actors.
 */

export type CampaignGrantActorResolution =
  | { ok: true; actor: string }
  | { ok: false; statusCode: 401 | 403; error: "staff_unauthenticated" | "forbidden" };

export async function resolveCampaignGhlGrantActor(
  headers: { readonly [key: string]: string | string[] | undefined },
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env
): Promise<CampaignGrantActorResolution> {
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
            AND p.permission = 'admin_coc'::"StaffPermissionKey"
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
