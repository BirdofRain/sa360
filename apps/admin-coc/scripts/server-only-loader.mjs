/**
 * ESM resolve hook used only by the operator hasher command.
 * Redirects the `server-only` marker to an empty module.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only" || specifier.endsWith("/server-only")) {
    return {
      shortCircuit: true,
      url: new URL("./server-only-empty.mjs", import.meta.url).href,
    };
  }
  return nextResolve(specifier, context);
}
