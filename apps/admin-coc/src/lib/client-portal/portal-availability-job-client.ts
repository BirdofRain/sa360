import type { PortalInventoryAvailabilityResponse } from "./portal-inventory-map";

export type PortalAvailabilityJobProgress = {
  phase: "starting" | "classifying";
  rowsClassified: number;
  selectableRowsExact: number | null;
  pagesRead: number;
};

const POLL_MS = 1_500;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
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
    availability?: PortalInventoryAvailabilityResponse;
  } | null;
  if (!started.ok || !startBody) {
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
  try {
    for (;;) {
      if (input.signal.aborted) {
        await cancelJob(jobId);
        throw new DOMException("Aborted", "AbortError");
      }
      const res = await fetch(pollUrl, {
        headers: { Accept: "application/json" },
        signal: input.signal,
      });
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        progress?: PortalAvailabilityJobProgress;
        availability?: PortalInventoryAvailabilityResponse;
      } | null;
      if (!res.ok || !body) {
        throw new Error("Inventory availability is temporarily unavailable.");
      }
      if (body.status === "complete" && body.availability?.ok) return body.availability;
      if (body.status !== "running") {
        throw new Error("Inventory availability is temporarily unavailable.");
      }
      if (body.progress) input.onProgress?.(body.progress);
      await delay(POLL_MS, input.signal);
    }
  } catch (error) {
    if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      await cancelJob(jobId);
      throw error instanceof DOMException ? error : new DOMException("Aborted", "AbortError");
    }
    await cancelJob(jobId);
    throw error;
  }
}
