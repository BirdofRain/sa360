"use client";

import { cn } from "@/lib/utils";
import type { DialQueueItem } from "@/lib/front-office/types";
import { formatRelativeTime } from "@/lib/front-office/display";

const PRIORITY_STYLE = {
  hot: "border-l-red-500 bg-red-50/50",
  warm: "border-l-amber-500 bg-amber-50/30",
  standard: "border-l-slate-300",
};

export function FoDialQueue({
  items,
  activeUid,
  onSelect,
}: {
  items: DialQueueItem[];
  activeUid?: string;
  onSelect: (uid: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Dial queue</h2>
        <p className="text-xs text-slate-500">{items.length} leads waiting</p>
      </div>
      <ul className="max-h-[480px] overflow-y-auto">
        {items.map((item) => (
          <li key={item.leadUid}>
            <button
              type="button"
              onClick={() => onSelect(item.leadUid)}
              className={cn(
                "w-full border-l-4 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                PRIORITY_STYLE[item.priority],
                activeUid === item.leadUid && "bg-slate-100"
              )}
            >
              <p className="text-sm font-medium text-slate-900">{item.leadName}</p>
              <p className="text-xs text-slate-500">{item.phoneMasked}</p>
              <p className="mt-1 text-[11px] text-slate-400">{item.campaign}</p>
              {item.lastTouchAt ? (
                <p className="text-[11px] text-slate-400">
                  {formatRelativeTime(item.lastTouchAt)}
                </p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
