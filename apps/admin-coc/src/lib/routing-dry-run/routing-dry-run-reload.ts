import { getDefaultMasterClientAccountId } from "../clients/master-client-default.ts";
import { routingDryRunSafeHref } from "./routing-dry-run-query.ts";

/** URL for error-page reload with env default master filter. */
export function routingDryRunReloadHref(masterClientAccountId?: string): string {
  return routingDryRunSafeHref(
    masterClientAccountId?.trim() || getDefaultMasterClientAccountId() || undefined
  );
}

export { routingDryRunSafeHref };
