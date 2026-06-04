"use client";

import { isSupportTicketsEnabled } from "@/lib/support-tickets/config";
import type { SupportTicketContextOverride } from "@/lib/support-tickets/types";

import { SupportTicketButton } from "./SupportTicketButton";

/** Global floating support entry — hidden when feature flag is off. */
export function SupportTicketLauncher() {
  if (!isSupportTicketsEnabled()) return null;
  return <SupportTicketButton variant="floating" />;
}

export function SupportTicketInlineButton({
  contextOverride,
  label = "Report issue",
}: {
  contextOverride?: SupportTicketContextOverride;
  label?: string;
}) {
  if (!isSupportTicketsEnabled()) return null;
  return (
    <SupportTicketButton
      variant="inline"
      contextOverride={contextOverride}
      className="h-8"
      label={label}
    />
  );
}
