"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const LIVE_REFRESH_MS = 10_000;

/** Refreshes the server-rendered webhook list while live testing mode is on. */
export function WebhookMonitorLiveRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => router.refresh(), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, router]);

  if (!enabled) return null;

  return (
    <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
      Live testing mode · Showing newest webhook calls first · Auto-refresh every 10 seconds
    </p>
  );
}
