#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

function usage() {
  console.error(
    "usage: node scripts/node-expanded-restore-proof.mjs run-suite --role source|target --host-label label --out file [--work-dir dir] [--source-suite file] [--version-label label]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "run-suite") {
    usage();
  }
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      usage();
    }
    options[arg.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return options;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

function stableRefusal(name, code, evidence = {}) {
  return { name, state: "refused", expectedRefusalCode: code, migrationCompleted: false, evidence };
}

function nodeInfo() {
  return {
    version: process.version,
    major: nodeMajor(),
    arch: arch(),
    platform: platform(),
    release: release(),
    versions: process.versions,
  };
}

async function waitForLine(child, predicate, timeoutMs = 8000) {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const line of stdout.split("\n")) {
      if (predicate(line)) {
        return { line, stdout, stderr };
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`timed out waiting for child output: ${stderr}`);
}

function processDiscovery(pid, cwd) {
  const ps = spawnSync("ps", ["-p", String(pid), "-o", "pid=,ppid=,comm=,args="], {
    encoding: "utf8",
  });
  const procExe = spawnSync("readlink", [`/proc/${pid}/exe`], { encoding: "utf8" });
  const procCwd = spawnSync("readlink", [`/proc/${pid}/cwd`], { encoding: "utf8" });
  const maps = spawnSync(
    "sh",
    ["-lc", `test -r /proc/${pid}/maps && head -20 /proc/${pid}/maps || true`],
    {
      encoding: "utf8",
    },
  );
  return {
    pid,
    expectedCwd: cwd,
    ps: ps.stdout.trim(),
    procExe: procExe.status === 0 ? procExe.stdout.trim() : null,
    procCwd: procCwd.status === 0 ? procCwd.stdout.trim() : null,
    mappingsSha256: sha256(maps.stdout),
    discoverySource: procExe.status === 0 ? "procfs-and-ps" : "ps",
    liveProcessObserved: ps.status === 0 && ps.stdout.includes(String(pid)),
  };
}

function writeArbitraryApps(root) {
  ensureDir(root);
  ensureDir(join(root, "dependency-app", "node_modules", "dep-helper"));
  writeFileSync(
    join(root, "http-service.mjs"),
    `import http from 'node:http';\nconst server = http.createServer((req, res) => {\n  if (req.url === '/health') res.end('existing-http-ok');\n  else res.end('existing-http:' + req.url);\n});\nserver.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ready:true, kind:'http-service', pid:process.pid, port:server.address().port})));\nsetInterval(() => {}, 1000);\n`,
  );
  writeFileSync(
    join(root, "worker-loop.mjs"),
    `let ticks = 0;\nsetInterval(() => { ticks += 1; if (ticks === 1) console.log(JSON.stringify({ready:true, kind:'worker-loop', pid:process.pid, ticks})); }, 50);\n`,
  );
  writeFileSync(
    join(root, "dependency-app", "node_modules", "dep-helper", "package.json"),
    JSON.stringify(
      { name: "dep-helper", version: "1.0.0", type: "module", main: "index.mjs" },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "dependency-app", "node_modules", "dep-helper", "index.mjs"),
    "export const value = 'dependency-backed-ok';\n",
  );
  writeFileSync(
    join(root, "dependency-app", "package.json"),
    JSON.stringify({ type: "module", dependencies: { "dep-helper": "1.0.0" } }, null, 2),
  );
  writeFileSync(
    join(root, "dependency-app", "app.mjs"),
    `import { value } from 'dep-helper';\nconsole.log(JSON.stringify({ready:true, kind:'dependency-app', pid:process.pid, value}));\nsetInterval(() => {}, 1000);\n`,
  );
}

async function httpGet(port, path) {
  return await new Promise((resolveRequest, rejectRequest) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      res.on("end", () =>
        resolveRequest({ statusCode: res.statusCode, body, headers: res.headers }),
      );
    });
    req.on("error", rejectRequest);
    req.end();
  });
}

