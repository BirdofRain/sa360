import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { LEAD_CLEANUP_STATUSES } from "../lib/lead-cleanup.js";
import {
  classifyIncompleteLeadIdentity,
  extractInboundContactIdentity,
  extractRoutingDryRunDecisionIdentity,
  extractSourceLeadEventIdentity,
  summarizeIdentity,
  type LeadCleanupDecision,
  type LeadIdentitySnapshot,
} from "../services/lead-cleanup/incomplete-lead-audit.js";

export type Options = {
  mark: boolean;
  markReviewRequired: boolean;
  sampleSize: number;
  batchSize: number;
};

type ModelName = "SourceLeadEvent" | "RoutingDryRunDecision" | "InboundContactIndex";

export type Candidate = {
  model: ModelName;
  id: string;
  action: Exclude<LeadCleanupDecision["action"], "keep">;
  status: string;
  reason: string;
  snapshot: LeadIdentitySnapshot;
  existingCleanupStatus: string | null;
  existingCleanupReason: string | null;
};

type Bucket = {
  model: ModelName;
  action: Candidate["action"];
  reason: string;
  status: string;
  total: number;
  alreadyMarked: number;
  markableNow: number;
  samples: Array<{ id: string; identity: Record<string, string | null> }>;
};

type UpdateGroup = {
  model: "SourceLeadEvent" | "RoutingDryRunDecision";
  status: string;
  reason: string;
  ids: string[];
};

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  return value === "true" || value === "1";
}

