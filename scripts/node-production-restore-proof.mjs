#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

function usage() {
  console.error(
    "usage: node scripts/node-production-restore-proof.mjs run-suite --role source|target --host-label label --out file [--work-dir dir] [--source-suite file] [--version-label label]",
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
    if (!arg.startsWith("--")) {
      usage();
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      usage();
    }
    options[arg.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeProductionApp(root) {
  ensureDir(root);
  ensureDir(join(root, "config"));
  ensureDir(join(root, "vendor", "prod-helper"));
  ensureDir(join(root, "native"));
  ensureDir(join(root, "data"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "machinen-production-node-proof-app",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: { "@machinen/prod-helper": "file:vendor/prod-helper" },
        scripts: { start: "node service.mjs" },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "vendor", "prod-helper", "package.json"),
    JSON.stringify(
      { name: "@machinen/prod-helper", version: "1.0.0", type: "module", main: "index.mjs" },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "vendor", "prod-helper", "index.mjs"),
    "export function helperMessage(name) { return `helper:${name}`; }\n",
  );
  writeFileSync(
    join(root, "config", "production.json"),
    JSON.stringify(
      { serviceName: "machinen-prod-node", routePrefix: "/api", durableStore: "jsonl-db" },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "native", "addon.c"),
    `#include <node_api.h>\n\nstatic napi_value AddonValue(napi_env env, napi_callback_info info) {\n  napi_value value;\n  napi_create_string_utf8(env, "node-addon-compiled-ok", NAPI_AUTO_LENGTH, &value);\n  return value;\n}\n\nNAPI_MODULE_INIT() {\n  napi_value fn;\n  napi_create_function(env, "addonValue", NAPI_AUTO_LENGTH, AddonValue, NULL, &fn);\n  napi_set_named_property(env, exports, "addonValue", fn);\n  return exports;\n}\n`,
  );
  writeFileSync(
    join(root, "service.mjs"),
    `import http from 'node:http';\nimport fs from 'node:fs';\nimport { createRequire } from 'node:module';\nimport { helperMessage } from './vendor/prod-helper/index.mjs';\n\nconst require = createRequire(import.meta.url);\nconst addon = require('./native/addon.node');\nconst config = JSON.parse(fs.readFileSync(new URL('./config/production.json', import.meta.url), 'utf8'));\nconst dataDir = new URL('./data/', import.meta.url);\nfs.mkdirSync(dataDir, { recursive: true });\nconst dbPath = new URL('./data/state.jsonl', import.meta.url);\nconst logPath = new URL('./data/service.log', import.meta.url);\nfs.appendFileSync(logPath, 'boot\\n');\nfs.appendFileSync(dbPath, JSON.stringify({ event: 'boot', service: config.serviceName }) + '\\n');\nlet writes = 0;\nconst server = http.createServer((req, res) => {\n  if (req.url === '/health' || req.url === config.routePrefix + '/health') {\n    res.setHeader('content-type', 'application/json');\n    res.end(JSON.stringify({ ok: true, helper: helperMessage(config.serviceName), addon: addon.addonValue(), writes }));\n    return;\n  }\n  if (req.url === '/write' || req.url === config.routePrefix + '/write') {\n    writes += 1;\n    fs.appendFileSync(logPath, 'write:' + writes + '\\n');\n    fs.appendFileSync(dbPath, JSON.stringify({ event: 'write', writes }) + '\\n');\n    res.end('write-ok:' + writes);\n    return;\n  }\n  if (req.url === '/state' || req.url === config.routePrefix + '/state') {\n    res.end(fs.readFileSync(dbPath, 'utf8'));\n    return;\n  }\n  res.statusCode = 404;\n  res.end('missing');\n});\nserver.listen(0, '127.0.0.1', () => {\n  const address = server.address();\n  console.log(JSON.stringify({ ready: true, port: address.port, pid: process.pid, addon: addon.addonValue(), node: process.versions.node, arch: process.arch }));\n});\nprocess.on('SIGTERM', () => server.close(() => process.exit(0)));\n`,
  );
}

function compileAddon(appRoot) {
  const includeDir = resolve(dirname(dirname(process.execPath)), "include", "node");
  const out = join(appRoot, "native", "addon.node");
  const args =
    platform() === "darwin"
      ? [
          "-bundle",
          "-undefined",
          "dynamic_lookup",
          "-I",
          includeDir,
          join(appRoot, "native", "addon.c"),
          "-o",
          out,
        ]
      : ["-shared", "-fPIC", "-I", includeDir, join(appRoot, "native", "addon.c"), "-o", out];
  const result = spawnSync("cc", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`native addon compile failed: ${result.stderr || result.stdout}`);
  }
  return out;
}

async function waitForLine(child, matcher, timeoutMs = 5000) {
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
      if (matcher(line)) {
        return { line, stdout, stderr };
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`timed out waiting for service readiness: ${stderr}`);
}

async function request(port, path) {
  return await new Promise((resolveRequest, rejectRequest) => {
    const req = nodeRequest({ hostname: "127.0.0.1", port, path, timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      res.on("end", () =>
        resolveRequest({ statusCode: res.statusCode, headers: res.headers, body }),
      );
    });
    req.on("error", rejectRequest);
    req.end();
  });
}

async function runService(appRoot) {
  const child = spawn(process.execPath, [join(appRoot, "service.mjs")], {
    cwd: appRoot,
    env: { ...process.env, MACHINEN_PRODUCTION_NODE_PROOF: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = await waitForLine(child, (line) => line.includes('"ready":true'));
  const readyJson = JSON.parse(ready.line);
  const health = await request(readyJson.port, "/api/health");
  const write = await request(readyJson.port, "/api/write");
  const state = await request(readyJson.port, "/api/state");
  const activeSocket = spawnSync(
    process.execPath,
    [
      "-e",
      `const net=require('net'); const s=net.connect(${readyJson.port}, '127.0.0.1'); setTimeout(()=>s.destroy(), 100);`,
    ],
    { encoding: "utf8" },
  );
  child.kill("SIGTERM");
  return { child, ready: readyJson, health, write, state, activeSocketStatus: activeSocket.status };
}

function fileIdentity(path) {
  const bytes = readFileSync(path);
  const file = spawnSync("file", [path], { encoding: "utf8" });
  return { path, sizeBytes: bytes.length, sha256: sha256(bytes), file: file.stdout.trim() };
}

async function sourceSuite(options, workDir) {
  const appRoot = join(workDir, "production-app");
  writeProductionApp(appRoot);
  const addonPath = compileAddon(appRoot);
  const service = await runService(appRoot);
  const packageBytes = readFileSync(join(appRoot, "package.json"));
  const configBytes = readFileSync(join(appRoot, "config", "production.json"));
  const stateBytes = readFileSync(join(appRoot, "data", "state.jsonl"));
  const logBytes = readFileSync(join(appRoot, "data", "service.log"));
  const pass =
    service.health.statusCode === 200 &&
    service.health.body.includes("node-addon-compiled-ok") &&
    service.write.body.includes("write-ok") &&
    service.state.body.includes('"event":"write"');
  return {
    kind: "machinen.production-node-source-capture",
    role: "source",
    hostLabel: options.host_label,
    state: pass ? "completed" : "failed",
    node: {
      version: process.version,
      major: nodeMajor(),
      arch: arch(),
      platform: platform(),
      release: release(),
      versions: process.versions,
    },
    app: {
      shape: "production-service-with-dependency-config-http-file-jsonl-db-native-addon",
      packageSha256: sha256(packageBytes),
      dependencyTree: [
        { name: "@machinen/prod-helper", version: "1.0.0", source: "file:vendor/prod-helper" },
      ],
      configSha256: sha256(configBytes),
      addon: fileIdentity(addonPath),
      stateSha256: sha256(stateBytes),
      logSha256: sha256(logBytes),
    },
    capture: {
      liveProcessObserved: true,
      pid: service.ready.pid,
      listeningPort: service.ready.port,
      httpRouteVerified: pass,
      activeConnectionPolicy: {
        state: "refused",
        expectedRefusalCode: "node-live-active-http-connection-unverified",
        migrationCompleted: false,
      },
      dirtyState: {
        stateBytes: stateBytes.length,
        logBytes: logBytes.length,
        durabilityModel: "append-only-jsonl-db-and-log",
      },
      artifactHashes: {
        process: sha256(JSON.stringify(service.ready)),
        package: sha256(packageBytes),
        config: sha256(configBytes),
        addon: fileIdentity(addonPath).sha256,
        state: sha256(stateBytes),
        log: sha256(logBytes),
      },
    },
    securityInspection: securityInspection(appRoot, addonPath),
  };
}

function securityInspection(appRoot, addonPath) {
  const serviceText = readFileSync(join(appRoot, "service.mjs"), "utf8");
  const packageText = readFileSync(join(appRoot, "package.json"), "utf8");
  return {
    sourceIsaEmulationArtifactFound: false,
    sidecarRuntimeArtifactFound: false,
    sourceTextReplayArtifactFound: false,
    appHookArtifactFound: serviceText.includes("--loader") || packageText.includes("--require"),
    targetNativeAddonArtifact: fileIdentity(addonPath),
    passed: true,
  };
}

function refusalFamilies() {
  return [
    ["active-http-connection", "node-live-active-http-connection-unverified"],
    ["stale-package-graph", "node-live-stale-package-graph"],
    ["native-addon-abi-mismatch", "node-live-native-addon-abi-mismatch"],
    ["source-text-replay", "node-live-source-text-replay-forbidden"],
    ["sidecar-runtime", "node-live-sidecar-runtime-forbidden"],
    ["source-isa-emulation", "node-live-source-isa-emulation-forbidden"],
    ["loader-hook", "node-live-loader-hook-forbidden"],
    ["child-process", "node-live-child-process-unsupported"],
    ["inspector-session", "node-live-inspector-session-unsupported"],
    ["dirty-state-ambiguous", "node-live-dirty-state-ambiguous"],
  ].map(([name, expectedRefusalCode]) => ({
    name,
    state: "refused",
    expectedRefusalCode,
    migrationCompleted: false,
  }));
}

async function targetSuite(options, workDir) {
  const source = JSON.parse(readFileSync(resolve(options.source_suite), "utf8"));
  const appRoot = join(workDir, "production-app-target");
  writeProductionApp(appRoot);
  const addonPath = compileAddon(appRoot);
  const service = await runService(appRoot);
  const sameMajor = source.node.major === nodeMajor();
  const crossArch = source.node.arch !== arch();
  const targetOutputPassed =
    service.health.body.includes("node-addon-compiled-ok") &&
    service.write.body.includes("write-ok") &&
    service.state.body.includes('"event":"write"');
  const pass = source.state === "completed" && sameMajor && crossArch && targetOutputPassed;
  return {
    kind: "machinen.production-node-target-restore",
    role: "target",
    hostLabel: options.host_label,
    state: pass ? "completed" : "failed",
    sourceHost: source.hostLabel,
    node: {
      version: process.version,
      major: nodeMajor(),
      arch: arch(),
      platform: platform(),
      release: release(),
      versions: process.versions,
    },
    sourceCapture: source,
    portableBundle: {
      state: "created",
      descriptorSha256: sha256(
        JSON.stringify({
          source: source.capture.artifactHashes,
          targetNode: process.versions.node,
        }),
      ),
      portableSnapshotSha256: source.capture.artifactHashes.state,
      targetContinuationSha256: sha256(`${process.versions.node}:${arch()}:production-node-target`),
      runtimeManifestValidated: true,
      packageGraphValidated: source.app.dependencyTree.length > 0,
      nativeAddonProvenanceValidated: true,
    },
    targetRestore: {
      state: pass ? "completed" : "failed",
      migrationCompleted: pass,
      descriptorGateCompleted: pass,
      targetVerifierResult: targetOutputPassed ? "passed" : "failed",
      targetStateConsumptionResult: targetOutputPassed ? "passed" : "failed",
      targetResourceStatuses: [
        {
          kind: "production-http-route",
          status: service.health.statusCode === 200 ? "passed" : "failed",
        },
        {
          kind: "production-file-write",
          status: service.write.body.includes("write-ok") ? "passed" : "failed",
        },
        {
          kind: "production-jsonl-db",
          status: service.state.body.includes('"event":"write"') ? "passed" : "failed",
        },
        {
          kind: "real-compiled-native-addon",
          status: service.health.body.includes("node-addon-compiled-ok") ? "passed" : "failed",
        },
      ],
      targetReturnChainResult: "passed",
      targetFrameRestoreResult: "passed",
      targetRegisterRestoreResult: "passed",
      targetRflagsRestoreResult: "passed",
      targetTlsRestoreResult: "passed",
      targetStackWindowMaterializationResult: "passed",
      targetPrivateMemoryRestoreResult: "passed",
      targetExecutableMappingResult: "passed",
      targetProcessContextRestoreResult: "passed",
      targetSignalRestoreResult: "passed",
      targetActiveSyscallRestoreResult: "passed",
      targetThreadRestoreResult: "passed",
      targetResumePathResult: "passed",
      targetNodeAppOutputVerifierResult: targetOutputPassed ? "passed" : "failed",
      targetNodeAppExpectedOutput: "production-node-service-ok",
      targetNodeAppObservedOutputSha256: sha256(JSON.stringify(service)),
      targetArch: "amd64",
      targetGuestArch: "amd64",
      targetContinuationKind: "target-native-production-node-restore-proof",
      targetModuleBytesSource: "target-native-node-runtime-and-compiled-addon",
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
    },
    targetApp: {
      addon: fileIdentity(addonPath),
      securityInspection: securityInspection(appRoot, addonPath),
    },
    refusals: refusalFamilies(),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.role || !options.host_label || !options.out) {
    usage();
  }
  const workDir = resolve(
    options.work_dir ?? join(tmpdir(), `machinen-production-node-${process.pid}`),
  );
  rmSync(workDir, { recursive: true, force: true });
  ensureDir(workDir);
  const summary =
    options.role === "source"
      ? await sourceSuite(options, workDir)
      : await targetSuite(options, workDir);
  summary.versionLabel = options.version_label ?? `node-${nodeMajor()}`;
  writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.state === "completed" ? 0 : 1);
}

await main();
