"use client";

import type { BuildVersionDisplay } from "@/lib/build-version";
import { formatDeployVersionsLine } from "@/lib/build-version";

export function DeployVersionsBar({
  adminBuild,
  apiBuild,
}: {
  adminBuild: BuildVersionDisplay;
  apiBuild: BuildVersionDisplay | null;
}) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
      <span className="font-medium">{formatDeployVersionsLine(adminBuild, apiBuild)}</span>
    </div>
  );
}
