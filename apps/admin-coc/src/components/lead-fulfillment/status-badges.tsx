import { Badge } from "@/components/ui/badge";
import type {
  LeadInventoryStatus,
  LeadProofStatus,
  LeadVerificationStatus,
} from "@/lib/lead-fulfillment/types";
import { cn } from "@/lib/utils";

function badgeTone(status: string): string {
  if (status === "attached" || status === "passed" || status === "available" || status === "delivered") {
    return "bg-emerald-50 text-emerald-900 border-emerald-200";
  }
  if (status === "needs_review" || status === "missing" || status === "reserved" || status === "unchecked") {
    return "bg-amber-50 text-amber-900 border-amber-200";
  }
  if (status === "rejected" || status === "failed" || status === "unavailable") {
    return "bg-red-50 text-red-900 border-red-200";
  }
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function ProofStatusBadge({ status }: { status: LeadProofStatus }) {
  return (
    <Badge variant="outline" className={cn("text-xs capitalize", badgeTone(status))}>
      {formatStatusLabel(status)}
    </Badge>
  );
}

export function VerificationStatusBadge({ status }: { status: LeadVerificationStatus }) {
  return (
    <Badge variant="outline" className={cn("text-xs capitalize", badgeTone(status))}>
      {formatStatusLabel(status)}
    </Badge>
  );
}

export function InventoryStatusBadge({ status }: { status: LeadInventoryStatus }) {
  return (
    <Badge variant="outline" className={cn("text-xs capitalize", badgeTone(status))}>
      {formatStatusLabel(status)}
    </Badge>
  );
}
