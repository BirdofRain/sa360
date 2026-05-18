import { Bot, Calendar, MessageSquare, Phone, UserRound } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeTime } from "@/lib/action-center/format";
import type { AiActivityFeedItem, AiActivityFeedKind } from "@/lib/action-center/types";
import { cn } from "@/lib/utils";

const KIND_META: Record<
  AiActivityFeedKind,
  { icon: typeof Bot; className: string }
> = {
  voice: { icon: Phone, className: "bg-violet-100 text-violet-700" },
  sms: { icon: MessageSquare, className: "bg-sky-100 text-sky-700" },
  appointment: { icon: Calendar, className: "bg-emerald-100 text-emerald-700" },
  routing: { icon: UserRound, className: "bg-amber-100 text-amber-800" },
  handoff: { icon: Bot, className: "bg-slate-200 text-slate-700" },
};

export function ActionCenterAiFeed({ items }: { items: AiActivityFeedItem[] }) {
  return (
    <Card className="border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-slate-900">
          <Bot className="size-4 text-slate-500" aria-hidden />
          AI activity feed
        </CardTitle>
        <CardDescription>Recent automation touching your book of business</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[min(280px,38vh)]">
          <ul className="space-y-0 divide-y divide-slate-100">
            {items.map((item) => {
              const meta = KIND_META[item.kind];
              const Icon = meta.icon;
              return (
                <li key={item.id} className="flex gap-3 px-4 py-3 hover:bg-slate-50/80">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                      meta.className
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{item.title}</p>
                      <time className="shrink-0 text-[11px] text-slate-400">
                        {formatRelativeTime(item.at)}
                      </time>
                    </div>
                    {item.detail ? (
                      <p className="mt-0.5 text-xs leading-snug text-slate-600">{item.detail}</p>
                    ) : null}
                    {item.displayName ? (
                      <p className="mt-1 text-[11px] text-slate-400">{item.displayName}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
