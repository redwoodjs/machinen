import {
  createNodeLevel5ProductSupport80ArtifactBundle,
  loadNodeLevel5ProductSupport80ArtifactBundle,
  verifyNodeLevel5ProductSupport80ArtifactBundle,
  type NodeLevel5ProductSupport80FamilyId,
} from "@machinen/runtime";
import { resolve } from "node:path";

import { die } from "../errors.ts";
import { takeCaptureValue } from "./node-level5-shared.ts";
import { reportNodeLevel5ProductCommand } from "./node-level5-reporting.ts";

type NodeLevel5ArtifactCliOptions = {
  out?: string;
  root?: string;
  family?: NodeLevel5ProductSupport80FamilyId;
  direction?: "arm64-to-amd64" | "amd64-to-arm64";
};

// fallow-ignore-next-line complexity
export function cmdNodeLevel5Artifacts(args: string[], json: boolean): number {
  const [sub, ...rest] = args;
  const options = parseNodeLevel5ArtifactArgs(rest);
  if (sub === "write") {
    if (!options.out || !options.family || !options.direction) {
      die("machinen node-level5 artifacts write requires --out, --family, and --direction");
    }
    const bundle = createNodeLevel5ProductSupport80ArtifactBundle({
      outDir: resolve(options.out),
      familyId: options.family,
      direction: options.direction,
    });
    return reportNodeLevel5ProductCommand(json, { accepted: true, bundle });
  }
  if (sub === "verify") {
    if (!options.root || !options.family || !options.direction) {
      die("machinen node-level5 artifacts verify requires --root, --family, and --direction");
    }
    try {
      assertSafeNodeLevel5ArtifactRootPath(options.root);
      return reportNodeLevel5ProductCommand(
        json,
        verifyNodeLevel5RetainedArtifact({
          root: options.root,
          family: options.family,
          direction: options.direction,
        }),
      );
    } catch (error) {
      return reportNodeLevel5ProductCommand(json, {
        accepted: false,
        code: "node-level5-artifact-bundle-invalid",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  die(nodeLevel5ArtifactsUsage());
}

function nodeLevel5ArtifactsUsage(): string {
  return "usage: machinen node-level5 artifacts <write|verify> ... [--json]";
}

// fallow-ignore-next-line complexity
export function readOptionalNodeLevel5RetainedArtifact(
  args: string[],
): Record<string, unknown> | undefined {
  if (args.length === 0) {
    return undefined;
  }
  try {
    const options = parseNodeLevel5ArtifactArgs(args);
    if (!options.root || !options.family || !options.direction) {
      die(
        "machinen node-level5 retained artifact commands require --root, --family, and --direction",
      );
    }
    assertSafeNodeLevel5ArtifactRootPath(options.root);
    return verifyNodeLevel5RetainedArtifact({
      root: options.root,
      family: options.family,
      direction: options.direction,
    });
  } catch (error) {
    return {
      accepted: false,
      code: "node-level5-artifact-bundle-invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function verifyNodeLevel5RetainedArtifact(
  options: Required<Pick<NodeLevel5ArtifactCliOptions, "root" | "family" | "direction">>,
): Record<string, unknown> {
  const bundle = loadNodeLevel5ProductSupport80ArtifactBundle({
    artifactRoot: resolve(options.root),
    familyId: options.family,
    direction: options.direction,
  });
  return verifyNodeLevel5ProductSupport80ArtifactBundle(bundle);
}

function assertSafeNodeLevel5ArtifactRootPath(path: string): void {
  if (path.split(/[\\/]+/u).includes("..")) {
    throw new Error("Node Level 5 artifact root must not contain path traversal segments");
  }
}

// fallow-ignore-next-line complexity
function parseNodeLevel5ArtifactArgs(args: string[]): NodeLevel5ArtifactCliOptions {
  const options: NodeLevel5ArtifactCliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--out") {
      options.out = takeCaptureValue(args, (index += 1), "--out");
    } else if (arg === "--root") {
      options.root = takeCaptureValue(args, (index += 1), "--root");
    } else if (arg === "--family") {
      options.family = takeCaptureValue(
        args,
        (index += 1),
        "--family",
      ) as NodeLevel5ProductSupport80FamilyId;
    } else if (arg === "--direction") {
      options.direction = takeCaptureValue(args, (index += 1), "--direction") as
        | "arm64-to-amd64"
        | "amd64-to-arm64";
    } else {
      die(`unknown node-level5 artifact argument: ${arg}`);
    }
  }
  return options;
}
