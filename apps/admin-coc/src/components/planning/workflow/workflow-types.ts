import type { PlanningStatus } from "../planning-status";

export type WorkflowStatus = PlanningStatus;

export type WorkflowBranchTone = "neutral" | "success" | "failure" | "next";

export type WorkflowCard = {
  id: string;
  title: string;
  bullets: string[];
  status: WorkflowStatus;
  fieldChips?: string[];
  footnote?: string;
};

export type WorkflowBranch = {
  trigger: string;
  target: string;
  tone: WorkflowBranchTone;
};

export type WorkflowModule = {
  id: string;
  title: string;
  short: string;
  purpose: string;
  /** Module-level rollup badge shown in the section header. */
  moduleStatus: WorkflowStatus;
  tone: {
    container: string;
    accent: string;
    eyebrow: string;
  };
  cards: WorkflowCard[];
  branches?: WorkflowBranch[];
  fieldChips?: string[];
};
