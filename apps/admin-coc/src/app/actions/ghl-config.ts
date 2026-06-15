"use server";

import {
  fetchAdminGhlLocationConfig,
  postAdminClientGhlConfig,
  postAdminRoutingRuleGhlConfig,
} from "@/lib/admin-api/server";
import type { ClientDeliveryConfigSummary } from "@/lib/clients/delivery-config-types";
import type {
  GhlLocationConfigDiscoveryResponse,
  RoutingRuleGhlConfigSaveBody,
} from "@/lib/ghl-config/types";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";

export type DiscoverGhlConfigActionResult =
  | { ok: true; discovery: GhlLocationConfigDiscoveryResponse }
  | { ok: false; error: string };

export async function discoverGhlLocationConfigAction(
  locationId: string,
  refresh = true
): Promise<DiscoverGhlConfigActionResult> {
  const res = await fetchAdminGhlLocationConfig(locationId, refresh);
  if (!res.data || res.error) {
    return { ok: false, error: res.error ?? "Failed to discover GHL config." };
  }
  return { ok: true, discovery: res.data };
}

export type SaveRoutingRuleGhlConfigActionResult =
  | { ok: true; item: RoutingRuleWithReadinessItem }
  | { ok: false; error: string };

export async function saveRoutingRuleGhlConfigAction(
  ruleId: string,
  body: RoutingRuleGhlConfigSaveBody
): Promise<SaveRoutingRuleGhlConfigActionResult> {
  const res = await postAdminRoutingRuleGhlConfig(ruleId, body);
  if (!res.data?.item || res.error) {
    return { ok: false, error: res.error ?? "Failed to save GHL delivery config." };
  }
  return { ok: true, item: res.data.item };
}

export type SaveClientGhlConfigActionResult =
  | {
      ok: true;
      ghlDestination: ClientDeliveryConfigSummary["ghlDestination"];
      destinationReadiness: ClientDeliveryConfigSummary["destinationReadiness"];
    }
  | { ok: false; error: string };

export async function saveClientGhlConfigAction(
  clientAccountId: string,
  body: RoutingRuleGhlConfigSaveBody
): Promise<SaveClientGhlConfigActionResult> {
  const res = await postAdminClientGhlConfig(clientAccountId, body);
  if (!res.data?.ghlDestination || res.error) {
    return { ok: false, error: res.error ?? "Failed to save GHL destination config." };
  }
  return {
    ok: true,
    ghlDestination: res.data.ghlDestination,
    destinationReadiness: res.data.destinationReadiness,
  };
}
