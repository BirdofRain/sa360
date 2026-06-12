export type BuildVersionDisplay = {
  commitShort: string | null;
  commitSha: string | null;
  buildLabel: string | null;
};

export function getAdminBuildVersion(): BuildVersionDisplay {
  const commitShort = process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT?.trim() || null;
  const commitSha = process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHA?.trim() || null;
  const buildLabel = process.env.NEXT_PUBLIC_SA360_BUILD_LABEL?.trim() || null;
  return { commitShort, commitSha, buildLabel };
}

export function formatDeployVersionsLine(
  admin: BuildVersionDisplay | null | undefined,
  api: BuildVersionDisplay | null | undefined
): string {
  const adminShort = admin?.commitShort?.trim() || "unknown";
  const apiShort = api?.commitShort?.trim() || "unknown";
  let line = `Deploy versions: Admin ${adminShort} · API ${apiShort}`;
  const buildLabel = api?.buildLabel?.trim() || admin?.buildLabel?.trim();
  if (buildLabel) line += ` · ${buildLabel}`;
  return line;
}
