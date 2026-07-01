"use client";

import { useEffect, useState } from "react";

import { CocDetailViewShell } from "@/components/CocDetailViewShell";
import {
  DELIVERY_STATUS_DISPLAY,
  formatDateTime,
} from "@/lib/front-office/display";
import type { LeadDeliveryDetail } from "@/lib/front-office/types";
import { FoMilestoneTimeline } from "../shared/fo-milestone-timeline";
import { FoStatusPill } from "../shared/fo-status-pill";

export function FoLeadDeliveryDrawer({
  leadUid,
  open,
  onOpenChange,
}: {
  leadUid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<LeadDeliveryDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !leadUid) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetch(`/api/front-office/lead-delivery/${encodeURIComponent(leadUid)}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; detail?: LeadDeliveryDetail }) => {
        setDetail(data.ok && data.detail ? data.detail : null);
      })
      .finally(() => setLoading(false));
  }, [open, leadUid]);

  const status = detail
    ? DELIVERY_STATUS_DISPLAY[detail.deliveryStatus]
    : null;

  return (
    <CocDetailViewShell
      open={open}
      onOpenChange={onOpenChange}
      title={detail?.leadName ?? "Lead delivery"}
      subtitle={detail ? `${detail.leadUid} · ${detail.matchedClient}` : undefined}
    >
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !detail ? (
        <p className="text-sm text-slate-500">Lead not found.</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            {status ? (
              <FoStatusPill label={status.label} className={status.className} />
            ) : null}
            <span className="text-xs text-slate-500">
              Received {formatDateTime(detail.receivedAt)}
            </span>
          </div>
          {detail.error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {detail.error}
            </p>
          ) : null}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Delivery timeline
            </h3>
            {detail.timeline.length === 0 ? (
              <p className="text-sm text-slate-500">
                No milestone events recorded yet for this lead.
              </p>
            ) : (
              <FoMilestoneTimeline entries={detail.timeline} />
            )}
          </div>
        </div>
      )}
    </CocDetailViewShell>
  );
}
