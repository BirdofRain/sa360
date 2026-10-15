"use server";

import { headers } from "next/headers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { issueMetaReviewerSessionToken } from "@/lib/meta-reviewer-login-flow";
import { META_REVIEWER_SIGN_IN_FAILED } from "@/lib/meta-reviewer-auth";
import {
  clearMetaReviewerLoginFailures,
  metaReviewerLoginRateKey,
  metaReviewerLoginRateLimited,
  recordMetaReviewerLoginFailure,
} from "@/lib/meta-reviewer-rate-limit";
import { metaReviewerSessionCookieOptions } from "@/lib/meta-reviewer-session";

/**
 * Reviewer sign-in. Success always lands on /meta-review.
 * The form has no next parameter. Wrong password, missing configuration, rate
 * limiting, and a disabled workspace all return the same error.
 */
export async function metaReviewerLoginAction(
  _prev: { error?: string } | undefined,
  formData: FormData
) {
  let rateKey = "unknown";
  try {
    rateKey = metaReviewerLoginRateKey(await headers());
  } catch {
    rateKey = "unknown";
  }

  if (metaReviewerLoginRateLimited(rateKey)) {
    return { error: META_REVIEWER_SIGN_IN_FAILED };
  }

  const password = String(formData.get("password") ?? "");
  const token = await issueMetaReviewerSessionToken(password);
  if (!token) {
    recordMetaReviewerLoginFailure(rateKey);
    return { error: META_REVIEWER_SIGN_IN_FAILED };
  }

  clearMetaReviewerLoginFailures(rateKey);
  const store = await cookies();
  store.set(metaReviewerSessionCookieOptions(token));
  redirect("/meta-review");
}
