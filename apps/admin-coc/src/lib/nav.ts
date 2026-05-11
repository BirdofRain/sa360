import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Building2,
  Flag,
  GaugeCircle,
  History,
  KanbanSquare,
  Network,
  PhoneIncoming,
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
  { href: "/webhooks", label: "Webhook Monitor", icon: Webhook },
  { href: "/synthflow", label: "Synthflow Voice", icon: PhoneIncoming },
  { href: "/review", label: "Review Queue", icon: AlertOctagon },
  { href: "/timeline", label: "Event Timeline", icon: History },
];

/** Configuration & accounts — order matches Figma reference. */
export const configurationNav: NavItem[] = [
  { href: "/clients", label: "Clients & Subaccounts", icon: Building2 },
  { href: "/clients/detail", label: "Client Detail", icon: Activity },
  { href: "/flags", label: "Feature Flags", icon: Flag },
  { href: "/settings", label: "Settings & Env", icon: Settings },
];

/** Internal planning / reference surfaces — static seed data, no API wiring. */
export const planningNav: NavItem[] = [
  { href: "/launch-kanban", label: "Launch Kanban", icon: KanbanSquare },
  { href: "/workflow", label: "Workflow Map", icon: Workflow },
  { href: "/architecture", label: "Architecture", icon: Network },
];
