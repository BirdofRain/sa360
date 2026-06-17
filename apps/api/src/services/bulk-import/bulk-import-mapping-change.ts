import type { ImportMappingChangeSummary } from "./csv-import-mapping.service.js";

export type MappingChangeImpact = {
  mappingChanged: boolean;
  resetRequired: boolean;
  sourceLeadEventsToRemove: number;
  simulationArtifactsToRemove: number;
  deliveredRows: number;
  destinationWillBePreserved: boolean;
  changeSummary?: ImportMappingChangeSummary;
};

export class MappingChangeRequiresResetError extends Error {
  readonly impact: MappingChangeImpact;

  constructor(impact: MappingChangeImpact) {
    super("mapping_change_requires_reset");
    this.name = "MappingChangeRequiresResetError";
    this.impact = impact;
  }
}
