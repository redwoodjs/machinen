#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "portability/nodejs";
const claimGuard = {
  arbitraryNodeProcessRestoreClaimed: false,
  rawV8HeapRestoreUsed: false,
  rawCpuStateReplayUsed: false,
  sourceIsaEmulationUsed: false,
};
const evidenceInputs = [
  ["classification-report", "portability/nodejs/retained/nodejs-portability-corpus-report.json"],
  ["runtime-report", "portability/nodejs/retained/nodejs-portability-no-deps-runtime-report.json"],
  [
    "runtime-report",
    "portability/nodejs/retained/nodejs-portability-no-deps-amd64-runtime-report.json",
  ],
  [
    "runtime-report",
    "portability/nodejs/retained/nodejs-portability-deps-arm64-runtime-report.json",
  ],
  [
    "runtime-report",
    "portability/nodejs/retained/nodejs-portability-deps-amd64-runtime-report.json",
  ],
  ["runtime-report", "portability/nodejs/retained/nodejs-portability-row001-runtime-report.json"],
];
const categoryBySlug = {
  "plain-http-create-server": "http",
  express: "framework",
  fastify: "framework",
  koa: "framework",
  hono: "framework",
  "next-minimal-server": "framework-server",
  "remix-react-router-server": "framework-server",
  nestjs: "framework-server",
  "graphql-apollo": "api",
  "websocket-server": "realtime",
  "sqlite-app": "state",
  "postgres-app": "state",
  "static-file-server": "filesystem",
  "file-upload-app": "filesystem",
  "cron-timer-app": "scheduler",
  "worker-thread-app": "concurrency-blocker",
  "native-addon-app": "native-blocker",
  "child-process-app": "process-blocker",
  "active-request-app": "live-state-blocker",
  "outbound-connection-app": "network-blocker",
};
const capabilityBySlug = {
  "plain-http-create-server":
    "Plain node:http listener can restart target-native and verify response",
  express: "Express basic HTTP route shape",
  fastify: "Fastify basic HTTP route shape",
  koa: "Koa basic HTTP middleware shape",
  hono: "Hono basic HTTP route shape",
  "next-minimal-server": "Next minimal server bootstrap shape",
  "remix-react-router-server": "Remix / React Router server bootstrap shape",
  nestjs: "NestJS server bootstrap shape",
  "graphql-apollo": "GraphQL / Apollo HTTP API shape",
  "websocket-server": "WebSocket server startup and active session boundary",
  "sqlite-app": "Clean local SQLite-style state plus HTTP verifier",
  "postgres-app": "Declared clean PostgreSQL external state boundary",
  "static-file-server": "Static file tree served by Node",
  "file-upload-app": "Upload/data directory state served by Node",
  "cron-timer-app": "Declared timer/schedule reconstruction",
  "worker-thread-app": "Worker thread live-state blocker",
  "native-addon-app": "Native addon rebuild / ABI blocker",
  "child-process-app": "Child process tree blocker",
  "active-request-app": "In-flight HTTP request blocker",
  "outbound-connection-app": "Outbound connection/reconnect policy blocker",
};

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function evidence(kind, path, summary) {
  return { kind, path, sha256: hashFile(path), summary };
}

function readReports() {
  return evidenceInputs
    .filter(([, path]) => existsSync(path))
    .map(([kind, path]) => ({ kind, path, report: JSON.parse(readFileSync(path, "utf8")) }));
}

function rowDirs() {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}-/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function attemptPolicy(row) {
  if (row.disposition === "refused-first") {
    return "refuse-live-state";
  }
  if (row.disposition === "supported-with-declared-config") {
    return "config-required";
  }
  return "try-first";
}

function archCell(row, arch, reports) {
  const ev = [
    evidence(
      "classification-report",
      "portability/nodejs/retained/nodejs-portability-corpus-report.json",
      `${arch} classification row retained`,
    ),
  ];
  const runtime = reports.find(
    ({ report }) =>
      Array.isArray(report.architectures) &&
      report.architectures.includes(arch) &&
      report.results?.some((result) => result.id === row.id && result.state === "verified"),
  );
  if (runtime) {
    ev.push(evidence(runtime.kind, runtime.path, `${arch} Machinen runtime verifier passed`));
    return {
      status: "verified",
      lastRun: null,
      evidence: ev,
      notes: "Machinen runtime-controlled VM execution verified this capability.",
    };
  }
  const failed = reports.find(
    ({ report }) =>
      Array.isArray(report.architectures) &&
      report.architectures.includes(arch) &&
      report.results?.some(
        (result) => result.id === row.id && result.state === "failed-classified",
      ),
  );
  if (failed) {
    ev.push(evidence(failed.kind, failed.path, `${arch} retained classified failure`));
    return {
      status: "failed-classified",
      lastRun: null,
      evidence: ev,
      notes: "Attempted and retained with classified failure evidence.",
    };
  }
  if (row.disposition === "refused-first") {
    return { status: "refused", lastRun: null, evidence: ev, notes: row.refusalCode };
  }
  if (row.disposition === "supported-with-declared-config") {
    return {
      status: "conditional",
      lastRun: null,
      evidence: ev,
      notes: "Needs declared config/dependencies before runtime execution.",
    };
  }
  return {
    status: "classified",
    lastRun: null,
    evidence: ev,
    notes: "Known capability; runtime execution pending.",
  };
}

