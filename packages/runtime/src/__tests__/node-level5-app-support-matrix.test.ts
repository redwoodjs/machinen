import { describe, expect, it } from "vitest";

import {
  buildNodeLevel5AppSupportMatrix,
  notProvenNodeLevel5AppSupportRows,
  refusedNodeLevel5AppSupportRows,
  supportedNodeLevel5AppSupportRows,
} from "../node-level5-app-support-matrix.ts";

describe("Node Level 5 app support matrix", () => {
  it("is based on particular fixture, template, installed, refusal, and gap apps", () => {
    const matrix = buildNodeLevel5AppSupportMatrix();

    expect(matrix).toMatchObject({
      accepted: true,
      kind: "machinen.node-level5-app-support-matrix",
      version: 2,
      nodeProductSupportClaimed: 90,
      broadNodeProductSupportClaimed: 30,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    });
    expect(matrix.rowCount).toBe(114);
    expect(matrix.rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        "express-fixture-product-run",
        "fastify-plugin-route",
        "express-installed-hello-world",
        "fastify-installed-plugin-route",
        "express-websockets",
        "fastify-native-addons",
        "express-installed-json-response",
        "fastify-background-tasks-not-proven",
        "express-db-connections",
        "fastify-cluster-mode",
        "express-installed-idle-timer",
        "fastify-installed-safe-outbound-reconnect",
        "express-installed-post-json-body",
        "fastify-installed-delete-route",
        "express-installed-redirect",
        "fastify-installed-response-header",
        "express-installed-error-handler",
        "fastify-installed-hook-chain",
        "express-installed-static-cache-header",
        "fastify-installed-configured-prefix",
        "express-installed-health-check",
        "fastify-installed-health-check",
        "express-generic-vm-cjs",
        "fastify-generic-vm-esm",
        "express-generic-vm-worker-threads",
      ]),
    );
  });

  it("marks positive app rows supported only for the declared idle HTTP subset", () => {
    const rows = supportedNodeLevel5AppSupportRows();

    expect(rows).toHaveLength(68);
    expect(rows.every((row) => row.status === "supported")).toBe(true);
    expect(rows.every((row) => row.supportScope === "declared-subset-idle-http")).toBe(true);
    expect(rows.every((row) => row.directions.includes("arm64-to-amd64"))).toBe(true);
    expect(rows.every((row) => row.directions.includes("amd64-to-arm64"))).toBe(true);
    expect(new Set(rows.map((row) => row.evidence.kind))).toEqual(
      new Set([
        "fixture-product-run-corpus",
        "template-corpus",
        "installed-package-corpus",
        "generic-vm-detected-corpus",
      ]),
    );
  });

  it("records feature dimensions for supported app rows", () => {
    const rows = supportedNodeLevel5AppSupportRows();
    const fastifyPlugin = rows.find((row) => row.id === "fastify-installed-plugin-route");
    const expressRouter = rows.find((row) => row.id === "express-installed-router");
    const expressJson = rows.find((row) => row.id === "express-installed-json-response");
    const fastifyQuery = rows.find((row) => row.id === "fastify-installed-query-string");
    const expressStatic = rows.find((row) => row.id === "express-installed-static-asset");
    const fastifyIdleTimer = rows.find((row) => row.id === "fastify-installed-idle-timer");
    const expressOutbound = rows.find(
      (row) => row.id === "express-installed-safe-outbound-reconnect",
    );
    const expressPostBody = rows.find((row) => row.id === "express-installed-post-json-body");

    expect(fastifyPlugin?.features).toMatchObject({
      asyncHandler: true,
      middleware: "pure-js",
      response: "text",
      route: "plugin-route",
    });
    expect(fastifyPlugin?.featureAssessment.asyncHandler).toBe("supported");
    expect(expressRouter?.features.route).toBe("router-route");
    expect(expressRouter?.featureAssessment.params).toBe("not-proven");
    expect(expressJson?.featureAssessment.response).toBe("supported");
    expect(fastifyQuery?.featureAssessment.query).toBe("supported");
    expect(expressStatic?.featureAssessment.staticAssets).toBe("supported");
    expect(fastifyIdleTimer?.featureAssessment.backgroundTasks).toBe("supported");
    expect(expressOutbound?.featureAssessment.externalNetwork).toBe("supported");
    expect(expressPostBody?.featureAssessment.middleware).toBe("supported");
  });

  it("marks unsupported live-state app rows as refused before snapshot", () => {
    const rows = refusedNodeLevel5AppSupportRows();

    expect(rows).toHaveLength(42);
    expect(rows.every((row) => row.status === "refused")).toBe(true);
    expect(rows.every((row) => row.productBehavior === "refuse-before-snapshot")).toBe(true);
    expect(
      rows.every((row) =>
        ["refusal-corpus", "generic-vm-detected-corpus"].includes(row.evidence.kind),
      ),
    ).toBe(true);
    expect(
      rows.find((row) => row.id === "express-websockets")?.featureAssessment.externalNetwork,
    ).toBe("refused");
    expect(
      rows.find((row) => row.id === "fastify-cluster-mode")?.featureAssessment.backgroundTasks,
    ).toBe("refused");
  });

  it("keeps unproven feature dimensions visible without turning them into claims", () => {
    const rows = notProvenNodeLevel5AppSupportRows();

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "not-proven")).toBe(true);
    expect(rows.every((row) => row.productBehavior === "not-proven")).toBe(true);
    expect(rows.every((row) => row.evidence.kind === "matrix-gap")).toBe(true);
    expect(rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        "express-external-network-not-proven",
        "fastify-background-tasks-not-proven",
      ]),
    );
  });

  it("keeps broad arbitrary support out of the app matrix claim", () => {
    const matrix = buildNodeLevel5AppSupportMatrix();

    expect(matrix.boundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "arbitrary-express-app", status: "not-claimed" }),
        expect.objectContaining({ id: "arbitrary-fastify-app", status: "not-claimed" }),
        expect.objectContaining({ id: "arbitrary-node-process", status: "not-claimed" }),
        expect.objectContaining({ id: "raw-cross-arch-cpu-restore", status: "out-of-scope" }),
      ]),
    );
  });
});
