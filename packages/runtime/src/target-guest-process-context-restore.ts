import { createHash } from "node:crypto";
import type {
  NativeProcessImageDocuments,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";

export type TargetGuestProcessContextRestoreMode = "metadata-only" | "apply-target-env-cwd";

export type TargetGuestProcessContextRestoreStep =
  | {
      action: "record-argv";
      argc: number;
      argvBytes: number;
      argvSha256: string;
    }
  | {
      action: "record-env";
      envCount: number;
      envBytes: number;
      envSha256: string;
    }
  | {
      action: "clear-env";
      envCount: number;
      envSha256: string;
    }
  | {
      action: "set-env";
      keyHex: string;
      valueHex: string;
      valueSha256: string;
    }
  | {
      action: "verify-env";
      envCount: number;
      envSha256: string;
    }
  | {
      action: "record-cwd";
      cwdHex: string;
      cwdSha256: string;
    }
  | {
      action: "chdir";
      cwdHex: string;
      cwdSha256: string;
    }
  | {
      action: "record-auxv";
      auxvBytes: number;
      auxvSha256: string;
    };

export type TargetGuestProcessContextRestorePlan =
  | {
      state: "planned";
      mode: TargetGuestProcessContextRestoreMode;
      steps: TargetGuestProcessContextRestoreStep[];
    }
  | { state: "refused"; refusals: NativeProcessImageRefusal[] };

export interface TargetGuestProcessContextRestoreOptions {
  mode?: TargetGuestProcessContextRestoreMode;
  maxArgvEntries?: number;
  maxEnvEntries?: number;
  maxStringBytes?: number;
  maxAuxvBytes?: number;
}

interface ProcessContextModel {
  argv: string[];
  envEntries: Array<[string, string]>;
  cwd: string;
  auxvHex: string;
}

const DEFAULT_MAX_ARGV_ENTRIES = 128;
const DEFAULT_MAX_ENV_ENTRIES = 256;
const DEFAULT_MAX_STRING_BYTES = 64 * 1024;
const DEFAULT_MAX_AUXV_BYTES = 4096;

export function planTargetGuestProcessContextRestore(
  documents: NativeProcessImageDocuments,
  options: TargetGuestProcessContextRestoreOptions = {},
): TargetGuestProcessContextRestorePlan {
  const model = processContextModel(documents, options);
  if ("refusals" in model) {
    return { state: "refused", refusals: model.refusals };
  }
  const mode = options.mode ?? "metadata-only";
  return { state: "planned", mode, steps: processContextSteps(model, mode) };
}

function processContextModel(
  documents: NativeProcessImageDocuments,
  options: TargetGuestProcessContextRestoreOptions,
): ProcessContextModel | { refusals: NativeProcessImageRefusal[] } {
  const refusals = [
    ...validateManifestProcessContext(documents, options),
    ...validateResourceConsistency(documents),
  ];
  if (refusals.length > 0) {
    return { refusals };
  }
  return {
    argv: documents.manifest.process.argv,
    envEntries: sortedEnvEntries(documents.manifest.process.env),
    cwd: documents.manifest.process.cwd,
    auxvHex: auxvResourceHex(documents)!,
  };
}

function validateManifestProcessContext(
  documents: NativeProcessImageDocuments,
  options: TargetGuestProcessContextRestoreOptions,
): NativeProcessImageRefusal[] {
  const maxStringBytes = options.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES;
  return [
    ...validateArgvContext(
      documents.manifest.process.argv,
      options.maxArgvEntries ?? DEFAULT_MAX_ARGV_ENTRIES,
      maxStringBytes,
    ),
    ...validateEnvContext(
      sortedEnvEntries(documents.manifest.process.env),
      options.maxEnvEntries ?? DEFAULT_MAX_ENV_ENTRIES,
      maxStringBytes,
    ),
    ...validateCwdContext(documents.manifest.process.cwd),
    ...validateAuxvContext(
      auxvResourceHex(documents),
      options.maxAuxvBytes ?? DEFAULT_MAX_AUXV_BYTES,
    ),
  ];
}

function validateArgvContext(
  argv: string[],
  maxArgv: number,
  maxStringBytes: number,
): NativeProcessImageRefusal[] {
  const argvBytes = stringListBytes(argv);
  return [
    ...(argv.length === 0 || argv.length > maxArgv
      ? [processContextRefusal("argv entry count is unsupported", { argc: argv.length, maxArgv })]
      : []),
    ...(argv.some(hasNulByte) || argvBytes > maxStringBytes
      ? [
          processContextRefusal("argv strings are malformed or oversized", {
            argvBytes,
            maxStringBytes,
          }),
        ]
      : []),
  ];
}

function validateEnvContext(
  envEntries: Array<[string, string]>,
  maxEnv: number,
  maxStringBytes: number,
): NativeProcessImageRefusal[] {
  const envBytes = stringListBytes(envEntries.flatMap(([key, value]) => [key, value]));
  return [
    ...(envEntries.length > maxEnv
      ? [
          processContextRefusal("env entry count is unsupported", {
            envCount: envEntries.length,
            maxEnv,
          }),
        ]
      : []),
    ...(envEntries.some(([key, value]) => invalidEnvEntry(key, value)) || envBytes > maxStringBytes
      ? [
          processContextRefusal("env strings are malformed or oversized", {
            envBytes,
            maxStringBytes,
          }),
        ]
      : []),
  ];
}

function validateCwdContext(cwd: string): NativeProcessImageRefusal[] {
  return cwd.startsWith("/") && !hasNulByte(cwd) && utf8Bytes(cwd) <= 4096
    ? []
    : [processContextRefusal("cwd is not an absolute bounded path", { cwd })];
}

function validateAuxvContext(
  auxvHex: string | undefined,
  maxAuxvBytes: number,
): NativeProcessImageRefusal[] {
  const auxvBytes = auxvHex ? auxvHex.length / 2 : 0;
  return auxvHex && isEvenHex(auxvHex) && auxvBytes <= maxAuxvBytes
    ? []
    : [
        processContextRefusal("auxv bytes are missing, malformed, or oversized", {
          auxvBytes,
          maxAuxvBytes,
        }),
      ];
}

function validateResourceConsistency(
  documents: NativeProcessImageDocuments,
): NativeProcessImageRefusal[] {
  const argvResource = documents.resources.resources.find((resource) => resource.kind === "argv");
  const envResource = documents.resources.resources.find((resource) => resource.kind === "env");
  const cwdResource = documents.resources.resources.find((resource) => resource.kind === "cwd");
  const auxvResource = documents.resources.resources.find((resource) => resource.kind === "auxv");
  return [
    ...resourceMismatch(
      argvResource?.recipe?.argv,
      documents.manifest.process.argv,
      "argv resource does not match manifest argv",
    ),
    ...resourceMismatch(
      envResource?.recipe?.env,
      documents.manifest.process.env,
      "env resource does not match manifest env",
    ),
    ...resourceMismatch(
      cwdResource?.recipe?.cwd,
      documents.manifest.process.cwd,
      "cwd resource does not match manifest cwd",
    ),
    ...(auxvResource?.recipe?.bytesHex === undefined
      ? [processContextRefusal("auxv resource is missing")]
      : []),
  ];
}

function resourceMismatch(
  actual: unknown,
  expected: unknown,
  reason: string,
): NativeProcessImageRefusal[] {
  return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [processContextRefusal(reason)];
}

function processContextSteps(
  model: ProcessContextModel,
  mode: TargetGuestProcessContextRestoreMode,
): TargetGuestProcessContextRestoreStep[] {
  const envDigest = sha256(canonicalEnv(model.envEntries));
  return [
    {
      action: "record-argv",
      argc: model.argv.length,
      argvBytes: stringListBytes(model.argv),
      argvSha256: sha256(JSON.stringify(model.argv)),
    },
    ...(mode === "apply-target-env-cwd"
      ? [
          { action: "clear-env" as const, envCount: model.envEntries.length, envSha256: envDigest },
          ...model.envEntries.map(([key, value]) => ({
            action: "set-env" as const,
            keyHex: hexUtf8(key),
            valueHex: hexUtf8(value),
            valueSha256: sha256(value),
          })),
          {
            action: "verify-env" as const,
            envCount: model.envEntries.length,
            envSha256: envDigest,
          },
          { action: "chdir" as const, cwdHex: hexUtf8(model.cwd), cwdSha256: sha256(model.cwd) },
        ]
      : [
          {
            action: "record-env" as const,
            envCount: model.envEntries.length,
            envBytes: stringListBytes(model.envEntries.flatMap(([key, value]) => [key, value])),
            envSha256: envDigest,
          },
          {
            action: "record-cwd" as const,
            cwdHex: hexUtf8(model.cwd),
            cwdSha256: sha256(model.cwd),
          },
        ]),
    {
      action: "record-auxv",
      auxvBytes: model.auxvHex.length / 2,
      auxvSha256: sha256(Buffer.from(model.auxvHex, "hex")),
    },
  ];
}

function auxvResourceHex(documents: NativeProcessImageDocuments): string | undefined {
  const value = documents.resources.resources.find((resource) => resource.kind === "auxv")?.recipe
    ?.bytesHex;
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

function sortedEnvEntries(env: Record<string, string>): Array<[string, string]> {
  return Object.entries(env).sort(([left], [right]) => left.localeCompare(right));
}

function canonicalEnv(entries: Array<[string, string]>): string {
  return JSON.stringify(Object.fromEntries(entries));
}

function invalidEnvEntry(key: string, value: string): boolean {
  return key.length === 0 || key.includes("=") || hasNulByte(key) || hasNulByte(value);
}

function stringListBytes(values: string[]): number {
  return values.reduce((total, value) => total + utf8Bytes(value), 0);
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function hasNulByte(value: string): boolean {
  return value.includes("\0");
}

function isEvenHex(value: string): boolean {
  return value.length % 2 === 0 && /^[0-9a-f]*$/i.test(value);
}

function hexUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function processContextRefusal(
  reason: string,
  detail: Record<string, unknown> = {},
): NativeProcessImageRefusal {
  return {
    code: "target-process-context-unsupported",
    message: `target process context handoff refused: ${reason}`,
    detail: { reason, ...detail },
  };
}
