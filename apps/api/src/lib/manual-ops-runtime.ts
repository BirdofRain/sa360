/**
 * Guard for manual operational CLIs that must never import the API Prisma
 * singleton while NODE_ENV=test. Does not touch DATABASE_URL checks.
 */
export const MANUAL_OPS_REFUSED_TEST_RUNTIME = "REFUSED_TEST_RUNTIME" as const;

export function isManualOpsTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "test";
}

export function buildRefusedTestRuntimePayload(cliName: string): {
  outcome: "REFUSED";
  ok: false;
  reasonCode: typeof MANUAL_OPS_REFUSED_TEST_RUNTIME;
  code: typeof MANUAL_OPS_REFUSED_TEST_RUNTIME;
  writesAttempted: false;
  reason: string;
} {
  return {
    outcome: "REFUSED",
    ok: false,
    reasonCode: MANUAL_OPS_REFUSED_TEST_RUNTIME,
    code: MANUAL_OPS_REFUSED_TEST_RUNTIME,
    writesAttempted: false,
    reason:
      `${cliName} refused because NODE_ENV=test. ` +
      "Run this manual operation from a child process where NODE_ENV is unset. " +
      "Do not set NODE_ENV=production.",
  };
}
