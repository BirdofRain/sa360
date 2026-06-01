import type { ClientGhlDestination } from "@prisma/client";

/** Copy tenant GHL defaults onto a routing rule row (config only — no delivery). */
export function applyClientDestinationDefaultsToRule<
  T extends Record<string, unknown>,
>(rule: T, destination: ClientGhlDestination | null | undefined): T {
  if (!destination) return rule;
  const out = { ...rule };
  const assign = (key: keyof ClientGhlDestination, ruleKey: string) => {
    const v = destination[key];
    if (v !== null && v !== undefined && v !== "" && out[ruleKey] == null) {
      (out as Record<string, unknown>)[ruleKey] = v;
    }
  };
  assign("destinationSubaccountIdGhl", "destinationSubaccountIdGhl");
  assign("locationName", "locationName");
  assign("ghlConnectionStatus", "ghlConnectionStatus");
  assign("snapshotInstalled", "snapshotInstalled");
  assign("requiredFieldsInstalled", "requiredFieldsInstalled");
  assign("defaultAssignedUserIdGhl", "defaultAssignedUserIdGhl");
  assign("destinationWorkflowIdGhl", "destinationWorkflowIdGhl");
  assign("destinationPipelineIdGhl", "destinationPipelineIdGhl");
  assign("destinationPipelineStageIdGhl", "destinationPipelineStageIdGhl");
  assign("backupSheetEnabled", "backupSheetEnabled");
  assign("backupSheetId", "backupSheetId");
  assign("opportunityCreationEnabled", "opportunityCreationEnabled");
  return out;
}
