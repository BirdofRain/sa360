import { cn } from "@/lib/utils";

export function FoStatusPill({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        className
      )}
    >
      {label}
    </span>
  );
}
