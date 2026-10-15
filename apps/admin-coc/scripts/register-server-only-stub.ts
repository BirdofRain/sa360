/**
 * Operator-only loader so the reviewer password hasher can run under tsx.
 * Next.js replaces `server-only` during the app build. This stub is not imported
 * by the application.
 *
 * tsx compiles `import "server-only"` into a CommonJS require, so the patch has
 * to sit on `Module._load`. The ESM hook covers a native import of the same marker.
 */
import { createRequire, register } from "node:module";

const nodeRequire = createRequire(import.meta.url);
const moduleCtor = nodeRequire("module") as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleCtor._load;
moduleCtor._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

register(new URL("./server-only-loader.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});
