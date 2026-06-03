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
  it("contains the requested 20 numbered workload rows", () => {
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
    ]);
  });

  it("keeps arbitrary raw Node process restore out of the corpus claim", () => {
    const rows = rowDirs().map(readRow);
    expect(rows).toHaveLength(20);
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
    ]);
    for (const row of refused) {
      expect(row.refusalCode).toMatch(/^node-portability-.+-unsupported$/u);
    }
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
      rowCount: 20,
      architectures: ["arm64", "amd64"],
      executeVm: false,
      summary: {
        productSupportedRows: 9,
        declaredConfigRows: 5,
        refusedFirstRows: 6,
        refusedRows: 12,
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
});
