import "server-only";

import { adminFetchJson, adminRequestJson } from "./server";
import type {
  MetaReviewActionResult,
  MetaReviewInsight,
  MetaReviewPage,
  MetaReviewPermission,
  MetaReviewPost,
  MetaReviewPreflight,
  MetaReviewSubscription,
  MetaReviewTrace,
} from "../meta-review/types";

type ApiSuccess<T> = { ok: true; trace?: MetaReviewTrace; items?: T; preflight?: T } & Record<
  string,
  unknown
>;

function readFailure(body: string, status: number): {
  error: string;
  trace: MetaReviewTrace | null;
} {
  try {
    const parsed = JSON.parse(body) as {
      message?: unknown;
      error?: unknown;
      trace?: MetaReviewTrace | null;
    };
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : `Request failed with HTTP ${status}.`;
    return { error: message.slice(0, 300), trace: parsed.trace ?? null };
  } catch {
    return { error: `Request failed with HTTP ${status}.`, trace: null };
  }
}

export async function fetchMetaReviewPreflight(): Promise<
  MetaReviewActionResult<MetaReviewPreflight>
> {
  const result = await adminFetchJson<ApiSuccess<MetaReviewPreflight>>(
    "/admin/v1/meta-review/preflight"
  );
  if (!result.ok) return { ok: false, ...readFailure(result.body, result.status) };
  if (!result.data.preflight) {
    return { ok: false, error: "Preflight response was incomplete.", trace: null };
  }
  return { ok: true, data: result.data.preflight, trace: result.data.trace ?? null };
}

export async function fetchMetaReviewPages(): Promise<
  MetaReviewActionResult<MetaReviewPage[]>
> {
  const result = await adminFetchJson<ApiSuccess<MetaReviewPage[]>>("/admin/v1/meta-review/pages");
  if (!result.ok) return { ok: false, ...readFailure(result.body, result.status) };
  return { ok: true, data: result.data.items ?? [], trace: result.data.trace ?? null };
}

export async function fetchMetaReviewPermissions(): Promise<
  MetaReviewActionResult<MetaReviewPermission[]>
> {
  const result = await adminFetchJson<ApiSuccess<MetaReviewPermission[]>>(
    "/admin/v1/meta-review/permissions"
  );
  if (!result.ok) return { ok: false, ...readFailure(result.body, result.status) };
  return { ok: true, data: result.data.items ?? [], trace: result.data.trace ?? null };
}

export async function fetchMetaReviewSubscription(
  pageId: string
): Promise<MetaReviewActionResult<MetaReviewSubscription[]>> {
  const result = await adminFetchJson<ApiSuccess<MetaReviewSubscription[]>>(
    `/admin/v1/meta-review/pages/${encodeURIComponent(pageId)}/subscription`
  );
  if (!result.ok) return { ok: false, ...readFailure(result.body, result.status) };
  return { ok: true, data: result.data.items ?? [], trace: result.data.trace ?? null };
}

export async function fetchMetaReviewPosts(
  pageId: string
): Promise<MetaReviewActionResult<MetaReviewPost[]>> {
  const result = await adminFetchJson<ApiSuccess<MetaReviewPost[]>>(
    `/admin/v1/meta-review/pages/${encodeURIComponent(pageId)}/posts`
  );
  if (!result.ok) return { ok: false, ...readFailure(result.body, result.status) };
  return { ok: true, data: result.data.items ?? [], trace: result.data.trace ?? null };
}

export async function fetchMetaReviewInsights(input: {
  adAccountId: string;
  since: string;
  until: string;
}): Promise<MetaReviewActionResult<MetaReviewInsight[]>> {
  const query = new URLSearchParams({ since: input.since, until: input.until });
  const result = await adminFetchJson<ApiSuccess<MetaReviewInsight[]>>(
    `/admin/v1/meta-review/ad-accounts/${encodeURIComponent(input.adAccountId)}/insights?${query}`
  );
  if (!result.ok) return { ok: false, ...readFailure(result.body, result.status) };
  return { ok: true, data: result.data.items ?? [], trace: result.data.trace ?? null };
}

export async function postMetaReviewLeadgenSubscription(input: {
  pageId: string;
  confirmed: boolean;
  confirmationText: string;
}): Promise<
  MetaReviewActionResult<{ alreadySubscribed: boolean; subscribedFields: string[] }>
> {
  const result = await adminRequestJson<
    ApiSuccess<never> & { alreadySubscribed: boolean; subscribedFields: string[] }
  >(
    "POST",
    `/admin/v1/meta-review/pages/${encodeURIComponent(input.pageId)}/subscribe-leadgen`,
    { confirmed: input.confirmed, confirmationText: input.confirmationText }
  );
  if (!result.ok) return { ok: false, ...readFailure(result.body, result.status) };
  return {
    ok: true,
    data: {
      alreadySubscribed: result.data.alreadySubscribed,
      subscribedFields: result.data.subscribedFields,
    },
    trace: result.data.trace ?? null,
  };
}
