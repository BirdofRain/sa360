/**
 * Local reference data for the SA360 modular workflow page.
 * Static; no API call.
 */

export type WorkflowStatus = "LIVE" | "BUILDING" | "NEXT" | "FUTURE";

export type WorkflowBranchTone = "neutral" | "success" | "failure" | "next";

export type WorkflowCard = {
  /** Display id like `M1A`, `M2A.5`, `M3V-B`. */
  id: string;
  title: string;
  bullets: string[];
  status: WorkflowStatus;
  fieldChips?: string[];
  /** Optional short note rendered under the bullets in italic muted text. */
  footnote?: string;
};

export type WorkflowBranch = {
  /** e.g. `"Reply detected"`. */
  trigger: string;
  /** e.g. `"M2D"` or `"M3V-A → M3V-B → M3V-C"`. */
  target: string;
  tone: WorkflowBranchTone;
};

export type WorkflowModule = {
  id: string;
  /** Long form, e.g. `"Module 1 — Intake + Attribution Fabric"`. */
  title: string;
  short: string;
  purpose: string;
  /** Tailwind classes for the module wrapper. Kept in data to keep markup mechanical. */
  tone: {
    container: string;
    accent: string;
    eyebrow: string;
  };
  cards: WorkflowCard[];
  branches?: WorkflowBranch[];
  fieldChips?: string[];
};
