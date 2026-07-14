import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "run-recipes");
const OUTPUT_DIR = join(ROOT, "public", "run");
const PUBLIC_KEY_PATH = join(SOURCE_DIR, "machinen.dev-2026-01-public.pem");
const KEY_ID = "machinen.dev-2026-01";
const ORIGIN = "https://machinen.dev";
const verifyOnly = process.argv.includes("--verify");

const publicKey = createPublicKey(readFileSync(PUBLIC_KEY_PATH));
const recipes = readRecipes();
const expectedIndex = registryPayload(recipes);

if (verifyOnly) {
  verifyPublishedRecipes(recipes, expectedIndex);
  process.stdout.write(`verified ${recipes.length} signed run recipes\n`);
} else {
  const privateKeyPath = process.env.MACHINEN_RUN_SIGNING_KEY;
  if (!privateKeyPath) {
    throw new Error("MACHINEN_RUN_SIGNING_KEY must point to the Ed25519 private key");
  }
  const privateKey = createPrivateKey(readFileSync(privateKeyPath));
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const recipe of recipes) {
    const envelope = signPayload(recipe, privateKey);
    writeEnvelope(recipe.name, envelope);
    for (const alias of recipe.aliases ?? []) {
      writeEnvelope(alias, envelope);
    }
  }
  writeEnvelope("index", signPayload(expectedIndex, privateKey));
  process.stdout.write(`signed ${recipes.length} run recipes with ${KEY_ID}\n`);
}

function readRecipes() {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const recipe = JSON.parse(readFileSync(join(SOURCE_DIR, name), "utf8"));
      validateRecipe(recipe, name);
      return recipe;
    });
}

function validateRecipe(recipe, filename) {
  assertObject(recipe, filename);
  assertAllowedKeys(recipe, [
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
  validateRecipeIdentity(recipe, filename);
  validateRecipeAliases(recipe.aliases, filename);
  assertString(recipe.summary, `${filename}: summary`);
  assertString(recipe.install, `${filename}: install`);
  validateRecipeCommand(recipe.command, filename);
  validateEnv(recipe.env, filename);
  validatePermissions(recipe.permissions, filename);
}

function validateRecipeIdentity(recipe, filename) {
  if (recipe.schemaVersion !== 1 || recipe.publisher !== "machinen.dev") {
    throw new Error(`${filename}: unsupported schema or publisher`);
  }
  assertSlug(recipe.name, `${filename}: name`);
}

function validateRecipeAliases(aliases, filename) {
  if (aliases !== undefined) {
    assertSlugArray(aliases, `${filename}: aliases`);
  }
}

function validateRecipeCommand(command, filename) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error(`${filename}: command must be a non-empty argv array`);
  }
  for (const arg of command) {
    assertString(arg, `${filename}: command arg`);
  }
}

function validateEnv(env, filename) {
  if (env === undefined) {
    return;
  }
  assertObject(env, `${filename}: env`);
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`${filename}: invalid env key ${key}`);
    }
    assertString(value, `${filename}: env ${key}`);
  }
}

function validatePermissions(permissions, filename) {
  assertObject(permissions, `${filename}: permissions`);
  assertExactKeys(permissions, ["network", "state", "workspace"]);
  validateNetworkPermission(permissions.network, filename);
  validateWorkspacePermission(permissions.workspace, filename);
  validateStatePermissions(permissions.state, filename);
}

function validateNetworkPermission(network, filename) {
  if (network !== true) {
    throw new Error(`${filename}: v1 recipes must declare outbound network access`);
  }
}

function validateWorkspacePermission(workspace, filename) {
  if (!["none", "ro", "rw"].includes(workspace)) {
    throw new Error(`${filename}: invalid workspace permission`);
  }
}

function validateStatePermissions(states, filename) {
  if (!Array.isArray(states)) {
    throw new Error(`${filename}: permissions.state must be an array`);
  }
  for (const state of states) {
    validateStatePermission(state, filename);
  }
}

function validateStatePermission(state, filename) {
  assertObject(state, `${filename}: state`);
  assertExactKeys(state, ["guest", "mode", "name"]);
  assertSlug(state.name, `${filename}: state name`);
  if (state.mode !== "ro" && state.mode !== "rw") {
    throw new Error(`${filename}: invalid state mode`);
  }
  validateStateGuestPath(state.guest, filename);
}

