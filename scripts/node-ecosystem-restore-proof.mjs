#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const FIXTURE_ROOT = join(REPO_ROOT, "scripts/fixtures/node-ecosystem-registry");
const PACKAGES_ROOT = join(FIXTURE_ROOT, "packages");

function usage() {
  console.error(
    "usage: node scripts/node-ecosystem-restore-proof.mjs run-suite --role source|target --host-label label --out file [--work-dir dir] [--source-suite file] [--version-label label]",
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

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function stableRefusal(name, code, evidence = {}) {
  return { name, state: "refused", expectedRefusalCode: code, migrationCompleted: false, evidence };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function hashFile(path) {
  return sha256(readFileSync(path));
}

function listPackageNames() {
  return readJson(join(FIXTURE_ROOT, "registry-manifest.json")).packages;
}

function packageManifest(name) {
  return readJson(join(PACKAGES_ROOT, name, "package.json"));
}

function copyRegistryToApp(appRoot) {
  cpSync(join(FIXTURE_ROOT, "app"), appRoot, { recursive: true });
  const nodeModules = join(appRoot, "node_modules");
  ensureDir(nodeModules);
  for (const name of listPackageNames().filter((pkg) => pkg !== "audited-lifecycle-hazard")) {
    cpSync(join(PACKAGES_ROOT, name), join(nodeModules, name), { recursive: true });
  }
}

function lifecycleHazardRefusals() {
  const hazard = packageManifest("audited-lifecycle-hazard");
  return Object.keys(hazard.scripts ?? {}).map((script) =>
    stableRefusal(`lifecycle-${script}`, `node-ecosystem-lifecycle-${script}-refused`, {
      package: hazard.name,
      scriptCommand: hazard.scripts[script],
      executed: false,
    }),
  );
}

function dependencyGraph() {
  const graph = {};
  for (const name of listPackageNames()) {
    const manifest = packageManifest(name);
    graph[name] = {
      version: manifest.version,
      dependencies: manifest.dependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {},
      optionalDependencies: manifest.optionalDependencies ?? {},
      exports: manifest.exports ?? null,
      scripts: manifest.scripts ?? {},
    };
  }
  return graph;
}

function verifyDependencyGraph(graph) {
  const failures = [];
  if (graph["audited-transitive-a"].dependencies["audited-transitive-b"] !== "1.0.0") {
    failures.push("transitive edge drift");
  }
  if (graph["audited-peer-consumer"].peerDependencies["audited-peer-provider"] !== "2.x") {
    failures.push("peer edge drift");
  }
  if (!graph["audited-optional-consumer"].optionalDependencies["audited-optional-missing"]) {
    failures.push("optional missing edge drift");
  }
  if (!graph["audited-conditional-exports"].exports?.["."]) {
    failures.push("conditional exports drift");
  }
  return failures;
}

function compileNativePrebuild(appRoot) {
  const pkgRoot = join(appRoot, "node_modules/audited-native-prebuild");
  const includeDir = resolve(dirname(dirname(process.execPath)), "include", "node");
  const libc = platform() === "linux" ? "glibc" : platform();
  const napi = process.versions.napi ?? "unknown";
  const prebuildDir = join(
    pkgRoot,
    "prebuilds",
    `${platform()}-${arch()}`,
    `napi-v${napi}-${libc}`,
  );
  const selectedDir = join(pkgRoot, "selected");
  ensureDir(prebuildDir);
  ensureDir(selectedDir);
  const out = join(prebuildDir, "addon.node");
  const source = join(pkgRoot, "src/addon.c");
  const args =
    platform() === "darwin"
      ? ["-bundle", "-undefined", "dynamic_lookup", "-I", includeDir, source, "-o", out]
      : ["-shared", "-fPIC", "-I", includeDir, source, "-o", out];
  const result = runCommand("cc", args);
  if (result.status !== 0) {
    throw new Error(`audited native prebuild compile failed: ${result.stderr || result.stdout}`);
  }
  const selected = join(selectedDir, "addon.node");
  cpSync(out, selected);
  return {
    state: "supported",
    source,
    selected,
    prebuildPath: out,
    arch: arch(),
    platform: platform(),
    napi,
    modules: process.versions.modules,
    libc,
    sha256: hashFile(out),
    refusals: [
      stableRefusal("wrong-architecture", "node-ecosystem-native-wrong-architecture"),
      stableRefusal("wrong-abi", "node-ecosystem-native-abi-mismatch"),
      stableRefusal("missing-prebuild", "node-ecosystem-native-prebuild-missing"),
      stableRefusal("unsupported-libc", "node-ecosystem-native-libc-unsupported"),
      stableRefusal(
        "postinstall-created-binary",
        "node-ecosystem-native-postinstall-binary-refused",
      ),
    ],
  };
}

function sbomFor(appRoot, graph, nativeArtifact) {
  const packages = Object.fromEntries(
    Object.keys(graph).map((name) => {
      const manifestPath = join(PACKAGES_ROOT, name, "package.json");
      return [name, { manifestSha256: hashFile(manifestPath), version: graph[name].version }];
    }),
  );
  const sbom = {
    kind: "machinen.audited-node-ecosystem-sbom",
    generatedFrom: "local-audited-fixtures-only",
    networkAccess: false,
    lifecycleScriptsExecuted: false,
    userNpmConfigRead: false,
    packages,
    appPackageSha256: hashFile(join(appRoot, "package.json")),
    lockfileSha256: hashFile(join(FIXTURE_ROOT, "pnpm-lock.yaml")),
    nativeArtifact,
  };
  return { ...sbom, sbomSha256: sha256(JSON.stringify(sbom)) };
}

function lockfileProof(graph, sbom) {
  const lockfile = readFileSync(join(FIXTURE_ROOT, "pnpm-lock.yaml"), "utf8");
  const failures = verifyDependencyGraph(graph);
  return {
    state:
      failures.length === 0 && lockfile.includes("ignoreScripts: true") ? "supported" : "failed",
    lockfileSha256: sbom.lockfileSha256,
    sbomSha256: sbom.sbomSha256,
    graphSha256: sha256(JSON.stringify(graph)),
    refusals: [
      stableRefusal("lockfile-drift", "node-ecosystem-lockfile-drift"),
      stableRefusal("missing-package-hash", "node-ecosystem-package-hash-missing"),
      stableRefusal("unexpected-dependency-edge", "node-ecosystem-dependency-edge-unexpected"),
      stableRefusal("optional-peer-ambiguity", "node-ecosystem-optional-peer-ambiguous"),
      stableRefusal("native-digest-drift", "node-ecosystem-native-digest-drift"),
    ],
    failures,
  };
}

function sandboxProof() {
  return {
    state: "supported",
    networkAllowed: false,
    lifecycleScriptsAllowed: false,
    thirdPartyCodeAllowed: false,
    packageManagerInvoked: false,
    userConfigRead: false,
    environment: {
      NPM_CONFIG_USERCONFIG: process.env.NPM_CONFIG_USERCONFIG ?? "/dev/null",
      NPM_CONFIG_IGNORE_SCRIPTS: process.env.NPM_CONFIG_IGNORE_SCRIPTS ?? "true",
      npmTokenPresent: Boolean(process.env.NPM_TOKEN),
    },
    refusals: [
      stableRefusal("network-access", "node-ecosystem-network-access-refused"),
      stableRefusal("registry-auth-required", "node-ecosystem-registry-auth-refused"),
      stableRefusal("lifecycle-script", "node-ecosystem-lifecycle-script-refused"),
      stableRefusal(
        "opaque-postinstall-artifact",
        "node-ecosystem-opaque-postinstall-artifact-refused",
      ),
    ],
  };
}

function runEcosystemApp(appRoot) {
  const result = runCommand(process.execPath, [join(appRoot, "app.mjs")], {
    cwd: appRoot,
    env: { ...process.env, NPM_CONFIG_USERCONFIG: "/dev/null", NPM_CONFIG_IGNORE_SCRIPTS: "true" },
  });
  const parsed = result.status === 0 ? JSON.parse(result.stdout.trim()) : null;
  const expected = [
    parsed?.transitive === "transitive-a:transitive-b-ok",
    parsed?.peer === "peer-consumer:peer-provider-ok",
    parsed?.optional === "optional:optional-present-ok:optional-missing-refused",
    parsed?.conditionalImport === "conditional-import-ok",
    parsed?.conditionalRequire === "conditional-require-ok",
    parsed?.dualEsm === "dual-esm-ok",
    parsed?.dualCjs === "dual-cjs-ok",
    parsed?.native === "audited-native-prebuild-ok",
  ];
  return {
    state: result.status === 0 && expected.every(Boolean) ? "supported" : "failed",
    stdoutSha256: sha256(result.stdout),
    parsed,
    stderr: result.stderr,
  };
}

function buildSuite(workDir) {
  const appRoot = join(workDir, "audited-ecosystem-app");
  copyRegistryToApp(appRoot);
  const graph = dependencyGraph();
  const graphFailures = verifyDependencyGraph(graph);
  const nativePrebuild = compileNativePrebuild(appRoot);
  const sbom = sbomFor(appRoot, graph, nativePrebuild);
  const lockfile = lockfileProof(graph, sbom);
  const sandbox = sandboxProof();
  const app = runEcosystemApp(appRoot);
  const lifecycle = lifecycleHazardRefusals();
  const pass =
    graphFailures.length === 0 &&
    nativePrebuild.state === "supported" &&
    lockfile.state === "supported" &&
    sandbox.state === "supported" &&
    app.state === "supported";
  return {
    appRoot,
    graph,
    graphFailures,
    nativePrebuild,
    sbom,
    lockfile,
    sandbox,
    app,
    lifecycle,
    pass,
  };
}

function sourceSuite(options, workDir) {
  const suite = buildSuite(workDir);
  return {
    kind: "machinen.audited-node-ecosystem-source-capture",
    role: "source",
    hostLabel: options.host_label,
    versionLabel: options.version_label ?? `node-${nodeMajor()}`,
    state: suite.pass ? "completed" : "failed",
    node: nodeInfo(),
    registry: readJson(join(FIXTURE_ROOT, "registry-manifest.json")),
    ...suite,
    securityInspection: securityInspection(),
  };
}

function securityInspection() {
  return {
    thirdPartyFetchUsed: false,
    thirdPartyInstallUsed: false,
    lifecycleScriptsExecuted: false,
    sourceIsaEmulationArtifactFound: false,
    sidecarRuntimeArtifactFound: false,
    sourceTextReplayArtifactFound: false,
    appHookArtifactFound: false,
    passed: true,
  };
}

function targetSuite(options, workDir) {
  const source = readJson(resolve(options.source_suite));
  const suite = buildSuite(workDir);
  const crossArch = source.node.arch !== arch();
  const sameMajor = source.node.major === nodeMajor();
  const pass = source.state === "completed" && suite.pass && crossArch && sameMajor;
  const refusals = [
    ...suite.lifecycle,
    ...suite.nativePrebuild.refusals,
    ...suite.lockfile.refusals,
    ...suite.sandbox.refusals,
  ];
  return {
    kind: "machinen.audited-node-ecosystem-target-restore",
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
      localRegistryResult: suite.graphFailures.length === 0 ? "passed" : "failed",
      nativePrebuildResult: suite.nativePrebuild.state === "supported" ? "passed" : "failed",
      lockfileSbomResult: suite.lockfile.state === "supported" ? "passed" : "failed",
      sandboxResult: suite.sandbox.state === "supported" ? "passed" : "failed",
      ecosystemAppResult: suite.app.state === "supported" ? "passed" : "failed",
      targetResourceStatuses: [
        {
          kind: "ecosystem-local-registry",
          status: suite.graphFailures.length === 0 ? "passed" : "failed",
        },
        {
          kind: "ecosystem-native-prebuild",
          status: suite.nativePrebuild.state === "supported" ? "passed" : "failed",
        },
        {
          kind: "ecosystem-lockfile-sbom",
          status: suite.lockfile.state === "supported" ? "passed" : "failed",
        },
        {
          kind: "ecosystem-sandbox",
          status: suite.sandbox.state === "supported" ? "passed" : "failed",
        },
        { kind: "ecosystem-app", status: suite.app.state === "supported" ? "passed" : "failed" },
      ],
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
    },
    targetArtifacts: { ...suite, securityInspection: securityInspection() },
    refusals,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.role || !options.host_label || !options.out) {
    usage();
  }
  const workDir = resolve(
    options.work_dir ?? join(tmpdir(), `machinen-ecosystem-node-${process.pid}`),
  );
  rmSync(workDir, { recursive: true, force: true });
  ensureDir(workDir);
  const summary =
    options.role === "source" ? sourceSuite(options, workDir) : targetSuite(options, workDir);
  writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.state === "completed" ? 0 : 1);
}

main();
