import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type NodePortabilityDisposition =
  | "product-supported"
  | "supported-with-declared-config"
  | "refused-first";

interface NodePortabilityRow {
  id: string;
  slug: string;
  runtime: "nodejs";
  disposition: NodePortabilityDisposition;
  dependencies: string[];
  refusalCode: string | null;
  claimGuard: Record<string, false>;
}

interface CompatibilityIndex {
  kind: "machinen.portability-compatibility-index";
  version: number;
  runtime: "nodejs";
  claimBoundary: {
    model: string;
    notClaimed: string[];
    proofMode: string;
    productMode: string;
    claimGuard: Record<string, false>;
  };
  summary: {
    rowCount: number;
    byStatus: Record<string, number>;
    byProductClaim: Record<string, number>;
    architectures: string[];
    verifiedBothArchitectures: number;
    refusedRows: number;
    conditionalRows: number;
    failedClassifiedRows: number;
  };
  rows: Array<{
    id: string;
    capability: string;
    category: string;
    attemptPolicy: "try-first" | "config-required" | "refuse-live-state";
    status: "verified" | "classified" | "conditional" | "failed-classified" | "refused";
    architectures: Record<
      string,
      { status: string; evidence: Array<{ kind: string; path: string }> }
    >;
    blockers: Array<{ id: string; severity: string; refusalCode: string | null }>;
    productClaim: {
      status: "claimed" | "candidate" | "conditional" | "refusal" | "none";
      scope: string;
    };
    evidence: Array<{ kind: string; path: string }>;
    claimGuard: Record<string, false>;
  }>;
}

const corpusRoot = resolve("portability/nodejs");

