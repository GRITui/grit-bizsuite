/**
 * Resolve hook for the QA harness: grit-pos's promotions.ts imports
 * Next's "server-only" guard package, which isn't resolvable under plain
 * node. Map it to an empty module — the guard is meaningless outside Next.
 */
const EMPTY_MODULE_URL = "data:text/javascript,export%20{}";

export function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: EMPTY_MODULE_URL, shortCircuit: true };
  }
  return next(specifier, context);
}

/** Shape consumed by node:module's registerHooks(). */
export const hooks = { resolve };
