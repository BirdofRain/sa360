/** Static roadmap boundary copy for Lead Fulfillment OS — demo/planning data only. */
export type RoadmapBoundaryItem = {
  id: string;
  title: string;
};

export type RoadmapBoundarySection = {
  id: "legacy" | "deprecated";
  title: string;
  eyebrow: string;
  items: RoadmapBoundaryItem[];
};

export const ROADMAP_BOUNDARY_SECTIONS: RoadmapBoundarySection[] = [
  {
    id: "legacy",
    title: "Legacy / Retainer Only",
    eyebrow: "Maintain existing pathways — no net-new roadmap expansion",
    items: [
      { id: "LG1", title: "Existing CRM support" },
      { id: "LG2", title: "Existing GHL workflow maintenance" },
      { id: "LG3", title: "Existing Synthflow support" },
      { id: "LG4", title: "Existing CloseBot support" },
      { id: "LG5", title: "Existing voice AI support" },
    ],
  },
  {
    id: "deprecated",
    title: "Deprecated / Do Not Build",
    eyebrow: "Explicit out-of-scope bets for the Lead Fulfillment OS roadmap",
    items: [
      { id: "DP1", title: "Blue/green channel selection expansion" },
      { id: "DP2", title: "SendBlue fallback optimization" },
      { id: "DP3", title: "New Synthflow feature work" },
      { id: "DP4", title: "New CloseBot feature work" },
      { id: "DP5", title: "New voice AI routing/orchestration" },
      { id: "DP6", title: "Orion-style front-end AI/CRM clone" },
    ],
  },
];
