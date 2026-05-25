import type { NativeProcessResource } from "./native-process-image.ts";

export function nativeResourceRecipeBigInt(
  resource: NativeProcessResource,
  key: string,
): bigint | undefined {
  const value = resource.recipe?.[key];
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}
