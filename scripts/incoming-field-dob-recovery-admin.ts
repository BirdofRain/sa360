/**
 * Read-only production DOB recovery assessment through the admin API.
 *
 *   pnpm source-intake:dob-recovery-admin
 *
 * GET /admin/v1/source-leads only. There is no apply mode. --apply, --confirm,
 * --write, --backfill, and --replay are refused before any request. The
 * default assessment is the fixed historical window ending at
 * 2026-11-03T15:36:00.000Z. --released-intake is a separate read beginning
 * 2026-11-03T17:42:00.000Z (November 3, 2026 12:42 PM America/New_York). It does
 * not change that historical window. storedCanonical is the saved lead.
 * proposedRecovery is recomputed and is not production verification.
 * formIdentity.providerFunnelId is the external funnel UUID, not SourceFunnel.id.
 * Confirmed provider lead ids are matched only from raw lead_id on details
 * this command already fetched. They are not requested as event ids.
 * The localhost Prisma command is unchanged and still refuses remote databases.
 *
 * Requires SA360_PROD_API_URL (or --base-url) and ADMIN_API_KEY or
 * SA360_ADMIN_KEY. The key is sent as x-sa360-admin-key and is never printed.
 * Sheets jobs and lead allocations are not on this API.
 */
const WRITE_FLAGS = ["apply", "confirm", "write", "backfill", "replay"] as const;
const MAX_PAGES = 100;
const PAGE_LIMIT = 200;

