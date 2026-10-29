"use server";

import { requireAdminCocAdminSession, requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import {
  fetchAdminSourceLeadDetail,
  postAdminActivateOngoingGhl,
  postAdminSelectedGhlDelivery,
} from "@/lib/admin-api/server";
import type { GhlWalkthroughExecution } from "@/components/clients/onboarding/ghl-walkthrough-types";
import { noteEventFromSourceLead } from "@/lib/clients/onboarding/view";
import { presentSourceValue } from "@/lib/clients/onboarding/ghl-field-coverage";

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
  const held = res.data.outcome === "held";
  const result: GhlWalkthroughExecution = {
    status: held ? "held" : (res.data.status ?? res.data.reason),
    contactIdGhl: res.data.contactIdGhl,
    opportunityIdGhl: res.data.opportunityIdGhl,
    workflowStarted: res.data.workflowStarted,
    externalCallExecuted: held ? false : res.data.externalCallExecuted,
    errors: res.data.ok ? [] : [res.data.error ?? res.data.reason],
    skippedDuplicate: res.data.reason === "duplicate_blocked" || res.data.status === "skipped_duplicate",
    outcome: res.data.outcome,
  };
  if (!res.data.ok) return { ok: false, error: res.error ?? res.data.error ?? res.data.reason, result };
  return { ok: true, result };
}

export async function loadStoredLeadSourceAttributesAction(
  sourceLeadEventId: string
): Promise<{ ok: true; sourceAttributes: Record<string, string | null> } | { ok: false; error: string }> {
  await requireAdminCocSession();
  const id = sourceLeadEventId.trim();
  if (!id) return { ok: false, error: "event_not_found" };
  const res = await fetchAdminSourceLeadDetail(id);
  if (!res.item) return { ok: false, error: res.error ?? "event_not_found" };
  const detail = res.item;
  const event = noteEventFromSourceLead({
    id: detail.id,
    leadName: detail.leadName,
    email: detail.email,
    phone: detail.phone,
    receivedAt: detail.receivedAt,
    rawPayloadJson: detail.rawPayloadJson,
    normalizedPayloadJson: detail.normalizedPayloadJson,
    enrichmentMetadataJson: detail.enrichmentMetadataJson,
  });
  const source = event.sourceAttributes;
  const sourceAttributes: Record<string, string | null> = {};
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      sourceAttributes[key] = presentSourceValue(value);
    }
  }
  return { ok: true, sourceAttributes };
}
