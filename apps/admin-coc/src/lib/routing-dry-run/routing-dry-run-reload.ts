import { getDefaultMasterClientAccountId } from "../clients/master-client-default.ts";
import { buildRoutingDryRunHref } from "./routing-dry-run-query.ts";

/** URL for error-page reload with env default master filter. */
export function routingDryRunReloadHref(masterClientAccountId?: string): string {
  const master = masterClientAccountId?.trim() || getDefaultMasterClientAccountId();
  if (!master) return "/routing-dry-run";
  return buildRoutingDryRunHref({
    masterClientAccountId: master,
    matched: "all",
    validationStatus: "all",
    reviewQueue: "all",
    limit: 50,
  });
}
