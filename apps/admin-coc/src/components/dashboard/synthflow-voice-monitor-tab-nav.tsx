import Link from "next/link";

import { cn } from "@/lib/utils";

export function SynthflowVoiceMonitorTabNav({
  requestsHref,
  outboundHref,
  active,
}: {
  requestsHref: string;
  outboundHref: string;
  active: "requests" | "outbound";
}) {
  const triggerClass = (isActive: boolean) =>
    cn(
      "inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium transition-all outline-none",
      isActive
        ? "bg-background text-foreground shadow-sm border border-slate-200"
        : "border border-transparent text-slate-600 hover:bg-background/60 hover:text-foreground"
    );

  return (
    <div
      role="tablist"
      aria-label="Synthflow Voice Monitor views"
      className="inline-flex h-9 w-fit items-center justify-center rounded-lg border border-slate-200 bg-muted p-[3px] text-muted-foreground"
    >
      <Link role="tab" aria-selected={active === "requests"} href={requestsHref} className={triggerClass(active === "requests")}>
        Request logs
      </Link>
      <Link role="tab" aria-selected={active === "outbound"} href={outboundHref} className={triggerClass(active === "outbound")}>
        Outbound results
      </Link>
    </div>
  );
}
