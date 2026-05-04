import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Building2,
  Flag,
  GaugeCircle,
  History,
  PhoneIncoming,
  Settings,
  Webhook,
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
