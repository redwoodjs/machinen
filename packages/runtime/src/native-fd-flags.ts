/** Helpers for native Linux fd flag strings captured from /proc/<pid>/fdinfo. */

export function nativeFdAccessMode(flags: string[] | undefined): number | undefined {
  const octal = flags?.find((flag) => flag.startsWith("octal:"));
  return octal ? Number.parseInt(octal.slice("octal:".length), 8) & 0x3 : undefined;
}
