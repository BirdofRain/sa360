"use server";

import { requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import {
  postFacebookCaptureReevaluation,
  postFacebookFormAssociation,
} from "@/lib/admin-api/facebook-intake-server";
import type {
  AssociateFacebookFormResult,
  ReevaluateFacebookCaptureResult,
} from "@/lib/facebook-intake/types";

export async function associateFacebookFormAction(input: {
  pageId: string;
  formId: string;
  clientAccountId: string;
  formName?: string;
}): Promise<AssociateFacebookFormResult> {
  await requireAdminCocAdminSession();
  return postFacebookFormAssociation(input);
}

export async function reevaluateFacebookCaptureAction(input: {
  sourceEventId: string;
  operatorNote?: string;
}): Promise<ReevaluateFacebookCaptureResult> {
  await requireAdminCocAdminSession();
  return postFacebookCaptureReevaluation(input);
}
