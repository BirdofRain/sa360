import { Queue } from "bullmq";
import { EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB, EXTERNAL_WEBHOOK_NOTICE_QUEUE } from "@sa360/shared";

import { redis } from "../../lib/redis.js";

let noticeQueue: Queue | null = null;

function getQueue(): Queue {
  if (!noticeQueue) noticeQueue = new Queue(EXTERNAL_WEBHOOK_NOTICE_QUEUE, { connection: redis });
  return noticeQueue;
}

export function wasExternalWebhookNoticeQueueOpened(): boolean {
  return noticeQueue !== null;
}

export async function closeExternalWebhookNoticeQueue(): Promise<void> {
  if (!noticeQueue) return;
  await noticeQueue.close();
  noticeQueue = null;
}

/** One job per receipt. A second add with the same id does not call the provider twice. */
export async function enqueueExternalWebhookNotice(receiptId: string): Promise<void> {
  await getQueue().add(
    EXTERNAL_WEBHOOK_NOTICE_DISPATCH_JOB,
    { receiptId },
    { jobId: receiptId, attempts: 1, removeOnComplete: true, removeOnFail: 20 }
  );
}
