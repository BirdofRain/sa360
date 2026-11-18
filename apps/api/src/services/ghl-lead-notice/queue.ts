import { Queue } from "bullmq";
import { GHL_LEAD_NOTICE_DISPATCH_JOB, GHL_LEAD_NOTICE_QUEUE } from "@sa360/shared";

import { redis } from "../../lib/redis.js";

let noticeQueue: Queue | null = null;

function getQueue(): Queue {
  if (!noticeQueue) noticeQueue = new Queue(GHL_LEAD_NOTICE_QUEUE, { connection: redis });
  return noticeQueue;
}

export async function enqueueGhlLeadNotice(receiptId: string): Promise<"queued" | "already_queued"> {
  try {
    await getQueue().add(
      GHL_LEAD_NOTICE_DISPATCH_JOB,
      { receiptId },
      { jobId: receiptId, attempts: 1, removeOnComplete: true, removeOnFail: 20 }
    );
    return "queued";
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
    if (message.toLowerCase().includes("already")) return "already_queued";
    throw error;
  }
}
