/** Safe build/deploy identity for health checks (no secrets). */
export type BuildVersionInfo = {
  commitSha: string | null;
  commitShort: string | null;
  buildLabel: string | null;
  source: string | null;
};

const CANDIDATE_ENV_KEYS = [
  "SA360_BUILD_COMMIT_SHA",
  "COMMIT_HASH",
  "COMMIT_SHA",
  "GIT_COMMIT",
  "SOURCE_VERSION",
  "DO_APP_COMMIT_HASH",
] as const;

function firstEnv(keys: readonly string[]): { value: string; source: string } | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return { value, source: key };
  }
  return null;
}

export function getBuildVersionInfo(): BuildVersionInfo {
  const hit = firstEnv(CANDIDATE_ENV_KEYS);
  const label = process.env.SA360_BUILD_LABEL?.trim() || process.env.BUILD_LABEL?.trim() || null;
  if (!hit) {
    return {
      commitSha: null,
      commitShort: null,
      buildLabel: label,
      source: null,
    };
  }
  const sha = hit.value.replace(/^sha:/i, "");
  return {
    commitSha: sha,
    commitShort: sha.length > 7 ? sha.slice(0, 7) : sha,
    buildLabel: label,
    source: hit.source,
  };
}

export function getBuildVersionPayload(): Record<string, string | null> {
  const info = getBuildVersionInfo();
  return {
    commitSha: info.commitSha,
    commitShort: info.commitShort,
    buildLabel: info.buildLabel,
    buildSource: info.source,
  };
}
