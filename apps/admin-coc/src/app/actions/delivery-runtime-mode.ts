"use server";

import { requireAdminCocSession } from "@/lib/admin-coc-session-guard";

import {
  fetchAdminDeliveryRuntimeMode,
  postAdminDeliveryRuntimeMode,
} from "@/lib/admin-api/server";
import type { DeliveryRuntimeModeStatus } from "@/lib/delivery-runtime-mode/types";

export async function loadDeliveryRuntimeModeAction(): Promise<{
  ok: boolean;
  status: DeliveryRuntimeModeStatus | null;
  error: string | null;
}> {
  await requireAdminCocSession();
  const res = await fetchAdminDeliveryRuntimeMode();
  if (!res.data) return { ok: false, status: null, error: res.error };
  return { ok: true, status: res.data, error: null };
}

export async function setDeliveryRuntimeModeAction(input: {
  mode: "simulate" | "live_canary";
  durationMinutes?: number;
  operatorConfirmationText: string;
  reason?: string;
}): Promise<{
  ok: boolean;
  status: DeliveryRuntimeModeStatus | null;
  error: string | null;
}> {
  await requireAdminCocSession();
  const res = await postAdminDeliveryRuntimeMode(input);
  if (!res.data) return { ok: false, status: null, error: res.error };
  return { ok: true, status: res.data, error: null };
}
