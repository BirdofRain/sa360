import type { PortalInventoryAvailabilityResponse } from "./portal-inventory-map";

export type PortalAvailabilityJobProgress = {
  phase: "starting" | "classifying";
  rowsClassified: number;
  selectableRowsExact: number | null;
  pagesRead: number;
};

const POLL_MS = 1_500;

export const PORTAL_AVAILABILITY_BUSY_MESSAGE =
  "Another availability count is still running. Wait for it to finish, then check again. No leads were reserved.";

export const PORTAL_AVAILABILITY_EXPIRED_MESSAGE =
  "This check expired because the page stopped checking in. A background tab can delay polling. No availability total is shown. Run the check again and keep this tab open until it finishes.";

export const PORTAL_AVAILABILITY_LOST_MESSAGE =
  "This availability check is no longer running. A restart or deployment can cause that. No availability total is shown. Run the check again.";

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      reject(new DOMException("Aborted", "AbortError"));
    };
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") finish();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
  });
}

async function cancelJob(jobId: string) {
  await fetch(`/api/client-portal/leads-on-demand/availability/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => undefined);
}

export async function loadPortalInventoryAvailabilityThroughJob(input: {
  nicheKey: string;
  requestedAgeBucket: string;
  requestedQuantity: number;
  signal: AbortSignal;
  onProgress?: (progress: PortalAvailabilityJobProgress) => void;
}): Promise<PortalInventoryAvailabilityResponse> {
  const started = await fetch("/api/client-portal/leads-on-demand/availability/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      nicheKey: input.nicheKey,
      requestedAgeBucket: input.requestedAgeBucket,
      requestedQuantity: input.requestedQuantity,
    }),
    signal: input.signal,
  });
  const startBody = (await started.json().catch(() => null)) as {
    status?: string;
    jobId?: string;
    code?: string;
    availability?: PortalInventoryAvailabilityResponse;
  } | null;
  if (!started.ok || !startBody) {
    if (startBody?.code === "availability_job_busy") {
      throw new Error(PORTAL_AVAILABILITY_BUSY_MESSAGE);
    }
    throw new Error("Inventory availability is temporarily unavailable.");
  }
  if (startBody.status === "complete" && startBody.availability?.ok) {
    return startBody.availability;
  }
  if (startBody.status !== "running" || typeof startBody.jobId !== "string") {
    throw new Error("Inventory availability is temporarily unavailable.");
  }

  const jobId = startBody.jobId;
  const pollUrl =
    `/api/client-portal/leads-on-demand/availability/jobs/${encodeURIComponent(jobId)}` +
    `?nicheKey=${encodeURIComponent(input.nicheKey)}` +
    `&requestedAgeBucket=${encodeURIComponent(input.requestedAgeBucket)}` +
    `&requestedQuantity=${encodeURIComponent(String(input.requestedQuantity))}`;
  for (;;) {
    if (input.signal.aborted) {
      await cancelJob(jobId);
      throw new DOMException("Aborted", "AbortError");
    }
    let res: Response;
    try {
      res = await fetch(pollUrl, {
        headers: { Accept: "application/json" },
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        await cancelJob(jobId);
        throw error instanceof DOMException ? error : new DOMException("Aborted", "AbortError");
      }
      await delay(POLL_MS, input.signal);
      continue;
    }
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      code?: string;
      progress?: PortalAvailabilityJobProgress;
      availability?: PortalInventoryAvailabilityResponse;
    } | null;
    if (res.status === 404 || body?.code === "job_not_found") {
      throw new Error(PORTAL_AVAILABILITY_LOST_MESSAGE);
    }
    if (body?.code === "availability_job_expired") {
      throw new Error(PORTAL_AVAILABILITY_EXPIRED_MESSAGE);
    }
    if (!res.ok || !body) {
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new Error("Inventory availability is temporarily unavailable.");
      }
      await delay(POLL_MS, input.signal);
      continue;
    }
    if (body.status === "complete" && body.availability?.ok) return body.availability;
    if (body.status === "running") {
      if (body.progress) input.onProgress?.(body.progress);
      await delay(POLL_MS, input.signal);
      continue;
    }
    throw new Error("Inventory availability is temporarily unavailable.");
  }
}
