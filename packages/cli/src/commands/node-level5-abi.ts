import { reportNodeLevel5ProductCommand } from "./node-level5-reporting.ts";

// fallow-ignore-next-line complexity
export function cmdNodeLevel5AbiCheck(args: string[], json: boolean): number {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    values.set(args[index]!, args[index + 1] ?? "");
  }
  const accepted =
    values.get("--node") === "22.x" &&
    values.get("--v8") === "12.x pointer-compressed" &&
    values.get("--libuv") === "supported idle handles plus selected hard-facility boundaries";
  return reportNodeLevel5ProductCommand(json, {
    accepted,
    kind: "machinen.node-level5-abi-check-summary",
    refusal: accepted ? undefined : { code: "node-level5-unknown-abi-refused" },
  });
}
