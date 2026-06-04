"use client";

import { useRouter } from "next/navigation";

import type { SupportTicketListQuery } from "@/lib/support-tickets/types";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from "@/lib/support-tickets/types";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function SupportTicketsFilters({ initial }: { initial: SupportTicketListQuery }) {
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const status = String(fd.get("status") ?? "all");
    const priority = String(fd.get("priority") ?? "all");
    const category = String(fd.get("category") ?? "all");
    const search = String(fd.get("search") ?? "").trim();
    if (status !== "all") params.set("status", status);
    if (priority !== "all") params.set("priority", priority);
    if (category !== "all") params.set("category", category);
    if (search) params.set("search", search);
    const q = params.toString();
    router.push(q ? `/support-tickets?${q}` : "/support-tickets");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <label className="space-y-1 text-xs text-slate-500">
        Status
        <select name="status" className={selectClass} defaultValue={initial.status ?? "all"}>
          <option value="all">All</option>
          {SUPPORT_TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs text-slate-500">
        Priority
        <select name="priority" className={selectClass} defaultValue={initial.priority ?? "all"}>
          <option value="all">All</option>
          {SUPPORT_TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs text-slate-500">
        Category
        <select name="category" className={selectClass} defaultValue={initial.category ?? "all"}>
          <option value="all">All</option>
          {SUPPORT_TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-[200px] flex-1 space-y-1 text-xs text-slate-500">
        Search
        <input
          name="search"
          type="search"
          defaultValue={initial.search ?? ""}
          placeholder="Subject, description, or ticket #"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <button
        type="submit"
        className="inline-flex h-9 items-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white"
      >
        Apply
      </button>
    </form>
  );
}
