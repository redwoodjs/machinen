// Render a registry entry's `portForward` array as a single PORTS cell
// for `machinen ls`. Kept in its own module so the test can import it
// without triggering cli.ts's top-level `main()` dispatch.
//
// Format:
//   - undefined / empty → "-"
//   - single forward    → "3000:3000"
//   - multiple forwards → "3000:3000,5432:5432"
//
// `hostAddr` is intentionally elided — the table cell stays terse, and
// the bind-address surfaces in `BOOT_PORT_FORWARD_IN_USE` errors when
// it actually matters.

export function formatPorts(
  pf: Array<{ hostPort: number; guestPort: number; hostAddr?: string }> | undefined,
): string {
  if (!pf || pf.length === 0) {
    return "-";
  }
  return pf.map((p) => `${p.hostPort}:${p.guestPort}`).join(",");
}
