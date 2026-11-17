"use strict";

/**
 * `next build` is a production prerender. Next.js 15 does not replace a
 * NODE_ENV that is already set, so a development value (the Cloud Agent .env,
 * a sourced shell, or a platform env) makes the build prerender with the
 * development React runtime. That fails /404 with "<Html> should not be
 * imported outside of pages/_document" and fails /_not-found and Front Office
 * pages with "Cannot read properties of null (reading 'useContext')".
 *
 * Force production for this process only. `next dev` is unchanged.
 *
 * Invoke the package bin shim rather than dist/bin/next. pnpm's shim sets
 * NODE_PATH so ESLint can resolve plugins such as eslint-plugin-react-hooks
 * from the virtual store. Skipping the shim logs a plugin load failure and
 * continues the build without lint.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const shim =
  process.platform === "win32"
    ? path.join(__dirname, "..", "node_modules", ".bin", "next.cmd")
    : path.join(__dirname, "..", "node_modules", ".bin", "next");

const result = spawnSync(shim, ["build"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status == null ? 1 : result.status);
}
