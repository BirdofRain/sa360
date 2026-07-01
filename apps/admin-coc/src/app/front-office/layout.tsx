import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Front Office | SA360",
  description: "SA360 Front Office — operational cockpit for leads, delivery, and trust.",
};

export default function FrontOfficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
