import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { approveRunRecipe, hasRunRecipeApproval } from "../run-approval.ts";
import {
  loadRunRecipe,
  loadRunRegistry,
  normalizeRunRecipeReference,
  verifyRunRecipeEnvelope,
  type RunRecipe,
} from "../run-registry.ts";

const recipe: RunRecipe = {
  schemaVersion: 1,
  publisher: "machinen.dev",
  name: "test-tool",
  summary: "A test recipe.",
  install: ["set -e", "echo install"],
  command: ["test-tool"],
  permissions: {
    network: true,
    workspace: "ro",
    state: [{ name: "config", guest: "/root/.test-tool", mode: "rw" }],
  },
};

function signedEnvelope(payload: unknown) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from(JSON.stringify(payload));
  const signature = sign(null, bytes, privateKey);
  return {
    raw: JSON.stringify({
      envelopeVersion: 1,
      algorithm: "Ed25519",
      keyId: "test-key",
      payload: bytes.toString("base64"),
      signature: signature.toString("base64"),
    }),
    keys: {
      "test-key": publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
  };
}

describe("run recipe references", () => {
  it("accepts full and schemeless machinen.dev URLs", () => {
    expect(normalizeRunRecipeReference("machinen.dev/run/claude-code")).toBe(
      "https://machinen.dev/run/claude-code",
    );
    expect(normalizeRunRecipeReference("https://machinen.dev/run/claude-code")).toBe(
      "https://machinen.dev/run/claude-code",
    );
  });

  it("rejects shorthand names, third-party origins, HTTP, and URL parameters", () => {
    expect(() => normalizeRunRecipeReference("claude-code")).toThrow(/invalid run recipe URL/);
    expect(() => normalizeRunRecipeReference("https://example.com/run/tool")).toThrow(
      /untrusted run recipe origin/,
    );
    expect(() => normalizeRunRecipeReference("http://machinen.dev/run/tool")).toThrow(
      /untrusted run recipe origin/,
    );
    expect(() => normalizeRunRecipeReference("https://machinen.dev/run/tool?next=x")).toThrow(
      /query parameters/,
    );
  });
});

describe("signed run recipes", () => {
  it("verifies an Ed25519 signature and parses the strict recipe schema", () => {
    const envelope = signedEnvelope(recipe);
    const verified = verifyRunRecipeEnvelope(
      envelope.raw,
      "https://machinen.dev/run/test-tool",
      envelope.keys,
    );

    expect(verified.recipe).toEqual(recipe);
    expect(verified.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(verified.keyId).toBe("test-key");
  });

  it("rejects payload tampering", () => {
    const envelope = signedEnvelope(recipe);
    const parsed = JSON.parse(envelope.raw);
    const tampered = Buffer.from(parsed.payload, "base64").toString("utf8").replace("ro", "rw");
    parsed.payload = Buffer.from(tampered).toString("base64");

    expect(() =>
      verifyRunRecipeEnvelope(
        JSON.stringify(parsed),
        "https://machinen.dev/run/test-tool",
        envelope.keys,
      ),
    ).toThrow(/signature verification failed/);
  });

  it("rejects embedded newlines in install entries", () => {
    const envelope = signedEnvelope({ ...recipe, install: ["echo one\necho two"] });

    expect(() =>
      verifyRunRecipeEnvelope(envelope.raw, "https://machinen.dev/run/test-tool", envelope.keys),
    ).toThrow(/must be exactly one shell line/);
  });

  it("rejects recipe-selected host paths even when the payload is signed", () => {
    const unsafe = structuredClone(recipe) as unknown as Record<string, unknown>;
    const permissions = unsafe.permissions as { state: Array<Record<string, unknown>> };
    permissions.state[0]!.host = "~/.ssh";
    const envelope = signedEnvelope(unsafe);

    expect(() =>
      verifyRunRecipeEnvelope(envelope.raw, "https://machinen.dev/run/test-tool", envelope.keys),
    ).toThrow(/unexpected fields/);
  });
});

describe("published machinen.dev recipes", () => {
  const publishedDir = resolve(import.meta.dirname, "../../../../apps/machinen.dev/public/run");

  it("uses envelopes accepted by the CLI's pinned production key and schema", () => {
    const expectedNames = new Map([
      ["pi", "pi"],
      ["command-code", "command-code"],
      ["claude-code", "claude-code"],
      ["claude", "claude-code"],
      ["codex", "codex"],
    ]);
    for (const [endpoint, recipeName] of expectedNames) {
      const verified = verifyRunRecipeEnvelope(
        readFileSync(join(publishedDir, endpoint), "utf8"),
        `https://machinen.dev/run/${endpoint}`,
      );
      expect(verified.recipe.name).toBe(recipeName);
      expect(verified.recipe.install).toContain(
        "apt-get install -y --no-install-recommends git ca-certificates openssh-client",
      );
      expect(verified.recipe.install).toContain("git --version");
    }
  });

  it("publishes an index accepted by the CLI", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return new Response(
        readFileSync(join(publishedDir, url.pathname.split("/").at(-1)!), "utf8"),
      );
    }) as unknown as typeof fetch;
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-run-registry-test-"));

    const registry = await loadRunRegistry({ fetchImpl, cacheDir });

    expect(registry.recipes.map((entry) => entry.name)).toEqual([
      "claude-code",
      "codex",
      "command-code",
      "pi",
    ]);
  });
});

