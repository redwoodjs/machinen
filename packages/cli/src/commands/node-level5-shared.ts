import { emitJson, emitJsonError } from "../args.ts";
import { die } from "../errors.ts";

export type NodeLevel5DeclaredSubsetCliOptions = {
  out: string;
  manifest: string;
  sourceArch: "arm64" | "amd64";
  targetArch: "arm64" | "amd64";
  experimental: boolean;
  productSupportClaimed: boolean;
  rawCpuRestore: boolean;
};

export function parseNodeLevel5DeclaredSubsetCaptureArgs(
  args: string[],
): Pick<
  NodeLevel5DeclaredSubsetCliOptions,
  "out" | "sourceArch" | "targetArch" | "experimental" | "productSupportClaimed"
> {
  return parseNodeLevel5DeclaredSubsetCliArgs(args, "capture");
}

export function parseNodeLevel5DeclaredSubsetRestoreArgs(
  args: string[],
): Pick<
  NodeLevel5DeclaredSubsetCliOptions,
  "manifest" | "experimental" | "productSupportClaimed" | "rawCpuRestore"
> {
  return parseNodeLevel5DeclaredSubsetCliArgs(args, "restore");
}

// fallow-ignore-next-line complexity
function parseNodeLevel5DeclaredSubsetCliArgs(
  args: string[],
  mode: "capture" | "restore",
): NodeLevel5DeclaredSubsetCliOptions {
  const options = defaultNodeLevel5DeclaredSubsetCliOptions();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--experimental-node-level5") {
      options.experimental = true;
    } else if (arg === "--claim-product-support") {
      options.productSupportClaimed = true;
    } else if (mode === "capture" && arg === "--out") {
      options.out = takeCaptureValue(args, (index += 1), "--out");
    } else if (mode === "capture" && arg === "--source-arch") {
      options.sourceArch = parseProductArch(
        takeCaptureValue(args, (index += 1), "--source-arch"),
        "--source-arch",
      );
    } else if (mode === "capture" && arg === "--target-arch") {
      options.targetArch = parseProductArch(
        takeCaptureValue(args, (index += 1), "--target-arch"),
        "--target-arch",
      );
    } else if (mode === "restore" && arg === "--raw-cpu-restore") {
      options.rawCpuRestore = true;
    } else if (mode === "restore" && arg === "--manifest") {
      options.manifest = takeCaptureValue(args, (index += 1), "--manifest");
    } else if (mode === "restore" && !arg.startsWith("-") && !options.manifest) {
      options.manifest = arg;
    } else {
      die(`unknown node-level5 ${mode} argument: ${arg}`);
    }
  }
  return options;
}

function defaultNodeLevel5DeclaredSubsetCliOptions(): NodeLevel5DeclaredSubsetCliOptions {
  return {
    out: "",
    manifest: "",
    sourceArch: "arm64",
    targetArch: "amd64",
    experimental: false,
    productSupportClaimed: false,
    rawCpuRestore: false,
  };
}

export function reportNodeLevel5DeclaredSubsetCliRefusal(
  json: boolean,
  code: string,
  message: string,
): never {
  if (json) {
    emitJsonError(code, message);
  } else {
    process.stderr.write(`machinen: ${message} (${code})\n`);
  }
  process.exit(1);
}

export type NodeLevel5DeclaredSubsetCliSummary = {
  accepted: boolean;
  manifestPath?: string;
  refusal?: { code: string };
};

export function reportNodeLevel5DeclaredSubsetSummary<
  TSummary extends NodeLevel5DeclaredSubsetCliSummary,
>(
  json: boolean,
  summary: TSummary,
  messages: {
    accepted: (summary: TSummary) => string;
    refused: (summary: TSummary) => string;
  },
): number {
  if (json) {
    emitJson(summary);
  } else {
    process.stderr.write(summary.accepted ? messages.accepted(summary) : messages.refused(summary));
  }
  return summary.accepted ? 0 : 1;
}

export function takeCaptureValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    die(`${flag} requires a value`);
  }
  return value;
}

export function parseProductArch(value: string, flag: string): "arm64" | "amd64" {
  if (value === "arm64" || value === "amd64") {
    return value;
  }
  die(`${flag} must be arm64 or amd64`);
}
