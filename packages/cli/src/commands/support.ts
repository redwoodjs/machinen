import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  buildProductClaimRegistry,
  filterProductClaimRegistry,
  productClaimFamilies,
  productClaimStatuses,
  productSupportLevels,
  type ProductClaimFamily,
  type ProductClaimStatus,
  type ProductSupportLevel,
} from "@machinen/runtime";

export type SupportOptions = {
  json: boolean;
  family?: ProductClaimFamily;
  runtime?: string;
  status?: ProductClaimStatus;
  profile?: string;
  resourceFamily?: string;
  refusalCode?: string;
  level?: ProductSupportLevel;
};

export function cmdSupport(args: string[]): number {
  const options = parseSupportArgs(args);
  const registry = buildProductClaimRegistry(readProductProofProfilesForCli());
  const entries = filterProductClaimRegistry(registry.entries, {
    family: options.family,
    runtime: options.runtime,
    status: options.status,
    profile: options.profile,
    resourceFamily: options.resourceFamily,
    refusalCode: options.refusalCode,
    supportLevel: options.level,
  });
  const payload = {
    schema_version: 1,
    kind: "machinen.product-support-status",
    filters: {
      family: options.family,
      runtime: options.runtime,
      status: options.status,
      profile: options.profile,
      resourceFamily: options.resourceFamily,
      refusalCode: options.refusalCode,
      level: options.level,
    },
    summary: registry.summary,
    count: entries.length,
    entries,
  };
  if (options.json) {
    emitJson(payload);
    return 0;
  }
  process.stdout.write(formatSupportText(payload));
  return 0;
}

// fallow-ignore-next-line complexity
function parseSupportArgs(args: string[]): SupportOptions {
  const { json, rest } = consumeJsonFlag(args);
  const options: SupportOptions = { json };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    switch (arg) {
      case "--family":
        options.family = parseSupportFamily(takeValue(rest, ++index, arg));
        break;
      case "--runtime":
        options.runtime = takeValue(rest, ++index, arg);
        break;
      case "--status":
        options.status = parseSupportStatus(takeValue(rest, ++index, arg));
        break;
      case "--profile":
        options.profile = takeValue(rest, ++index, arg);
        break;
      case "--resource-family":
        options.resourceFamily = takeValue(rest, ++index, arg);
        break;
      case "--refusal-code":
        options.refusalCode = takeValue(rest, ++index, arg);
        break;
      case "--level":
        options.level = parseSupportLevel(takeValue(rest, ++index, arg));
        break;
      default:
        die(`${supportUsage()}\nunknown argument: ${arg}`);
    }
  }
  return options;
}

function supportUsage(): string {
  return (
    "usage: machinen support [--family <family>] [--runtime <runtime>] " +
    "[--status <status>] [--profile <name>] [--resource-family <family>] " +
    "[--refusal-code <code>] [--level <support-level>] [--json]"
  );
}

function parseSupportFamily(value: string): ProductClaimFamily {
  if ((productClaimFamilies as readonly string[]).includes(value)) {
    return value as ProductClaimFamily;
  }
  die(`--family must be one of: ${productClaimFamilies.join(", ")}`);
}

function parseSupportStatus(value: string): ProductClaimStatus {
  if ((productClaimStatuses as readonly string[]).includes(value)) {
    return value as ProductClaimStatus;
  }
  die(`--status must be one of: ${productClaimStatuses.join(", ")}`);
}

function parseSupportLevel(value: string): ProductSupportLevel {
  if ((productSupportLevels as readonly string[]).includes(value)) {
    return value as ProductSupportLevel;
  }
  die(`--level must be one of: ${productSupportLevels.join(", ")}`);
}

function readProductProofProfilesForCli(): Array<Record<string, unknown> & { name: string }> {
  const candidates = [
    join(process.cwd(), "scripts/portable-machine-proof-profiles.json"),
    join(
      dirname(dirname(dirname(resolve(process.argv[1] ?? ".")))),
      "scripts/portable-machine-proof-profiles.json",
    ),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    die("could not locate scripts/portable-machine-proof-profiles.json for support discovery");
  }
  return JSON.parse(readFileSync(path, "utf8")) as Array<
    Record<string, unknown> & { name: string }
  >;
}

function formatSupportText(payload: {
  summary: ReturnType<typeof buildProductClaimRegistry>["summary"];
  count: number;
  entries: Array<ReturnType<typeof buildProductClaimRegistry>["entries"][number]>;
}): string {
  const lines = [
    `product support claims: ${payload.count}/${payload.summary.total}`,
    `implemented=${payload.summary.implementedProductSupport} refused=${payload.summary.stableProductRefusals} proof-only=${payload.summary.proofOnlyFixtures}`,
  ];
  for (const entry of payload.entries.slice(0, 25)) {
    lines.push(
      `${entry.name}\t${entry.family}\t${entry.supportLevel}\t${entry.productStatus}\t${entry.productRefusalCode ?? "-"}`,
    );
  }
  if (payload.entries.length > 25) {
    lines.push(`... ${payload.entries.length - 25} more; pass --json for the full registry`);
  }
  return `${lines.join("\n")}\n`;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    die(`${flag} requires a value`);
  }
  return value;
}

function consumeJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const rest: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else {
      rest.push(arg);
    }
  }
  return { json, rest };
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function die(msg: string): never {
  process.stderr.write(`machinen: ${msg}\n`);
  process.exit(1);
}
