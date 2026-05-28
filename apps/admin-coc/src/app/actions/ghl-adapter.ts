"use server";

import { postAdminGhlAdapterSimulate } from "@/lib/admin-api/server";
import type { GhlAdapterRunItem } from "@/lib/ghl-adapter/types";

export type SimulateGhlAdapterActionResult =
  | {
      ok: true;
      adapterRun: GhlAdapterRunItem;
      adapterMode: string;
      safetyMessage: string;
    }
  | {
      ok: false;
      error: string;
      adapterRun?: GhlAdapterRunItem;
      adapterMode?: string;
      blockedReason?: string | null;
    };

export async function simulateGhlAdapterAction(
  planId: string
): Promise<SimulateGhlAdapterActionResult> {
  const res = await postAdminGhlAdapterSimulate(planId);
  if (!res.data) {
    return { ok: false, error: res.error ?? "Simulation failed." };
  }
  if (!res.data.ok) {
    return {
      ok: false,
      error: res.data.blockedReason ?? res.error ?? "Adapter simulation blocked.",
      adapterRun: res.data.adapterRun,
      adapterMode: res.data.adapterMode,
      blockedReason: res.data.blockedReason,
    };
  }
  return {
    ok: true,
    adapterRun: res.data.adapterRun,
    adapterMode: res.data.adapterMode,
    safetyMessage: res.data.safetyMessage,
  };
}
