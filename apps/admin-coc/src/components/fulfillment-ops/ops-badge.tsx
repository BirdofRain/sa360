import { Badge } from "@/components/ui/badge";
import { opsBadgeClass, type OpsBadgeTone } from "@/lib/fulfillment-ops/status";
import { cn } from "@/lib/utils";

export function OpsBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: OpsBadgeTone;
}) {
  return (
    <Badge variant="outline" className={cn("text-[10px] font-semibold tracking-wide", opsBadgeClass(tone))}>
      {label}
    </Badge>
  );
}
