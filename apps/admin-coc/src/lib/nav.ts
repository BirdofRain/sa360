import type { LucideIcon } from "lucide-react";
import {
  Flag,
  LayoutDashboard,
  PhoneIncoming,
  Settings,
  Users,
  Webhook,
  Inbox,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const mainNav: NavItem[] = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/webhooks", label: "Webhook Monitor", icon: Webhook },
  { href: "/synthflow", label: "Synthflow Voice", icon: PhoneIncoming },
  { href: "/clients", label: "Clients / Subaccounts", icon: Users },
  { href: "/review", label: "Review Queue", icon: Inbox },
  { href: "/flags", label: "Feature Flags", icon: Flag },
  { href: "/settings", label: "Settings", icon: Settings },
];
