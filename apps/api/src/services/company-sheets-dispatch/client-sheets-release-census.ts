import { COMPANY_SHEETS_EXECUTION_LEASE_MS } from "@sa360/shared";

import {
  planPreMigrationLeadJobQuarantine,
  readClientSheetsHistoryCoverage,
  type HistoryCoverageSnapshot,
  type SheetsPersonDb,
} from "./client-sheets-person-gate.js";

const OPEN_JOB_CAP = 50;
const QUARANTINE_CAP = 50;
const SA360_JOB_INDEX_ORIGIN = "delivery_index";
const LIVE_RESERVATION_ORIGIN = "live_reservation";
const IMPORTED_ZAP_ORIGIN = "historical_baseline";
const KNOWN_ORIGINS = new Set([SA360_JOB_INDEX_ORIGIN, LIVE_RESERVATION_ORIGIN, IMPORTED_ZAP_ORIGIN]);

export type SheetsAdmissionOriginCount = {
  origin: string;
  total: number;
  byStatus: Record<string, number>;
};

export type SheetsReleaseCensus = {
  clientAccountId: string;
  history: HistoryCoverageSnapshot & {
    cursor: { createdAt: string; jobId: string } | null;
    updatedAt: string | null;
    /** True only when status is complete and the proof is cursor_exhausted or no_eligible_jobs. */
    sa360JobHistoryComplete: boolean;
  };
  admissions: {
    sa360JobIndex: SheetsAdmissionOriginCount;
    liveReservation: SheetsAdmissionOriginCount;
    importedZapHistory: SheetsAdmissionOriginCount;
    unknownOrigins: SheetsAdmissionOriginCount[];
  };
  jobs: {
    byKindStatus: Array<{ kind: string; status: string; count: number }>;
    open: Array<{
      jobId: string;
      kind: string;
      status: string;
      appendStartedAt: string | null;
      uncertainReason: string | null;
      rowsWritten: number;
      claimHeld: boolean;
      claimWithinLease: boolean;
    }>;
    openTruncated: boolean;
  };
  locks: Array<{ worksheetId: number; ownerJobId: string; lockedAt: string | null }>;
  creatingTabs: Array<{ role: string; worksheetId: number | null; updatedAt: string }>;
  quarantine: {
    strategy: "quarantine_until_reconciled";
    ran: false;
    count: number;
    jobs: Array<{ jobId: string; sourceLeadEventId: string; status: string; reason: "no_person_admission" }>;
    truncated: boolean;
  };
  switches: {
    readOnly: true;
    campaignDispatchEnabled: boolean;
    campaignDispatchNotBefore: string | null;
    agedDispatchEnabled: boolean;
    agedDispatchNotBefore: string | null;
  };
  incomplete: string[];
};

function originCount(
  origin: string,
  groups: Array<{ origin: string; status: string; _count: { _all: number } }>
): SheetsAdmissionOriginCount {
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const group of groups) {
    if (group.origin !== origin) continue;
    byStatus[group.status] = (byStatus[group.status] ?? 0) + group._count._all;
    total += group._count._all;
  }
  return { origin, total, byStatus };
}

function sa360HistoryComplete(history: HistoryCoverageSnapshot): boolean {
  return (
    history.status === "complete" &&
    (history.completenessProof === "cursor_exhausted" || history.completenessProof === "no_eligible_jobs")
  );
}

/**
 * Read-only release census for one client.
 * Reuses history coverage and the pre-migration quarantine plan.
 * Does not call Google, append a row, replay a lead, or change dispatch switches.
 */
