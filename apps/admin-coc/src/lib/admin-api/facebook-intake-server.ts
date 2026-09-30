import "server-only";

import { adminFetchJson, adminRequestJson } from "./server";
import { formatAdminApiError } from "./admin-api-error";
import type {
  AssociateFacebookFormResult,
  FacebookFormAssociationItem,
  ReevaluateFacebookCaptureResult,
} from "../facebook-intake/types";

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
  delivery: { attempted: boolean };
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
    { operatorNote: body.operatorNote }
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
    inventoryTracked: false,
    deliveryAttempted: false,
  };
}
