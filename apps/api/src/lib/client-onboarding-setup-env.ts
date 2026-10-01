export function isClientOnboardingSetupEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.SA360_NATIVE_CLIENT_SETUP_ENABLED?.trim().toLowerCase() === "true";
}