export async function readClientSheetsReleaseCensus(
  db: SheetsPersonDb,
  clientAccountId: string,
  now: Date = new Date()
): Promise<SheetsReleaseCensus> {
  const id = clientAccountId.trim();
  const leaseCutoff = now.getTime() - COMPANY_SHEETS_EXECUTION_LEASE_MS;
  const [history, coverage, admissionGroups, jobGroups, openJobs, destination, quarantine] = await Promise.all([
    readClientSheetsHistoryCoverage(db, id),
    db.clientSheetsHistoryCoverage.findUnique({ where: { clientAccountId: id } }),
    db.clientSheetsPersonAdmission.groupBy({
      by: ["origin", "status"],
      where: { clientAccountId: id },
      _count: { _all: true },
    }),
    db.companySheetsDeliveryJob.groupBy({
      by: ["kind", "status"],
      where: { clientAccountId: id },
      _count: { _all: true },
    }),
    db.companySheetsDeliveryJob.findMany({
      where: { clientAccountId: id, status: { in: ["queued", "retryable", "running", "uncertain"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: OPEN_JOB_CAP + 1,
      select: {
        id: true,
        kind: true,
        status: true,
        appendStartedAt: true,
        uncertainReason: true,
        rowsWritten: true,
        startedAt: true,
        updatedAt: true,
      },
    }),
    db.companySheetsDestination.findUnique({
      where: { clientAccountId: id },
      select: {
        id: true,
        spreadsheetId: true,
        campaignDispatchEnabled: true,
        campaignDispatchNotBefore: true,
        agedDispatchEnabled: true,
        agedDispatchNotBefore: true,
      },
    }),
    planPreMigrationLeadJobQuarantine(db, id),
  ]);
  const tabs = destination
    ? await db.companySheetsTabContract.findMany({
        where: { destinationId: destination.id },
        select: { role: true, setupState: true, worksheetId: true, updatedAt: true },
      })
    : [];
  const locks = destination
    ? await db.companySheetsWorksheetLock.findMany({
        where: { spreadsheetId: destination.spreadsheetId, ownerJobId: { not: null } },
        select: { worksheetId: true, ownerJobId: true, lockedAt: true },
      })
    : [];
  const openTruncated = openJobs.length > OPEN_JOB_CAP;
  const visibleOpen = openTruncated ? openJobs.slice(0, OPEN_JOB_CAP) : openJobs;
  const unknownOrigins = [...new Set(admissionGroups.map((group) => group.origin).filter((origin) => !KNOWN_ORIGINS.has(origin)))]
    .sort()
    .map((origin) => originCount(origin, admissionGroups));
  const incomplete = [
    "This census is one client only.",
    "Sheet cell values are not read.",
    "Unimported Zap deliveries are not counted. Imported Zap history is historical_baseline and is separate from SA360 delivery_index history.",
    "The dispatch drain lock is a Postgres advisory lock. This read does not acquire it and does not list it.",
    "indexedCount is not completeness proof. Use history.status and history.completenessProof.",
  ];
  if (!destination) {
    incomplete.push("No Sheets destination is saved for this client, so worksheet locks and creating tabs cannot be listed.");
  }
  if (openTruncated) incomplete.push(`Open job list is capped at ${OPEN_JOB_CAP}.`);
  if (quarantine.jobs.length > QUARANTINE_CAP) incomplete.push(`Quarantine job list is capped at ${QUARANTINE_CAP}.`);
  return {
    clientAccountId: id,
    history: {
      ...history,
      cursor:
        coverage?.cursorCreatedAt && coverage.cursorJobId
          ? { createdAt: coverage.cursorCreatedAt.toISOString(), jobId: coverage.cursorJobId }
          : null,
      updatedAt: coverage?.updatedAt?.toISOString() ?? null,
      sa360JobHistoryComplete: sa360HistoryComplete(history),
    },
    admissions: {
      sa360JobIndex: originCount(SA360_JOB_INDEX_ORIGIN, admissionGroups),
      liveReservation: originCount(LIVE_RESERVATION_ORIGIN, admissionGroups),
      importedZapHistory: originCount(IMPORTED_ZAP_ORIGIN, admissionGroups),
      unknownOrigins,
    },
    jobs: {
      byKindStatus: jobGroups
        .map((group) => ({ kind: group.kind, status: group.status, count: group._count._all }))
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.status.localeCompare(right.status)),
      open: visibleOpen.map((job) => {
        const anchor = job.startedAt ?? job.updatedAt;
        const claimHeld = job.status === "running";
        return {
          jobId: job.id,
          kind: job.kind,
          status: job.status,
          appendStartedAt: job.appendStartedAt?.toISOString() ?? null,
          uncertainReason: job.uncertainReason,
          rowsWritten: job.rowsWritten,
          claimHeld,
          claimWithinLease: claimHeld && anchor.getTime() >= leaseCutoff,
        };
      }),
      openTruncated,
    },
    locks: locks.flatMap((lock) =>
      lock.ownerJobId
        ? [{ worksheetId: lock.worksheetId, ownerJobId: lock.ownerJobId, lockedAt: lock.lockedAt?.toISOString() ?? null }]
        : []
    ),
    creatingTabs: tabs
      .filter((tab) => tab.setupState === "creating")
      .map((tab) => ({ role: tab.role, worksheetId: tab.worksheetId, updatedAt: tab.updatedAt.toISOString() })),
    quarantine: {
      strategy: quarantine.strategy,
      ran: false,
      count: quarantine.jobs.length,
      jobs: quarantine.jobs.slice(0, QUARANTINE_CAP),
      truncated: quarantine.jobs.length > QUARANTINE_CAP,
    },
    switches: {
      readOnly: true,
      campaignDispatchEnabled: destination?.campaignDispatchEnabled === true,
      campaignDispatchNotBefore: destination?.campaignDispatchNotBefore?.toISOString() ?? null,
      agedDispatchEnabled: destination?.agedDispatchEnabled === true,
      agedDispatchNotBefore: destination?.agedDispatchNotBefore?.toISOString() ?? null,
    },
    incomplete,
  };
}
