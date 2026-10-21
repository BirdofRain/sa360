import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Boxes,
  Bot,
  Building2,
  ClipboardList,
  Flag,
  GaugeCircle,
  History,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Link2,
  ListChecks,
  Network,
  PackageCheck,
  PhoneIncoming,
  Radar,
  Route,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Upload,
  Webhook,
  Workflow,
  LifeBuoy,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Placeholder badge until API wiring (e.g. counts). Omit for no badge. */
  badge?: string;
};

/**
 * COC shell destination for order review and approval.
 * Team Orders uses this href. Front Office stays at `/front-office`.
 * `/front-office/orders` remains that shell's order list.
 */
export const COC_ORDERS_HREF = "/orders";

/**
 * Everyday ADMIN sidebar group. These labels organize the current admin
 * session. They are not a separate role.
 */
export const teamNav: NavItem[] = [
  { href: "/", label: "Command Center", icon: GaugeCircle },
  {
    href: "/lead-fulfillment",
    label: "Lead Fulfillment Overview",
    icon: PackageCheck,
  },
  { href: COC_ORDERS_HREF, label: "Orders", icon: ShoppingCart },
  {
    href: "/fulfillment-ops",
    label: "Fulfillment Ops",
    icon: ClipboardList,
  },
  { href: "/lead-inventory", label: "Lead Inventory", icon: Boxes },
  { href: "/clients", label: "Clients & Subaccounts", icon: Building2 },
  { href: "/source-intake", label: "Source Intake Queue", icon: Inbox },
  { href: "/lead-timeline", label: "Lead Timeline", icon: History },
];

export const bulkImportsNavItem: NavItem = {
  href: "/source-intake/imports",
  label: "Bulk Imports",
  icon: Upload,
};

/**
 * ADMIN management group: diagnostics, configuration, legacy shells, and
 * planning. Collapsed in the sidebar unless the open page is in this group.
 */
export const adminToolsNav: NavItem[] = [
  { href: "/webhooks", label: "Webhook Monitor", icon: Webhook },
  { href: "/facebook-intake", label: "Facebook Intake", icon: Inbox },
  { href: "/routing-dry-run", label: "Routing Dry Run", icon: Route },
  { href: "/delivery-readiness", label: "Delivery Readiness", icon: ShieldCheck },
  { href: "/direct-delivery-demo", label: "Direct Delivery Demo", icon: Send },
  { href: "/synthflow", label: "Synthflow Voice", icon: PhoneIncoming },
  { href: "/automation-dashboard", label: "Automation Visibility", icon: Radar },
  { href: "/ghl-connections", label: "GHL Connections", icon: Link2 },
  { href: "/flags", label: "Feature Flags", icon: Flag },
  { href: "/settings", label: "Settings & Env", icon: Settings },
  { href: "/front-office", label: "Front Office", icon: LayoutDashboard },
  { href: "/action-center", label: "Action Center", icon: ListChecks },
  { href: "/agent-workspace", label: "Agent Workspace", icon: Bot },
  { href: "/launch-kanban", label: "Launch Kanban", icon: KanbanSquare },
  { href: "/workflow", label: "Workflow Map", icon: Workflow },
  { href: "/architecture", label: "Architecture", icon: Network },
  { href: "/planning/pivot-archive", label: "Pivot Archive", icon: Archive },
];

/** Shown when NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED is true. */
export const supportTicketsNavItem: NavItem = {
  href: "/support-tickets",
  label: "Support Tickets",
  icon: LifeBuoy,
};

/** Planning routes rendered inside Admin Tools. */
export const planningNav: NavItem[] = adminToolsNav.filter((item) =>
  ["/launch-kanban", "/workflow", "/architecture", "/planning/pivot-archive"].includes(
    item.href
  )
);

export function visibleAdminNavItems(options: {
  bulkImports: boolean;
  supportTickets: boolean;
}): NavItem[] {
  const adminTools = [...adminToolsNav];
  if (options.bulkImports) adminTools.push(bulkImportsNavItem);
  if (options.supportTickets) adminTools.push(supportTicketsNavItem);
  return [...teamNav, ...adminTools];
}

export function adminToolsSectionItems(options: {
  bulkImports: boolean;
  supportTickets: boolean;
}): NavItem[] {
  const items = [...adminToolsNav];
  if (options.bulkImports) items.push(bulkImportsNavItem);
  if (options.supportTickets) items.push(supportTicketsNavItem);
  return items;
}
