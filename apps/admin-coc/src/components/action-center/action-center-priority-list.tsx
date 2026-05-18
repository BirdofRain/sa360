import { Clock, Phone, Sparkles } from "lucide-react";

import { ActionCenterGhlLinkButton } from "@/components/action-center/action-center-ghl-link-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatPhoneDisplay,
  formatPremium,
  formatRelativeTime,
} from "@/lib/action-center/format";
import type { PriorityCallItem, PriorityCallReasonCode } from "@/lib/action-center/types";
import { resolveGhlPriorityLeadLinks } from "@/lib/ghl/deep-links";
import { cn } from "@/lib/utils";

const REASON_LABEL: Record<PriorityCallReasonCode, string> = {
  ai_appointment_ready: "AI appointment",
  hot_lead: "Hot lead",
  callback_due: "Callback",
  revenue_signal: "Revenue",
  stale_follow_up: "Stale",
};

const REASON_BADGE: Record<PriorityCallReasonCode, string> = {
  ai_appointment_ready: "border-sky-200 bg-sky-50 text-sky-800",
  hot_lead: "border-amber-200 bg-amber-50 text-amber-900",
  callback_due: "border-violet-200 bg-violet-50 text-violet-800",
  revenue_signal: "border-emerald-200 bg-emerald-50 text-emerald-800",
  stale_follow_up: "border-slate-200 bg-slate-100 text-slate-700",
};

export function ActionCenterPriorityList({
  items,
  locationId,
}: {
  items: PriorityCallItem[];
  locationId?: string | null;
}) {
  return (
    <Card className="h-full border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
      <CardHeader className="border-b border-slate-100 bg-slate-50/80">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg text-slate-900">
              <Sparkles className="size-5 text-amber-500" aria-hidden />
              Call these first
            </CardTitle>
            <CardDescription className="mt-1">
              Ranked by revenue impact and time sensitivity — start at #1
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
            {items.length} queued
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-3 sm:p-4">
        {items.map((item) => (
          <PriorityRow
            key={item.contactIdGhl || `rank-${item.rank}`}
            item={item}
            locationId={locationId}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function PriorityRow({
  item,
  locationId,
}: {
  item: PriorityCallItem;
  locationId?: string | null;
}) {
  const premium = formatPremium(item.estimatedPremium);
  const isTop = item.rank === 1;
  const links = resolveGhlPriorityLeadLinks({
    locationId,
    contactIdGhl: item.contactIdGhl,
    phoneE164: item.phoneE164,
    appointmentStatus: item.appointmentStatus,
    dueBy: item.dueBy,
    reasonCode: item.reasonCode,
  });

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 transition-colors sm:flex-row sm:gap-4 sm:p-4",
        isTop
          ? "border-amber-300/80 bg-gradient-to-r from-amber-50/90 to-white shadow-sm ring-1 ring-amber-200/60"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
      )}
    >
      <div className="flex gap-3 sm:contents">
        <div className="flex flex-col items-center gap-0.5">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums",
              isTop ? "bg-amber-500 text-white" : "bg-slate-900 text-white"
            )}
            aria-hidden
          >
            {item.rank}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:hidden">
            Score {item.priorityScore}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{item.displayName}</h3>
            <Badge
              variant="outline"
              className={cn("text-[10px] font-semibold", REASON_BADGE[item.reasonCode])}
            >
              {REASON_LABEL[item.reasonCode]}
            </Badge>
            {item.lifecycleStage ? (
              <span className="font-mono text-[10px] text-slate-400">{item.lifecycleStage}</span>
            ) : null}
          </div>

          <p className="mt-1 text-sm leading-snug text-slate-600">{item.reason}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 font-medium text-slate-800">
              <Phone className="size-3.5 text-slate-400" aria-hidden />
              {formatPhoneDisplay(item.phoneE164)}
            </span>
            {item.dueBy ? (
              <span className="inline-flex items-center gap-1 text-amber-800">
                <Clock className="size-3.5" aria-hidden />
                Due {formatRelativeTime(item.dueBy)}
              </span>
            ) : null}
            {premium ? (
              <span className="font-medium text-emerald-700">{premium} est.</span>
            ) : null}
            {item.lastTouchAt ? (
              <span>Last touch {formatRelativeTime(item.lastTouchAt)}</span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5 sm:hidden">
            <ActionCenterGhlLinkButton action={links.callNext} variant="default" external={false} />
            <ActionCenterGhlLinkButton action={links.openInGhl} />
            <ActionCenterGhlLinkButton action={links.openConversation} />
            <ActionCenterGhlLinkButton action={links.openCalendar} />
          </div>
        </div>
      </div>

      <div className="hidden shrink-0 flex-col items-stretch gap-1 sm:flex sm:w-[11.5rem]">
        <span className="text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Score {item.priorityScore}
        </span>
        <ActionCenterGhlLinkButton action={links.callNext} variant="default" external={false} />
        <ActionCenterGhlLinkButton action={links.openInGhl} />
        <ActionCenterGhlLinkButton action={links.openConversation} />
        <ActionCenterGhlLinkButton action={links.openCalendar} />
      </div>
    </article>
  );
}
