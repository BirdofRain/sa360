"use server";

import { requireAdminCocAdminSession, requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import {
  postAdminActivateOngoingGhl,
  postAdminSelectedGhlDelivery,
} from "@/lib/admin-api/server";
import type { GhlWalkthroughExecution } from "@/components/clients/onboarding/ghl-walkthrough-types";

export async function activateOngoingGhlDeliveryAction(
  clientAccountId: string,
  requestId: string,
  confirmation: string
): Promise<
  | {
      ok: true;
      alreadyActive: boolean;
      omittedCoreFields: string[];
      omittedOptionalFields: string[];
    }
  | { ok: false; error: string }
> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const res = await postAdminActivateOngoingGhl(clientAccountId, { requestId, confirmation });
  if (!res.data?.ok) return { ok: false, error: res.error ?? res.data?.error ?? "Ongoing GHL delivery was not enabled." };
  return {
    ok: true,
    alreadyActive: res.data.alreadyActive === true,
    omittedCoreFields: res.data.omittedCoreFields ?? [],
    omittedOptionalFields: res.data.omittedOptionalFields ?? [],
  };
}

export async function testSelectedGhlDeliveryAction(
  clientAccountId: string,
  planId: string,
  confirmation: string
): Promise<
  | { ok: true; result: GhlWalkthroughExecution }
  | { ok: false; error: string; result?: GhlWalkthroughExecution }
> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const res = await postAdminSelectedGhlDelivery(clientAccountId, { planId, confirmation });
  if (!res.data) return { ok: false, error: res.error ?? "GHL test was not recorded." };
  const result: GhlWalkthroughExecution = {
    status: res.data.status ?? res.data.reason,
    contactIdGhl: res.data.contactIdGhl,
    opportunityIdGhl: res.data.opportunityIdGhl,
    workflowStarted: res.data.workflowStarted,
    externalCallExecuted: res.data.externalCallExecuted,
    errors: res.data.ok ? [] : [res.data.error ?? res.data.reason],
    skippedDuplicate: res.data.reason === "duplicate_blocked" || res.data.status === "skipped_duplicate",
  };
  if (!res.data.ok) return { ok: false, error: res.error ?? res.data.error ?? res.data.reason, result };
  return { ok: true, result };
}
