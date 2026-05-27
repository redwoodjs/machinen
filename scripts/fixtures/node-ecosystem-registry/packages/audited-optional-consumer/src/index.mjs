export async function optionalValues() {
  const present = await import("audited-optional-present")
    .then((m) => m.value)
    .catch(() => "missing-present");
  const missing = await import("audited-optional-missing")
    .then((m) => m.value)
    .catch(() => "optional-missing-refused");
  return `optional:${present}:${missing}`;
}
