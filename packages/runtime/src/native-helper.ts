import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { BootError, type ErrorCode } from "./errors.ts";

const PROTOCOL_VERSION = 1;
const HELPER_NAME = "machinen-runtime-helper";
const require_ = createRequire(import.meta.url);

interface RuntimeHelperCallOptions<TData> {
  command: string;
  data: unknown;
  isData: (value: unknown) => value is TData;
  errorCode?: ErrorCode;
}

interface RuntimeHelperSuccess<TData> {
  ok: true;
  protocolVersion: number;
  command: string;
  data: TData;
}

interface RuntimeHelperFailure {
  ok: false;
  protocolVersion: number;
  error: RuntimeHelperErrorDetail;
}

interface RuntimeHelperErrorDetail {
  code: string;
  message: string;
}

export function callRuntimeHelper<TData>(opts: RuntimeHelperCallOptions<TData>): TData {
  const errorCode = opts.errorCode ?? "BOOT_MOUNTDISK_TOOL_MISSING";
  const helper = resolveRuntimeHelper(errorCode);
  const result = spawnSync(helper, [opts.command], {
    input: `${JSON.stringify({ protocolVersion: PROTOCOL_VERSION, data: opts.data })}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    throw new BootError(
      errorCode,
      `${HELPER_NAME} failed to start at ${helper}: ${result.error.message}`,
      {
        cause: result.error,
      },
    );
  }

  const response = parseRuntimeHelperResponse<TData>(result.stdout, opts, helper, errorCode);
  if (response.ok === false) {
    throw new BootError(
      errorCode,
      `${HELPER_NAME} ${opts.command} failed (${response.error.code}): ${response.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new BootError(
      errorCode,
      `${HELPER_NAME} ${opts.command} exited ${result.status} after returning ok:true.`,
    );
  }
  return response.data;
}

function parseRuntimeHelperResponse<TData>(
  stdout: string,
  opts: RuntimeHelperCallOptions<TData>,
  helper: string,
  errorCode: ErrorCode,
): RuntimeHelperSuccess<TData> | RuntimeHelperFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new BootError(
      errorCode,
      `${HELPER_NAME} at ${helper} returned invalid JSON for ${opts.command}.`,
      {
        cause: err,
      },
    );
  }
  if (isRuntimeHelperFailure(parsed)) {
    return parsed;
  }
  if (!isRuntimeHelperSuccessEnvelope(parsed, opts.command)) {
    throw new BootError(
      errorCode,
      `${HELPER_NAME} at ${helper} returned an invalid ${opts.command} response shape.`,
    );
  }
  if (!opts.isData(parsed.data)) {
    throw new BootError(
      errorCode,
      `${HELPER_NAME} at ${helper} returned invalid ${opts.command} response data.`,
    );
  }
  return { ...parsed, data: parsed.data };
}

function isRuntimeHelperSuccessEnvelope(
  value: unknown,
  command: string,
): value is Omit<RuntimeHelperSuccess<unknown>, "data"> & { data: unknown } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const response = value as Partial<RuntimeHelperSuccess<unknown>>;
  return (
    response.ok === true &&
    response.protocolVersion === PROTOCOL_VERSION &&
    response.command === command
  );
}

function isRuntimeHelperFailure(value: unknown): value is RuntimeHelperFailure {
  if (!value || typeof value !== "object") {
    return false;
  }
  const response = value as Partial<RuntimeHelperFailure>;
  return (
    response.ok === false &&
    response.protocolVersion === PROTOCOL_VERSION &&
    !!response.error &&
    typeof response.error.code === "string" &&
    typeof response.error.message === "string"
  );
}

function resolveRuntimeHelper(errorCode: ErrorCode): string {
  return (
    resolveRuntimeHelperEnvOverride(errorCode) ??
    findBundledRuntimeHelper() ??
    missingRuntimeHelper(errorCode)
  );
}

function resolveRuntimeHelperEnvOverride(errorCode: ErrorCode): string | undefined {
  const envOverride = process.env.MACHINEN_RUNTIME_HELPER;
  if (!envOverride) {
    return undefined;
  }
  if (existsSync(envOverride)) {
    return envOverride;
  }
  throw new BootError(
    errorCode,
    `MACHINEN_RUNTIME_HELPER=${envOverride} is set but that file does not exist.`,
  );
}

function findBundledRuntimeHelper(): string | undefined {
  const pkg = `@machinen/native-${arch()}-${platform()}`;
  try {
    const mod = require_(pkg) as { runtimeHelper?: string };
    if (mod.runtimeHelper && existsSync(mod.runtimeHelper)) {
      return mod.runtimeHelper;
    }
  } catch {
    // Optional dep not installed for this arch+os.
  }
  return undefined;
}

function missingRuntimeHelper(errorCode: ErrorCode): never {
  throw new BootError(
    errorCode,
    `${HELPER_NAME} was not found. Build it with scripts/build-runtime-helper.sh, install the matching @machinen/native-* package, or set MACHINEN_RUNTIME_HELPER=/abs/path/to/${HELPER_NAME}.`,
  );
}
