"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const LIVE_REFRESH_MS = 10_000;

/** Refreshes the server-rendered webhook list while live testing mode is on. */
export function WebhookMonitorLiveRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        router.refresh();
      } finally {
        // router.refresh is sync kickoff; allow the next interval after the min gap.
        window.setTimeout(() => {
          inFlightRef.current = false;
        }, LIVE_REFRESH_MS);
      }
    };

    const id = window.setInterval(tick, LIVE_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Do not immediately storm; wait for the next interval.
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      inFlightRef.current = false;
    };
  }, [enabled, router]);

  if (!enabled) return null;

  return (
    <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
      Live testing mode · Showing newest webhook calls first · Auto-refresh every 10 seconds
    </p>
  );
}