describe("run recipe fetching", () => {
  it("fetches, verifies, and caches a signed recipe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-run-registry-test-"));
    const envelope = signedEnvelope(recipe);
    const fetchImpl = vi.fn(async () => new Response(envelope.raw)) as unknown as typeof fetch;

    const verified = await loadRunRecipe("machinen.dev/run/test-tool", {
      fetchImpl,
      cacheDir: dir,
      trustedKeys: envelope.keys,
    });

    expect(verified.recipe.name).toBe("test-tool");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses only a previously verified cache entry when the registry is unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-run-registry-test-"));
    const envelope = signedEnvelope(recipe);
    const available = vi.fn(async () => new Response(envelope.raw)) as unknown as typeof fetch;
    await loadRunRecipe("machinen.dev/run/test-tool", {
      fetchImpl: available,
      cacheDir: dir,
      trustedKeys: envelope.keys,
    });

    const warning = vi.fn();
    const unavailable = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const cached = await loadRunRecipe("machinen.dev/run/test-tool", {
      fetchImpl: unavailable,
      cacheDir: dir,
      trustedKeys: envelope.keys,
      warn: warning,
    });

    expect(cached.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("using signed cached recipe"));
  });

  it("rejects redirects away from the trusted registry origin", async () => {
    const redirected = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/run/test-tool" },
        }),
    ) as unknown as typeof fetch;

    await expect(
      loadRunRecipe("machinen.dev/run/test-tool", { fetchImpl: redirected }),
    ).rejects.toThrow(/untrusted run recipe origin/);
  });
});

describe("run recipe approvals", () => {
  it("approves only the exact signed payload digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-run-approval-test-"));
    const path = join(dir, "approvals.json");
    const firstEnvelope = signedEnvelope(recipe);
    const first = verifyRunRecipeEnvelope(
      firstEnvelope.raw,
      "https://machinen.dev/run/test-tool",
      firstEnvelope.keys,
    );
    expect(hasRunRecipeApproval(first, path)).toBe(false);

    approveRunRecipe(first, path);
    expect(hasRunRecipeApproval(first, path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain(first.digest);

    const changedEnvelope = signedEnvelope({ ...recipe, summary: "Changed." });
    const changed = verifyRunRecipeEnvelope(
      changedEnvelope.raw,
      "https://machinen.dev/run/test-tool",
      changedEnvelope.keys,
    );
    expect(hasRunRecipeApproval(changed, path)).toBe(false);
  });
});
