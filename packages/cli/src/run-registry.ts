import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const REGISTRY_ORIGIN = "https://machinen.dev";
const REGISTRY_INDEX_URL = `${REGISTRY_ORIGIN}/run/index`;
const MAX_DOCUMENT_BYTES = 128 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

const TRUSTED_KEYS: Readonly<Record<string, string>> = {
  "machinen.dev-2026-01": `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjzAMpg9KEcMHbRPsObeED63z/2AIJaAh+vyksl1UCIw=
-----END PUBLIC KEY-----
`,
};

export type RunWorkspacePermission = "none" | "ro" | "rw";
export type RunStatePermission = { name: string; guest: string; mode: "ro" | "rw" };

export interface RunRecipe {
  schemaVersion: 1;
  publisher: "machinen.dev";
  name: string;
  aliases?: string[];
  summary: string;
  install: string;
  command: string[];
  env?: Record<string, string>;
  permissions: {
    network: true;
    workspace: RunWorkspacePermission;
    state: RunStatePermission[];
  };
}

export interface VerifiedRunRecipe {
  source: string;
  digest: string;
  keyId: string;
  recipe: RunRecipe;
}

export interface RunRegistryEntry {
  name: string;
  aliases?: string[];
  summary: string;
  source: string;
  sha256: string;
}

export interface VerifiedRunRegistry {
  source: string;
  digest: string;
  keyId: string;
  recipes: RunRegistryEntry[];
}

interface SignedEnvelope {
  envelopeVersion: 1;
  algorithm: "Ed25519";
  keyId: string;
  payload: string;
  signature: string;
}

interface RegistryPayload {
  schemaVersion: 1;
  publisher: "machinen.dev";
  recipes: RunRegistryEntry[];
}

interface RegistryLoadOptions {
  fetchImpl?: typeof fetch;
  cacheDir?: string;
  trustedKeys?: Readonly<Record<string, string>>;
  warn?: (message: string) => void;
}

class RegistryUnavailableError extends Error {}

export async function loadRunRecipe(
  reference: string,
  opts: RegistryLoadOptions = {},
): Promise<VerifiedRunRecipe> {
  const source = normalizeRunRecipeReference(reference);
  const raw = await loadSignedDocument(source, opts);
  const verified = verifyEnvelope(raw, opts.trustedKeys ?? TRUSTED_KEYS);
  return {
    source,
    digest: verified.digest,
    keyId: verified.keyId,
    recipe: parseRunRecipe(verified.payload),
  };
}

export async function loadRunRegistry(
  opts: RegistryLoadOptions = {},
): Promise<VerifiedRunRegistry> {
  const raw = await loadSignedDocument(REGISTRY_INDEX_URL, opts);
  const verified = verifyEnvelope(raw, opts.trustedKeys ?? TRUSTED_KEYS);
  const payload = parseRegistryPayload(verified.payload);
  return {
    source: REGISTRY_INDEX_URL,
    digest: verified.digest,
    keyId: verified.keyId,
    recipes: payload.recipes,
  };
}

export function normalizeRunRecipeReference(reference: string): string {
  const trimmed = reference.trim();
  if (trimmed.length === 0) {
    throw new Error("run recipe reference cannot be empty");
  }
  const withProtocol = trimmed.startsWith("machinen.dev/") ? `https://${trimmed}` : trimmed;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error(
      `invalid run recipe URL: ${reference}\nExpected machinen.dev/run/<name> or https://machinen.dev/run/<name>.`,
    );
  }
  validateOfficialRecipeUrl(url);
  return url.toString();
}

export function verifyRunRecipeEnvelope(
  raw: string,
  source: string,
  trustedKeys: Readonly<Record<string, string>> = TRUSTED_KEYS,
): VerifiedRunRecipe {
  validateOfficialRecipeUrl(new URL(source));
  const verified = verifyEnvelope(raw, trustedKeys);
  return {
    source,
    digest: verified.digest,
    keyId: verified.keyId,
    recipe: parseRunRecipe(verified.payload),
  };
}

