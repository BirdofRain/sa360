"use server";

import {
  deleteAdminClient,
  deleteAdminRoutingRule,
  fetchAdminClientDetail,
  fetchAdminClientDeletionImpact,
  fetchAdminClientRekeyPreview,
  patchAdminClient,
  patchAdminClientGhlDestination,
  postAdminClient,
  postAdminClientRekey,
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

export type DeleteActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function deleteRoutingRuleAction(ruleId: string): Promise<DeleteActionResult> {
  const res = await deleteAdminRoutingRule(ruleId);
  if (!res.ok) return { ok: false, error: res.error ?? "Failed to delete routing rule." };
  return { ok: true };
}

export async function deleteClientAction(clientAccountId: string): Promise<DeleteActionResult> {
  const res = await deleteAdminClient(clientAccountId);
  if (!res.ok) return { ok: false, error: res.error ?? "Failed to delete client." };
  const parts = [
    res.routingRulesDeleted != null ? `${res.routingRulesDeleted} routing rule(s) removed` : null,
    res.ghlConnectionsUnlinked != null && res.ghlConnectionsUnlinked > 0
      ? `${res.ghlConnectionsUnlinked} GHL connection(s) unlinked (not deleted)`
      : null,
  ].filter(Boolean);
  return { ok: true, message: parts.join(". ") || undefined };
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

export async function fetchClientDeletionImpactAction(clientAccountId: string): Promise<
  | {
      ok: true;
      impact: {
        blockers: string[];
        blocked: boolean;
        warning: string;
      };
    }
  | { ok: false; error: string }
> {
  const res = await fetchAdminClientDeletionImpact(clientAccountId);
  if (!res.ok || !res.impact) {
    return { ok: false, error: res.error ?? "Failed to load deletion impact." };
  }
  return {
    ok: true,
    impact: {
      blockers: res.impact.blockers,
      blocked: res.impact.blocked,
      warning: res.impact.warning,
    },
  };
}

export async function previewClientRekeyAction(
  sourceClientAccountId: string,
  targetClientAccountId: string
): Promise<
  | { ok: true; preview: Record<string, unknown> & { safeToExecute: boolean } }
  | { ok: false; error: string }
> {
  const res = await fetchAdminClientRekeyPreview(sourceClientAccountId, targetClientAccountId);
  if (!res.ok || !res.preview) {
    return { ok: false, error: res.error ?? "Rekey preview failed." };
  }
  return {
    ok: true,
    preview: res.preview as Record<string, unknown> & { safeToExecute: boolean },
  };
}

export async function executeClientRekeyAction(
  sourceClientAccountId: string,
  targetClientAccountId: string,
  confirmation: string
): Promise<
  | { ok: true; targetClientAccountId: string; movedReferences: Record<string, number> }
  | { ok: false; error: string }
> {
  const res = await postAdminClientRekey(sourceClientAccountId, {
    targetClientAccountId,
    confirmation,
  });
  if (!res.ok || !res.result) {
    return { ok: false, error: res.error ?? "Client rekey failed." };
  }
  return {
    ok: true,
    targetClientAccountId: String(res.result.targetClientAccountId ?? targetClientAccountId),
    movedReferences: (res.result.movedReferences as Record<string, number>) ?? {},
  };
}
