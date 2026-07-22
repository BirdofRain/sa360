import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Boxes,
  ClipboardList,
  Link2,
  Building2,
  Flag,
  GaugeCircle,
  History,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Network,
  PackageCheck,
  PhoneIncoming,
  Radar,
  Route,
  Send,
  ShieldCheck,
  Settings,
  Webhook,
  Workflow,
  AlertOctagon,
  LifeBuoy,
  Upload,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Placeholder badge until API wiring (e.g. counts). Omit for no badge. */
  badge?: string;
};

/** Primary ops surfaces — order matches Figma internal admin reference. */
export const operationsNav: NavItem[] = [
  { href: "/", label: "Command Center", icon: GaugeCircle },
  { href: "/front-office", label: "Front Office", icon: LayoutDashboard },
  {
    href: "/lead-fulfillment",
    label: "Lead Fulfillment Overview",
    icon: PackageCheck,
  },
  {
    href: "/fulfillment-ops",
    label: "Fulfillment Ops",
    icon: ClipboardList,
  },
  { href: "/lead-inventory", label: "Lead Inventory", icon: Boxes },
  { href: "/automation-dashboard", label: "Automation Visibility", icon: Radar },
  { href: "/webhooks", label: "Webhook Monitor", icon: Webhook },
  { href: "/source-intake", label: "Source Intake Queue", icon: Inbox },
  { href: "/synthflow", label: "Synthflow Voice", icon: PhoneIncoming },
  { href: "/review", label: "Review Queue", icon: AlertOctagon },
  { href: "/lead-timeline", label: "Lead Timeline", icon: History },
  { href: "/routing-dry-run", label: "Routing Dry Run", icon: Route },
  { href: "/direct-delivery-demo", label: "Direct Delivery Demo", icon: Send },
  { href: "/delivery-readiness", label: "Delivery Readiness", icon: ShieldCheck },
];

export const bulkImportsNavItem: NavItem = {
  href: "/source-intake/imports",
  label: "Bulk Imports",
  icon: Upload,
};

/** Configuration & accounts — order matches Figma reference. */
export const configurationNav: NavItem[] = [
  { href: "/clients", label: "Clients & Subaccounts", icon: Building2 },
  { href: "/ghl-connections", label: "GHL Connections", icon: Link2 },
  { href: "/flags", label: "Feature Flags", icon: Flag },
  { href: "/settings", label: "Settings & Env", icon: Settings },
];

/** Shown when NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED is true. */
export const supportTicketsNavItem: NavItem = {
  href: "/support-tickets",
  label: "Support Tickets",
  icon: LifeBuoy,
};

/** Internal planning / reference surfaces — static seed data, no API wiring. */
export const planningNav: NavItem[] = [
  { href: "/launch-kanban", label: "Launch Kanban", icon: KanbanSquare },
  { href: "/workflow", label: "Workflow Map", icon: Workflow },
  { href: "/architecture", label: "Architecture", icon: Network },
  { href: "/planning/pivot-archive", label: "Pivot Archive", icon: Archive },
];
