import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
  description: "What you need to do next for your account and orders.",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
