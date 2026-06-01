import type { LucideIcon } from "lucide-react";

import type { PlanningStatus } from "../planning-status";

export type ArchitectureStatus = PlanningStatus;

export type ArchitectureTier = {
  id: string;
  label: string;
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
  caption?: string;
  description: string;
  icon: LucideIcon;
  status: ArchitectureStatus;
};

export type ArchitectureFlowStep = {
  ref: string;
  freeform?: boolean;
};

export type ArchitectureFlow = {
  id: string;
  title: string;
  description: string;
  status: ArchitectureStatus;
  steps: ArchitectureFlowStep[];
};
