import Link from "next/link";

import { URGENT_SEVERITY_DISPLAY, formatRelativeTime } from "@/lib/front-office/display";
import type { FrontOfficeUrgentTask } from "@/lib/front-office/types";
import { FoStatusPill } from "../shared/fo-status-pill";

export function FoUrgentTasksPanel({ tasks }: { tasks: FrontOfficeUrgentTask[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Urgent tasks</h2>
      </div>
      <ul className="divide-y divide-slate-100">
        {tasks.map((task) => {
          const style = URGENT_SEVERITY_DISPLAY[task.severity];
          const content = (
            <>
              <FoStatusPill label={style.label} className={style.className} />
              <span className="mt-2 block text-sm text-slate-800">{task.title}</span>
              <span className="mt-1 block text-[11px] text-slate-400">
                {formatRelativeTime(task.at)}
              </span>
            </>
          );
          return (
            <li key={task.id} className="px-4 py-3">
              {task.href ? (
                <Link href={task.href} className="block hover:opacity-80">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
