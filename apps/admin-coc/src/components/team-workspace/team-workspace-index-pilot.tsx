import type { ReactNode } from "react";

import styles from "./life-agent-launch-pilot.module.css";

/**
 * Visual boundary for the /team-workspace index.
 * Imported only by that page. Client detail, the dashboard shell, and other routes do not render it.
 * Headings use the app's existing Inter font from the root layout.
 */
export function TeamWorkspaceIndexPilot({ children }: { children: ReactNode }) {
  return (
    <div className={styles.boundary} data-lal-pilot="team-workspace-index">
      {children}
    </div>
  );
}
