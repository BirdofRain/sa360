"use server";

/**
 * Temporary MVP access gate for `/portal` (pre–Phase 3 login).
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  getClientPortalAccessCode,
  isValidPortalAccessCode,
  portalAccessCookieOptions,
  portalPathAfterAccessGrant,
} from "@/lib/client-portal/access-gate";
import { parseClientPortalRange } from "@/lib/client-portal/range";
import type { ClientPortalRangeKey } from "@/lib/client-portal/types";

function safeRange(raw: FormDataEntryValue | null): ClientPortalRangeKey {
  if (typeof raw !== "string") return "7d";
  return parseClientPortalRange(raw);
}

export async function submitPortalAccessAction(
  _prev: { error?: string } | undefined,
  formData: FormData
) {
  if (!getClientPortalAccessCode()) {
    return { error: "Portal access is not configured on the server." };
  }

  const code = String(formData.get("accessCode") ?? "");
  if (!isValidPortalAccessCode(code)) {
    return { error: "That access code is not valid. Please try again." };
  }

  const rangeKey = safeRange(formData.get("range"));
  const store = await cookies();
  store.set(portalAccessCookieOptions());

  redirect(portalPathAfterAccessGrant(rangeKey));
}
