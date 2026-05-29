import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildProductClaimRegistry,
  filterProductClaimRegistry,
  productClaimRefusalSummary,
} from "../product-claim-registry.ts";

const REPO_ROOT = resolve(new URL("../../../../", import.meta.url).pathname);
const PROFILES = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "scripts/portable-machine-proof-profiles.json"), "utf8"),
);

describe("Goal 46 product claim registry", () => {
  it("classifies every portable-machine proof profile into a product status", () => {
    const registry = buildProductClaimRegistry(PROFILES);

    expect(registry.entries).toHaveLength(PROFILES.length + 2);
    expect(registry.summary.total).toBe(PROFILES.length + 2);
    expect(registry.summary.implementedProductSupport).toBe(5);
    expect(
      registry.entries.filter((entry) => entry.productStatus === "implemented-product-support"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "node-app-http-server-recreate",
          migrationCompleted: true,
          proofOnly: false,
        }),
        expect.objectContaining({
          name: "python-cross-arch-runtime-policy",
          migrationCompleted: true,
          proofOnly: false,
        }),
        expect.objectContaining({
          name: "go-cross-arch-runtime-policy",
          migrationCompleted: true,
          proofOnly: false,
          supportLevel: "level-1-semantic-restart",
        }),
        expect.objectContaining({
          name: "ping-level4-socket-reconstruction-v1",
          migrationCompleted: true,
          proofOnly: false,
          supportLevel: "level-4-kernel-resource-reconstruction",
        }),
        expect.objectContaining({
          name: "eventfd-counter-v1-nonsemaphore-no-waiters",
          family: "native-linux-resource",
          migrationCompleted: true,
          proofOnly: false,
          supportLevel: "level-4-kernel-resource-reconstruction",
        }),
      ]),
    );
    expect(
      registry.entries.some(
        (entry) =>
          entry.name === "ping-sequence-counter-semantic-continuation-v1" &&
          entry.productStatus === "implemented-product-support",
      ),
    ).toBe(false);
    expect(registry.summary.stableProductRefusals).toBeGreaterThan(0);
    expect(registry.summary.proofOnlyFixtures).toBeGreaterThan(0);
  });

  it("makes ping and raw ICMP refusals visible as stable product refusals", () => {
    const registry = buildProductClaimRegistry(PROFILES);
    const ping = registry.entries.find(
      (entry) => entry.name === "ping-socket-known-unread-reply-v3-multiple-replies-refusal",
    );
    const rawIcmp = registry.entries.find(
      (entry) => entry.name === "raw-icmp-known-unread-reply-v1-multiple-replies-refusal",
    );

    expect(ping).toMatchObject({
      family: "network-ping-socket",
      productStatus: "stable-product-refusal",
      migrationCompleted: false,
    });
    expect(rawIcmp).toMatchObject({
      family: "network-ping-socket",
      productStatus: "stable-product-refusal",
      migrationCompleted: false,
    });
    expect(productClaimRefusalSummary(ping!)).toMatchObject({
      targetState: "refused",
      migrationCompleted: false,
      expectedRefusalCode: "target-socket-syscall-state-unsupported",
    });
  });

  it("keeps proof-only success fixtures out of implemented product support", () => {
    const registry = buildProductClaimRegistry(PROFILES);
    const proofOnly = filterProductClaimRegistry(registry.entries, {
      status: "proof-only-fixture",
    });

    expect(proofOnly.length).toBeGreaterThan(0);
    expect(proofOnly.every((entry) => entry.migrationCompleted === false)).toBe(true);
    expect(proofOnly.every((entry) => entry.descriptorRequired === false)).toBe(true);
    expect(proofOnly.some((entry) => entry.name === "two-thread-ppoll")).toBe(true);
  });

  it("classifies all Goal 46 families", () => {
    const registry = buildProductClaimRegistry(PROFILES);
    for (const family of [
      "nodejs",
      "go",
      "python-ruby-jvm",
      "stateful-services",
      "foundation-native",
      "native-linux-resource",
      "network-ping-socket",
    ] as const) {
      expect(registry.summary.byFamily[family], `${family} has entries`).toBeGreaterThan(0);
    }
  });
});
