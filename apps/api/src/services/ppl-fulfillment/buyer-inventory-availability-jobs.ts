import { randomUUID } from "node:crypto";

import {
  lookupBuyerInventoryAvailability,
  validateBuyerInventoryAvailabilityRequest,
  type BuyerInventoryAvailabilityReport,
  type BuyerInventoryAvailabilityResult,
} from "./buyer-inventory-availability.service.js";

/**
 * One snapshot holds one of the API process's three pooled connections for
 * the whole count. A second concurrent count would leave a single connection
 * for every other request on that process.
 */
export const BUYER_AVAILABILITY_JOB_CONCURRENCY = 1;

/**
 * A hidden browser tab can delay timers for longer than a minute, and Safari
 * can freeze them until the tab is visible again. This window is longer than
 * the 300-second snapshot, so a throttled tab does not lose a count that is
 * still running. The snapshot timeout, an explicit cancel, and a real failure
 * still release the connection. This idle expiry is the backstop when polls
 * never return and the snapshot has not ended.
 */
export const BUYER_AVAILABILITY_JOB_POLL_IDLE_MS = 10 * 60 * 1000;

export const BUYER_AVAILABILITY_JOB_EXPIRED = "availability_job_expired";

export const BUYER_AVAILABILITY_JOB_RESULT_TTL_MS = 15 * 60 * 1000;

const SWEEP_INTERVAL_MS = 5_000;

export const BUYER_AVAILABILITY_JOB_EFFECTS = {
  orderCreated: false,
  reservationCreated: false,
  deliveryRecorded: false,
  csvGenerated: false,
  sourceDataMutated: false,
} as const;

export type BuyerAvailabilityJobStatus = "running" | "complete" | "failed" | "cancelled";

export type BuyerAvailabilityJobProgress = {
  phase: "starting" | "classifying";
  rowsClassified: number;
  selectableRowsExact: number | null;
  pagesRead: number;
};

export type BuyerAvailabilityJobAudience =
  | { kind: "admin" }
  | { kind: "portal"; clientAccountId: string };

export type BuyerAvailabilityJobRequest = {
  clientAccountId: string;
  nicheKey: string;
  states?: string[];
  commerceAgeBucketKeys?: string[];
};

export type BuyerAvailabilityJobFailure = {
  code: string;
};

export type BuyerAvailabilityJobView = {
  ok: true;
  jobId: string;
  status: BuyerAvailabilityJobStatus;
  readOnly: true;
  effects: typeof BUYER_AVAILABILITY_JOB_EFFECTS;
  progress: BuyerAvailabilityJobProgress;
  /** Present only when status is complete. An interrupted job never includes it. */
  result?: BuyerInventoryAvailabilityReport;
  failure?: BuyerAvailabilityJobFailure;
};

export type BuyerAvailabilityJobStart =
  | {
      ok: true;
      jobId: string;
      status: "running";
      readOnly: true;
      effects: typeof BUYER_AVAILABILITY_JOB_EFFECTS;
    }
  | {
      ok: false;
      code:
        | "invalid_niche"
        | "invalid_states"
        | "invalid_age_buckets"
        | "availability_job_busy";
      reasons: string[];
    };

type AvailabilityLookup = (input: {
  clientAccountId: string;
  nicheKey: string;
  states?: readonly string[] | null;
  commerceAgeBucketKeys?: unknown;
  signal?: AbortSignal;
  onProgress?: (progress: {
    phase: "classifying";
    pagesRead: number;
    rowsClassified: number;
    selectableRowsExact: number;
  }) => void;
}) => Promise<BuyerInventoryAvailabilityResult>;

type JobRecord = {
  id: string;
  audience: BuyerAvailabilityJobAudience;
  request: BuyerAvailabilityJobRequest;
  status: BuyerAvailabilityJobStatus;
  progress: BuyerAvailabilityJobProgress;
  result?: BuyerInventoryAvailabilityReport;
  failure?: BuyerAvailabilityJobFailure;
  abort: AbortController;
  lastSeenAt: number;
  finishedAt?: number;
  slotHeld: boolean;
};

const jobs = new Map<string, JobRecord>();
let activeJobId: string | null = null;
let sweeper: NodeJS.Timeout | null = null;

function emptyProgress(): BuyerAvailabilityJobProgress {
  return {
    phase: "starting",
    rowsClassified: 0,
    selectableRowsExact: null,
    pagesRead: 0,
  };
}

function sameAudience(
  job: BuyerAvailabilityJobAudience,
  caller: BuyerAvailabilityJobAudience
): boolean {
  if (job.kind !== caller.kind) return false;
  if (job.kind === "portal" && caller.kind === "portal") {
    return job.clientAccountId === caller.clientAccountId;
  }
  return true;
}

function releaseSlot(job: JobRecord) {
  if (!job.slotHeld) return;
  job.slotHeld = false;
  if (activeJobId === job.id) activeJobId = null;
}

function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    sweepBuyerInventoryAvailabilityJobs(Date.now());
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();
}

export function sweepBuyerInventoryAvailabilityJobs(
  now = Date.now(),
  pollIdleMs = BUYER_AVAILABILITY_JOB_POLL_IDLE_MS
) {
  for (const job of jobs.values()) {
    if (job.status === "running" && now - job.lastSeenAt > pollIdleMs) {
      expireRecord(job, now);
    }
    if (job.finishedAt != null && now - job.finishedAt > BUYER_AVAILABILITY_JOB_RESULT_TTL_MS) {
      jobs.delete(job.id);
    }
  }
}

function cancelRecord(job: JobRecord, now: number) {
  if (job.status === "running") {
    job.status = "cancelled";
    job.result = undefined;
    job.failure = undefined;
    job.finishedAt = now;
  }
  job.abort.abort();
}

