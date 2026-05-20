export function normalizeNativeHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}