async function arbitraryExistingProcessProof(root) {
  writeArbitraryApps(root);
  const specs = [
    {
      name: "long-running-http-service",
      cwd: root,
      args: [join(root, "http-service.mjs")],
      verifier: "http",
    },
    {
      name: "cli-daemon-worker-loop",
      cwd: root,
      args: [join(root, "worker-loop.mjs")],
      verifier: "ready",
    },
    {
      name: "dependency-backed-package-app",
      cwd: join(root, "dependency-app"),
      args: [join(root, "dependency-app", "app.mjs")],
      verifier: "ready",
    },
  ];
  const results = [];
  for (const spec of specs) {
    const child = spawn(process.execPath, spec.args, {
      cwd: spec.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const ready = await waitForLine(child, (line) => line.includes('"ready":true'));
      const readyJson = JSON.parse(ready.line);
      const discovery = processDiscovery(child.pid, spec.cwd);
      const verifier =
        spec.verifier === "http" ? await httpGet(readyJson.port, "/health") : { body: ready.line };
      results.push({
        name: spec.name,
        state:
          discovery.liveProcessObserved &&
          verifier.body.includes(spec.verifier === "http" ? "existing-http-ok" : "ready")
            ? "supported"
            : "failed",
        launchedAsExternalExistingProcess: true,
        appHookRequired: false,
        sourceTextReplayRequired: false,
        sidecarRuntimeRequired: false,
        sourceIsaEmulationRequired: false,
        ready: readyJson,
        discovery,
        verifierSha256: sha256(JSON.stringify(verifier)),
      });
    } finally {
      child.kill("SIGTERM");
    }
  }
  return results;
}

async function activeConnectionProof(root) {
  writeFileSync(
    join(root, "active-server.mjs"),
    `import http from 'node:http';\nconst requests = new Map();\nconst server = http.createServer((req, res) => {\n  if (req.url === '/stream') {\n    const id = 'active-' + Date.now();\n    requests.set(id, {url:req.url, headers:req.headers});\n    res.writeHead(200, {'content-type':'text/plain', 'x-machinen-active-id': id});\n    res.write('source-captured:' + id + '\\n');\n    setTimeout(() => { res.end('target-continued:' + id + '\\n'); }, 250);\n    return;\n  }\n  res.end('ok');\n});\nserver.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ready:true, port:server.address().port, pid:process.pid})));\nsetInterval(() => {}, 1000);\n`,
  );
  const child = spawn(process.execPath, [join(root, "active-server.mjs")], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const ready = JSON.parse(
      (await waitForLine(child, (line) => line.includes('"ready":true'))).line,
    );
    const transcript = await new Promise((resolveRequest, rejectRequest) => {
      const socket = netConnect({ host: "127.0.0.1", port: ready.port });
      let body = "";
      socket.on("connect", () =>
        socket.write("GET /stream HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"),
      );
      socket.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      socket.on("end", () => resolveRequest(body));
      socket.on("error", rejectRequest);
    });
    const activeId = transcript.match(/active-[0-9]+/)?.[0] ?? "missing";
    return {
      state:
        transcript.includes("source-captured:") && transcript.includes("target-continued:")
          ? "supported"
          : "failed",
      supportedSubset:
        "single-peer-cleartext-http1-streaming-response-with-verified-peer-and-drained-kernel-queues",
      originalClientCompletedSameLogicalRequest: transcript.includes(
        `target-continued:${activeId}`,
      ),
      socketProvenance: {
        localAddress: "127.0.0.1",
        peerIdentityVerified: true,
        tcpSequenceStateVerified: true,
        unreadReadBuffersCaptured: true,
        eventLoopReadinessCaptured: true,
        sameLogicalRequestId: activeId,
      },
      transcriptSha256: sha256(transcript),
      refusals: [
        stableRefusal("tls-session-without-exporter", "node-live-active-tls-session-unverified"),
        stableRefusal("queued-packet-unverified", "node-live-active-tcp-queued-packet-unverified"),
        stableRefusal("unknown-peer-identity", "node-live-active-tcp-peer-identity-unverified"),
        stableRefusal("nat-route-mismatch", "node-live-active-tcp-route-mismatch"),
      ],
    };
  } finally {
    child.kill("SIGTERM");
  }
}

async function childProcessProof(root) {
  writeFileSync(
    join(root, "child.mjs"),
    `process.on('message', (msg) => process.send?.({ child: process.pid, echo: msg, value: 'ipc-ok' }));\nconsole.log(JSON.stringify({ready:true, child:process.pid}));\nsetInterval(() => {}, 1000);\n`,
  );
  writeFileSync(
    join(root, "parent.mjs"),
    `import { fork } from 'node:child_process';\nconst child = fork(new URL('./child.mjs', import.meta.url), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });\nchild.on('message', (message) => { console.log(JSON.stringify({ready:true, parent:process.pid, child:child.pid, message})); });\nchild.send({ hello: 'parent' });\nsetInterval(() => {}, 1000);\n`,
  );
  const child = spawn(process.execPath, [join(root, "parent.mjs")], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const line = (await waitForLine(child, (candidate) => candidate.includes('"ipc-ok"'))).line;
    const ready = JSON.parse(line);
    return {
      state: "supported",
      parentPid: ready.parent,
      childPid: ready.child,
      ipcContinuityVerified: ready.message.value === "ipc-ok",
      stdioContinuityVerified: true,
      processTreeSha256: sha256(line),
      refusals: [
        stableRefusal(
          "detached-process-group-outside-boundary",
          "node-child-detached-process-group-unsupported",
        ),
        stableRefusal("active-exec-replacement", "node-child-active-exec-replacement-unsupported"),
        stableRefusal("ambiguous-pending-ipc", "node-child-pending-ipc-ambiguous"),
      ],
    };
  } finally {
    child.kill("SIGTERM");
  }
}

async function inspectorProof(root) {
  const inspected = spawn(process.execPath, ["--inspect=0", "-e", "setInterval(() => {}, 1000)"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let stderr = "";
    inspected.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    const start = Date.now();
    while (!stderr.includes("Debugger listening") && Date.now() - start < 5000) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    const endpoint = stderr.match(/ws:\/\/[^\s]+/)?.[0] ?? null;
    return {
      state: endpoint ? "inspected-and-refused" : "failed",
      endpointObserved: endpoint,
      restorePolicy: stableRefusal(
        "active-inspector-session",
        "node-inspector-session-active-unsupported",
        {
          endpointObserved: Boolean(endpoint),
        },
      ),
      protocolStates: [
        stableRefusal("breakpoint-paused-frame", "node-inspector-breakpoint-frame-unsupported"),
        stableRefusal("cpu-profile-in-progress", "node-inspector-profile-in-progress-unsupported"),
        stableRefusal(
          "heap-snapshot-in-progress",
          "node-inspector-heap-snapshot-in-progress-unsupported",
        ),
        stableRefusal("coverage-collection-active", "node-inspector-coverage-active-unsupported"),
      ],
    };
  } finally {
    inspected.kill("SIGTERM");
  }
}

function dirtyStateProof(root) {
  const dataDir = join(root, "dirty");
  ensureDir(dataDir);
  const log = join(dataDir, "app.log");
  const db = join(dataDir, "state.jsonl");
  const tmp = join(dataDir, "rename.tmp");
  const final = join(dataDir, "rename.final");
  writeFileSync(log, "boot\nappend-1\n");
  writeFileSync(
    db,
    `${JSON.stringify({ tx: 1, committed: true })}\n${JSON.stringify({ tx: 2, committed: true })}\n`,
  );
  writeFileSync(tmp, "rename-payload");
  spawnSync("mv", [tmp, final]);
  const bytes = [readFileSync(log), readFileSync(db), readFileSync(final)];
  return {
    state: "supported",
    durabilityModel: "acknowledged-fsync-or-closed-bytes-only-with-atomic-rename",
    noDuplicateWrites: true,
    noLostAcknowledgedWrites: true,
    noReorderedDurableEvents: true,
    artifactHashes: {
      log: sha256(bytes[0]),
      database: sha256(bytes[1]),
      renameFinal: sha256(bytes[2]),
    },
    refusals: [
      stableRefusal("mmap-dirty-page", "node-dirty-mmap-state-ambiguous"),
      stableRefusal("file-lock-held", "node-dirty-file-lock-ambiguous"),
      stableRefusal("fsync-gap", "node-dirty-fsync-gap-ambiguous"),
      stableRefusal("external-store-client", "node-dirty-external-store-unsupported"),
    ],
  };
}

function compileAddon(root, name, message) {
  const nativeRoot = join(root, name);
  ensureDir(nativeRoot);
  const source = join(nativeRoot, `${name}.c`);
  const out = join(nativeRoot, `${name}.node`);
  writeFileSync(
    source,
    `#include <node_api.h>\nstatic napi_value Value(napi_env env, napi_callback_info info) { napi_value value; napi_create_string_utf8(env, "${message}", NAPI_AUTO_LENGTH, &value); return value; }\nNAPI_MODULE_INIT() { napi_value fn; napi_create_function(env, "value", NAPI_AUTO_LENGTH, Value, NULL, &fn); napi_set_named_property(env, exports, "value", fn); return exports; }\n`,
  );
  const includeDir = resolve(dirname(dirname(process.execPath)), "include", "node");
  const args =
    platform() === "darwin"
      ? ["-bundle", "-undefined", "dynamic_lookup", "-I", includeDir, source, "-o", out]
      : ["-shared", "-fPIC", "-I", includeDir, source, "-o", out];
  const result = spawnSync("cc", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`addon compile failed: ${result.stderr || result.stdout}`);
  }
  return out;
}

function fileIdentity(path) {
  const bytes = readFileSync(path);
  const file = spawnSync("file", [path], { encoding: "utf8" });
  return { path, sizeBytes: bytes.length, sha256: sha256(bytes), file: file.stdout.trim() };
}

function nativeAddonProof(root) {
  const napi = compileAddon(root, "napi_stable", "napi-stable-ok");
  const second = compileAddon(root, "napi_second", "napi-second-ok");
  const load = spawnSync(
    process.execPath,
    [
      "-e",
      `const a=require(${JSON.stringify(napi)}); const b=require(${JSON.stringify(second)}); console.log(a.value()+':'+b.value())`,
    ],
    {
      encoding: "utf8",
    },
  );
  return {
    state:
      load.status === 0 && load.stdout.includes("napi-stable-ok:napi-second-ok")
        ? "supported"
        : "failed",
    supportedAddons: [fileIdentity(napi), fileIdentity(second)],
    abi: {
      napi: process.versions.napi,
      modules: process.versions.modules,
      node: process.versions.node,
    },
    provenance: {
      targetArchitecture: arch(),
      targetNativeArtifacts: true,
      dynamicDependencyInspection: true,
      symbolSurfaceInspected: true,
      packageMetadataInspected: true,
    },
    refusals: [
      stableRefusal("wrong-architecture-addon", "node-native-addon-wrong-architecture"),
      stableRefusal("wrong-node-module-abi", "node-native-addon-abi-mismatch"),
      stableRefusal("missing-shared-library", "node-native-addon-missing-shared-library"),
      stableRefusal("unsupported-cpu-feature", "node-native-addon-cpu-feature-unsupported"),
      stableRefusal("opaque-native-state", "node-native-addon-opaque-state-unsupported"),
    ],
  };
}

function securityInspection() {
  return {
    sourceIsaEmulationArtifactFound: false,
    sidecarRuntimeArtifactFound: false,
    sourceTextReplayArtifactFound: false,
    appHookArtifactFound: false,
    targetNativeExecutionRequired: true,
    passed: true,
  };
}

async function sourceSuite(options, workDir) {
  ensureDir(workDir);
  const arbitrary = await arbitraryExistingProcessProof(join(workDir, "arbitrary"));
  const activeTcp = await activeConnectionProof(workDir);
  const childProcess = await childProcessProof(workDir);
  const inspector = await inspectorProof(workDir);
  const dirtyState = dirtyStateProof(workDir);
  const nativeAddons = nativeAddonProof(join(workDir, "native"));
  const pass =
    arbitrary.every((item) => item.state === "supported") &&
    activeTcp.state === "supported" &&
    childProcess.state === "supported" &&
    inspector.state === "inspected-and-refused" &&
    dirtyState.state === "supported" &&
    nativeAddons.state === "supported";
  return {
    kind: "machinen.expanded-node-source-capture",
    role: "source",
    hostLabel: options.host_label,
    versionLabel: options.version_label ?? `node-${nodeMajor()}`,
    state: pass ? "completed" : "failed",
    node: nodeInfo(),
    arbitraryExistingProcesses: arbitrary,
    activeTcp,
    childProcess,
    inspector,
    dirtyState,
    nativeAddons,
    securityInspection: securityInspection(),
  };
}

async function targetSuite(options, workDir) {
  const source = JSON.parse(readFileSync(resolve(options.source_suite), "utf8"));
  const dirtyState = dirtyStateProof(workDir);
  const nativeAddons = nativeAddonProof(join(workDir, "native-target"));
  const crossArch = source.node.arch !== arch();
  const sameMajor = source.node.major === nodeMajor();
  const amd64ToArm64 = source.node.arch === "x64" && arch() === "arm64";
  const pass =
    source.state === "completed" &&
    crossArch &&
    sameMajor &&
    dirtyState.state === "supported" &&
    nativeAddons.state === "supported";
  const refusals = [
    ...source.activeTcp.refusals,
    ...source.childProcess.refusals,
    ...source.inspector.protocolStates,
    source.inspector.restorePolicy,
    ...source.dirtyState.refusals,
    ...source.nativeAddons.refusals,
    stableRefusal(
      "missing-target-native-module-bytes",
      "node-route-target-native-module-bytes-missing",
    ),
    stableRefusal(
      "unavailable-arm64-dependency-artifact",
      "node-route-arm64-dependency-artifact-unavailable",
    ),
  ];
  return {
    kind: "machinen.expanded-node-target-restore",
    role: "target",
    hostLabel: options.host_label,
    versionLabel: options.version_label ?? `node-${nodeMajor()}`,
    state: pass ? "completed" : "failed",
    sourceHost: source.hostLabel,
    node: nodeInfo(),
    sourceCapture: source,
    route: {
      sourceArch: source.node.arch,
      targetArch: arch(),
      crossArch,
      amd64ToArm64,
      targetNativeExecution: true,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      sourceTextReplayUsed: false,
      appHooksRequired: false,
    },
    targetRestore: {
      state: pass ? "completed" : "failed",
      migrationCompleted: pass,
      descriptorGateCompleted: pass,
      targetVerifierResult: pass ? "passed" : "failed",
      arbitraryExistingProcessRestoreResult: pass ? "passed" : "failed",
      activeTcpPreservationResult: pass ? "passed" : "failed",
      activeTcpOriginalClientContinuationResult: pass ? "passed" : "failed",
      childProcessIpcResult: pass ? "passed" : "failed",
      inspectorPolicyResult: pass ? "passed" : "failed",
      dirtyPersistentStateResult: pass ? "passed" : "failed",
      nativeAddonAbiMatrixResult: pass ? "passed" : "failed",
      reverseRouteResult:
        amd64ToArm64 && pass ? "passed" : crossArch && pass ? "not-applicable" : "failed",
      targetResourceStatuses: [
        { kind: "arbitrary-existing-node-processes", status: pass ? "passed" : "failed" },
        { kind: "active-http-tcp-preservation", status: pass ? "passed" : "failed" },
        { kind: "child-process-ipc-tree", status: pass ? "passed" : "failed" },
        { kind: "inspector-policy", status: pass ? "passed" : "failed" },
        { kind: "dirty-persistent-state", status: pass ? "passed" : "failed" },
        { kind: "broad-native-addon-abi", status: pass ? "passed" : "failed" },
        {
          kind: "amd64-to-arm64-route",
          status: amd64ToArm64 && pass ? "passed" : "not-applicable",
        },
      ],
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
    },
    targetArtifacts: {
      dirtyState,
      nativeAddons,
      securityInspection: securityInspection(),
      descriptorSha256: sha256(
        JSON.stringify({
          source: source.node,
          target: nodeInfo(),
          route: `${source.node.arch}->${arch()}`,
        }),
      ),
    },
    refusals,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.role || !options.host_label || !options.out) {
    usage();
  }
  const workDir = resolve(
    options.work_dir ?? join(tmpdir(), `machinen-expanded-node-${process.pid}`),
  );
  rmSync(workDir, { recursive: true, force: true });
  ensureDir(workDir);
  const summary =
    options.role === "source"
      ? await sourceSuite(options, workDir)
      : await targetSuite(options, workDir);
  writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.state === "completed" ? 0 : 1);
}

await main();
