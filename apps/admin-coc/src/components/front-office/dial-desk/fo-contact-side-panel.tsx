import { formatDateTime } from "@/lib/front-office/display";
import type { DialDeskContact } from "@/lib/front-office/types";

export function FoContactSidePanel({ contact }: { contact: DialDeskContact }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Notes</h3>
        <ul className="mt-2 space-y-2">
          {contact.notes.map((note, i) => (
            <li key={i} className="text-sm text-slate-600">
              {note}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Timeline</h3>
        <ul className="mt-2 space-y-3">
          {contact.timeline.map((entry, i) => (
            <li key={i} className="text-sm">
              <span className="text-[11px] text-slate-400">
                {formatDateTime(entry.at)}
              </span>
              <p className="text-slate-700">{entry.summary}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-4">
        <h3 className="text-sm font-semibold text-violet-900">AI status</h3>
        <p className="mt-1 text-sm text-violet-800">
          {contact.aiStatus === "engaged"
            ? "AI is actively nurturing this lead. Human takeover recommended for quote discussion."
            : contact.aiStatus === "needs_human"
              ? "AI escalated — agent action required."
              : "AI idle — awaiting trigger or manual outreach."}
        </p>
      </div>
    </div>
  );
}
