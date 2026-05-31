import { describe, expect, it } from "vitest";

import {
  buildNodeLevel5AppSupportMatrix,
  refusedNodeLevel5AppSupportRows,
  supportedNodeLevel5AppSupportRows,
} from "../node-level5-app-support-matrix.ts";

describe("Node Level 5 app support matrix", () => {
  it("is based on particular fixture, template, installed, and refusal apps", () => {
    const matrix = buildNodeLevel5AppSupportMatrix();

    expect(matrix).toMatchObject({
      accepted: true,
      kind: "machinen.node-level5-app-support-matrix",
      nodeProductSupportClaimed: 80,
      broadNodeProductSupportClaimed: 20,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    });
    expect(matrix.rowCount).toBe(26);
    expect(matrix.rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        "express-fixture-product-run",
        "fastify-fixture-product-run",
        "express-official-hello-world",
        "fastify-plugin-route",
        "express-installed-hello-world",
        "fastify-installed-plugin-route",
        "express-websockets",
        "fastify-native-addons",
      ]),
    );
  });

  it("marks positive app rows supported only for the declared idle HTTP subset", () => {
    const rows = supportedNodeLevel5AppSupportRows();

    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.status === "supported")).toBe(true);
    expect(rows.every((row) => row.supportScope === "declared-subset-idle-http")).toBe(true);
    expect(rows.every((row) => row.directions.includes("arm64-to-amd64"))).toBe(true);
    expect(rows.every((row) => row.directions.includes("amd64-to-arm64"))).toBe(true);
    expect(new Set(rows.map((row) => row.evidence.kind))).toEqual(
      new Set(["fixture-product-run-corpus", "template-corpus", "installed-package-corpus"]),
    );
  });

  it("marks unsupported live-state app rows as refused before snapshot", () => {
    const rows = refusedNodeLevel5AppSupportRows();

    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.status === "refused")).toBe(true);
    expect(rows.every((row) => row.productBehavior === "refuse-before-snapshot")).toBe(true);
    expect(rows.every((row) => row.evidence.kind === "refusal-corpus")).toBe(true);
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
