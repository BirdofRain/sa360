import "server-only";

import { adminFetchJson, adminRequestJson } from "./server";
import { formatAdminApiError } from "./admin-api-error";
import type {
  AssociateFacebookFormResult,
  FacebookFormAssociationItem,
  ReevaluateFacebookCaptureResult,
} from "../facebook-intake/types";
import {
  sanitizeMetaCaptureHealth,
  type MetaCaptureHealthView,
} from "../facebook-intake/meta-capture-health";
import {
  sanitizeSourceResolutionReview,
  type SourceResolutionReviewView,
} from "../facebook-intake/source-resolution";

type AssociationListResponse = {
  ok: true;
  count: number;
  items: FacebookFormAssociationItem[];
};

type AssociationWriteResponse = {
  ok: true;
  created: boolean;
  ownershipUnchanged: boolean;
  item: FacebookFormAssociationItem;
};

type ReevaluateResponse = {
  ok: true;
  sourceEventId: string;
  unchanged: boolean;
  association: {
    outcome: string;
    clientAccountId: string | null;
    explanation: string;
  };
  inventory: { tracked: boolean };
  delivery: { thisRequestAttempted: boolean; historicalOutcome: string };
};

function errorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

export async function listFacebookFormAssociations(): Promise<{
  items: FacebookFormAssociationItem[];
  error: string | null;
}> {
  const res = await adminFetchJson<AssociationListResponse>("/admin/v1/facebook-form-associations");
  if (!res.ok) return { items: [], error: formatAdminApiError(res) };
  return { items: res.data.items ?? [], error: null };
}

export async function postFacebookFormAssociation(body: {
  pageId: string;
  formId: string;
  clientAccountId: string;
  formName?: string;
}): Promise<AssociateFacebookFormResult> {
  const res = await adminRequestJson<AssociationWriteResponse>(
    "POST",
    "/admin/v1/facebook-form-associations",
    body
  );
  if (!res.ok) {
    return { ok: false, error: formatAdminApiError(res), code: errorCode(res.body) };
  }
  return {
    ok: true,
    created: res.data.created,
    ownershipUnchanged: res.data.ownershipUnchanged,
    item: res.data.item,
  };
}

export async function postFacebookCaptureReevaluation(body: {
  sourceEventId: string;
  operatorNote?: string;
}): Promise<ReevaluateFacebookCaptureResult> {
  const res = await adminRequestJson<ReevaluateResponse>(
    "POST",
    `/admin/v1/facebook-capture/events/${encodeURIComponent(body.sourceEventId)}/reevaluate-association`,
    { operatorNote: body.operatorNote, actor: "admin_coc_admin" }
  );
  if (!res.ok) {
    return { ok: false, error: formatAdminApiError(res), code: errorCode(res.body) };
  }
  return {
    ok: true,
    sourceEventId: res.data.sourceEventId,
    unchanged: res.data.unchanged,
    associationOutcome: res.data.association.outcome,
    clientAccountId: res.data.association.clientAccountId,
    explanation: res.data.association.explanation,
    thisRequestInventoryTracked: false,
    thisRequestDeliveryAttempted: false,
    historicalDeliveryOutcome: res.data.delivery.historicalOutcome,
  };
}

export async function loadMetaCaptureHealth(): Promise<{
  health: MetaCaptureHealthView | null;
  error: string | null;
}> {
  const res = await adminFetchJson<Record<string, unknown>>("/admin/v1/meta-capture/health");
  if (!res.ok) return { health: null, error: formatAdminApiError(res) };
  const health = sanitizeMetaCaptureHealth(res.data);
  if (!health) return { health: null, error: "Meta capture health response was not readable." };
  return { health, error: null };
}

export async function loadFacebookSourceResolutionReview(query: {
  pageId?: string;
  formId?: string;
  classification?: string;
  offset?: string;
}): Promise<{ review: SourceResolutionReviewView | null; error: string | null }> {
  const params = new URLSearchParams();
  if (query.pageId) params.set("pageId", query.pageId);
  if (query.formId) params.set("formId", query.formId);
  if (query.classification) params.set("classification", query.classification);
  if (query.offset) params.set("offset", query.offset);
  if (query.pageId && query.formId) params.set("includeEvents", "1");
  if (query.classification === "cannot_identify") params.set("includeEvents", "1");
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const res = await adminFetchJson<Record<string, unknown>>(`/admin/v1/facebook-source-resolution${suffix}`);
  if (!res.ok) return { review: null, error: formatAdminApiError(res) };
  const review = sanitizeSourceResolutionReview(res.data);
  if (!review) return { review: null, error: "Source Resolution review response was not readable." };
  return { review, error: null };
}
