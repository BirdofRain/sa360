import type { LucideIcon } from "lucide-react";
import {
  GaugeCircle,
  PackageCheck,
  ShoppingCart,
  ShieldCheck,
  PhoneCall,
} from "lucide-react";

import type { FrontOfficeRole } from "./types";

export type FrontOfficeNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: FrontOfficeRole[];
};

export const frontOfficeNavItems: FrontOfficeNavItem[] = [
  {
    href: "/front-office",
    label: "Dashboard",
    icon: GaugeCircle,
    roles: ["admin", "client", "agent"],
  },
  {
    href: "/front-office/lead-delivery",
    label: "Lead Delivery",
    icon: PackageCheck,
    roles: ["admin", "client", "agent"],
  },
  {
    href: "/front-office/orders",
    label: "Orders",
    icon: ShoppingCart,
    roles: ["admin", "client"],
  },
  {
    href: "/front-office/trust",
    label: "Trust Center",
    icon: ShieldCheck,
    roles: ["admin", "client"],
  },
  {
    href: "/front-office/dial-desk",
    label: "Dial Desk",
    icon: PhoneCall,
    roles: ["admin", "agent"],
  },
];

export function filterNavByRole(role: FrontOfficeRole): FrontOfficeNavItem[] {
  return frontOfficeNavItems.filter((item) => item.roles.includes(role));
}

const ROUTE_ACL: { prefix: string; roles: FrontOfficeRole[] }[] = [
  { prefix: "/front-office/dial-desk", roles: ["admin", "agent"] },
  { prefix: "/front-office/orders", roles: ["admin", "client"] },
  { prefix: "/front-office/trust", roles: ["admin", "client"] },
  { prefix: "/front-office/lead-delivery", roles: ["admin", "client", "agent"] },
  { prefix: "/front-office", roles: ["admin", "client", "agent"] },
];

export function canAccessRoute(role: FrontOfficeRole, pathname: string): boolean {
  if (pathname === "/front-office/login-chooser") return true;
  const match = ROUTE_ACL.find((entry) =>
    pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)
  );
  if (!match) return true;
  return match.roles.includes(role);
}

export function roleBadgeLabel(role: FrontOfficeRole): string {
  if (role === "admin") return "Operator";
  if (role === "client") return "Client";
  return "Agent";
}
