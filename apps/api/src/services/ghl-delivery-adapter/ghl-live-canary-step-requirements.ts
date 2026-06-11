import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";

export type LiveCanaryStepRequirementFlags = {
  ownerRequired: boolean;
  workflowRequired: boolean;
  stampRequired: boolean;
};

export const DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY =
  "Required delivery completed. Optional enrichment needs config.";

const OPTIONAL_POST_CONTACT_STEP_TYPES = new Set([
  "assign_owner",
  "start_workflow",
  "stamp_custom_fields",
]);

export function getLiveCanaryStepRequirementFlags(
  ctx: GhlAdapterPlanContext
): LiveCanaryStepRequirementFlags {
  const cfg = ctx.destinationFieldMapping;
  return {
    ownerRequired: cfg?.ownerAssignmentRequired === true,
    workflowRequired: cfg?.workflowStartRequired === true,
    stampRequired: cfg?.customFieldStampRequired === true,
  };
}

export function isRequiredLiveCanaryStepFailure(
  stepType: string,
  flags: LiveCanaryStepRequirementFlags
): boolean {
  if (stepType === "write_backup_sheet") return false;
  if (stepType === "create_or_update_contact") return true;
  if (stepType === "add_tags") return true;
  if (stepType === "create_or_update_opportunity") return true;
  if (stepType === "assign_owner") return flags.ownerRequired;
  if (stepType === "start_workflow") return flags.workflowRequired;
  if (stepType === "stamp_custom_fields") return flags.stampRequired;
  return false;
}

export function isRequiredDeliveryPathComplete(
  stepOutcomes: Array<{ stepType: string; status: string }>,
  opportunityConfigured: boolean
): boolean {
  const statusOf = (stepType: string) =>
    stepOutcomes.find((s) => s.stepType === stepType)?.status;
  if (statusOf("create_or_update_contact") !== "succeeded") return false;
  if (statusOf("add_tags") !== "succeeded") return false;
  if (opportunityConfigured && statusOf("create_or_update_opportunity") !== "succeeded") {
    return false;
  }
  return true;
}

export function hasOptionalPostContactIssues(
  stepOutcomes: Array<{ stepType: string; status: string }>
): boolean {
  return stepOutcomes.some((s) => {
    if (!OPTIONAL_POST_CONTACT_STEP_TYPES.has(s.stepType)) return false;
    return (
      s.status === "optional_failed" ||
      s.status === "skipped" ||
      s.status === "failed" ||
      s.status === "partial_success"
    );
  });
}

export function deriveLiveCanaryRunStatus(input: {
  stepOutcomes: Array<{ stepType: string; status: string }>;
  flags: LiveCanaryStepRequirementFlags;
  contactIdGhl: string | null;
  opportunityConfigured: boolean;
}): "succeeded" | "partial_success" | "failed" {
  const { stepOutcomes, flags, contactIdGhl, opportunityConfigured } = input;

  const contact = stepOutcomes.find((s) => s.stepType === "create_or_update_contact");
  if (contact?.status === "failed" || !contactIdGhl) return "failed";

  if (opportunityConfigured) {
    const opp = stepOutcomes.find((s) => s.stepType === "create_or_update_opportunity");
    if (opp?.status === "failed") return "failed";
  }

  const tags = stepOutcomes.find((s) => s.stepType === "add_tags");
  if (tags?.status === "failed") return "failed";

  const requiredHardFailures = stepOutcomes.filter(
    (s) => s.status === "failed" && isRequiredLiveCanaryStepFailure(s.stepType, flags)
  );
  if (requiredHardFailures.length > 0) return "failed";

  const pathComplete = isRequiredDeliveryPathComplete(stepOutcomes, opportunityConfigured);
  if (!pathComplete) return "failed";

  if (hasOptionalPostContactIssues(stepOutcomes)) return "partial_success";
  return "succeeded";
}

export function liveCanaryRunSummaryForStatus(
  runStatus: "succeeded" | "partial_success" | "failed",
  requiredPathComplete: boolean
): string {
  if (runStatus === "succeeded") return "Live canary delivery completed successfully.";
  if (runStatus === "partial_success" && requiredPathComplete) {
    return DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY;
  }
  if (runStatus === "partial_success") {
    return "Live canary partially succeeded — review step errors and GHL subaccount before retry.";
  }
  return "Live canary delivery failed.";
}
