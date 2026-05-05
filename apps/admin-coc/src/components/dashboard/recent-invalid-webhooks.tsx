import Link from "next/link";

import type { AdminWebhookListItem } from "@/lib/admin-api/types";
import { Badge } from "@/components/ui/badge";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function RecentInvalidWebhooks({ items }: { items: AdminWebhookListItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500">
        No recent invalid webhook requests (validation_failed / unauthorized) in the sampled batch.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((row) => (
        <li key={row.id} className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{formatTime(row.receivedAt)}</span>
                <Badge variant="destructive" className="text-[10px]">
                  {row.processingStatus}
                </Badge>
                <span className="truncate font-mono text-xs text-slate-700">{row.route}</span>
              </div>
              <p className="line-clamp-2 text-xs text-slate-600" title={row.errorSummary ?? undefined}>
                {row.errorSummary ?? "—"}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RecentInvalidWebhooksFooter() {
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <Link href="/webhooks" className="text-xs font-medium text-slate-700 underline-offset-4 hover:underline">
        Open Webhook Monitor →
      </Link>
    </div>
  );
}
