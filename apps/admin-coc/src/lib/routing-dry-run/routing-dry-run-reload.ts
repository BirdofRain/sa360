import { routingDryRunSafeHref } from "./routing-dry-run-query.ts";

/** URL for error-page reload in safe mode without master filter. */
export function routingDryRunReloadHref(): string {
  return routingDryRunSafeHref();
}

export { routingDryRunSafeHref };
