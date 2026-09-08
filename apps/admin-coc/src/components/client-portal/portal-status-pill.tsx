import { cn } from "@/lib/utils";

export function PortalStatusPill({
  label,
  tone = "neutral",
  kind,
}: {
  label: string;
  tone?: "good" | "warn" | "bad" | "neutral";
  kind?: "order" | "payment";
}) {
  const accessibilityLabel =
    kind === "payment" ? `Payment status: ${label}` : kind === "order" ? `Order status: ${label}` : label;
  return (
    <span
      role="status"
      aria-label={accessibilityLabel}
      className={cn(
        "inline-flex w-fit max-w-full shrink-0 self-start items-center rounded-full border px-2 py-0.5 text-left text-xs font-medium",
        tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "bad" && "border-red-200 bg-red-50 text-red-800",
        tone === "neutral" && "border-slate-200 bg-slate-50 text-slate-700"
      )}
    >
      {label}
    </span>
  );
}
