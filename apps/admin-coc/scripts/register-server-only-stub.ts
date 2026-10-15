/**
 * Operator-only loader so the reviewer password hasher can run under tsx.
 * Next.js replaces `server-only` during the app build. This stub is not imported
 * by the application.
 */
import module from "node:module";

const loader = module as NodeModule & { _load: typeof module._load };
const originalLoad = loader._load;
loader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};