function expireRecord(job: JobRecord, now: number) {
  if (job.status !== "running") return;
  job.status = "failed";
  job.failure = { code: BUYER_AVAILABILITY_JOB_EXPIRED };
  job.result = undefined;
  job.finishedAt = now;
  job.abort.abort();
}

function viewOf(job: JobRecord): BuyerAvailabilityJobView {
  const view: BuyerAvailabilityJobView = {
    ok: true,
    jobId: job.id,
    status: job.status,
    readOnly: true,
    effects: BUYER_AVAILABILITY_JOB_EFFECTS,
    progress: { ...job.progress },
  };
  if (job.status === "complete" && job.result) {
    view.result = job.result;
  }
  if (job.status === "failed" && job.failure) {
    view.failure = { code: job.failure.code };
  }
  return view;
}

export function startBuyerInventoryAvailabilityJob(
  input: {
    audience: BuyerAvailabilityJobAudience;
    request: BuyerAvailabilityJobRequest;
    lookup?: AvailabilityLookup;
    now?: number;
  }
): BuyerAvailabilityJobStart {
  const validated = validateBuyerInventoryAvailabilityRequest({
    nicheKey: input.request.nicheKey,
    states: input.request.states,
    commerceAgeBucketKeys: input.request.commerceAgeBucketKeys,
  });
  if (!validated.ok) return validated;
  sweepBuyerInventoryAvailabilityJobs(input.now ?? Date.now());
  if (activeJobId) {
    return {
      ok: false,
      code: "availability_job_busy",
      reasons: ["availability_job_busy"],
    };
  }

  const now = input.now ?? Date.now();
  const job: JobRecord = {
    id: `bav_${randomUUID()}`,
    audience: input.audience,
    request: {
      clientAccountId: input.request.clientAccountId.trim(),
      nicheKey: input.request.nicheKey,
      ...(input.request.states ? { states: input.request.states } : {}),
      ...(input.request.commerceAgeBucketKeys
        ? { commerceAgeBucketKeys: input.request.commerceAgeBucketKeys }
        : {}),
    },
    status: "running",
    progress: emptyProgress(),
    abort: new AbortController(),
    lastSeenAt: now,
    slotHeld: true,
  };
  jobs.set(job.id, job);
  activeJobId = job.id;
  ensureSweeper();

  const lookup = input.lookup ?? lookupBuyerInventoryAvailability;
  void runJob(job, lookup);
  return {
    ok: true,
    jobId: job.id,
    status: "running",
    readOnly: true,
    effects: BUYER_AVAILABILITY_JOB_EFFECTS,
  };
}

async function runJob(job: JobRecord, lookup: AvailabilityLookup) {
  try {
    const result = await lookup({
      clientAccountId: job.request.clientAccountId,
      nicheKey: job.request.nicheKey,
      states: job.request.states,
      commerceAgeBucketKeys: job.request.commerceAgeBucketKeys,
      signal: job.abort.signal,
      onProgress: (progress) => {
        if (job.status !== "running") return;
        job.progress = {
          phase: "classifying",
          pagesRead: progress.pagesRead,
          rowsClassified: progress.rowsClassified,
          selectableRowsExact: progress.selectableRowsExact,
        };
      },
    });
    if (job.status !== "running" || job.abort.signal.aborted) {
      if (job.status === "running") {
        job.status = "cancelled";
        job.failure = undefined;
        job.finishedAt = Date.now();
      }
      job.result = undefined;
      job.finishedAt = job.finishedAt ?? Date.now();
      return;
    }
    if (!result.ok) {
      job.status = "failed";
      job.failure = { code: result.code };
      job.result = undefined;
      job.finishedAt = Date.now();
      return;
    }
    job.status = "complete";
    job.result = result;
    job.failure = undefined;
    job.finishedAt = Date.now();
  } catch {
    if (job.status !== "running") {
      job.result = undefined;
      return;
    }
    if (job.abort.signal.aborted) {
      job.status = "cancelled";
      job.failure = undefined;
      job.result = undefined;
      job.finishedAt = job.finishedAt ?? Date.now();
      return;
    }
    job.status = "failed";
    job.failure = { code: "availability_job_failed" };
    job.result = undefined;
    job.finishedAt = Date.now();
  } finally {
    releaseSlot(job);
  }
}

export function readBuyerInventoryAvailabilityJob(
  jobId: string,
  audience: BuyerAvailabilityJobAudience,
  now = Date.now()
): BuyerAvailabilityJobView | { ok: false; code: "job_not_found" } {
  const job = jobs.get(jobId);
  if (!job || !sameAudience(job.audience, audience)) {
    return { ok: false, code: "job_not_found" };
  }
  if (job.status === "running") job.lastSeenAt = now;
  return viewOf(job);
}

export function cancelBuyerInventoryAvailabilityJob(
  jobId: string,
  audience: BuyerAvailabilityJobAudience,
  now = Date.now()
):
  | { ok: true; jobId: string; status: BuyerAvailabilityJobStatus }
  | { ok: false; code: "job_not_found" } {
  const job = jobs.get(jobId);
  if (!job || !sameAudience(job.audience, audience)) {
    return { ok: false, code: "job_not_found" };
  }
  if (job.status === "running") cancelRecord(job, now);
  return { ok: true, jobId: job.id, status: job.status };
}

export function resetBuyerInventoryAvailabilityJobsForTests() {
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
  for (const job of jobs.values()) {
    job.abort.abort();
    job.slotHeld = false;
  }
  jobs.clear();
  activeJobId = null;
}