function rowStatus(row, architectures) {
  const cells = Object.values(architectures).map((cell) => cell.status);
  if (cells.every((status) => status === "verified")) {
    return "verified";
  }
  if (cells.some((status) => status === "failed-classified")) {
    return "failed-classified";
  }
  if (row.disposition === "refused-first") {
    return "refused";
  }
  if (row.disposition === "supported-with-declared-config") {
    return "conditional";
  }
  return "classified";
}

function blockers(row, status) {
  if (row.disposition === "refused-first") {
    return [
      {
        id: row.slug,
        severity: "hard-blocker",
        description: row.description,
        refusalCode: row.refusalCode,
      },
    ];
  }
  if (status === "failed-classified") {
    return [
      {
        id: "classified-runtime-failure",
        severity: "major",
        description: "A retained runtime attempt failed and was classified.",
        refusalCode: "node-portability-runtime-attempt-failed",
      },
    ];
  }
  if (row.disposition === "supported-with-declared-config") {
    return [
      {
        id: "declared-config-required",
        severity: "minor",
        description:
          "Needs target-native dependency/config/artifact declaration before proof execution.",
        refusalCode: null,
      },
    ];
  }
  if (row.dependencies.length > 0 && status !== "verified") {
    return [
      {
        id: "dependency-install-required",
        severity: "minor",
        description:
          "Needs target-native npm dependency installation during proof/product restore.",
        refusalCode: null,
      },
    ];
  }
  return [];
}

function productClaim(row, status) {
  if (status === "verified") {
    return {
      status: "candidate",
      scope: "node-portability-corpus-proof",
      notes:
        "VM-verified capability evidence; does not claim arbitrary raw Node process continuation.",
    };
  }
  if (row.disposition === "refused-first") {
    return {
      status: "refusal",
      scope: "node-portability-blocker",
      notes:
        "Stable blocker row; app restart may be separately attempted but live/opaque state is not portable.",
    };
  }
  if (row.disposition === "supported-with-declared-config") {
    return {
      status: "conditional",
      scope: "node-portability-corpus-proof",
      notes: "Requires declared dependencies/config/artifacts before runtime execution.",
    };
  }
  return {
    status: "none",
    scope: "classification-only",
    notes: "Known row, not yet product-claimed.",
  };
}

function uniqueEvidence(items) {
  return items.filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.kind === item.kind && candidate.path === item.path) ===
      index,
  );
}

