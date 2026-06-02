import type { LucideIcon } from "lucide-react";
import {
  Link2,
  Building2,
  Flag,
  GaugeCircle,
  History,
  KanbanSquare,
  Network,
  PhoneIncoming,
  Radar,
  Route,
  ShieldCheck,
  Settings,
  Webhook,
  Workflow,
  AlertOctagon,
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
  { href: "/automation-dashboard", label: "Automation Visibility", icon: Radar },
  { href: "/webhooks", label: "Webhook Monitor", icon: Webhook },
  { href: "/synthflow", label: "Synthflow Voice", icon: PhoneIncoming },
  { href: "/review", label: "Review Queue", icon: AlertOctagon },
  { href: "/lead-timeline", label: "Lead Timeline", icon: History },
  { href: "/routing-dry-run", label: "Routing Dry Run", icon: Route },
  { href: "/delivery-readiness", label: "Delivery Readiness", icon: ShieldCheck },
];

/** Configuration & accounts — order matches Figma reference. */
export const configurationNav: NavItem[] = [
  { href: "/clients", label: "Clients & Subaccounts", icon: Building2 },
  { href: "/ghl-connections", label: "GHL Connections", icon: Link2 },
  { href: "/flags", label: "Feature Flags", icon: Flag },
  { href: "/settings", label: "Settings & Env", icon: Settings },
];

/** Internal planning / reference surfaces — static seed data, no API wiring. */
export const planningNav: NavItem[] = [
  { href: "/launch-kanban", label: "Launch Kanban", icon: KanbanSquare },
  { href: "/workflow", label: "Workflow Map", icon: Workflow },
  { href: "/architecture", label: "Architecture", icon: Network },
];
