import { ROUTING_DRY_RUN_ACTION_FAILED } from "./routing-dry-run-safe.ts";

export type RoutingDryRunActionError = {
  code: string;
  message: string;
  details?: string;
};

export function routingDryRunActionError(
  code: string,
  message: string,
  details?: string
): RoutingDryRunActionError {
  return details ? { code, message, details } : { code, message };
}

export function formatRoutingDryRunActionError(
  error: RoutingDryRunActionError | string
): string {
  if (typeof error === "string") return error;
  if (error.details?.trim()) {
    return `${error.message} (${error.details})`;
  }
  return error.message;
}

export async function runRoutingDryRunAction<T>(
  fn: () => Promise<T>
): Promise<{ ok: true; data: T } | { ok: false; error: RoutingDryRunActionError }> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: routingDryRunActionError("action_failed", ROUTING_DRY_RUN_ACTION_FAILED, details),
    };
  }
}
