import { createHash } from "node:crypto";
import type {
  NativeProcessImageDocuments,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";

export type TargetGuestProcessContextRestoreMode =
  | "metadata-only"
  | "apply-target-env-cwd"
  | "apply-target-visible-context"
  | "apply-target-initial-stack";

export type TargetGuestProcessContextRestoreStep =
  | {
      action: "record-argv";
      argc: number;
      argvBytes: number;
      argvSha256: string;
    }
  | {
      action: "materialize-argv";
      argc: number;
      argvSha256: string;
      tokenIndex: number;
      tokenHex: string;
      tokenSha256: string;
    }
  | {
      action: "set-argv-entry";
      index: number;
      valueHex: string;
      valueSha256: string;
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
      action: "verify-env-value";
      keyHex: string;
      valueHex: string;
      valueSha256: string;
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
      action: "verify-cwd";
      cwdHex: string;
      cwdSha256: string;
    }
  | {
      action: "record-auxv";
      auxvBytes: number;
      auxvSha256: string;
    }
  | {
      action: "verify-auxv-selected";
      pageSize: number;
      clockTick: number;
      auxvSha256: string;
    }
  | {
      action: "record-auxv-policy";
      mode: "selected-safe-only";
      materializedKeys: string;
      refusedKeys: string;
      auxvSha256: string;
    }
  | {
      action: "materialize-initial-stack";
      targetStart: string;
      sizeBytes: number;
      argc: number;
      envCount: number;
      pageSize: number;
      clockTick: number;
      argvSha256: string;
      envSha256: string;
    }
  | {
      action: "verify-initial-stack";
      targetStart: string;
      argc: number;
      envCount: number;
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
  initialStackTargetStart?: string;
  initialStackSizeBytes?: number;
}

interface ProcessContextModel {
  argv: string[];
  envEntries: Array<[string, string]>;
  cwd: string;
  auxvHex: string;
  selectedAuxv: SelectedAuxvContext;
  initialStack: InitialStackContext;
  auxvPolicy: AuxvMaterializationPolicy;
}

interface InitialStackContext {
  targetStart: string;
  sizeBytes: number;
}

interface AuxvMaterializationPolicy {
  materializedKeys: string[];
  refusedKeys: string[];
}

interface SelectedAuxvContext {
  pageSize: number;
  clockTick: number;
}

const DEFAULT_MAX_ARGV_ENTRIES = 128;
const DEFAULT_MAX_ENV_ENTRIES = 256;
const DEFAULT_MAX_STRING_BYTES = 64 * 1024;
const DEFAULT_MAX_AUXV_BYTES = 4096;
const CONTEXT_ENV_TOKEN_KEY = "MACHINEN_CONTEXT_TOKEN";
const CONTEXT_ARGV_TOKEN = "--machinen-argv-token";
const DEFAULT_INITIAL_STACK_TARGET_START = "0x600000002000";
const DEFAULT_INITIAL_STACK_SIZE_BYTES = 16 * 1024;
const TARGET_CONTEXT_STRING_BYTES = 512;
const AT_PAGESZ = 6n;
const AT_CLKTCK = 17n;
const AT_BASE = 7n;
const AT_RANDOM = 25n;
const AT_EXECFN = 31n;
const AT_SYSINFO_EHDR = 33n;
const AT_NULL = 0n;
const AUXV_ENTRY_BYTES = 16;
const AUXV_NAMES = new Map<bigint, string>([
  [AT_PAGESZ, "AT_PAGESZ"],
  [AT_CLKTCK, "AT_CLKTCK"],
  [AT_BASE, "AT_BASE"],
  [AT_RANDOM, "AT_RANDOM"],
  [AT_EXECFN, "AT_EXECFN"],
  [AT_SYSINFO_EHDR, "AT_SYSINFO_EHDR"],
]);
const UNSUPPORTED_INITIAL_STACK_AUXV = [AT_SYSINFO_EHDR, AT_RANDOM, AT_EXECFN, AT_BASE] as const;

export function planTargetGuestProcessContextRestore(
  documents: NativeProcessImageDocuments,
  options: TargetGuestProcessContextRestoreOptions = {},
): TargetGuestProcessContextRestorePlan {
  const mode = options.mode ?? "metadata-only";
  const model = processContextModel(documents, options, mode);
  if ("refusals" in model) {
    return { state: "refused", refusals: model.refusals };
  }
  return { state: "planned", mode, steps: processContextSteps(model, mode) };
}

function processContextModel(
  documents: NativeProcessImageDocuments,
  options: TargetGuestProcessContextRestoreOptions,
  mode: TargetGuestProcessContextRestoreMode,
): ProcessContextModel | { refusals: NativeProcessImageRefusal[] } {
  const auxvHex = auxvResourceHex(documents);
  const selectedAuxv = auxvHex ? selectedAuxvContext(auxvHex) : undefined;
  const refusals = [
    ...validateManifestProcessContext(documents, options),
    ...validateResourceConsistency(documents),
    ...validateTargetVisibleContext(documents, selectedAuxv, mode),
    ...validateInitialStackContext(documents, options, mode),
  ];
  if (refusals.length > 0) {
    return { refusals };
  }
  return {
    argv: documents.manifest.process.argv,
    envEntries: sortedEnvEntries(documents.manifest.process.env),
    cwd: documents.manifest.process.cwd,
    auxvHex: auxvHex!,
    selectedAuxv: selectedAuxv!,
    initialStack: initialStackContext(options),
    auxvPolicy: auxvMaterializationPolicy(auxvHex!),
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

function validateTargetVisibleContext(
  documents: NativeProcessImageDocuments,
  selectedAuxv: SelectedAuxvContext | undefined,
  mode: TargetGuestProcessContextRestoreMode,
): NativeProcessImageRefusal[] {
  if (mode !== "apply-target-visible-context" && mode !== "apply-target-initial-stack") {
    return [];
  }
  const env = documents.manifest.process.env;
  const argvTokenIndex = documents.manifest.process.argv.indexOf(CONTEXT_ARGV_TOKEN);
  return [
    ...(mode === "apply-target-visible-context" && !env[CONTEXT_ENV_TOKEN_KEY]
      ? [processContextRefusal("target-visible context requires MACHINEN_CONTEXT_TOKEN")]
      : []),
    ...(mode === "apply-target-visible-context" && argvTokenIndex < 0
      ? [processContextRefusal("target-visible context requires controlled argv token")]
      : []),
    ...(selectedAuxv
      ? []
      : [
          processContextRefusal("target-visible context requires selected safe auxv entries", {
            requiredAuxv: ["AT_PAGESZ", "AT_CLKTCK"],
          }),
        ]),
  ];
}

function validateInitialStackContext(
  documents: NativeProcessImageDocuments,
  options: TargetGuestProcessContextRestoreOptions,
  mode: TargetGuestProcessContextRestoreMode,
): NativeProcessImageRefusal[] {
  if (mode !== "apply-target-initial-stack") {
    return [];
  }
  const sizeBytes = options.initialStackSizeBytes ?? DEFAULT_INITIAL_STACK_SIZE_BYTES;
  const requiredBytes = initialStackRequiredBytes(
    documents.manifest.process.argv,
    sortedEnvEntries(documents.manifest.process.env),
  );
  const envEntries = sortedEnvEntries(documents.manifest.process.env);
  return [
    ...(requiredBytes <= sizeBytes
      ? []
      : [
          processContextRefusal("initial-stack process context exceeds target block", {
            requiredBytes,
            sizeBytes,
          }),
        ]),
    ...(documents.manifest.process.argv.some(
      (value) => utf8Bytes(value) >= TARGET_CONTEXT_STRING_BYTES,
    ) ||
    envEntries.some(
      ([key, value]) =>
        utf8Bytes(key) >= TARGET_CONTEXT_STRING_BYTES ||
        utf8Bytes(value) >= TARGET_CONTEXT_STRING_BYTES ||
        utf8Bytes(`${key}=${value}`) >= TARGET_CONTEXT_STRING_BYTES * 2,
    )
      ? [
          processContextRefusal("initial-stack process context string exceeds target buffer", {
            maxTargetStringBytes: TARGET_CONTEXT_STRING_BYTES,
          }),
        ]
      : []),
  ];
}

function processContextSteps(
  model: ProcessContextModel,
  mode: TargetGuestProcessContextRestoreMode,
): TargetGuestProcessContextRestoreStep[] {
  const envDigest = sha256(canonicalEnv(model.envEntries));
  const argvDigest = sha256(JSON.stringify(model.argv));
  const auxvDigest = sha256(Buffer.from(model.auxvHex, "hex"));
  return [
    {
      action: "record-argv",
      argc: model.argv.length,
      argvBytes: stringListBytes(model.argv),
      argvSha256: argvDigest,
    },
    ...targetVisibleArgvSteps(model, mode, argvDigest),
    ...envSteps(model, mode, envDigest),
    ...cwdSteps(model, mode),
    {
      action: "record-auxv",
      auxvBytes: model.auxvHex.length / 2,
      auxvSha256: auxvDigest,
    },
    ...targetVisibleAuxvSteps(model, mode, auxvDigest),
    ...initialStackSteps(model, mode, argvDigest, envDigest, auxvDigest),
  ];
}

function targetVisibleArgvSteps(
  model: ProcessContextModel,
  mode: TargetGuestProcessContextRestoreMode,
  argvDigest: string,
): TargetGuestProcessContextRestoreStep[] {
  if (mode === "apply-target-initial-stack") {
    return model.argv.map((value, index) => ({
      action: "set-argv-entry" as const,
      index,
      valueHex: hexUtf8(value),
      valueSha256: sha256(value),
    }));
  }
  if (mode !== "apply-target-visible-context") {
    return [];
  }
  const tokenIndex = model.argv.indexOf(CONTEXT_ARGV_TOKEN);
  return [
    {
      action: "materialize-argv",
      argc: model.argv.length,
      argvSha256: argvDigest,
      tokenIndex,
      tokenHex: hexUtf8(CONTEXT_ARGV_TOKEN),
      tokenSha256: sha256(CONTEXT_ARGV_TOKEN),
    },
  ];
}

function envSteps(
  model: ProcessContextModel,
  mode: TargetGuestProcessContextRestoreMode,
  envDigest: string,
): TargetGuestProcessContextRestoreStep[] {
  if (mode === "metadata-only") {
    return [
      {
        action: "record-env",
        envCount: model.envEntries.length,
        envBytes: stringListBytes(model.envEntries.flatMap(([key, value]) => [key, value])),
        envSha256: envDigest,
      },
    ];
  }
  return [
    { action: "clear-env", envCount: model.envEntries.length, envSha256: envDigest },
    ...model.envEntries.map(([key, value]) => ({
      action: "set-env" as const,
      keyHex: hexUtf8(key),
      valueHex: hexUtf8(value),
      valueSha256: sha256(value),
    })),
    { action: "verify-env", envCount: model.envEntries.length, envSha256: envDigest },
    ...targetVisibleEnvSteps(model, mode),
  ];
}

function targetVisibleEnvSteps(
  model: ProcessContextModel,
  mode: TargetGuestProcessContextRestoreMode,
): TargetGuestProcessContextRestoreStep[] {
  const token = Object.fromEntries(model.envEntries)[CONTEXT_ENV_TOKEN_KEY];
  return mode === "apply-target-visible-context" && token
    ? [
        {
          action: "verify-env-value",
          keyHex: hexUtf8(CONTEXT_ENV_TOKEN_KEY),
          valueHex: hexUtf8(token),
          valueSha256: sha256(token),
        },
      ]
    : [];
}

function cwdSteps(
  model: ProcessContextModel,
  mode: TargetGuestProcessContextRestoreMode,
): TargetGuestProcessContextRestoreStep[] {
  if (mode === "metadata-only") {
    return [{ action: "record-cwd", cwdHex: hexUtf8(model.cwd), cwdSha256: sha256(model.cwd) }];
  }
  const applyStep = {
    action: "chdir" as const,
    cwdHex: hexUtf8(model.cwd),
    cwdSha256: sha256(model.cwd),
  };
  return mode === "apply-target-visible-context" || mode === "apply-target-initial-stack"
    ? [
        applyStep,
        { action: "verify-cwd", cwdHex: applyStep.cwdHex, cwdSha256: applyStep.cwdSha256 },
      ]
    : [applyStep];
}

function targetVisibleAuxvSteps(
  model: ProcessContextModel,
  mode: TargetGuestProcessContextRestoreMode,
  auxvDigest: string,
): TargetGuestProcessContextRestoreStep[] {
  return mode === "apply-target-visible-context"
    ? [
        {
          action: "verify-auxv-selected",
          pageSize: model.selectedAuxv.pageSize,
          clockTick: model.selectedAuxv.clockTick,
          auxvSha256: auxvDigest,
        },
      ]
    : [];
}

function initialStackSteps(
  model: ProcessContextModel,
  mode: TargetGuestProcessContextRestoreMode,
  argvDigest: string,
  envDigest: string,
  auxvDigest: string,
): TargetGuestProcessContextRestoreStep[] {
  return mode === "apply-target-initial-stack"
    ? [
        {
          action: "record-auxv-policy",
          mode: "selected-safe-only",
          materializedKeys: model.auxvPolicy.materializedKeys.join(","),
          refusedKeys: model.auxvPolicy.refusedKeys.join(","),
          auxvSha256: auxvDigest,
        },
        {
          action: "materialize-initial-stack",
          targetStart: model.initialStack.targetStart,
          sizeBytes: model.initialStack.sizeBytes,
          argc: model.argv.length,
          envCount: model.envEntries.length,
          pageSize: model.selectedAuxv.pageSize,
          clockTick: model.selectedAuxv.clockTick,
          argvSha256: argvDigest,
          envSha256: envDigest,
        },
        {
          action: "verify-initial-stack",
          targetStart: model.initialStack.targetStart,
          argc: model.argv.length,
          envCount: model.envEntries.length,
        },
      ]
    : [];
}

function auxvResourceHex(documents: NativeProcessImageDocuments): string | undefined {
  const value = documents.resources.resources.find((resource) => resource.kind === "auxv")?.recipe
    ?.bytesHex;
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

function selectedAuxvContext(auxvHex: string): SelectedAuxvContext | undefined {
  const entries = parseAuxvEntries(auxvHex);
  const pageSize = entries.get(AT_PAGESZ);
  const clockTick = entries.get(AT_CLKTCK);
  return pageSize !== undefined && clockTick !== undefined
    ? { pageSize: Number(pageSize), clockTick: Number(clockTick) }
    : undefined;
}

function initialStackContext(
  options: TargetGuestProcessContextRestoreOptions,
): InitialStackContext {
  return {
    targetStart: options.initialStackTargetStart ?? DEFAULT_INITIAL_STACK_TARGET_START,
    sizeBytes: options.initialStackSizeBytes ?? DEFAULT_INITIAL_STACK_SIZE_BYTES,
  };
}

function auxvMaterializationPolicy(auxvHex: string): AuxvMaterializationPolicy {
  const entries = parseAuxvEntries(auxvHex);
  return {
    materializedKeys: [auxvName(AT_PAGESZ), auxvName(AT_CLKTCK)],
    refusedKeys: UNSUPPORTED_INITIAL_STACK_AUXV.filter((key) => entries.has(key)).map(auxvName),
  };
}

function auxvName(key: bigint): string {
  return AUXV_NAMES.get(key) ?? `AT_${key.toString()}`;
}

function initialStackRequiredBytes(argv: string[], envEntries: Array<[string, string]>): number {
  const headerBytes = (1 + argv.length + 1 + envEntries.length + 1 + 6) * 8;
  const stringBytes =
    stringListBytes(argv) +
    envEntries.reduce((total, [key, value]) => total + utf8Bytes(`${key}=${value}`), 0) +
    argv.length +
    envEntries.length;
  return alignUp(headerBytes, 8) + stringBytes;
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function parseAuxvEntries(auxvHex: string): Map<bigint, bigint> {
  const bytes = Buffer.from(auxvHex, "hex");
  const entries = new Map<bigint, bigint>();
  for (let offset = 0; offset + AUXV_ENTRY_BYTES <= bytes.length; offset += AUXV_ENTRY_BYTES) {
    const key = bytes.readBigUInt64LE(offset);
    const value = bytes.readBigUInt64LE(offset + 8);
    if (key === AT_NULL) {
      break;
    }
    entries.set(key, value);
  }
  return entries;
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