function validateOfficialRecipeUrl(url: URL): void {
  if (url.origin !== REGISTRY_ORIGIN) {
    throw new Error(
      `untrusted run recipe origin: ${url.origin}\nOnly ${REGISTRY_ORIGIN}/run/* is supported.`,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("run recipe URLs cannot contain credentials, query parameters, or fragments");
  }
  if (!/^\/run\/[a-z0-9][a-z0-9-]{0,63}$/.test(url.pathname)) {
    throw new Error(`invalid run recipe URL path: ${url.pathname}`);
  }
}

async function loadSignedDocument(source: string, opts: RegistryLoadOptions): Promise<string> {
  try {
    const raw = await fetchSignedDocument(source, opts.fetchImpl ?? fetch);
    // Verify before putting bytes into the trusted offline cache.
    verifyEnvelope(raw, opts.trustedKeys ?? TRUSTED_KEYS);
    writeRegistryCache(source, raw, opts.cacheDir);
    return raw;
  } catch (error) {
    if (!(error instanceof RegistryUnavailableError)) {
      throw error;
    }
    const cached = readRegistryCache(source, opts.cacheDir);
    if (cached === undefined) {
      throw error;
    }
    verifyEnvelope(cached, opts.trustedKeys ?? TRUSTED_KEYS);
    (opts.warn ?? defaultWarning)(
      `machinen: registry unavailable; using signed cached recipe for ${source}\n`,
    );
    return cached;
  }
}

async function fetchSignedDocument(source: string, fetchImpl: typeof fetch): Promise<string> {
  let current = new URL(source);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetchRegistryResponse(current, fetchImpl);
    const redirect = redirectTarget(response, current);
    if (redirect) {
      current = redirect;
      continue;
    }
    requireSuccessfulResponse(response, current);
    return await readBoundedResponse(response);
  }
  throw new Error(`run registry redirected more than ${MAX_REDIRECTS} times`);
}

