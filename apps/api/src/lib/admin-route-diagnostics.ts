import { randomUUID } from "node:crypto";

export type AdminRouteDependencyOutcome = "success" | "timeout" | "error" | "aborted" | "partial";

export type AdminRouteDependencyTiming = {
  dependency: string;
  outcome: AdminRouteDependencyOutcome;
  durationMs: number;
  rowsRead?: number;
  rowsReturned?: number;
  queryCount?: number;
  code?: string;
  summary?: string;
};

export type AdminRouteDiagnostics = {
  requestId: string;
  route: string;
  totalDurationMs: number;
  memoryBeforeMb: number;
  memoryAfterMb: number;
  heapDeltaMb: number;
  dependencies: AdminRouteDependencyTiming[];
};

function memMb(): number {
  return Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 100) / 100;
}

export function createAdminRouteDiagnostics(route: string, requestId?: string) {
  const startedAt = Date.now();
  const memoryBeforeMb = memMb();
  const dependencies: AdminRouteDependencyTiming[] = [];
  const id = requestId?.trim() || randomUUID();

  return {
    requestId: id,
    route,
    record(dep: AdminRouteDependencyTiming) {
      dependencies.push(dep);
    },
    finish(): AdminRouteDiagnostics {
      const memoryAfterMb = memMb();
      return {
        requestId: id,
        route,
        totalDurationMs: Date.now() - startedAt,
        memoryBeforeMb,
        memoryAfterMb,
        heapDeltaMb: Math.round((memoryAfterMb - memoryBeforeMb) * 100) / 100,
        dependencies,
      };
    },
  };
}

export function logAdminRouteDiagnostics(diag: AdminRouteDiagnostics): void {
  // Structured ops log only — no PII, tokens, payloads, or DB URLs.
  console.info(
    JSON.stringify({
      level: "info",
      msg: "admin_route_diagnostics",
      ...diag,
    })
  );
}

export class DependencyTimeoutError extends Error {
  readonly code = "dependency_timeout";
  constructor(dependency: string) {
    super(`${dependency}_timeout`);
    this.name = "DependencyTimeoutError";
  }
}

/**
 * Run an optional bootstrap dependency with a hard timeout and AbortSignal.
 * Does not retry. Caller decides how to degrade.
 */
export async function runWithDependencyTimeout<T>(
  dependency: string,
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal
): Promise<{ ok: true; value: T; durationMs: number } | { ok: false; error: Error; durationMs: number; code: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DependencyTimeoutError(dependency));
    }, timeoutMs);
  });

  try {
    const value = await Promise.race([work(controller.signal), timeoutPromise]);
    return { ok: true, value, durationMs: Date.now() - started };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const code =
      error instanceof DependencyTimeoutError
        ? "dependency_timeout"
        : error.name === "AbortError"
          ? "dependency_aborted"
          : "dependency_error";
    return { ok: false, error, durationMs: Date.now() - started, code };
  } finally {
    if (timer) clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
  }
}
