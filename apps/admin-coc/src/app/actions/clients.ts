"use server";

import {
  fetchAdminClientDetail,
  patchAdminClient,
  patchAdminClientGhlDestination,
  postAdminClient,
  postAdminRoutingRule,
} from "@/lib/admin-api/server";
import type { ClientAccountDetail, RoutingRuleCreateBody } from "@/lib/clients/types";

export type ClientActionResult =
  | { ok: true; item: ClientAccountDetail }
  | { ok: false; error: string };

export async function createClientAction(
  body: Record<string, unknown>
): Promise<ClientActionResult> {
  const res = await postAdminClient(body);
  if (!res.data?.item || res.error) {
    return { ok: false, error: res.error ?? "Failed to create client." };
  }
  return { ok: true, item: res.data.item };
}

export async function patchClientAction(
  clientAccountId: string,
  body: Record<string, unknown>
): Promise<ClientActionResult> {
  const res = await patchAdminClient(clientAccountId, body);
  if (!res.data?.item || res.error) {
    return { ok: false, error: res.error ?? "Failed to update client." };
  }
  return { ok: true, item: res.data.item };
}

export async function patchClientGhlDestinationAction(
  clientAccountId: string,
  body: Record<string, unknown>
): Promise<ClientActionResult> {
  const res = await patchAdminClientGhlDestination(clientAccountId, body);
  if (!res.data?.item || res.error) {
    return { ok: false, error: res.error ?? "Failed to update GHL destination." };
  }
  return { ok: true, item: res.data.item };
}

export async function createRoutingRuleAction(
  body: RoutingRuleCreateBody
): Promise<ClientActionResult> {
  const res = await postAdminRoutingRule(body);
  if (!res.data?.item) {
    return { ok: false, error: res.error ?? "Failed to create routing rule." };
  }
  const detail = await fetchAdminClientDetail(body.clientAccountId);
  if (!detail.data?.item) {
    return { ok: false, error: detail.error ?? "Rule created but could not reload client." };
  }
  return { ok: true, item: detail.data.item };
}
