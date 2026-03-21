/**
 * ESM loader hook that adds `type: "json"` to bare JSON imports.
 *
 * Node 22+ enforces import attributes for JSON modules, but
 * @actions/workflow-parser imports .json files without them.
 * Registering this hook via `module.register()` before the
 * dynamic import transparently patches the missing attribute.
 */
export async function load(
  url: string,
  context: { importAttributes?: Record<string, string> },
  nextLoad: Function,
) {
  if (url.endsWith(".json") && context.importAttributes?.type !== "json") {
    return nextLoad(url, {
      ...context,
      importAttributes: { ...context.importAttributes, type: "json" },
    });
  }
  return nextLoad(url, context);
}
