"use server";

import {
  fetchAdminClientChannelProfileImpact,
  fetchAdminClientChannelProfileReadiness,
  postAdminClientChannelProfile,
} from "@/lib/admin-api/server";
import type {
  ChannelImpactPreview,
  ChannelProfileSaveInput,
  ChannelProfileValidationDetail,
  ChannelReadinessReport,
  SaveChannelProfileResponse,
} from "@/lib/clients/channel-profile-types";

export type SaveChannelProfileResult =
  | { ok: true; data: SaveChannelProfileResponse["data"] }
  | { ok: false; error: string; details?: ChannelProfileValidationDetail[] };

export async function saveChannelProfileAction(
  clientAccountId: string,
  body: ChannelProfileSaveInput
): Promise<SaveChannelProfileResult> {
  const res = await postAdminClientChannelProfile(clientAccountId, body);
  if (!res.data || res.error) {
    return {
      ok: false,
      error: res.error ?? "Failed to save channel profile.",
      details: res.details ?? undefined,
    };
  }
  return { ok: true, data: res.data };
}

export type ValidateReadinessResult =
  | { ok: true; readiness: ChannelReadinessReport }
  | { ok: false; error: string };

export async function validateChannelProfileReadinessAction(
  clientAccountId: string,
  subaccountIdGhl?: string | null
): Promise<ValidateReadinessResult> {
  const res = await fetchAdminClientChannelProfileReadiness(clientAccountId, subaccountIdGhl);
  if (!res.data || res.error) {
    return { ok: false, error: res.error ?? "Failed to validate GHL readiness." };
  }
  return { ok: true, readiness: res.data };
}

export type ImpactPreviewResult =
  | { ok: true; preview: ChannelImpactPreview }
  | { ok: false; error: string };

export async function previewChannelProfileImpactAction(
  clientAccountId: string,
  opts?: { subaccountIdGhl?: string | null; applyScope?: string | null }
): Promise<ImpactPreviewResult> {
  const res = await fetchAdminClientChannelProfileImpact(clientAccountId, opts);
  if (!res.data || res.error) {
    return { ok: false, error: res.error ?? "Failed to load impact preview." };
  }
  return { ok: true, preview: res.data };
}
