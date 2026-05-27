"use server";

import { postAdminRoutingDryRun } from "@/lib/admin-api/server";
import { parseRoutingDryRunTestJson } from "@/lib/routing-dry-run/routing-dry-run-test.util";
import type { RoutingDryRunTestResponse } from "@/lib/routing-dry-run/types";

export type RunRoutingDryRunTestActionResult =
  | { ok: true; data: RoutingDryRunTestResponse }
  | { ok: false; error: string };

export async function runRoutingDryRunTestAction(
  rawJson: string
): Promise<RunRoutingDryRunTestActionResult> {
  const parsed = parseRoutingDryRunTestJson(rawJson);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const res = await postAdminRoutingDryRun(parsed.payload);
  if (!res.data || res.error) {
    return { ok: false, error: res.error ?? "Dry-run request failed." };
  }
  return { ok: true, data: res.data };
}
