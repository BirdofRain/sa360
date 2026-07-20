/**
 * Authoritative Pipeline Studio read model.
 * Designed for a future single-read API. This slice uses fixtures only —
 * no inventory, routing, or fulfillment business logic.
 */

export type PipelineStudioDataSource = "mock";

export type PipelineStudioKpiTone = "good" | "warn" | "neutral" | "accent";

export type TerritoryPriority = "high" | "medium" | "low";

export type TerritoryHealth = "healthy" | "watch" | "critical" | "unavailable";

export type TerritoryRouteType = "primary" | "failover" | "backup" | "none";

export type DestinationType = "crm" | "power_dialer" | "auto_follow_up";

export type DestinationStatus = "active" | "idle" | "error";

export type RouteKind = "primary" | "failover" | "backup";

export type MapViewMode = "states" | "regions" | "markets" | "heatmap";

export const PIPELINE_STUDIO_PROTOTYPE_NOTICE =
  "Visual prototype using fixture data. Existing inventory and fulfillment systems are unchanged.";

export type TerritoryAgeBucket = {
  label: string;
  count: number;
};

export type PipelineStudioTerritory = {
  stateCode: string;
  stateName: string;
  selected: boolean;
  priority: TerritoryPriority;
  availableCount: number;
  estimatedLeadsPerDay: number;
  ageBuckets: TerritoryAgeBucket[];
  health: TerritoryHealth;
  routeType: TerritoryRouteType;
  /** Presentation anchor for SVG routes (fixture / future geo layer). */
  mapX: number;
  mapY: number;
};

export type PipelineStudioDestination = {
  id: string;
  type: DestinationType;
  name: string;
  status: DestinationStatus;
  successRate: number;
  recentVolume: number;
  enabled: boolean;
};

export type PipelineStudioRules = {
  dailyCap: number;
  speedToLeadTargetSeconds: number;
  workingHours: string;
  timezoneBehavior: string;
  complianceGuardrailSummary: string;
  failoverEnabled: boolean;
};

export type PipelineStudioMetrics = {
  deliveredLastSevenDays: number;
  averageSpeedToLeadSeconds: number;
  successRate: number;
  routeHealth: string;
  activeConnectionCount: number;
};

export type PipelineStudioCompliance = {
  status: string;
  proofCoveragePercent: number;
  warnings: string[];
  blockingReasons: string[];
};

export type PipelineStudioCapabilities = {
  canSaveDraft: boolean;
  canValidate: boolean;
  /** Must remain false for this fixture slice — no real publish path. */
  canPublish: false;
  /** Local browser toggles only when true; never persists to production. */
  canModifyDestinations: boolean;
};

export type PipelineStudioConnector = {
  id: string;
  label: string;
  kind: string;
};

export type PipelineStudioRoute = {
  id: string;
  fromCode: string;
  toCode: string;
  kind: RouteKind;
};

export type PipelineStudioMapState = {
  code: string;
  name: string;
  /** Simplified SVG path (viewBox 0 0 1000 620) */
  path: string;
  focus: boolean;
};

export type PipelineStudioMetricCard = {
  key: string;
  label: string;
  value: string;
  detail?: string;
  trend?: string;
  tone?: PipelineStudioKpiTone;
};

export type PipelineStudioReadModel = {
  generatedAt: string;
  dataSource: PipelineStudioDataSource;
  pipeline: {
    id: string;
    name: string;
    version: string;
    status: "active" | "draft";
    updatedAt: string;
  };
  origin: {
    label: string;
    city: string;
    state: string;
    latitude: number;
    longitude: number;
    mapX: number;
    mapY: number;
  };
  territories: PipelineStudioTerritory[];
  destinations: PipelineStudioDestination[];
  rules: PipelineStudioRules;
  metrics: PipelineStudioMetrics;
  compliance: PipelineStudioCompliance;
  capabilities: PipelineStudioCapabilities;
  /** Presentation-only connectors strip (not a production write surface). */
  connectors: PipelineStudioConnector[];
  /** Presentation-only map arcs between territory anchors. */
  routes: PipelineStudioRoute[];
  /** Presentation-only SVG state geometry. */
  mapStates: PipelineStudioMapState[];
};
