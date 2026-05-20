import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Lead performance overview — appointments, funnel, and activity.",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