function validateStateGuestPath(guest, filename) {
  if (typeof guest !== "string" || !guest.startsWith("/")) {
    throw new Error(`${filename}: state guest must be absolute`);
  }
}

function registryPayload(values) {
  return {
    schemaVersion: 1,
    publisher: "machinen.dev",
    recipes: values.map((recipe) => {
      const payload = canonicalBytes(recipe);
      return {
        name: recipe.name,
        ...(recipe.aliases ? { aliases: recipe.aliases } : {}),
        summary: recipe.summary,
        source: `${ORIGIN}/run/${recipe.name}`,
        sha256: createHash("sha256").update(payload).digest("hex"),
      };
    }),
  };
}

function signPayload(value, privateKey) {
  const payload = canonicalBytes(value);
  const signature = sign(null, payload, privateKey);
  if (!verify(null, payload, publicKey, signature)) {
    throw new Error("new signature did not verify against the committed public key");
  }
  return {
    envelopeVersion: 1,
    algorithm: "Ed25519",
    keyId: KEY_ID,
    payload: payload.toString("base64"),
    signature: signature.toString("base64"),
  };
}

function verifyPublishedRecipes(values, expectedRegistry) {
  for (const recipe of values) {
    verifyPublishedRecipe(recipe);
  }
  const index = readAndVerifyEnvelope("index");
  assertCanonicalPayload(index, expectedRegistry, "index");
}

function verifyPublishedRecipe(recipe) {
  const primary = readAndVerifyEnvelope(recipe.name);
  assertCanonicalPayload(primary, recipe, recipe.name);
  for (const alias of recipe.aliases ?? []) {
    assertAliasMatchesRecipe(alias, primary, recipe.name);
  }
}

function assertAliasMatchesRecipe(alias, primary, recipeName) {
  const aliasEnvelope = readAndVerifyEnvelope(alias);
  if (JSON.stringify(aliasEnvelope) !== JSON.stringify(primary)) {
    throw new Error(`published alias ${alias} does not match ${recipeName}`);
  }
}

function readAndVerifyEnvelope(name) {
  const path = join(OUTPUT_DIR, name);
  requirePublishedEnvelope(path);
  const envelope = JSON.parse(readFileSync(path, "utf8"));
  assertEnvelopeMetadata(envelope, name);
  assertEnvelopeSignature(envelope, name);
  return envelope;
}

function requirePublishedEnvelope(path) {
  if (!existsSync(path)) {
    throw new Error(`missing published recipe: ${path}`);
  }
}

function assertEnvelopeMetadata(envelope, name) {
  assertExactKeys(envelope, ["algorithm", "envelopeVersion", "keyId", "payload", "signature"]);
  if (
    envelope.envelopeVersion !== 1 ||
    envelope.algorithm !== "Ed25519" ||
    envelope.keyId !== KEY_ID
  ) {
    throw new Error(`${name}: invalid signed envelope metadata`);
  }
}

function assertEnvelopeSignature(envelope, name) {
  const payload = Buffer.from(envelope.payload, "base64");
  const signature = Buffer.from(envelope.signature, "base64");
  if (!verify(null, payload, publicKey, signature)) {
    throw new Error(`${name}: signature verification failed`);
  }
}

function assertCanonicalPayload(envelope, expected, name) {
  const actual = Buffer.from(envelope.payload, "base64");
  const canonical = canonicalBytes(expected);
  if (!actual.equals(canonical)) {
    throw new Error(`${name}: signed payload is stale; run pnpm recipes:sign`);
  }
}

function writeEnvelope(name, envelope) {
  writeFileSync(join(OUTPUT_DIR, name), `${JSON.stringify(envelope, null, 2)}\n`);
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(sortValue(value)), "utf8");
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty string without NUL`);
  }
}

function assertSlug(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a lowercase slug`);
  }
}

function assertSlugArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (const item of value) {
    assertSlug(item, label);
  }
}

function assertAllowedKeys(object, keys) {
  const allowed = new Set(keys);
  const unexpected = Object.keys(object).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`unexpected fields: ${unexpected.join(", ")}`);
  }
}

function assertExactKeys(object, keys) {
  assertAllowedKeys(object, keys);
  const actual = new Set(Object.keys(object));
  const missing = keys.filter((key) => !actual.has(key));
  if (missing.length > 0) {
    throw new Error(`missing fields: ${missing.join(", ")}`);
  }
}
