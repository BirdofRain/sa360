import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set your password",
  description: "Set a password for your SA360 portal.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PortalInviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
