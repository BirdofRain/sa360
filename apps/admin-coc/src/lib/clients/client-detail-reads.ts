/**
 * Safe timings for the client detail page.
 * Records name the operation and the route template. They do not include
 * client ids, session cookies, auth headers, tokens, or response bodies.
 * Navigation is process warmth: the first read of an operation in this
 * process is cold, and a later read is repeat. Responses stay uncached.
 */

export type ClientDetailNavigation = "cold" | "repeat";

export type ClientDetailReadRecord = {
  event: "client_detail_read";
  operation: string;
  endpoint: string;
  durationMs: number;
  httpStatus: number | null;
  blocksInitialRender: boolean;
  essentialForClientSetup: boolean;
  navigation: ClientDetailNavigation;
};

export type ClientDetailReadSpec = {
  operation: string;
  endpoint: string;
  blocksInitialRender: boolean;
  essentialForClientSetup: boolean;
};

/** Header and Client Setup. Diagnostics are absent from this list. */
export const CLIENT_DETAIL_CRITICAL_READS: readonly ClientDetailReadSpec[] = [
  {
    operation: "client_detail",
    endpoint: "GET /admin/v1/clients/:id",
    blocksInitialRender: true,
    essentialForClientSetup: true,
  },
  {
    operation: "client_setup",
    endpoint: "GET /admin/v1/clients/:id/setup",
    blocksInitialRender: false,
    essentialForClientSetup: true,
  },
];

/** Stored records, cutover, source tools, and provider diagnostics. */
export const CLIENT_DETAIL_DIAGNOSTIC_READS: readonly ClientDetailReadSpec[] = [
  {
    operation: "cutover_readiness",
    endpoint: "GET /admin/v1/clients/:id/cutover-readiness",
    blocksInitialRender: false,
    essentialForClientSetup: false,
  },
  {
    operation: "source_funnels",
    endpoint: "GET /admin/v1/clients/:id/source-funnels",
    blocksInitialRender: false,
    essentialForClientSetup: false,
  },
  {
    operation: "sheets_destination",
    endpoint: "GET /admin/v1/clients/:id/google-sheets/destination",
    blocksInitialRender: false,
    essentialForClientSetup: false,
  },
  {
    operation: "google_connection",
    endpoint: "GET /admin/v1/integrations/google/company",
    blocksInitialRender: false,
    essentialForClientSetup: false,
  },
  {
    operation: "sheets_dispatch",
    endpoint: "GET /admin/v1/clients/:id/google-sheets/dispatch",
    blocksInitialRender: false,
    essentialForClientSetup: false,
  },
  {
    operation: "onboarding_summary",
    endpoint: "GET /admin/v1/clients/:id/onboarding",
    blocksInitialRender: false,
    essentialForClientSetup: false,
  },
  {
    operation: "folder_spreadsheets",
    endpoint: "GET /admin/v1/clients/:id/google-sheets/folder/spreadsheets",
    blocksInitialRender: false,
    essentialForClientSetup: false,
  },
];

const specs = new Map(
  [...CLIENT_DETAIL_CRITICAL_READS, ...CLIENT_DETAIL_DIAGNOSTIC_READS].map((spec) => [spec.operation, spec])
);

const seenOperations = new Set<string>();

export function resetClientDetailNavigationPasses(): void {
  seenOperations.clear();
}

export function clientDetailNavigationPass(operation: string): ClientDetailNavigation {
  if (seenOperations.has(operation)) return "repeat";
  seenOperations.add(operation);
  return "cold";
}

export function clientDetailReadSpec(operation: string): ClientDetailReadSpec | null {
  return specs.get(operation) ?? null;
}

export function readClientDetailHttpStatus(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const record = result as { status?: unknown; ok?: unknown; error?: unknown };
  if (typeof record.status === "number") return record.status;
  if (record.ok === true) return 200;
  if ("error" in record && record.error == null) return 200;
  return null;
}

export function clientDetailReadRecord(
  input: Omit<ClientDetailReadRecord, "event">
): ClientDetailReadRecord {
  return { event: "client_detail_read", ...input };
}

export function logClientDetailRead(record: ClientDetailReadRecord): void {
  console.info(JSON.stringify(record));
}

export async function timeClientDetailRead<T>(operation: string, run: () => Promise<T>): Promise<T> {
  const spec = specs.get(operation);
  const endpoint = spec?.endpoint ?? operation;
  const navigation = clientDetailNavigationPass(operation);
  const started = performance.now();
  const finish = (httpStatus: number | null) => {
    logClientDetailRead(
      clientDetailReadRecord({
        operation,
        endpoint,
        durationMs: Math.round(performance.now() - started),
        httpStatus,
        blocksInitialRender: spec?.blocksInitialRender ?? false,
        essentialForClientSetup: spec?.essentialForClientSetup ?? false,
        navigation,
      })
    );
  };
  try {
    const result = await run();
    finish(readClientDetailHttpStatus(result));
    return result;
  } catch (error) {
    finish(null);
    throw error;
  }
}
