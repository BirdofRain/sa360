/**
 * Paginated run index for finding an incident run id. Rows carry statuses and
 * sanitized codes only. Use the run detail diagnostic for one run's evidence.
 */

import type { Prisma } from "@prisma/client";

import { sanitizeCode } from "./sanitize.js";
import type { DiagnosticsDb } from "./read-only.js";
import { encodeRunCursor, type DiagnosticWindow, type RunCursor } from "./window.js";

export type GhlRunListItem = {
  id: string;
  clientAccountId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  workflowStartRequiredRecorded: boolean | null;
  steps: Array<{ stepType: string; status: string; errorCode: string | null }>;
};

export type GhlRunList = {
  window: { from: string; to: string };
  items: GhlRunListItem[];
  nextCursor: string | null;
};

export async function loadGhlRunList(
  db: DiagnosticsDb,
  input: {
    window: DiagnosticWindow;
    clientAccountId: string | null;
    status: string | null;
    limit: number;
    cursor: RunCursor | null;
  }
): Promise<GhlRunList> {
  const and: Prisma.GhlLiveDeliveryRunWhereInput[] = [];
  if (input.cursor) {
    and.push({
      OR: [
        { startedAt: { lt: input.cursor.startedAt } },
        { startedAt: input.cursor.startedAt, id: { lt: input.cursor.id } },
      ],
    });
  }
  const rows = await db.ghlLiveDeliveryRun.findMany({
    where: {
      mode: "ongoing_association",
      startedAt: { gte: input.window.from, lt: input.window.to },
      ...(input.clientAccountId ? { destinationClientAccountId: input.clientAccountId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      id: true,
      destinationClientAccountId: true,
      status: true,
      startedAt: true,
      completedAt: true,
      workflowStartRequired: true,
      stepRuns: {
        orderBy: { stepOrder: "asc" },
        select: { stepType: true, status: true, errorCode: true },
      },
    },
  });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    window: { from: input.window.from.toISOString(), to: input.window.to.toISOString() },
    items: page.map((row) => ({
      id: row.id,
      clientAccountId: row.destinationClientAccountId,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      workflowStartRequiredRecorded: row.workflowStartRequired,
      steps: row.stepRuns.map((step) => ({
        stepType: step.stepType,
        status: step.status,
        errorCode: sanitizeCode(step.errorCode),
      })),
    })),
    nextCursor: rows.length > input.limit && last ? encodeRunCursor({ startedAt: last.startedAt, id: last.id }) : null,
  };
}
