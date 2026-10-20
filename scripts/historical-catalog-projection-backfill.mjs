/**
 * Operator runner for historical_catalog_projection_backfill_chunk.
 *
 * Dry-run is the default. It opens one read-only transaction, counts the next
 * inventory-id window, and aggregates historical_catalog_projection_diff.
 * It does not CALL the procedure.
 *
 *   pnpm historical-catalog:backfill -- \
 *     --expected-db-host 127.0.0.1:5432 \
 *     --checkpoint /tmp/historical-catalog-backfill.json \
 *     --after g3bf- --until g3bf-~
 *
 * Execution is a separate approval. It still refuses to set ready, disable
 * triggers, or write inventory and source-event rows.
 *
 *   pnpm historical-catalog:backfill -- \
 *     --execute \
 *     --confirm "BACKFILL HISTORICAL CATALOG PROJECTION" \
 *     --expected-db-host <host or host:port> \
 *     --api-health-url https://api.lifeagentlaunch.com \
 *     --checkpoint /tmp/historical-catalog-backfill.json \
 *     --init-checkpoint \
 *     --chunk-size 100 \
 *     --chunks 1
 *
 * Resume with the same checkpoint. A failed chunk is not recorded, so the next
 * run repeats that id window. The procedure is idempotent.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

export const CONFIRMATION = "BACKFILL HISTORICAL CATALOG PROJECTION";
export const DEFAULT_CHUNK_SIZE = 100;
export const MAX_CHUNK_SIZE = 100;
export const MAX_CHUNKS_PER_RUN = 20;
export const STATEMENT_TIMEOUT = "20s";
export const LOCK_TIMEOUT = "3s";
const DIFF_LIMIT = 200;

class ChunkRejected extends Error {
  constructor(result) {
    super("chunk_not_accepted");
    this.result = result;
  }
}
const REQUIRED_TRIGGERS = [
  "historical_catalog_projection_event_refresh",
  "historical_catalog_projection_item_refresh",
  "historical_catalog_projection_lot_refresh",
];

const repoRoot = resolve(new URL("..", import.meta.url).pathname);

export function redact(value) {
  return String(value).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function refusal(reasonCode, field, reason) {
  return {
    outcome: "REFUSED",
    ok: false,
    reasonCode,
    field: field ?? null,
    reason,
    writesAttempted: false,
    readyChanged: false,
  };
}

function parseBoundedInt(flag, raw, { min, max, allowZero = false }) {
  const pattern = allowZero ? /^(0|[1-9]\d*)$/ : /^[1-9]\d*$/;
  if (!pattern.test(raw ?? "")) {
    return {
      error: refusal("invalid_operator_input", flag, "must be a positive integer"),
    };
  }
  const value = Number(raw);
  if (value < min || value > max) {
    return {
      error: refusal("invalid_operator_input", flag, `must be between ${min} and ${max}`),
    };
  }
  return { value };
}

export function databaseEndpoint(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (protocol !== "postgres" && protocol !== "postgresql") return null;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return null;
  return { host, port: parsed.port || "5432" };
}

export function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function hostMatches(endpoint, expected) {
  const normalized = expected.trim().toLowerCase();
  const withPort = `${endpoint.host}:${endpoint.port}`;
  return normalized === endpoint.host || normalized === withPort;
}

function checkpointInsideRepo(checkpointPath) {
  const resolved = resolve(checkpointPath);
  const root = resolve(repoRoot);
  const fromRoot = relative(root, resolved);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

export function validateInvocation(raw, env) {
  if (env.NODE_ENV === "test") {
    return {
      error: refusal(
        "REFUSED_TEST_RUNTIME",
        "NODE_ENV",
        "refused because NODE_ENV=test. Run from a process where NODE_ENV is unset.",
      ),
    };
  }
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    return { error: refusal("DATABASE_URL_required", "DATABASE_URL", "DATABASE_URL is required") };
  }
  const endpoint = databaseEndpoint(databaseUrl);
  if (!endpoint) {
    return { error: refusal("invalid_database_url", "DATABASE_URL", "DATABASE_URL must be a postgres URL") };
  }

  const execute = raw.execute === "true";
  const chunk = parseBoundedInt("chunk-size", raw["chunk-size"] ?? String(DEFAULT_CHUNK_SIZE), {
    min: 1,
    max: MAX_CHUNK_SIZE,
  });
  if (chunk.error) return chunk;
  const chunks = parseBoundedInt("chunks", raw.chunks ?? "1", { min: 1, max: MAX_CHUNKS_PER_RUN });
  if (chunks.error) return chunks;
  const pause = parseBoundedInt("pause-ms", raw["pause-ms"] ?? "0", {
    min: 0,
    max: 10_000,
    allowZero: true,
  });
  if (pause.error) return pause;

  const expectedDbHost = raw["expected-db-host"]?.trim() || "";
  if (!isLoopback(endpoint.host) && !expectedDbHost) {
    return {
      error: refusal(
        "expected_db_host_required",
        "expected-db-host",
        "a non-local database requires --expected-db-host",
      ),
    };
  }
  if (expectedDbHost && !hostMatches(endpoint, expectedDbHost)) {
    return {
      error: refusal(
        "db_host_mismatch",
        "expected-db-host",
        `DATABASE_URL host is ${endpoint.host}:${endpoint.port}`,
      ),
    };
  }

  const apiHealthUrl = raw["api-health-url"]?.trim() || "";
  if (execute && !isLoopback(endpoint.host) && !apiHealthUrl) {
    return {
      error: refusal(
        "api_health_url_required",
        "api-health-url",
        "execute against a non-local database requires --api-health-url",
      ),
    };
  }
  if (apiHealthUrl) {
    let health;
    try {
      health = new URL(apiHealthUrl);
    } catch {
      return { error: refusal("invalid_operator_input", "api-health-url", "must be an absolute URL") };
    }
    const healthHost = health.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const localHealth = isLoopback(healthHost);
    if (health.protocol !== "https:" && !(health.protocol === "http:" && localHealth)) {
      return {
        error: refusal("invalid_operator_input", "api-health-url", "must be https, or http on localhost"),
      };
    }
  }

  if (execute && raw.confirm !== CONFIRMATION) {
    return {
      error: refusal("confirmation_required", "confirm", `execute requires --confirm ${CONFIRMATION}`),
    };
  }
  if (execute && !expectedDbHost) {
    return {
      error: refusal("expected_db_host_required", "expected-db-host", "execute requires --expected-db-host"),
    };
  }

  const after = raw.after ?? null;
  const until = raw.until?.trim() || null;
  if (after !== null && after.trim() !== after) {
    return { error: refusal("invalid_operator_input", "after", "must not contain surrounding whitespace") };
  }
  if (until !== null && until.length > 200) {
    return { error: refusal("invalid_operator_input", "until", "must be at most 200 characters") };
  }
  if (after !== null && after.length > 200) {
    return { error: refusal("invalid_operator_input", "after", "must be at most 200 characters") };
  }
  if (until !== null && after !== null && after >= until) {
    return { error: refusal("invalid_operator_input", "until", "requires a non-empty id range") };
  }
  if (until && chunks.value !== 1) {
    return {
      error: refusal("invalid_operator_input", "chunks", "an explicit --until processes one window"),
    };
  }

  const checkpoint = raw.checkpoint?.trim() || "";
  if (!checkpoint) {
    return { error: refusal("checkpoint_required", "checkpoint", "--checkpoint is required") };
  }
  if (checkpointInsideRepo(checkpoint)) {
    return {
      error: refusal(
        "checkpoint_inside_repo",
        "checkpoint",
        "checkpoint must be outside the repository",
      ),
    };
  }

  return {
    options: {
      execute,
      chunkSize: chunk.value,
      chunks: chunks.value,
      pauseMs: pause.value,
      after,
      until,
      checkpoint: resolve(checkpoint),
      initCheckpoint: raw["init-checkpoint"] === "true",
      apiHealthUrl: apiHealthUrl || null,
      databaseUrl,
      loopback: isLoopback(endpoint.host),
    },
  };
}

function readCheckpoint(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return { missing: true };
    throw error;
  }
  if (parsed?.version !== 1 || typeof parsed.appliedAfterId !== "string") {
    return { invalid: true };
  }
  return { value: parsed };
}

function writeCheckpoint(path, value) {
  const next = { ...value, version: 1, updatedAt: new Date().toISOString() };
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporary, path);
  return next;
}

async function checkHealth(apiHealthUrl) {
  const root = apiHealthUrl.replace(/\/$/, "");
  const paths = ["/health", "/health/db", "/health/queue"];
  const checks = [];
  for (const path of paths) {
    let status = 0;
    try {
      const response = await fetch(`${root}${path}`, { signal: AbortSignal.timeout(5_000) });
      status = response.status;
    } catch {
      status = 0;
    }
    checks.push({ path, status });
    if (status !== 200) return { ok: false, checks };
  }
  return { ok: true, checks };
}

async function withSession(db, readOnly, fn) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      await tx.$executeRawUnsafe(
        `SELECT set_config('application_name', '${
          readOnly ? "historical-catalog-backfill-dry-run" : "historical-catalog-backfill-execute"
        }', true)`,
      );
      if (readOnly) await tx.$executeRawUnsafe("SET LOCAL default_transaction_read_only = on");
      return fn(tx);
    },
    { maxWait: 8_000, timeout: 25_000 },
  );
}

async function preflight(tx) {
  const control = await tx.$queryRaw`
    SELECT ready FROM historical_catalog_projection_control
  `;
  const triggers = await tx.$queryRaw`
    SELECT tgname::text AS tgname, tgenabled::text AS tgenabled
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'historical_catalog_projection_event_refresh',
        'historical_catalog_projection_item_refresh',
        'historical_catalog_projection_lot_refresh'
      )
  `;
  const locks = await tx.$queryRaw`
    SELECT count(*)::int AS lock_waits
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock'
      AND pid <> pg_backend_pid()
  `;
  const enabled = new Set(
    triggers.filter((row) => row.tgenabled === "O").map((row) => row.tgname),
  );
  return {
    ready: control.length === 1 ? control[0].ready === true : null,
    triggersEnabled: REQUIRED_TRIGGERS.every((name) => enabled.has(name)),
    lockWaits: Number(locks[0]?.lock_waits ?? 0),
  };
}

function preflightStop(state) {
  if (state.ready !== false) return "ready_not_false";
  if (!state.triggersEnabled) return "triggers_not_enabled";
  if (state.lockWaits > 0) return "lock_waits";
  return null;
}

async function diffCounts(tx, after, until) {
  const rows = await tx.$queryRaw`
    SELECT discrepancy::text AS discrepancy, count(*)::int AS n
    FROM historical_catalog_projection_diff(${after}, ${until}, CAST(${DIFF_LIMIT} AS integer))
    GROUP BY discrepancy
    ORDER BY discrepancy
  `;
  const counts = {};
  let total = 0;
  for (const row of rows) {
    const n = Number(row.n);
    counts[row.discrepancy] = n;
    total += n;
  }
  return { counts, truncated: total >= DIFF_LIMIT, categories: total };
}

async function windowCounts(tx, after, until) {
  const items = await tx.$queryRaw`
    SELECT count(*)::int AS n
    FROM "LeadInventoryItem"
    WHERE id > ${after} AND id <= ${until}
  `;
  const source = await tx.$queryRaw`
    SELECT count(*)::int AS n
    FROM historical_catalog_projection_source
    WHERE item_id > ${after} AND item_id <= ${until}
  `;
  const projection = await tx.$queryRaw`
    SELECT count(*)::int AS n
    FROM historical_catalog_projection
    WHERE item_id > ${after} AND item_id <= ${until}
  `;
  const duplicates = await tx.$queryRaw`
    SELECT count(*)::int AS n
    FROM (
      SELECT source.item_id
      FROM historical_catalog_projection_source AS source
      WHERE source.item_id > ${after} AND source.item_id <= ${until}
      GROUP BY source.item_id
      HAVING count(*) > 1
    ) AS duplicate_ids
  `;
  return {
    items: Number(items[0]?.n ?? 0),
    sourceRows: Number(source[0]?.n ?? 0),
    projectionRows: Number(projection[0]?.n ?? 0),
    duplicateSourceIds: Number(duplicates[0]?.n ?? 0),
  };
}

async function resolveUntil(tx, after, chunkSize, explicitUntil) {
  if (explicitUntil) {
    const counts = await windowCounts(tx, after, explicitUntil);
    if (counts.items > MAX_CHUNK_SIZE) {
      return { error: "range_exceeds_chunk_size", items: counts.items };
    }
    if (counts.items === 0) return { empty: true };
    return { until: explicitUntil, counts };
  }
  const upper = await tx.$queryRaw`
    SELECT id
    FROM "LeadInventoryItem"
    WHERE id > ${after}
    ORDER BY id
    LIMIT 1 OFFSET ${chunkSize - 1}
  `;
  let until = upper[0]?.id ?? null;
  if (!until) {
    const last = await tx.$queryRaw`
      SELECT id
      FROM "LeadInventoryItem"
      WHERE id > ${after}
      ORDER BY id DESC
      LIMIT 1
    `;
    until = last[0]?.id ?? null;
  }
  if (!until) return { empty: true };
  const counts = await windowCounts(tx, after, until);
  return { until, counts };
}

async function itemCount(tx) {
  const rows = await tx.$queryRaw`SELECT count(*)::int AS n FROM "LeadInventoryItem"`;
  return Number(rows[0]?.n ?? 0);
}

async function projectionCount(tx) {
  const rows = await tx.$queryRaw`SELECT count(*)::int AS n FROM historical_catalog_projection`;
  return Number(rows[0]?.n ?? 0);
}

function baseReport(options, extra) {
  return {
    ok: extra.outcome === "DRY_RUN" || extra.outcome === "APPLIED" || extra.outcome === "COMPLETE",
    execute: options.execute,
    writesAttempted: false,
    readyChanged: false,
    statementTimeout: STATEMENT_TIMEOUT,
    lockTimeout: LOCK_TIMEOUT,
    chunkSize: options.chunkSize,
    ...extra,
  };
}

export async function runHistoricalCatalogBackfill(options) {
  const db = new PrismaClient({ datasources: { db: { url: options.databaseUrl } } });
  try {
    let stored = readCheckpoint(options.checkpoint);
    if (stored.invalid) {
      return baseReport(options, {
        outcome: "REFUSED",
        ok: false,
        reasonCode: "invalid_checkpoint",
        reason: "checkpoint version must be 1",
      });
    }
    if (stored.missing && options.execute && !options.initCheckpoint) {
      return baseReport(options, {
        outcome: "REFUSED",
        ok: false,
        reasonCode: "checkpoint_missing",
        reason: "execute requires an existing checkpoint or --init-checkpoint",
      });
    }
    if (!stored.missing && options.initCheckpoint) {
      return baseReport(options, {
        outcome: "REFUSED",
        ok: false,
        reasonCode: "checkpoint_exists",
        reason: "refusing to overwrite an existing checkpoint",
      });
    }
    if (stored.missing && options.initCheckpoint) {
      stored = {
        value: writeCheckpoint(options.checkpoint, {
          appliedAfterId: options.after ?? "",
          chunkSize: options.chunkSize,
          chunksCompleted: 0,
          itemsVisited: 0,
          sourceRowsVisited: 0,
        }),
      };
    }
    const cursor = stored.value?.appliedAfterId ?? options.after ?? "";
    if (options.after !== null && options.after !== cursor) {
      return baseReport(options, {
        outcome: "REFUSED",
        ok: false,
        reasonCode: "checkpoint_cursor_mismatch",
        reason: "--after does not match the checkpoint cursor",
      });
    }
    if (stored.value && stored.value.chunkSize !== options.chunkSize) {
      return baseReport(options, {
        outcome: "REFUSED",
        ok: false,
        reasonCode: "chunk_size_mismatch",
        reason: "checkpoint chunk size does not match --chunk-size",
      });
    }

    if (options.execute && options.apiHealthUrl) {
      const health = await checkHealth(options.apiHealthUrl);
      if (!health.ok) {
        return baseReport(options, {
          outcome: "STOPPED",
          ok: false,
          reasonCode: "api_health_failed",
          health: health.checks,
        });
      }
    }

    const totals = await withSession(db, true, async (tx) => ({
      itemCount: await itemCount(tx),
      projectionRowCount: await projectionCount(tx),
    }));

    const chunks = [];
    let after = cursor;
    let checkpoint = stored.value ?? null;
    let complete = false;
    for (let index = 0; index < options.chunks; index++) {
      if (options.execute && options.apiHealthUrl && index > 0) {
        const health = await checkHealth(options.apiHealthUrl);
        if (!health.ok) {
          return baseReport(options, {
            outcome: "STOPPED",
            ok: false,
            reasonCode: "api_health_failed",
            health: health.checks,
            chunks,
            checkpointAdvanced: chunks.some((chunk) => chunk.applied),
          });
        }
      }

      const preview = await withSession(db, true, async (tx) => {
        const state = await preflight(tx);
        const stop = preflightStop(state);
        if (stop) return { stop, state };
        const resolved = await resolveUntil(tx, after, options.chunkSize, options.until);
        if (resolved.error) return { stop: resolved.error, items: resolved.items, state };
        if (resolved.empty) return { empty: true, explicit: Boolean(options.until), state };
        const diff = await diffCounts(tx, after, resolved.until);
        return { state, until: resolved.until, counts: resolved.counts, diff };
      });

      if (preview.stop) {
        return baseReport(options, {
          outcome: "STOPPED",
          ok: false,
          reasonCode: preview.stop,
          ready: preview.state?.ready ?? null,
          triggersEnabled: preview.state?.triggersEnabled ?? false,
          lockWaits: preview.state?.lockWaits ?? null,
          chunks,
          checkpointAdvanced: false,
          itemCount: totals.itemCount,
          projectionRowCount: totals.projectionRowCount,
        });
      }
      if (preview.empty) {
        if (preview.explicit) {
          return baseReport(options, {
            outcome: "REFUSED",
            ok: false,
            reasonCode: "empty_range",
            reason: "the explicit id window contains no inventory items",
            chunks,
          });
        }
        complete = true;
        break;
      }
      if (preview.counts.duplicateSourceIds > 0) {
        return baseReport(options, {
          outcome: "STOPPED",
          ok: false,
          reasonCode: "duplicate_source_ids",
          duplicateSourceIds: preview.counts.duplicateSourceIds,
          chunks,
        });
      }

      if (!options.execute) {
        chunks.push({
          afterId: after,
          untilId: preview.until,
          items: preview.counts.items,
          sourceRows: preview.counts.sourceRows,
          projectionRowsBefore: preview.counts.projectionRows,
          duplicateSourceIds: preview.counts.duplicateSourceIds,
          diff: preview.diff.counts,
          diffTruncated: preview.diff.truncated,
          applied: false,
          ready: false,
        });
        after = preview.until;
        continue;
      }

      const started = Date.now();
      let applied;
      try {
        applied = await withSession(db, false, async (tx) => {
          const state = await preflight(tx);
          const stop = preflightStop(state);
          if (stop) return { stop, state };
          await tx.$executeRaw`
            CALL historical_catalog_projection_backfill_chunk(${after}, ${preview.until})
          `;
          const counts = await windowCounts(tx, after, preview.until);
          const diff = await diffCounts(tx, after, preview.until);
          const readyRows = await tx.$queryRaw`
            SELECT ready FROM historical_catalog_projection_control
          `;
          const newer = await tx.$queryRaw`
            SELECT count(*)::int AS n
            FROM historical_catalog_projection
            WHERE item_id > ${after}
              AND item_id <= ${preview.until}
              AND refreshed_at > transaction_timestamp()
          `;
          const ready = readyRows.length === 1 ? readyRows[0].ready === true : null;
          if (ready !== false || counts.duplicateSourceIds > 0 || diff.truncated || diff.categories > 0) {
            throw new ChunkRejected({
              rollback: true,
              ready,
              counts,
              diff,
              concurrentTriggerRows: Number(newer[0]?.n ?? 0),
            });
          }
          return {
            ready,
            counts,
            diff,
            concurrentTriggerRows: Number(newer[0]?.n ?? 0),
          };
        });
      } catch (error) {
        const rejected = error instanceof ChunkRejected ? error.result : null;
        if (rejected) {
          return baseReport(options, {
            outcome: "STOPPED",
            ok: false,
            reasonCode: "chunk_not_accepted",
            ready: rejected.ready,
            diff: rejected.diff?.counts ?? null,
            diffTruncated: rejected.diff?.truncated ?? false,
            duplicateSourceIds: rejected.counts?.duplicateSourceIds ?? null,
            concurrentTriggerRows: rejected.concurrentTriggerRows ?? null,
            chunks,
            writesAttempted: true,
            rolledBack: true,
            checkpointAdvanced: chunks.some((chunk) => chunk.applied),
          });
        }
        return baseReport(options, {
          outcome: "STOPPED",
          ok: false,
          reasonCode: "chunk_failed",
          reason: redact(error instanceof Error ? error.message : error),
          chunks,
          checkpointAdvanced: chunks.some((chunk) => chunk.applied),
          durationMs: Date.now() - started,
        });
      }

      if (applied.stop) {
        return baseReport(options, {
          outcome: "STOPPED",
          ok: false,
          reasonCode: applied.stop,
          ready: applied.state?.ready ?? null,
          triggersEnabled: applied.state?.triggersEnabled ?? false,
          lockWaits: applied.state?.lockWaits ?? null,
          chunks,
          writesAttempted: false,
          rolledBack: true,
          checkpointAdvanced: chunks.some((chunk) => chunk.applied),
        });
      }

      checkpoint = writeCheckpoint(options.checkpoint, {
        appliedAfterId: preview.until,
        chunkSize: options.chunkSize,
        chunksCompleted: Number(checkpoint?.chunksCompleted ?? 0) + 1,
        itemsVisited: Number(checkpoint?.itemsVisited ?? 0) + applied.counts.items,
        sourceRowsVisited: Number(checkpoint?.sourceRowsVisited ?? 0) + applied.counts.sourceRows,
      });
      chunks.push({
        afterId: after,
        untilId: preview.until,
        items: applied.counts.items,
        sourceRows: applied.counts.sourceRows,
        projectionRowsBefore: preview.counts.projectionRows,
        projectionRowsAfter: applied.counts.projectionRows,
        duplicateSourceIds: applied.counts.duplicateSourceIds,
        diff: applied.diff.counts,
        diffTruncated: applied.diff.truncated,
        concurrentTriggerRows: applied.concurrentTriggerRows,
        applied: true,
        ready: false,
        durationMs: Date.now() - started,
      });
      after = preview.until;
      if (options.pauseMs > 0 && index < options.chunks - 1) {
        await new Promise((resolvePause) => setTimeout(resolvePause, options.pauseMs));
      }
    }

    const projectionRowCount = options.execute
      ? await withSession(db, true, projectionCount)
      : totals.projectionRowCount;
    const appliedAny = chunks.some((chunk) => chunk.applied);
    const outcome = options.execute
      ? appliedAny
        ? "APPLIED"
        : "COMPLETE"
      : complete && chunks.length === 0
        ? "COMPLETE"
        : "DRY_RUN";
    return baseReport(options, {
      outcome,
      ready: false,
      writesAttempted: options.execute && chunks.some((chunk) => chunk.applied),
      checkpointAdvanced: options.execute && chunks.some((chunk) => chunk.applied),
      complete: complete || (!options.until && chunks.length < options.chunks),
      itemCount: totals.itemCount,
      projectionRowCount,
      itemsVisited: checkpoint?.itemsVisited ?? 0,
      sourceRowsVisited: checkpoint?.sourceRowsVisited ?? 0,
      chunksCompleted: checkpoint?.chunksCompleted ?? 0,
      chunks,
    });
  } finally {
    await db.$disconnect();
  }
}

function usage() {
  return `Historical catalog projection backfill

Default is dry-run. --execute also requires:
  --confirm "${CONFIRMATION}"
  --expected-db-host <host or host:port>
  --checkpoint <path outside this repository>
  --init-checkpoint on the first execution only
  --api-health-url <https origin> when the database is not local

Optional:
  --chunk-size <1..${MAX_CHUNK_SIZE}>     default ${DEFAULT_CHUNK_SIZE}
  --chunks <1..${MAX_CHUNKS_PER_RUN}>          default 1
  --pause-ms <0..10000>         pause between executed chunks
  --after <id>                  must match the checkpoint cursor when one exists
  --until <id>                  one explicit window, at most ${MAX_CHUNK_SIZE} inventory ids
`;
}

async function main() {
  const raw = parseArgs(process.argv.slice(2));
  if (raw.help === "true") {
    console.error(usage());
    process.exit(2);
  }
  const validated = validateInvocation(raw, process.env);
  if (validated.error) {
    console.error(JSON.stringify(validated.error));
    process.exit(2);
  }
  try {
    const report = await runHistoricalCatalogBackfill(validated.options);
    console.log(JSON.stringify(report, null, 2));
    if (report.outcome === "REFUSED") process.exit(2);
    if (!report.ok) process.exit(1);
  } catch (error) {
    console.error(JSON.stringify({ outcome: "FAILED", ok: false, reason: redact(error) }));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
