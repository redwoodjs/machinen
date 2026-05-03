// Tail-N pure helper for `machinen attach --tail`. Lives in its own
// module so vitest can import the function without dragging in
// `cli.ts`'s top-level `main()` call (which would `process.exit` on
// load with the test runner's argv).

/**
 * Return the last `tail` lines of `content`, always terminated with a
 * newline. `"all"` (or `0`) returns the whole content. Pure for tests.
 */
export function tailLines(content: string, tail: number | "all"): string {
  if (tail === "all" || tail === 0) {
    return content.endsWith("\n") || content.length === 0 ? content : `${content}\n`;
  }
  // Split on \n, drop the trailing empty produced by a terminating
  // newline so "last N" counts real lines, then take the last N. Fine
  // for the snapshot's ~1 MiB cap; a streaming reverse-reader would
  // be overkill at this size.
  const lines = content.split("\n");
  const hadTrailingNl = lines.length > 0 && lines[lines.length - 1] === "";
  const meaningful = hadTrailingNl ? lines.slice(0, -1) : lines;
  if (meaningful.length === 0) {
    return "";
  }
  const slice = meaningful.slice(Math.max(0, meaningful.length - tail));
  return `${slice.join("\n")}\n`;
}
