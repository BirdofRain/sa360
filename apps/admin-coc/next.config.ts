import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function deployCommitSha(): string | undefined {
  const fromEnv =
    process.env.SA360_BUILD_COMMIT_SHA?.trim() ||
    process.env.COMMIT_HASH?.trim() ||
    process.env.COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

const commitSha = deployCommitSha();

const nextConfig: NextConfig = {
  transpilePackages: ["@sa360/shared"],
  env: {
    NEXT_PUBLIC_SA360_BUILD_COMMIT_SHA: commitSha ?? "",
    NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT: commitSha ? commitSha.slice(0, 7) : "",
  },
};

export default nextConfig;
