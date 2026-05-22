/** Helpers for native Linux fd flag strings captured from /proc/<pid>/fdinfo. */

export function nativeFdFlagBits(flags: string[] | undefined): number | undefined {
  const octal = flags?.find((flag) => flag.startsWith("octal:"));
  return octal ? Number.parseInt(octal.slice("octal:".length), 8) : undefined;
}

export function nativeFdAccessMode(flags: string[] | undefined): number | undefined {
  const bits = nativeFdFlagBits(flags);
  return bits === undefined ? undefined : bits & 0x3;
}