function rowDirs(): string[] {
  return readdirSync(corpusRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}-/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readRow(dir: string): NodePortabilityRow {
  return JSON.parse(
    readFileSync(resolve(corpusRoot, dir, "portability.json"), "utf8"),
  ) as NodePortabilityRow;
}

describe("Node.js portability corpus", () => {
  it("documents the caniuse-style compatibility structure", () => {
    const readme = readFileSync(resolve("portability/README.md"), "utf8");
    const schema = JSON.parse(
      readFileSync(resolve("portability/compatibility.schema.json"), "utf8"),
    ) as {
      title: string;
      properties: Record<string, unknown>;
    };
    expect(readme).toContain("caniuse.com");
    expect(readme).toContain("Proof mode: try broadly");
    expect(schema.title).toBe("Machinen portability compatibility index");
    expect(schema.properties).toHaveProperty("rows");
  });

  it("renders a caniuse-style dashboard backed by the Node compatibility index", () => {
    const index = JSON.parse(
      readFileSync(resolve(corpusRoot, "index.json"), "utf8"),
    ) as CompatibilityIndex;
    const html = readFileSync(resolve(corpusRoot, "index.html"), "utf8");
    const embedded =
      /<script id="embedded-nodejs-portability-index" type="application\/json">\n([\s\S]*?)\n\s*<\/script>/u.exec(
        html,
      );
    expect(embedded?.[1]).toBeDefined();
    expect(JSON.parse(embedded![1]!)).toEqual(index);
    expect(html).toContain("Node.js portability compatibility");
    expect(html).toContain("raw V8 heap restore");
    expect(html).toContain("active socket stream transfer");
    expect(html).toContain("nodejs-portability-deps-amd64-runtime-report.json");
    expect(html).toContain("nodejs-portability-memory-scalar-arm64-to-amd64-report.json");
    expect(html).toContain("nodejs-portability-memory-plain-object-report.json");
    expect(html).toContain("nodejs-portability-memory-array-report.json");
    expect(html).toContain("nodejs-portability-memory-closure-context-report.json");
    expect(html).toContain("nodejs-portability-memory-unsupported-boundaries-report.json");
  });

  it("contains the requested 36 numbered workload rows", () => {
    expect(rowDirs()).toEqual([
      "001-plain-http-create-server",
      "002-express",
      "003-fastify",
      "004-koa",
      "005-hono",
      "006-next-minimal-server",
      "007-remix-react-router-server",
      "008-nestjs",
      "009-graphql-apollo",
      "010-websocket-server",
      "011-sqlite-app",
      "012-postgres-app",
      "013-static-file-server",
      "014-file-upload-app",
      "015-cron-timer-app",
      "016-worker-thread-app",
      "017-native-addon-app",
      "018-child-process-app",
      "019-active-request-app",
      "020-outbound-connection-app",
      "021-memory-scalar-counter",
      "022-memory-plain-object",
      "023-memory-array",
      "024-memory-closure-context",
      "025-memory-unsupported-boundaries",
      "026-memory-string",
      "027-memory-nested-object-graph",
      "028-memory-shared-references",
      "029-memory-cycle",
      "030-memory-map-set",
      "031-memory-class-instance",
      "032-memory-http-handler-closure-state",
      "033-memory-buffer",
      "034-memory-typed-array",
      "035-memory-pending-promise-refusal",
      "036-memory-capture-classifier",
    ]);
  });

  it("keeps arbitrary raw Node process restore out of the corpus claim", () => {
    const rows = rowDirs().map(readRow);
    expect(rows).toHaveLength(36);
    for (const row of rows) {
      expect(row.runtime).toBe("nodejs");
      expect(row.claimGuard).toMatchObject({
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        rawCpuStateReplayUsed: false,
        sourceIsaEmulationUsed: false,
      });
    }
  });

  it("marks unsafe live-state cases as refused-first with stable refusal codes", () => {
    const refused = rowDirs()
      .map(readRow)
      .filter((row) => row.disposition === "refused-first");
    expect(refused.map((row) => row.id)).toEqual([
      "010-websocket-server",
      "016-worker-thread-app",
      "017-native-addon-app",
      "018-child-process-app",
      "019-active-request-app",
      "020-outbound-connection-app",
      "025-memory-unsupported-boundaries",
      "035-memory-pending-promise-refusal",
    ]);
    for (const row of refused) {
      expect(row.refusalCode).toMatch(/^node-portability-.+-unsupported$/u);
    }
  });

  it("publishes the Node compatibility index as capability rows, not app trophies", () => {
    const index = JSON.parse(
      readFileSync(resolve(corpusRoot, "index.json"), "utf8"),
    ) as CompatibilityIndex;
    expect(index).toMatchObject({
      kind: "machinen.portability-compatibility-index",
      version: 1,
      runtime: "nodejs",
      summary: {
        rowCount: 36,
        byStatus: { verified: 28, refused: 8 },
        byProductClaim: { candidate: 28, refusal: 8 },
        architectures: ["arm64", "amd64"],
        verifiedBothArchitectures: 28,
        refusedRows: 8,
        conditionalRows: 0,
        failedClassifiedRows: 0,
      },
    });
    expect(index.claimBoundary.model).toContain(
      "arbitrary Node.js application portability dimensions",
    );
    expect(index.claimBoundary.notClaimed).toEqual(
      expect.arrayContaining(["raw V8 heap restore", "raw CPU/process continuation"]),
    );
    for (const row of index.rows) {
      expect(row.capability.length).toBeGreaterThan(10);
      expect(row.architectures).toHaveProperty("arm64");
      expect(row.architectures).toHaveProperty("amd64");
      expect(row.productClaim.status).not.toBe("claimed");
      expect(row.claimGuard).toMatchObject({
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        rawCpuStateReplayUsed: false,
        sourceIsaEmulationUsed: false,
      });
    }
  });

  it("keeps Node live-state refusals wired into the product portable VM plan path", () => {
    const cli = readFileSync(resolve("packages/cli/src/cli.ts"), "utf8");
    const report = JSON.parse(
      readFileSync(
        resolve(
          "proofs/linux-vm-workload/portable-vm-product-node-refusals/retained/portable-vm-product-node-refusal-report.json",
        ),
        "utf8",
      ),
    ) as { accepted: boolean; rows: Array<{ marker: string; refusalCode: string }> };
    expect(report.accepted).toBe(true);
    expect(report.rows.map((row) => row.refusalCode)).toEqual([
      "node-portability-active-websocket-unsupported",
      "node-portability-worker-thread-unsupported",
      "node-portability-native-addon-unsupported",
      "node-portability-child-process-unsupported",
      "node-portability-active-request-unsupported",
      "node-portability-outbound-connection-unsupported",
    ]);
    for (const row of report.rows) {
      expect(cli).toContain(row.marker);
      expect(cli).toContain(row.refusalCode);
    }
    expect(cli).toContain("nodejs-portability-inventory.json");
    expect(cli).toContain("classify-against-node-portability-compatibility-index");
    expect(cli).toContain('arbitraryNodeProcessRestoreClaimed": false');
    expect(cli).toContain('rawV8HeapRestoreUsed": false');
  });

  it("retains a bidirectional classification report for arm64 and amd64", () => {
    const report = JSON.parse(
      readFileSync(resolve(corpusRoot, "retained/nodejs-portability-corpus-report.json"), "utf8"),
    ) as {
      accepted: boolean;
      rowCount: number;
      architectures: string[];
      executeVm: boolean;
      summary: Record<string, number>;
      claimGuard: Record<string, false>;
    };
    expect(report).toMatchObject({
      accepted: true,
      rowCount: 36,
      architectures: ["arm64", "amd64"],
      executeVm: false,
      summary: {
        productSupportedRows: 23,
        declaredConfigRows: 5,
        refusedFirstRows: 8,
        refusedRows: 16,
      },
      claimGuard: {
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        rawCpuStateReplayUsed: false,
        sourceIsaEmulationUsed: false,
      },
    });
  });

  it("retains runtime-controlled arm64 and amd64 VM execution for dependency-free rows", () => {
    for (const [file, arch] of [
      ["nodejs-portability-no-deps-runtime-report.json", "arm64"],
      ["nodejs-portability-no-deps-amd64-runtime-report.json", "amd64"],
    ] as const) {
      const report = JSON.parse(readFileSync(resolve(corpusRoot, "retained", file), "utf8")) as {
        accepted: boolean;
        rowCount: number;
        architectures: string[];
        executeVm: boolean;
        summary: Record<string, number>;
      };
      expect(report).toMatchObject({
        accepted: true,
        rowCount: 5,
        architectures: [arch],
        executeVm: true,
        summary: {
          productSupportedRows: 5,
          verifiedVmRows: 5,
          environmentUnavailableRows: 0,
        },
      });
    }
  });

  it("retains memory-state portability smoke reports", () => {
    for (const [file, rowId, expectedState] of [
      ["nodejs-portability-memory-plain-object-report.json", "022-memory-plain-object", "verified"],
      ["nodejs-portability-memory-array-report.json", "023-memory-array", "verified"],
      [
        "nodejs-portability-memory-closure-context-report.json",
        "024-memory-closure-context",
        "verified",
      ],
      [
        "nodejs-portability-memory-unsupported-boundaries-report.json",
        "025-memory-unsupported-boundaries",
        "refused",
      ],
      ["nodejs-portability-memory-string-report.json", "026-memory-string", "verified"],
      [
        "nodejs-portability-memory-nested-object-graph-report.json",
        "027-memory-nested-object-graph",
        "verified",
      ],
      [
        "nodejs-portability-memory-shared-references-report.json",
        "028-memory-shared-references",
        "verified",
      ],
      ["nodejs-portability-memory-cycle-report.json", "029-memory-cycle", "verified"],
      ["nodejs-portability-memory-map-set-report.json", "030-memory-map-set", "verified"],
      [
        "nodejs-portability-memory-class-instance-report.json",
        "031-memory-class-instance",
        "verified",
      ],
      [
        "nodejs-portability-memory-http-handler-closure-state-report.json",
        "032-memory-http-handler-closure-state",
        "verified",
      ],
      ["nodejs-portability-memory-buffer-report.json", "033-memory-buffer", "verified"],
      ["nodejs-portability-memory-typed-array-report.json", "034-memory-typed-array", "verified"],
      [
        "nodejs-portability-memory-pending-promise-refusal-report.json",
        "035-memory-pending-promise-refusal",
        "refused",
      ],
    ] as const) {
      const report = JSON.parse(readFileSync(resolve(corpusRoot, "retained", file), "utf8")) as {
        accepted: boolean;
        portabilityRow: string;
        architectures: string[];
        results: Array<{ id: string; state: string }>;
        claimGuard: Record<string, false>;
      };
      expect(report.accepted).toBe(true);
      expect(report.portabilityRow).toBe(rowId);
      expect(report.architectures).toEqual(["arm64", "amd64"]);
      expect(report.results).toEqual([
        expect.objectContaining({ id: rowId, architecture: "arm64", state: expectedState }),
        expect.objectContaining({ id: rowId, architecture: "amd64", state: expectedState }),
      ]);
      expect(report.claimGuard).toMatchObject({
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        rawCpuStateReplayUsed: false,
        sourceIsaEmulationUsed: false,
      });
    }
  });

  it("retains real guest /proc memory classifier smoke reports", () => {
    for (const [file, arch] of [
      ["nodejs-portability-memory-capture-classifier-report.json", "arm64"],
      ["nodejs-portability-memory-capture-classifier-amd64-report.json", "amd64"],
    ] as const) {
      const report = JSON.parse(readFileSync(resolve(corpusRoot, "retained", file), "utf8")) as {
        accepted: boolean;
        portabilityRow: string;
        architectures: string[];
        executeVm: boolean;
        memoryCapture: string;
        capture: { categories: Record<string, { found: boolean }>; captureMethod: string };
        claimGuard: Record<string, false>;
      };
      expect(report).toMatchObject({
        accepted: true,
        portabilityRow: "036-memory-capture-classifier",
        architectures: [arch],
        executeVm: true,
        memoryCapture: "real-guest-proc-maps-and-proc-mem",
      });
      expect(report.capture.captureMethod).toBe("guest-proc-maps-and-proc-mem-anchor-classifier");
      expect(Object.values(report.capture.categories).every((category) => category.found)).toBe(
        true,
      );
      expect(report.claimGuard).toMatchObject({
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        sourceIsaEmulationUsed: false,
      });
    }
  });

  it("retains runtime-controlled arm64 and amd64 VM execution for dependency-backed rows", () => {
    for (const [file, arch] of [
      ["nodejs-portability-deps-arm64-runtime-report.json", "arm64"],
      ["nodejs-portability-deps-amd64-runtime-report.json", "amd64"],
    ] as const) {
      const report = JSON.parse(readFileSync(resolve(corpusRoot, "retained", file), "utf8")) as {
        accepted: boolean;
        rowCount: number;
        architectures: string[];
        executeVm: boolean;
        installDeps: boolean;
        summary: Record<string, number>;
        results: Array<{ id: string; state: string }>;
      };
      expect(report).toMatchObject({
        accepted: true,
        rowCount: 9,
        architectures: [arch],
        executeVm: true,
        installDeps: true,
        summary: {
          productSupportedRows: 4,
          declaredConfigRows: 5,
          verifiedVmRows: 9,
          failedClassifiedRows: 0,
          environmentUnavailableRows: 0,
        },
      });
      expect(report.results.map((row) => row.id)).toEqual([
        "002-express",
        "003-fastify",
        "004-koa",
        "005-hono",
        "006-next-minimal-server",
        "007-remix-react-router-server",
        "008-nestjs",
        "009-graphql-apollo",
        "012-postgres-app",
      ]);
      expect(report.results.every((row) => row.state === "verified")).toBe(true);
    }
  });
});
