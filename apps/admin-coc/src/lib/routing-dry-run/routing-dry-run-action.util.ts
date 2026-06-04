import { ROUTING_DRY_RUN_ACTION_FAILED } from "./routing-dry-run-safe.ts";

export async function runRoutingDryRunAction<T>(
  fn: () => Promise<T>
): Promise<{ ok: true; data: T } | { ok: false; error: string; details?: string }> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return { ok: false, error: ROUTING_DRY_RUN_ACTION_FAILED, details };
  }
}