function refuse(reasonCode: string, field?: string): never {
  console.error(JSON.stringify({ outcome: "REFUSED", ok: false, writes: false, reasonCode, ...(field ? { field } : {}) }));
  process.exit(2);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    if (!key) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function adminKey(): string {
  return process.env.ADMIN_API_KEY?.trim() || process.env.SA360_ADMIN_KEY?.trim() || "";
}

function assertHttpsBase(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    refuse("invalid_base_url", "base-url");
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (parsed.protocol !== "https:" && !local) refuse("base_url_not_https", "base-url");
  if (parsed.username || parsed.password) refuse("base_url_has_credentials", "base-url");
  return parsed;
}

type ListBody = {
  ok?: boolean;
  items?: Array<{ id?: string; receivedAt?: string; sourceProvider?: string }>;
  nextCursor?: string | null;
};

type DetailBody = {
  ok?: boolean;
  item?: Record<string, unknown>;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function detailFrom(item: Record<string, unknown> | undefined) {
  if (!item) return null;
  if (
    typeof item.id !== "string" ||
    typeof item.sourceProvider !== "string" ||
    typeof item.sourceSystem !== "string" ||
    typeof item.status !== "string" ||
    typeof item.receivedAt !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    sourceProvider: item.sourceProvider,
    sourceSystem: item.sourceSystem,
    sourceRouteKey: textOrNull(item.sourceRouteKey),
    sourceFunnelName: textOrNull(item.sourceFunnelName),
    destinationClientAccountId: textOrNull(item.destinationClientAccountId),
    sourceClientAccountId: textOrNull(item.sourceClientAccountId),
    status: item.status,
    receivedAt: item.receivedAt,
    deliveredAt: textOrNull(item.deliveredAt),
    rawPayloadJson: item.rawPayloadJson ?? null,
    normalizedPayloadJson: item.normalizedPayloadJson ?? null,
    enrichmentMetadataJson: item.enrichmentMetadataJson ?? null,
    routingResultJson: item.routingResultJson ?? null,
    deliveryResultJson: item.deliveryResultJson ?? null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const flag of WRITE_FLAGS) {
    if (args[flag]) refuse("writes_refused", flag);
  }

  const baseText = args["base-url"]?.trim() || process.env.SA360_PROD_API_URL?.trim() || "";
  if (!baseText) refuse("base_url_required", "base-url");
  const base = assertHttpsBase(baseText);
  const key = adminKey();
  if (!key) refuse("admin_key_required");

  const recovery = await import("../apps/api/src/services/source-intake/incoming-field-dob-recovery.ts");
  const releasedIntake = args["released-intake"] === "true";
  const resolved = recovery.resolveIncomingDobRecoveryAdminWindow({
    releasedIntake,
    receivedFrom: args["received-from"],
    receivedTo: args["received-to"],
    now: releasedIntake && !args["received-to"]?.trim() ? new Date() : undefined,
  });
  const from = new Date(resolved.receivedFrom);
  if (Number.isNaN(from.getTime())) refuse("invalid_received_from", "received-from");
  const expectIds = process.argv.slice(2).flatMap((token, index, argv) => {
    if (token !== "--expect-id") return [];
    const next = argv[index + 1];
    return next && !next.startsWith("--") ? [next.trim()] : [];
  }).filter(Boolean);

  const to = new Date(resolved.receivedTo);
  if (Number.isNaN(to.getTime())) refuse("invalid_received_to", "received-to");
  if (to.getTime() < from.getTime()) refuse("received_to_before_from", "received-to");

  const header = { "x-sa360-admin-key": key, accept: "application/json" };
  const origin = base.origin;

  async function getJson(path: string): Promise<{ status: number; body: unknown }> {
    const response = await fetch(new URL(path, origin), { method: "GET", headers: header });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  }

  const scan = await recovery.scanAdminSourceLeadWindow({
    receivedFrom: from.toISOString(),
    receivedTo: to.toISOString(),
    maxPages: MAX_PAGES,
    listPage: async (cursor) => {
      const params = new URLSearchParams({
        sourceProvider: "leadcapture_io",
        limit: String(PAGE_LIMIT),
        includeCleanup: "true",
      });
      if (cursor) params.set("cursor", cursor);
      const loaded = await getJson(`/admin/v1/source-leads?${params.toString()}`);
      if (loaded.status === 401 || loaded.status === 503) {
        refuse(loaded.status === 401 ? "admin_unauthorized" : "admin_api_disabled");
      }
      if (loaded.status !== 200) refuse("admin_list_failed", String(loaded.status));
      const body = loaded.body as ListBody;
      if (!body || body.ok !== true || !Array.isArray(body.items)) refuse("admin_list_unreadable");
      return {
        items: body.items
          .filter((item) => typeof item.id === "string" && typeof item.receivedAt === "string")
          .map((item) => ({
            id: item.id as string,
            receivedAt: item.receivedAt as string,
            sourceProvider: item.sourceProvider ?? null,
          })),
        nextCursor: typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null,
      };
    },
  });

  const inspectionIds = recovery.incomingDobRecoveryAdminInspectionIds({
    releasedIntake,
    extraIds: expectIds,
  });
  const detailIds = [...scan.ids];
  for (const id of inspectionIds) {
    if (!detailIds.includes(id)) detailIds.push(id);
  }

  const rows: Array<ReturnType<typeof recovery.adminSourceLeadDetailToRecoverySnapshot>> = [];
  let knownStatus: number | null = null;
  for (const id of detailIds) {
    const loaded = await getJson(`/admin/v1/source-leads/${encodeURIComponent(id)}`);
    if (id === recovery.KNOWN_DOB_RECOVERY_EVENT_ID) knownStatus = loaded.status;
    if (loaded.status === 404) continue;
    if (loaded.status === 401 || loaded.status === 503) {
      refuse(loaded.status === 401 ? "admin_unauthorized" : "admin_api_disabled");
    }
    if (loaded.status !== 200) refuse("admin_detail_failed", String(loaded.status));
    const body = loaded.body as DetailBody;
    const detail = detailFrom(body?.item);
    if (!detail) refuse("admin_detail_unreadable");
    rows.push(recovery.adminSourceLeadDetailToRecoverySnapshot(detail));
  }

  const report = recovery.buildIncomingDobRecoveryReport({
    rows,
    receivedFrom: from.toISOString(),
    receivedTo: to.toISOString(),
    truncated: !scan.complete,
  });
  const foundIds = new Set(rows.map((row) => row.id));
  const inspections = inspectionIds
    .map((id) => rows.find((row) => row.id === id) ?? null)
    .filter((row): row is NonNullable<typeof row> => row != null)
    .map((row) => recovery.describeIncomingDobRecoveryInspection(row));

  console.log(
    JSON.stringify({
      environment: "admin_api",
      host: base.hostname,
      writes: false,
      method: "GET",
      assessment: resolved.assessment,
      window: {
        receivedFrom: from.toISOString(),
        receivedTo: to.toISOString(),
        receivedToSource: resolved.receivedToSource,
        timezone: "America/New_York",
      },
      pagination: {
        complete: scan.complete,
        stoppedReason: scan.stoppedReason,
        pages: scan.pages,
        listItemsSeen: scan.listItemsSeen,
        detailsFetched: rows.length,
        maxPages: MAX_PAGES,
      },
      deliveryEvidence:
        "deliveredAt, status, and deliveryResultJson.externalCallExecuted. Sheets jobs and lead allocations are not on this API, so those two flags are unresolved and are not production zeros.",
      knownEventHttpStatus: knownStatus,
      inspectionIds,
      missingInspectionIds: inspectionIds.filter((id) => !foundIds.has(id)),
      sourceLeadLookups: recovery.matchConfirmedSourceLeadEvents(rows, {
        paginationComplete: scan.complete,
      }),
      inspections,
      report,
    })
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.name : "unknown_error";
  console.error(JSON.stringify({ outcome: "FAILED", ok: false, writes: false, error: message }));
  process.exit(1);
});
