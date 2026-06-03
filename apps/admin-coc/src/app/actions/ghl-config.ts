"use server";

import {
  fetchAdminGhlLocationConfig,
  postAdminRoutingRuleGhlConfig,
} from "@/lib/admin-api/server";
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
