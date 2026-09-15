import {
  CLIENT_PORTAL_ASSERTION_HEADER,
  createClientPortalAssertion,
} from "@sa360/shared/client-portal-assertion";

import type { PortalSessionPayload } from "../client-portal/portal-session.ts";
import { CLIENT_PORTAL_KEY_HEADER } from "./keys.ts";

export function buildGooglePortalApiRequestConfig(input: {
  baseUrl: string;
  apiKey: string;
  session: PortalSessionPayload;
}): {
  baseUrl: string;
  headers: Record<string, string>;
} {
  return {
    baseUrl: input.baseUrl.replace(/\/+$/, ""),
    headers: {
      [CLIENT_PORTAL_KEY_HEADER]: input.apiKey,
      [CLIENT_PORTAL_ASSERTION_HEADER]: createClientPortalAssertion(
        {
          clientAccountId: input.session.clientAccountId,
          portalSessionEpoch: input.session.portalSessionEpoch,
        },
        input.apiKey
      ),
      Accept: "application/json",
    },
  };
}
