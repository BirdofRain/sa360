import type { LucideIcon } from "lucide-react";

export type ArchitectureStatus = "LIVE" | "BUILDING" | "NEXT" | "FUTURE";

export type ArchitectureTier = {
  id: string;
  /** Display label e.g. `"SA360 Application"`. */
  label: string;
  /** Sub-label e.g. `"Owned by SA360"`. */
  caption?: string;
  tone: {
    container: string;
    accent: string;
    eyebrow: string;
  };
  blocks: ArchitectureBlock[];
};

export type ArchitectureBlock = {
  id: string;
  name: string;
  /** Short subtitle under the name. */
  caption?: string;
  description: string;
  icon: LucideIcon;
  status: ArchitectureStatus;
};

export type ArchitectureFlowStep = {
  /** Either an `ArchitectureBlock.id` reference or a free-form label like `"Beta dashboards"`. */
  ref: string;
  /** If true, render as a free-form pill rather than a block reference. */
  freeform?: boolean;
};

export type ArchitectureFlow = {
  id: string;
  title: string;
  description: string;
  status: ArchitectureStatus;
  steps: ArchitectureFlowStep[];
};