function parseNumberFlag(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parseArgs(argv: string[]): Options {
  const args = new Map<string, string | undefined>();
  for (const raw of argv) {
    const normalized = raw.trim();
    if (!normalized.startsWith("--")) continue;
    const [key, value] = normalized.slice(2).split("=", 2);
    args.set(key, value);
  }

  if (args.has("help") || args.has("h")) {
    console.log(
      [
        "Usage: pnpm --filter @sa360/api exec tsx src/scripts/audit-incomplete-leads.ts [flags]",
        "",
        "Flags:",
        "  --mark                         Apply automatic cleanup status updates.",
        "  --mark-review-required         In mark mode, also set REVIEW_REQUIRED status.",
        "  --sample-size=<n>              Sample rows printed per reason bucket (default 5).",
        "  --batch-size=<n>               Read batch size for scans (default 500).",
      ].join("\n")
    );
    process.exit(0);
  }

  return {
    mark: args.has("mark") || parseBooleanFlag(args.get("mark")),
    markReviewRequired:
      args.has("mark-review-required") || parseBooleanFlag(args.get("mark-review-required")),
    sampleSize: parseNumberFlag(args.get("sample-size"), 5),
    batchSize: parseNumberFlag(args.get("batch-size"), 500),
  };
}

function decisionToCandidateBase(
  model: ModelName,
  id: string,
  decision: LeadCleanupDecision,
  snapshot: LeadIdentitySnapshot,
  existingCleanupStatus: string | null,
  existingCleanupReason: string | null
): Candidate | null {
  if (decision.action === "keep") return null;
  return {
    model,
    id,
    action: decision.action,
    status: decision.status,
    reason: decision.reason,
    snapshot,
    existingCleanupStatus,
    existingCleanupReason,
  };
}

async function scanSourceLeadEvents(
  prisma: PrismaClient,
  opts: Options,
  linkedDecisionReasonById: Map<string, string>,
  linkedDecisionReasonByLeadUid: Map<string, string>
): Promise<{ inspected: number; candidates: Candidate[] }> {
  let inspected = 0;
  const candidates: Candidate[] = [];
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.sourceLeadEvent.findMany({
      select: {
        id: true,
        clientAccountIdResolved: true,
        destinationLocationIdResolved: true,
        routingRuleIdResolved: true,
        sourceLeadUid: true,
        normalizedPayloadJson: true,
        routingDryRunDecisionId: true,
        cleanupStatus: true,
        cleanupReason: true,
      },
      orderBy: { id: "asc" },
      take: opts.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      inspected += 1;
      const extracted = extractSourceLeadEventIdentity({
        clientAccountIdResolved: row.clientAccountIdResolved,
        destinationLocationIdResolved: row.destinationLocationIdResolved,
        routingRuleIdResolved: row.routingRuleIdResolved,
        sourceLeadUid: row.sourceLeadUid,
        normalizedPayloadJson: row.normalizedPayloadJson,
      });
      const decision = classifyIncompleteLeadIdentity(extracted.snapshot, extracted.support);
      const candidate = decisionToCandidateBase(
        "SourceLeadEvent",
        row.id,
        decision,
        extracted.snapshot,
        row.cleanupStatus,
        row.cleanupReason
      );
      if (candidate) candidates.push(candidate);

      if (decision.action === "mark") {
        if (row.routingDryRunDecisionId?.trim()) {
          linkedDecisionReasonById.set(row.routingDryRunDecisionId.trim(), decision.reason);
        }
        if (row.sourceLeadUid?.trim()) {
          linkedDecisionReasonByLeadUid.set(row.sourceLeadUid.trim(), decision.reason);
        }
      }
    }

    cursor = rows[rows.length - 1]?.id;
  }

  return { inspected, candidates };
}

async function scanRoutingDryRunDecisions(
  prisma: PrismaClient,
  opts: Options,
  linkedDecisionReasonById: Map<string, string>,
  linkedDecisionReasonByLeadUid: Map<string, string>
): Promise<{ inspected: number; candidates: Candidate[] }> {
  let inspected = 0;
  const candidates: Candidate[] = [];
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.routingDryRunDecision.findMany({
      select: {
        id: true,
        masterClientAccountId: true,
        destinationClientAccountId: true,
        destinationSubaccountIdGhl: true,
        sourceLeadUid: true,
        matchedRuleId: true,
        attributionSnapshot: true,
        cleanupStatus: true,
        cleanupReason: true,
      },
      orderBy: { id: "asc" },
      take: opts.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      inspected += 1;
      const linkedReason =
        linkedDecisionReasonById.get(row.id) ??
        (row.sourceLeadUid ? linkedDecisionReasonByLeadUid.get(row.sourceLeadUid) : undefined);

      const decision: LeadCleanupDecision = linkedReason
        ? {
            action: "mark",
            status: LEAD_CLEANUP_STATUSES.INCOMPLETE_MISSING_CLIENT_AND_NAME,
            reason: linkedReason,
          }
        : (() => {
            const extracted = extractRoutingDryRunDecisionIdentity({
              masterClientAccountId: row.masterClientAccountId,
              destinationClientAccountId: row.destinationClientAccountId,
              destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
              sourceLeadUid: row.sourceLeadUid,
              matchedRuleId: row.matchedRuleId,
              attributionSnapshot: row.attributionSnapshot,
            });
            return classifyIncompleteLeadIdentity(extracted.snapshot, extracted.support);
          })();

      const extracted = extractRoutingDryRunDecisionIdentity({
        masterClientAccountId: row.masterClientAccountId,
        destinationClientAccountId: row.destinationClientAccountId,
        destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
        sourceLeadUid: row.sourceLeadUid,
        matchedRuleId: row.matchedRuleId,
        attributionSnapshot: row.attributionSnapshot,
      });

      const candidate = decisionToCandidateBase(
        "RoutingDryRunDecision",
        row.id,
        decision,
        extracted.snapshot,
        row.cleanupStatus,
        row.cleanupReason
      );
      if (candidate) candidates.push(candidate);
    }

    cursor = rows[rows.length - 1]?.id;
  }

  return { inspected, candidates };
}

async function scanInboundContactIndex(
  prisma: PrismaClient,
  opts: Options
): Promise<{ inspected: number; candidates: Candidate[] }> {
  let inspected = 0;
  const candidates: Candidate[] = [];
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.inboundContactIndex.findMany({
      select: {
        id: true,
        clientAccountId: true,
        subaccountIdGhl: true,
        firstName: true,
        lastName: true,
        displayName: true,
        phoneE164: true,
        email: true,
        leadUid: true,
        contactIdGhl: true,
      },
      orderBy: { id: "asc" },
      take: opts.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      inspected += 1;
      const extracted = extractInboundContactIdentity({
        clientAccountId: row.clientAccountId,
        subaccountIdGhl: row.subaccountIdGhl,
        firstName: row.firstName,
        lastName: row.lastName,
        displayName: row.displayName,
        phoneE164: row.phoneE164,
        email: row.email,
        leadUid: row.leadUid,
        contactIdGhl: row.contactIdGhl,
      });
      const decision = classifyIncompleteLeadIdentity(extracted.snapshot, extracted.support);
      const candidate = decisionToCandidateBase(
        "InboundContactIndex",
        row.id,
        decision,
        extracted.snapshot,
        null,
        null
      );
      if (candidate) candidates.push(candidate);
    }

    cursor = rows[rows.length - 1]?.id;
  }

  return { inspected, candidates };
}

export function isCandidateMarkableNow(row: Candidate, opts: Options): boolean {
  if (!opts.mark) return false;
  if (row.model === "InboundContactIndex") return false;
  if (row.existingCleanupStatus) return false;
  if (row.action === "mark") return true;
  if (row.action === "review_required") return opts.markReviewRequired;
  return false;
}

function bucketize(candidates: Candidate[], opts: Options): Bucket[] {
  const map = new Map<string, Bucket>();

  for (const row of candidates) {
    const key = `${row.model}|${row.action}|${row.reason}|${row.status}`;
    const existing = map.get(key);
    const markableByMode = isCandidateMarkableNow(row, opts);
    if (!existing) {
      map.set(key, {
        model: row.model,
        action: row.action,
        reason: row.reason,
        status: row.status,
        total: 1,
        alreadyMarked: row.existingCleanupStatus ? 1 : 0,
        markableNow: markableByMode ? 1 : 0,
        samples: [
          {
            id: row.id,
            identity: summarizeIdentity(row.snapshot),
          },
        ],
      });
      continue;
    }

    existing.total += 1;
    if (row.existingCleanupStatus) existing.alreadyMarked += 1;
    if (markableByMode) existing.markableNow += 1;
    if (existing.samples.length < opts.sampleSize) {
      existing.samples.push({ id: row.id, identity: summarizeIdentity(row.snapshot) });
    }
  }

  return [...map.values()].sort((a, b) =>
    `${a.model}:${a.reason}:${a.action}`.localeCompare(`${b.model}:${b.reason}:${b.action}`)
  );
}

export function toUpdateGroups(candidates: Candidate[], opts: Options): UpdateGroup[] {
  const map = new Map<string, UpdateGroup>();

  for (const row of candidates) {
    if (!isCandidateMarkableNow(row, opts)) continue;
    if (row.model !== "SourceLeadEvent" && row.model !== "RoutingDryRunDecision") continue;

    const key = `${row.model}|${row.status}|${row.reason}`;
    const existing = map.get(key);
    if (existing) {
      existing.ids.push(row.id);
      continue;
    }

    map.set(key, {
      model: row.model,
      status: row.status,
      reason: row.reason,
      ids: [row.id],
    });
  }

  return [...map.values()].sort((a, b) =>
    `${a.model}:${a.status}:${a.reason}`.localeCompare(`${b.model}:${b.status}:${b.reason}`)
  );
}

async function applyUpdates(prisma: PrismaClient, groups: UpdateGroup[]) {
  const now = new Date();
  for (const group of groups) {
    if (group.model === "SourceLeadEvent") {
      await prisma.sourceLeadEvent.updateMany({
        where: { id: { in: group.ids } },
        data: {
          cleanupStatus: group.status,
          cleanupReason: group.reason,
          cleanupMarkedAt: now,
        },
      });
      continue;
    }

    await prisma.routingDryRunDecision.updateMany({
      where: { id: { in: group.ids } },
      data: {
        cleanupStatus: group.status,
        cleanupReason: group.reason,
        cleanupMarkedAt: now,
      },
    });
  }
}

function printBuckets(buckets: Bucket[]) {
  if (buckets.length === 0) {
    console.log("\nNo cleanup candidates found.");
    return;
  }

  console.log("\nCandidates by model/reason:");
  for (const bucket of buckets) {
    console.log(
      `- ${bucket.model} | ${bucket.reason} | action=${bucket.action} | total=${bucket.total} | already_marked=${bucket.alreadyMarked} | markable_now=${bucket.markableNow}`
    );
    for (const sample of bucket.samples) {
      console.log(`  sample ${sample.id}: ${JSON.stringify(sample.identity)}`);
    }
  }
}

export async function runAuditScript(argv: string[] = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const prisma = new PrismaClient();
  try {
    const linkedDecisionReasonById = new Map<string, string>();
    const linkedDecisionReasonByLeadUid = new Map<string, string>();

    console.log(`Mode: ${opts.mark ? "mark" : "dry-run"}`);
    if (!opts.mark && opts.markReviewRequired) {
      console.log(
        "Dry-run note: --mark-review-required is enabled, but no rows will be updated unless --mark is also set."
      );
    }
    if (opts.mark && !opts.markReviewRequired) {
      console.log("Mark mode is conservative: review_required rows are reported but not auto-marked.");
    }

    const source = await scanSourceLeadEvents(
      prisma,
      opts,
      linkedDecisionReasonById,
      linkedDecisionReasonByLeadUid
    );
    const routing = await scanRoutingDryRunDecisions(
      prisma,
      opts,
      linkedDecisionReasonById,
      linkedDecisionReasonByLeadUid
    );
    const inbound = await scanInboundContactIndex(prisma, opts);

    const candidates = [...source.candidates, ...routing.candidates, ...inbound.candidates];
    const buckets = bucketize(candidates, opts);
    const updates = toUpdateGroups(candidates, opts);

    console.log("\nInspected rows:");
    console.log(`- SourceLeadEvent: ${source.inspected}`);
    console.log(`- RoutingDryRunDecision: ${routing.inspected}`);
    console.log(`- InboundContactIndex: ${inbound.inspected}`);

    printBuckets(buckets);

    console.log("\nPlanned updates:");
    if (updates.length === 0) {
      console.log("- none");
    } else {
      for (const group of updates) {
        console.log(
          `- ${group.model} -> ${group.status} (${group.reason}) count=${group.ids.length}`
        );
      }
    }

    if (!opts.mark) {
      console.log("\nDry-run complete. No rows were updated.");
      return;
    }

    if (updates.length === 0) {
      console.log("\nMark mode complete. No updates were required.");
      return;
    }

    await applyUpdates(prisma, updates);
    console.log(`\nMark mode complete. Updated ${updates.reduce((sum, g) => sum + g.ids.length, 0)} row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

function isDirectExecution(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  return resolve(argvPath) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  runAuditScript().catch((err) => {
    console.error("audit-incomplete-leads failed:", err);
    process.exit(1);
  });
}
