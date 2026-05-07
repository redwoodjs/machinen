// Render the MEM column for `machinen ls` (#274) — host RSS over
// the configured ceiling, e.g. "1.2G/4G". Lives in its own module so
// the test can import it without triggering cli.ts's top-level
// `main()` dispatch (same pattern as format-ports.ts).
//
// Format:
//   - both unknown        → "-"
//   - rss only            → "<rss>"
//   - ceiling only        → "?/<ceiling>"
//   - both                → "<rss>/<ceiling>"
//
// Both sides use the same IEC (1024-base) auto-scale so a saturated
// VM reads "16G/16G" instead of "16384M/16G". Single-digit values
// keep one decimal ("1.2G"); double-digit and up round to integer
// ("16G") to keep the cell narrow.

export function formatMem(
  rssBytes: number | null | undefined,
  ceilingMib: number | undefined,
): string {
  const rss = typeof rssBytes === "number" && rssBytes > 0 ? rssBytes : null;
  const ceiling = typeof ceilingMib === "number" && ceilingMib > 0 ? ceilingMib : null;
  if (rss === null && ceiling === null) {
    return "-";
  }
  if (ceiling === null) {
    return formatBytes(rss as number);
  }
  const ceilingStr = formatBytes(ceiling * 1024 * 1024);
  if (rss === null) {
    return `?/${ceilingStr}`;
  }
  return `${formatBytes(rss)}/${ceilingStr}`;
}

function formatBytes(bytes: number): string {
  const KIB = 1024;
  const MIB = KIB * 1024;
  const GIB = MIB * 1024;
  if (bytes >= GIB) {
    const g = bytes / GIB;
    return g >= 10 ? `${Math.round(g)}G` : `${g.toFixed(1)}G`;
  }
  if (bytes >= MIB) {
    const m = bytes / MIB;
    return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
  }
  if (bytes >= KIB) {
    return `${Math.round(bytes / KIB)}K`;
  }
  return `${bytes}B`;
}
