export function shouldShowInternalCanaryReviewAction(input: {
  internalApprovalSatisfied: boolean;
  effectiveRuntimeMode: string;
  liveCanaryClientMatch: boolean;
  waveSize: number;
  maxWaveSize: number;
}): boolean {
  return (
    !input.internalApprovalSatisfied &&
    input.effectiveRuntimeMode === "live_canary" &&
    input.liveCanaryClientMatch &&
    input.waveSize <= input.maxWaveSize
  );
}