async function fetchRegistryResponse(current: URL, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(current, {
      headers: { accept: "application/vnd.machinen.run.v1+json, application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RegistryUnavailableError(
      `could not fetch run recipe ${current}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function redirectTarget(response: Response, current: URL): URL | undefined {
  if (!isRedirect(response.status)) {
    return undefined;
  }
  const location = response.headers.get("location");
  if (!location) {
    throw new Error(`run registry returned redirect ${response.status} without Location`);
  }
  const target = new URL(location, current);
  validateOfficialRecipeUrl(target);
  return target;
}

function requireSuccessfulResponse(response: Response, current: URL): void {
  if (response.ok) {
    return;
  }
  const message = `run registry returned HTTP ${response.status} for ${current}`;
  if (response.status >= 500) {
    throw new RegistryUnavailableError(message);
  }
  throw new Error(message);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`run registry document exceeds ${MAX_DOCUMENT_BYTES} bytes`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`run registry document exceeds ${MAX_DOCUMENT_BYTES} bytes`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function verifyEnvelope(
  raw: string,
  trustedKeys: Readonly<Record<string, string>>,
): { payload: unknown; digest: string; keyId: string } {
  const envelope = parseEnvelope(raw);
  const publicKeyPem = trustedKeys[envelope.keyId];
  if (!publicKeyPem) {
    throw new Error(`run recipe was signed by unknown key: ${envelope.keyId}`);
  }
  const payloadBytes = decodeBase64(envelope.payload, "payload");
  const signatureBytes = decodeBase64(envelope.signature, "signature");
  if (signatureBytes.byteLength !== 64) {
    throw new Error("run recipe signature has an invalid length");
  }
  const valid = verify(null, payloadBytes, createPublicKey(publicKeyPem), signatureBytes);
  if (!valid) {
    throw new Error("run recipe signature verification failed");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new Error("signed run recipe payload is not valid JSON");
  }
  return {
    payload,
    digest: createHash("sha256").update(payloadBytes).digest("hex"),
    keyId: envelope.keyId,
  };
}

function parseEnvelope(raw: string): SignedEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("run registry response is not valid JSON");
  }
  const object = expectObject(value, "run registry envelope");
  expectExactKeys(object, ["algorithm", "envelopeVersion", "keyId", "payload", "signature"]);
  if (object.envelopeVersion !== 1 || object.algorithm !== "Ed25519") {
    throw new Error("unsupported run recipe envelope version or algorithm");
  }
  return {
    envelopeVersion: 1,
    algorithm: "Ed25519",
    keyId: expectString(object.keyId, "envelope.keyId", 64),
    payload: expectString(object.payload, "envelope.payload", MAX_DOCUMENT_BYTES),
    signature: expectString(object.signature, "envelope.signature", 256),
  };
}

function decodeBase64(value: string, label: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`run recipe ${label} is not canonical base64`);
  }
  return Buffer.from(value, "base64");
}

function parseRunRecipe(value: unknown): RunRecipe {
  const recipe = expectObject(value, "run recipe");
  expectAllowedKeys(recipe, [
    "aliases",
    "command",
    "env",
    "install",
    "name",
    "permissions",
    "publisher",
    "schemaVersion",
    "summary",
  ]);
  if (recipe.schemaVersion !== 1 || recipe.publisher !== "machinen.dev") {
    throw new Error("unsupported run recipe schema or publisher");
  }
  const name = expectSlug(recipe.name, "recipe.name");
  const aliases =
    recipe.aliases === undefined ? undefined : expectSlugArray(recipe.aliases, "recipe.aliases");
  const summary = expectString(recipe.summary, "recipe.summary", 240);
  const install = expectString(recipe.install, "recipe.install", 32 * 1024);
  if (install.trim().length === 0) {
    throw new Error("recipe.install cannot be empty");
  }
  return {
    schemaVersion: 1,
    publisher: "machinen.dev",
    name,
    ...(aliases ? { aliases } : {}),
    summary,
    install,
    command: parseCommand(recipe.command),
    ...(recipe.env === undefined ? {} : { env: parseEnv(recipe.env) }),
    permissions: parsePermissions(recipe.permissions),
  };
}

function parseCommand(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("recipe.command must contain 1-32 argv strings");
  }
  return value.map((arg, index) => {
    const parsed = expectString(arg, `recipe.command[${index}]`, 4096);
    if (parsed.includes("\0")) {
      throw new Error(`recipe.command[${index}] cannot contain NUL`);
    }
    return parsed;
  });
}

function parseEnv(value: unknown): Record<string, string> {
  const object = expectObject(value, "recipe.env");
  if (Object.keys(object).length > 64) {
    throw new Error("recipe.env cannot contain more than 64 entries");
  }
  const env: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(object)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`invalid recipe environment key: ${key}`);
    }
    const parsed = expectString(candidate, `recipe.env.${key}`, 8192);
    if (parsed.includes("\0")) {
      throw new Error(`recipe.env.${key} cannot contain NUL`);
    }
    env[key] = parsed;
  }
  return env;
}

function parsePermissions(value: unknown): RunRecipe["permissions"] {
  const permissions = expectObject(value, "recipe.permissions");
  expectExactKeys(permissions, ["network", "state", "workspace"]);
  if (permissions.network !== true) {
    throw new Error("v1 run recipes must declare outbound network access");
  }
  if (!isWorkspacePermission(permissions.workspace)) {
    throw new Error("recipe.permissions.workspace must be none, ro, or rw");
  }
  return {
    network: true,
    workspace: permissions.workspace,
    state: parseStatePermissions(permissions.state),
  };
}

function isWorkspacePermission(value: unknown): value is RunWorkspacePermission {
  return value === "none" || value === "ro" || value === "rw";
}

function parseStatePermissions(value: unknown): RunStatePermission[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error("recipe.permissions.state must be an array with at most 16 entries");
  }
  const names = new Set<string>();
  const guests = new Set<string>();
  return value.map((candidate, index) => {
    const state = expectObject(candidate, `recipe.permissions.state[${index}]`);
    expectExactKeys(state, ["guest", "mode", "name"]);
    const name = expectSlug(state.name, `recipe.permissions.state[${index}].name`);
    const guest = expectGuestPath(state.guest, `recipe.permissions.state[${index}].guest`);
    if (state.mode !== "ro" && state.mode !== "rw") {
      throw new Error(`recipe.permissions.state[${index}].mode must be ro or rw`);
    }
    if (names.has(name) || guests.has(guest)) {
      throw new Error("recipe state names and guest paths must be unique");
    }
    names.add(name);
    guests.add(guest);
    return { name, guest, mode: state.mode };
  });
}

function expectGuestPath(value: unknown, label: string): string {
  const path = expectString(value, label, 4096);
  if (
    !path.startsWith("/") ||
    path.includes("\0") ||
    path.includes("/../") ||
    path.endsWith("/..")
  ) {
    throw new Error(`${label} must be a safe absolute path`);
  }
  const reserved = ["/dev", "/proc", "/sys", "/run", "/mnt/workspace"];
  if (reserved.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    throw new Error(`${label} cannot overlap reserved path ${path}`);
  }
  return path;
}

function parseRegistryPayload(value: unknown): RegistryPayload {
  const payload = expectObject(value, "run registry index");
  expectExactKeys(payload, ["publisher", "recipes", "schemaVersion"]);
  if (payload.schemaVersion !== 1 || payload.publisher !== "machinen.dev") {
    throw new Error("unsupported run registry index schema or publisher");
  }
  if (!Array.isArray(payload.recipes) || payload.recipes.length > 256) {
    throw new Error("run registry index recipes must be an array with at most 256 entries");
  }
  return {
    schemaVersion: 1,
    publisher: "machinen.dev",
    recipes: payload.recipes.map(parseRegistryEntry),
  };
}

function parseRegistryEntry(value: unknown, index: number): RunRegistryEntry {
  const entry = expectObject(value, `registry.recipes[${index}]`);
  expectAllowedKeys(entry, ["aliases", "name", "sha256", "source", "summary"]);
  const source = normalizeRunRecipeReference(expectString(entry.source, "registry source", 512));
  const sha256 = expectString(entry.sha256, "registry sha256", 64);
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("registry recipe sha256 must be 64 lowercase hexadecimal characters");
  }
  return {
    name: expectSlug(entry.name, "registry recipe name"),
    ...(entry.aliases === undefined
      ? {}
      : { aliases: expectSlugArray(entry.aliases, "registry aliases") }),
    summary: expectString(entry.summary, "registry summary", 240),
    source,
    sha256,
  };
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function expectSlug(value: unknown, label: string): string {
  const parsed = expectString(value, label, 64);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(parsed)) {
    throw new Error(`${label} must use lowercase letters, digits, and dashes`);
  }
  return parsed;
}

function expectSlugArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error(`${label} must be an array with at most 16 entries`);
  }
  return value.map((candidate, index) => expectSlug(candidate, `${label}[${index}]`));
}

function expectExactKeys(object: Record<string, unknown>, keys: string[]): void {
  const expected = new Set(keys);
  const actual = Object.keys(object);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new Error(`unexpected fields: expected ${keys.join(", ")}`);
  }
}

function expectAllowedKeys(object: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(object).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`unexpected fields: ${unexpected.join(", ")}`);
  }
}

function registryCachePath(source: string, cacheDir?: string): string {
  const root = cacheDir ?? join(homedir(), ".machinen", "run", "registry");
  const key = createHash("sha256").update(source).digest("hex");
  return join(root, `${key}.json`);
}

function writeRegistryCache(source: string, raw: string, cacheDir?: string): void {
  const path = registryCachePath(source, cacheDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, raw, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

function readRegistryCache(source: string, cacheDir?: string): string | undefined {
  const path = registryCachePath(source, cacheDir);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function defaultWarning(message: string): void {
  process.stderr.write(message);
}
