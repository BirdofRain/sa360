import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset for your SA360 portal.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PortalForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
