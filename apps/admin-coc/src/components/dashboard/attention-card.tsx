import Link from "next/link";

import type { AttentionRead } from "@/lib/command-center/attention-read";
import { cn } from "@/lib/utils";

export function AttentionCardLoading({ title }: { title: string }) {
  return (
    <article
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      aria-busy="true"
      data-testid="attention-card-loading"
    >
      <h3 className="text-sm font-medium text-slate-800">{title}</h3>
      <p className="mt-3 text-sm text-slate-500" role="status">
        Loading…
      </p>
    </article>
  );
}

export function AttentionCard({
  title,
  hint,
  href,
  emptyHint,
  read,
  testId,
  detail,
}: {
  title: string;
  hint: string;
  href: string;
  emptyHint: string;
  read: AttentionRead;
  testId: string;
  /** Shown only after a successful read, for example when the count was refreshed. */
  detail?: string;
}) {
  const ready = read.state === "ready";
  const count = ready ? read.count : null;
  const body = (
    <>
      <h3 className="text-sm font-medium text-slate-800">{title}</h3>
      {ready ? (
        <>
          <p
            className={cn(
              "mt-2 text-[26px] font-medium tracking-tight",
              count === 0 ? "text-slate-900" : "text-amber-800"
            )}
            data-testid={`${testId}-count`}
          >
            {count}
          </p>
          <p className="mt-1 text-xs text-slate-500">{count === 0 ? emptyHint : hint}</p>
          {detail ? (
            <p className="mt-2 text-xs text-slate-400" data-testid={`${testId}-refreshed`}>
              {detail}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium text-slate-700" data-testid={`${testId}-unavailable`}>
            Unavailable
          </p>
          <p className="mt-1 text-xs text-slate-500">{read.reason}</p>
        </>
      )}
    </>
  );

  if (!ready) {
    return (
      <article
        className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
        data-testid={testId}
      >
        {body}
      </article>
    );
  }

  return (
    <Link
      href={href}
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:border-slate-300"
      data-testid={testId}
    >
      {body}
      <p className="mt-3 text-xs font-medium text-slate-700 underline-offset-4 hover:underline">
        Open queue
      </p>
    </Link>
  );
}
