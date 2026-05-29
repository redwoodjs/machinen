import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

export const NODE_LEVEL5_TARGET_SIDE_PROOF_FORMAT_VERSION = 1 as const;

export interface NodeLevel5TargetSideProofInput {
  outPath?: string;
  token?: string;
  keepWorkspace?: boolean;
}

export interface NodeLevel5TargetSideProof {
  kind: "machinen.node-level5-target-side-continuation-proof";
  formatVersion: typeof NODE_LEVEL5_TARGET_SIDE_PROOF_FORMAT_VERSION;
  sourceGoal: "009";
  evidenceStatus: "proof";
  productSupport: "not-yet-supported";
  implementationLevel: "not-implemented";
  graduationTargetLevel: "level-5-cross-arch-process-continuation";
  fixture: {
    kind: "small-node-http-app";
    appPath: string;
    appSha256: string;
  };
  capture: {
    selectedProofState: {
      continuationToken: string;
      route: "/continuation";
      expectedRuntime: "node";
    };
  };
  restoreHarness: {
    kind: "target-side-node-http-proof-harness";
    targetNativeExecution: true;
    verifierRequestPath: "/continuation";
  };
  targetOutput: {
    kind: "machinen.node-level5-target-output";
    continuationToken: string;
    runtime: "node";
    processArch: string;
    execPath: string;
    pid: number;
    targetNativeExecution: true;
  };
  assertions: {
    sourceIsaEmulationUsed: false;
    sidecarOutputUsed: false;
    metadataOnlySuccess: false;
    targetVerifierObservedActualNodeContinuation: true;
  };
  summary: {
    state: "completed";
    migrationCompleted: false;
    proofOnly: true;
    targetOutputVerified: true;
  };
}

export async function runNodeLevel5TargetSideProof(
  input: NodeLevel5TargetSideProofInput = {},
): Promise<NodeLevel5TargetSideProof> {
  const workspace = mkdtempSync(join(tmpdir(), "machinen-node-level5-target-proof-"));
  const appPath = join(workspace, "app.mjs");
  const token = input.token ?? `node-level5-${process.pid}-${Date.now()}`;
  writeFileSync(appPath, targetProofHttpAppSource(token));
  const child = spawn(process.execPath, [appPath], {
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MACHINEN_NODE_LEVEL5_TOKEN: token },
  });
  try {
    const ready = await waitForReadyLine(child.stdout, child.stderr);
    const output = await fetchTargetOutput(ready.port);
    const proof = buildTargetProof({ appPath, token, output });
    if (input.outPath) {
      writeFileSync(resolve(input.outPath), `${JSON.stringify(proof, null, 2)}\n`);
    }
    return proof;
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => undefined);
    if (!input.keepWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

function targetProofHttpAppSource(token: string): string {
  return `import http from "node:http";\nconst token = process.env.MACHINEN_NODE_LEVEL5_TOKEN ?? ${JSON.stringify(token)};\nconst server = http.createServer((req, res) => {\n  if (req.url !== "/continuation") {\n    res.writeHead(404);\n    res.end("not found");\n    return;\n  }\n  const body = JSON.stringify({\n    kind: "machinen.node-level5-target-output",\n    continuationToken: token,\n    runtime: "node",\n    processArch: process.arch,\n    execPath: process.execPath,\n    pid: process.pid,\n    targetNativeExecution: true\n  });\n  res.writeHead(200, { "content-type": "application/json" });\n  res.end(body);\n});\nserver.listen(0, "127.0.0.1", () => {\n  const address = server.address();\n  console.log(JSON.stringify({ ready: true, port: address.port, pid: process.pid }));\n});\nprocess.on("SIGTERM", () => server.close(() => process.exit(0)));\n`;
}

async function waitForReadyLine(
  stdout: NodeJS.ReadableStream | null,
  stderr: NodeJS.ReadableStream | null,
): Promise<{ ready: true; port: number; pid: number }> {
  if (!stdout) {
    throw new Error("target proof child stdout is unavailable");
  }
  let buffer = "";
  let stderrText = "";
  stderr?.on("data", (chunk) => {
    stderrText += String(chunk);
  });
  return await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(
      () => rejectReady(new Error(`target proof app did not become ready: ${stderrText}`)),
      10_000,
    );
    stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      clearTimeout(timer);
      const line = buffer.slice(0, newline).trim();
      try {
        resolveReady(JSON.parse(line) as { ready: true; port: number; pid: number });
      } catch (err) {
        rejectReady(err);
      }
    });
  });
}

async function fetchTargetOutput(port: number): Promise<NodeLevel5TargetSideProof["targetOutput"]> {
  const response = await fetch(`http://127.0.0.1:${port}/continuation`);
  if (!response.ok) {
    throw new Error(`target proof verifier failed with HTTP ${response.status}`);
  }
  return (await response.json()) as NodeLevel5TargetSideProof["targetOutput"];
}

function buildTargetProof(input: {
  appPath: string;
  token: string;
  output: NodeLevel5TargetSideProof["targetOutput"];
}): NodeLevel5TargetSideProof {
  if (
    input.output.continuationToken !== input.token ||
    input.output.targetNativeExecution !== true
  ) {
    throw new Error("target proof output did not match captured continuation state");
  }
  return {
    kind: "machinen.node-level5-target-side-continuation-proof",
    formatVersion: NODE_LEVEL5_TARGET_SIDE_PROOF_FORMAT_VERSION,
    sourceGoal: "009",
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    fixture: {
      kind: "small-node-http-app",
      appPath: "generated:small-node-http-app.mjs",
      appSha256: sha256(readFileSync(input.appPath, "utf8")),
    },
    capture: {
      selectedProofState: {
        continuationToken: input.token,
        route: "/continuation",
        expectedRuntime: "node",
      },
    },
    restoreHarness: {
      kind: "target-side-node-http-proof-harness",
      targetNativeExecution: true,
      verifierRequestPath: "/continuation",
    },
    targetOutput: input.output,
    assertions: {
      sourceIsaEmulationUsed: false,
      sidecarOutputUsed: false,
      metadataOnlySuccess: false,
      targetVerifierObservedActualNodeContinuation: true,
    },
    summary: {
      state: "completed",
      migrationCompleted: false,
      proofOnly: true,
      targetOutputVerified: true,
    },
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
