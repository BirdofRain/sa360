import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./public-site.css";

export const metadata: Metadata = {
  title: "Aged Vet Leads — Veteran leads for insurance agents",
  description:
    "Public landing for insurance agents buying Veteran leads. Preview states, quantity, and freshness, then sign in to submit a request. Payment is confirmed by our team.",
};

export default function PublicMarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
