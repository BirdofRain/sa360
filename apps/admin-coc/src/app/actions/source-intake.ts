"use server";

import {
  fetchAdminSourceLeadDetail,
  postAdminSourceLeadApproveDelivery,
  postAdminSourceLeadRequeue,
} from "@/lib/admin-api/server";
import { SOURCE_LEAD_APPROVE_CONFIRMATION } from "@/lib/source-intake/types";
import type { SourceLeadApproveMode, SourceLeadDetail } from "@/lib/source-intake/types";

export async function loadSourceLeadDetailAction(id: string): Promise<{
  detail: SourceLeadDetail | null;
  error: string | null;
}> {
  const { item, error } = await fetchAdminSourceLeadDetail(id);
  return { detail: item, error };
}

export async function approveSourceLeadAction(
  id: string,
  mode: SourceLeadApproveMode,
  confirmationText: string
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  if (confirmationText.trim() !== SOURCE_LEAD_APPROVE_CONFIRMATION) {
    return {
      ok: false,
      error: `Type "${SOURCE_LEAD_APPROVE_CONFIRMATION}" exactly.`,
    };
  }

  const res = await postAdminSourceLeadApproveDelivery(id, {
    mode,
    operatorConfirmationText: confirmationText.trim(),
    confirmLiveDeliveryRisk: mode === "live_canary",
  });

  if (res.error) {
    return { ok: false, error: res.error };
  }

  const data = res.data as { ok?: boolean; summary?: string; reason?: string } | null;
  if (data && data.ok === false) {
    return { ok: false, error: data.reason ?? "Delivery blocked." };
  }

  return {
    ok: true,
    summary:
      typeof data?.summary === "string"
        ? data.summary
        : mode === "simulate"
          ? "Simulation completed."
          : "Live delivery submitted.",
  };
}

export async function requeueSourceLeadAction(
  id: string
): Promise<{ ok: boolean; error?: string; status?: string }> {
  const { status, error } = await postAdminSourceLeadRequeue(id);
  if (error) return { ok: false, error };
  return { ok: true, status: status ?? undefined };
}

export async function rejectSourceLeadAction(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const key =
    process.env.SA360_ADMIN_API_KEY?.trim() ||
    process.env.ADMIN_API_KEY?.trim() ||
    process.env.SA360_ADMIN_KEY?.trim();
  if (!base || !key) {
    return { ok: false, error: "Admin API not configured." };
  }
  const res = await fetch(`${base}/admin/v1/source-leads/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sa360-admin-key": key,
    },
    body: "{}",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: body.slice(0, 200) || `HTTP ${res.status}` };
  }
  return { ok: true };
}