function buildIndex() {
  const reports = readReports();
  const rows = rowDirs().map((dir) => {
    const row = JSON.parse(readFileSync(join(root, dir, "portability.json"), "utf8"));
    const architectures = {
      arm64: archCell(row, "arm64", reports),
      amd64: archCell(row, "amd64", reports),
    };
    const status = rowStatus(row, architectures);
    return {
      id: row.id,
      slug: row.slug,
      capability: capabilityBySlug[row.slug] ?? row.description,
      category: categoryBySlug[row.slug] ?? "unknown",
      description: row.description,
      attemptPolicy: attemptPolicy(row),
      status,
      architectures,
      blockers: blockers(row, status),
      workaround:
        row.disposition === "supported-with-declared-config" && status !== "verified"
          ? "Declare dependencies/config/artifacts and rerun with --install-deps or matching product adapter."
          : row.disposition === "refused-first"
            ? "Remove or declare a reconstruction policy for this live/opaque state before claiming portability."
            : null,
      productClaim: productClaim(row, status),
      evidence: uniqueEvidence([
        evidence("row-manifest", `portability/nodejs/${row.id}/portability.json`, "row metadata"),
        ...architectures.arm64.evidence,
        ...architectures.amd64.evidence,
      ]),
      claimGuard,
    };
  });
  const byStatus = {};
  const byProductClaim = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    byProductClaim[row.productClaim.status] = (byProductClaim[row.productClaim.status] ?? 0) + 1;
  }
  return {
    kind: "machinen.portability-compatibility-index",
    version: 1,
    runtime: "nodejs",
    updatedAt: "2026-06-03",
    claimBoundary: {
      model:
        "caniuse-style compatibility table for arbitrary Node.js application portability dimensions",
      notClaimed: [
        "raw V8 heap restore",
        "raw CPU/process continuation",
        "same PID continuation",
        "active request transfer",
        "active socket stream transfer",
        "source ISA emulation",
      ],
      proofMode: "try broadly, retain successes and failures, classify blockers",
      productMode:
        "claim only verified rows with retained product/runtime evidence and fail-closed blockers",
      claimGuard,
    },
    summary: {
      rowCount: rows.length,
      byStatus,
      byProductClaim,
      architectures: ["arm64", "amd64"],
      verifiedBothArchitectures: rows.filter((row) => row.status === "verified").length,
      refusedRows: rows.filter((row) => row.status === "refused").length,
      conditionalRows: rows.filter((row) => row.status === "conditional").length,
      failedClassifiedRows: rows.filter((row) => row.status === "failed-classified").length,
    },
    evidenceReports: reports.map(({ kind, path }) => evidence(kind, path, path.split("/").pop())),
    rows,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildDashboard(index) {
  const rows = index.rows
    .map(
      (row) => `<tr class="status-${row.status}">
<td><a href="${row.id}/">${row.id}</a></td>
<td>${escapeHtml(row.capability)}<div class="muted">${escapeHtml(row.category)} · ${escapeHtml(row.attemptPolicy)}</div></td>
<td><span class="pill ${row.status}">${row.status}</span></td>
<td>${archCellHtml(row, "arm64")}</td>
<td>${archCellHtml(row, "amd64")}</td>
<td>${escapeHtml(row.productClaim.status)}<div class="muted">${escapeHtml(row.productClaim.scope)}</div></td>
<td>${row.blockers.length === 0 ? "—" : row.blockers.map((blocker) => escapeHtml(blocker.refusalCode ?? blocker.id)).join("<br>")}</td>
<td>${row.evidence.map((item) => `<a href="../../${item.path}">${escapeHtml(item.kind)}</a>`).join("<br>")}</td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Machinen Node.js portability compatibility</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #16202a; }
    table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
    th, td { border: 1px solid #d7dee8; padding: 0.55rem; vertical-align: top; }
    th { background: #f4f7fb; text-align: left; }
    .cards { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
    .card { border: 1px solid #d7dee8; border-radius: 0.6rem; padding: 0.8rem 1rem; background: #fbfcfe; }
    .muted { color: #5f6f83; font-size: 0.82rem; margin-top: 0.25rem; }
    .pill { border-radius: 999px; padding: 0.18rem 0.5rem; font-weight: 700; display: inline-block; }
    .verified { background: #dff7e8; color: #0c6830; }
    .classified, .conditional { background: #fff2c6; color: #785a00; }
    .failed-classified, .refused { background: #ffe0e0; color: #8a1f1f; }
    code { background: #f4f7fb; padding: 0.12rem 0.25rem; border-radius: 0.25rem; }
  </style>
</head>
<body>
  <h1>Node.js portability compatibility</h1>
  <p>This is a caniuse-style capability matrix. It is not a claim that arbitrary raw Node processes, V8 heaps, active requests, or sockets resume exactly.</p>
  <div class="cards">
    <div class="card"><strong>${index.summary.rowCount}</strong><div class="muted">rows</div></div>
    <div class="card"><strong>${index.summary.verifiedBothArchitectures}</strong><div class="muted">verified on arm64 + amd64</div></div>
    <div class="card"><strong>${index.summary.refusedRows}</strong><div class="muted">stable refusal rows</div></div>
    <div class="card"><strong>${index.summary.failedClassifiedRows}</strong><div class="muted">failed-classified rows</div></div>
  </div>
  <h2>Claim guard</h2>
  <ul>
    ${index.claimBoundary.notClaimed.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n    ")}
  </ul>
  <table>
    <thead><tr><th>Row</th><th>Capability</th><th>Status</th><th>arm64</th><th>amd64</th><th>Product claim</th><th>Blockers</th><th>Evidence</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <script id="embedded-nodejs-portability-index" type="application/json">
${JSON.stringify(index, null, 2)}
  </script>
</body>
</html>
`;
}

function archCellHtml(row, arch) {
  const cell = row.architectures[arch];
  return `<span class="pill ${cell.status}">${cell.status}</span><div class="muted">${escapeHtml(cell.notes ?? "")}</div>`;
}

const index = buildIndex();
writeFileSync(join(root, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
writeFileSync(join(root, "index.html"), buildDashboard(index));
console.log(JSON.stringify(index.summary, null, 2));
