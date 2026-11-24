import { Figtree } from "next/font/google";
import type { ReactNode } from "react";

import styles from "./life-agent-launch-pilot.module.css";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-lal-heading",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

/**
 * Visual boundary for the /team-workspace index.
 * Imported only by that page. Client detail, the dashboard shell, and other routes do not render it.
 */
export function TeamWorkspaceIndexPilot({ children }: { children: ReactNode }) {
  return (
    <div className={`${figtree.variable} ${styles.boundary}`} data-lal-pilot="team-workspace-index">
      {children}
    </div>
  );
}
