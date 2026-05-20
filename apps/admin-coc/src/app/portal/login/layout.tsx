import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your performance dashboard.",
};

export default function PortalLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
