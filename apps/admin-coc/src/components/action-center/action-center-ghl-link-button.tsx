import { ExternalLink } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import type { GhlDeepLinkAction } from "@/lib/ghl/deep-links";
import { cn } from "@/lib/utils";

export function ActionCenterGhlLinkButton({
  action,
  variant = "outline",
  className,
  external = true,
}: {
  action: GhlDeepLinkAction;
  variant?: "default" | "outline";
  className?: string;
  /** When false, omits target=_blank (e.g. tel: links). */
  external?: boolean;
}) {
  const classes = cn(
    buttonVariants({ variant, size: "sm" }),
    "max-w-full truncate",
    className
  );

  if (action.disabled) {
    return (
      <button type="button" disabled title={action.title} className={classes}>
        {action.label}
      </button>
    );
  }

  return (
    <a
      href={action.href}
      title={action.title}
      className={cn(classes, "inline-flex items-center gap-1")}
      {...(external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {action.label}
      {external ? <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden /> : null}
    </a>
  );
}
