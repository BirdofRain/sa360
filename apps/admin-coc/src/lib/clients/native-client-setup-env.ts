export function isNativeClientSetupEnabled(
  env?: { SA360_NATIVE_CLIENT_SETUP_ENABLED?: string }
): boolean {
  const value =
    env === undefined
      ? process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED
      : env.SA360_NATIVE_CLIENT_SETUP_ENABLED;
  return value?.trim().toLowerCase() === "true";
}
