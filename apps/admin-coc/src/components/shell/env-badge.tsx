import { Badge } from "@/components/ui/badge";
import { getPublicSa360Env } from "@/lib/env";
import { cn } from "@/lib/utils";

export function EnvBadge() {
  const env = getPublicSa360Env();

  const variant =
    env === "production"
      ? "border-amber-600/40 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
      : env === "staging"
        ? "border-blue-600/30 bg-blue-50 text-blue-950 dark:bg-blue-950/30 dark:text-blue-100"
        : "border-muted-foreground/25 bg-muted text-muted-foreground";

  const label =
    env === "production"
      ? "PRODUCTION"
      : env === "staging"
        ? "STAGING"
        : "DEVELOPMENT";

  return (
    <Badge
      variant="outline"
      className={cn("rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide", variant)}
    >
      {label}
    </Badge>
  );
}
