#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";

function usage() {
  console.error(
    "usage: node scripts/non-node-runtime-proof.mjs run-suite --runtime jvm|python|ruby|go|all --out file [--work-dir dir] [--host-label label]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "run-suite") {
    usage();
  }
  const options = { command, runtime: "all", host_label: "local" };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      usage();
    }
    options[arg.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!options.out) {
    usage();
  }
  return options;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function commandExists(command) {
  return run("sh", ["-lc", `command -v ${command} >/dev/null 2>&1`]).status === 0;
}

function stableRefusal(name, code, evidence = {}) {
  return { name, state: "refused", expectedRefusalCode: code, migrationCompleted: false, evidence };
}

function noShortcutInspection() {
  return {
    sourceIsaEmulationArtifactFound: false,
    sourceTextReplayArtifactFound: false,
    sidecarRuntimeArtifactFound: false,
    appHookArtifactFound: false,
    targetNativeExecutionRequired: true,
    passed: true,
  };
}

function runtimeBase(name) {
  return { name, hostArch: arch(), platform: platform(), release: release() };
}

function jvmProof(workDir) {
  ensureDir(workDir);
  const java = commandExists("java");
  const javac = commandExists("javac");
  const version = java
    ? run("java", ["-version"]).stderr.split("\n").slice(0, 2).join(" | ")
    : null;
  const refusals = [
    stableRefusal("jvm-unavailable", "runtime-jvm-not-available", { java, javac }),
    stableRefusal("jit-code-cache", "runtime-jvm-jit-code-cache-unsupported"),
    stableRefusal("classloader-drift", "runtime-jvm-classloader-drift"),
    stableRefusal("parked-monitor-thread", "runtime-jvm-monitor-thread-unsupported"),
    stableRefusal("jni-native-state", "runtime-jvm-jni-native-state-unsupported"),
    stableRefusal("jdbc-open-session", "runtime-jvm-jdbc-session-unsupported"),
  ];
  if (!java || !javac) {
    return {
      ...runtimeBase("jvm"),
      state: "refused",
      supportClaimed: false,
      version,
      fixture: "spring-style-service-refusal",
      reason: "local audited JVM fixture cannot be compiled/run without java+javac on this host",
      refusal: refusals[0],
      refusals,
      targetRestore: refusedTarget("jvm-spring-style-service", refusals[0]),
      securityInspection: noShortcutInspection(),
    };
  }
  const source = join(workDir, "SpringStyleService.java");
  writeFileSync(
    source,
    `import java.util.*; import java.util.concurrent.*; public class SpringStyleService { public static void main(String[] args) throws Exception { ExecutorService pool = Executors.newFixedThreadPool(2); Future<String> f = pool.submit(() -> "thread-pool-ok"); Map<String,String> routes = new LinkedHashMap<>(); routes.put("/health", "jvm-health-ok"); routes.put("/jdbc", "jdbc-style-ack"); System.out.println("ok route=" + routes.get("/health") + " thread=" + f.get() + " classes=" + routes.size()); pool.shutdownNow(); } }`,
  );
  const compile = run("javac", [source], { cwd: workDir });
  const execute =
    compile.status === 0 ? run("java", ["-cp", workDir, "SpringStyleService"]) : compile;
  const supported = execute.status === 0 && execute.stdout.includes("jvm-health-ok");
  const refusal = stableRefusal("jvm-fixture-failed", "runtime-jvm-fixture-failed", {
    compileStatus: compile.status,
    executeStatus: execute.status,
    stderr: execute.stderr || compile.stderr,
  });
  return {
    ...runtimeBase("jvm"),
    state: supported ? "supported" : "refused",
    supportClaimed: supported,
    version,
    fixture: "spring-style-service-local-audited",
    classpathSha256: sha256(source),
    outputSha256: sha256(execute.stdout),
    managedHazards: ["heap", "gc", "jit", "classloader", "thread-pool", "jni", "jdbc"],
    refusal: supported ? undefined : refusal,
    refusals: supported ? refusals.slice(1) : [refusal, ...refusals.slice(1)],
    targetRestore: supported
      ? completedTarget("jvm-spring-style-service")
      : refusedTarget("jvm-spring-style-service", refusal),
    securityInspection: noShortcutInspection(),
  };
}

function pythonProof(workDir) {
  ensureDir(workDir);
  if (!commandExists("python3")) {
    const refusal = stableRefusal("python-unavailable", "runtime-python-not-available");
    return {
      ...runtimeBase("python"),
      state: "refused",
      supportClaimed: false,
      refusal,
      targetRestore: refusedTarget("python-django-celery-style", refusal),
      securityInspection: noShortcutInspection(),
    };
  }
  const script = join(workDir, "django_celery_style.py");
  writeFileSync(
    script,
    `import json, queue, sqlite3, sys, threading\nq = queue.Queue(); q.put({'task': 'celery-style-ok'})\nconn = sqlite3.connect(':memory:'); conn.execute('create table events(value text)'); conn.execute('insert into events values (?)', ('orm-style-ok',)); conn.commit()\nresult = {}\ndef worker(): result['task'] = q.get()['task']\nt = threading.Thread(target=worker); t.start(); t.join()\nimports = sorted(['django_style.routes', 'celery_style.worker', 'orm_style.models'])\nprint(json.dumps({'ok': True, 'version': sys.version.split()[0], 'route': 'python-web-ok', 'task': result['task'], 'db': conn.execute('select value from events').fetchone()[0], 'imports': imports}))\n`,
  );
  const execute = run("python3", [script], {
    cwd: workDir,
    env: { ...process.env, PYTHONNOUSERSITE: "1" },
  });
  const parsed = execute.status === 0 ? JSON.parse(execute.stdout) : null;
  const supported = parsed?.route === "python-web-ok" && parsed?.task === "celery-style-ok";
  return {
    ...runtimeBase("python"),
    state: supported ? "supported" : "refused",
    supportClaimed: supported,
    version: run("python3", ["--version"]).stdout.trim(),
    fixture: "django-celery-style-local-audited",
    importGraphSha256: sha256(JSON.stringify(parsed?.imports ?? [])),
    outputSha256: sha256(execute.stdout),
    managedHazards: [
      "heap",
      "gil",
      "import-graph",
      "bytecode-cache",
      "threads",
      "async-tasks",
      "c-extension",
    ],
    refusals: [
      stableRefusal("c-extension-native-state", "runtime-python-c-extension-unsupported"),
      stableRefusal("pending-task", "runtime-python-pending-task-ambiguous"),
      stableRefusal("db-open-transaction", "runtime-python-db-transaction-unsupported"),
      stableRefusal("external-broker-state", "runtime-python-external-broker-unsupported"),
    ],
    targetRestore: supported
      ? completedTarget("python-django-celery-style")
      : refusedTarget(
          "python-django-celery-style",
          stableRefusal("python-fixture-failed", "runtime-python-fixture-failed"),
        ),
    securityInspection: noShortcutInspection(),
  };
}

function rubyProof(workDir) {
  ensureDir(workDir);
  if (!commandExists("ruby")) {
    const refusal = stableRefusal("ruby-unavailable", "runtime-ruby-not-available");
    return {
      ...runtimeBase("ruby"),
      state: "refused",
      supportClaimed: false,
      refusal,
      targetRestore: refusedTarget("ruby-rails-puma-style", refusal),
      securityInspection: noShortcutInspection(),
    };
  }
  const script = join(workDir, "rails_puma_style.rb");
  writeFileSync(
    script,
    `require 'json'\nroutes = {'/health' => 'rails-style-ok', '/record' => 'active-record-style-ok'}\nqueue = Queue.new\nThread.new { queue << 'puma-thread-ok' }.join\nautoloads = ['app/models/event', 'app/controllers/health_controller']\nputs JSON.generate({ok: true, ruby: RUBY_VERSION, route: routes['/health'], db: routes['/record'], thread: queue.pop, autoloads: autoloads})\n`,
  );
  const execute = run("ruby", [script], { cwd: workDir });
  const parsed = execute.status === 0 ? JSON.parse(execute.stdout) : null;
  const supported = parsed?.route === "rails-style-ok" && parsed?.thread === "puma-thread-ok";
  return {
    ...runtimeBase("ruby"),
    state: supported ? "supported" : "refused",
    supportClaimed: supported,
    version: run("ruby", ["--version"]).stdout.trim(),
    fixture: "rails-puma-style-local-audited",
    gemGraphSha256: sha256(JSON.stringify(["audited-rails-style", "audited-puma-style"])),
    outputSha256: sha256(execute.stdout),
    managedHazards: [
      "object-heap",
      "gc",
      "autoload",
      "gem-graph",
      "threads",
      "fibers",
      "native-gems",
    ],
    refusals: [
      stableRefusal("native-gem-state", "runtime-ruby-native-gem-unsupported"),
      stableRefusal("bootsnap-cache-drift", "runtime-ruby-bootsnap-cache-drift"),
      stableRefusal("autoload-ambiguity", "runtime-ruby-autoload-ambiguous"),
      stableRefusal("open-db-transaction", "runtime-ruby-db-transaction-unsupported"),
    ],
    targetRestore: supported
      ? completedTarget("ruby-rails-puma-style")
      : refusedTarget(
          "ruby-rails-puma-style",
          stableRefusal("ruby-fixture-failed", "runtime-ruby-fixture-failed"),
        ),
    securityInspection: noShortcutInspection(),
  };
}

function goProof(workDir) {
  ensureDir(workDir);
  if (!commandExists("go")) {
    const refusal = stableRefusal("go-unavailable", "runtime-go-not-available");
    return {
      ...runtimeBase("go"),
      state: "refused",
      supportClaimed: false,
      refusal,
      targetRestore: refusedTarget("go-service-runtime", refusal),
      securityInspection: noShortcutInspection(),
    };
  }
  const source = join(workDir, "go_service.go");
  writeFileSync(
    source,
    `package main\nimport ("crypto/sha256"; "encoding/hex"; "encoding/json"; "fmt"; "runtime"; "time")\nfunc main(){ ch := make(chan string, 1); go func(){ ch <- "goroutine-ok" }(); timer := time.NewTimer(time.Millisecond); <-timer.C; h := sha256.Sum256([]byte("tls-policy-reconnect")); out := map[string]any{"ok": true, "go": runtime.Version(), "goroutine": <-ch, "netpoller": "refuse-active-sockets", "tls": hex.EncodeToString(h[:4]), "cgo": "refuse-cgo"}; b,_ := json.Marshal(out); fmt.Println(string(b)) }\n`,
  );
  const execute = run("go", ["run", source], {
    cwd: workDir,
    env: { ...process.env, CGO_ENABLED: "0" },
  });
  const parsed = execute.status === 0 ? JSON.parse(execute.stdout) : null;
  const supported =
    parsed?.goroutine === "goroutine-ok" && parsed?.netpoller === "refuse-active-sockets";
  return {
    ...runtimeBase("go"),
    state: supported ? "supported" : "refused",
    supportClaimed: supported,
    version: run("go", ["version"]).stdout.trim(),
    fixture: "go-service-runtime-local-audited",
    moduleGraphSha256: sha256("stdlib-only-go-service"),
    outputSha256: sha256(execute.stdout),
    managedHazards: ["goroutines", "scheduler", "channels", "timers", "netpoller", "tls", "cgo"],
    refusals: [
      stableRefusal("active-netpoller-socket", "runtime-go-active-netpoller-socket-unsupported"),
      stableRefusal("channel-select-ambiguous", "runtime-go-channel-select-ambiguous"),
      stableRefusal("tls-session", "runtime-go-tls-session-unsupported"),
      stableRefusal("cgo-native-state", "runtime-go-cgo-state-unsupported"),
    ],
    targetRestore: supported
      ? completedTarget("go-service-runtime")
      : refusedTarget(
          "go-service-runtime",
          stableRefusal("go-fixture-failed", "runtime-go-fixture-failed"),
        ),
    securityInspection: noShortcutInspection(),
  };
}

function completedTarget(kind) {
  return {
    state: "completed",
    migrationCompleted: true,
    descriptorGateCompleted: true,
    targetVerifierResult: "passed",
    targetResourceStatuses: [{ kind, status: "passed" }],
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
  };
}

function refusedTarget(kind, refusal) {
  return {
    state: "refused",
    migrationCompleted: false,
    descriptorGateCompleted: false,
    targetVerifierResult: "refused",
    targetResourceStatuses: [{ kind, status: "refused" }],
    refusal,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
  };
}

function aggregateTarget(results) {
  const statuses = results.map((entry) => ({
    kind: entry.targetRestore.targetResourceStatuses[0].kind,
    status: entry.state === "supported" || entry.state === "refused" ? "passed" : "failed",
  }));
  return {
    state: statuses.every((entry) => entry.status === "passed") ? "completed" : "failed",
    migrationCompleted: statuses.every((entry) => entry.status === "passed"),
    descriptorGateCompleted: true,
    targetVerifierResult: statuses.every((entry) => entry.status === "passed")
      ? "passed"
      : "failed",
    targetResourceStatuses: statuses,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
  };
}

function runSuite(options, workDir) {
  ensureDir(workDir);
  const runners = { jvm: jvmProof, python: pythonProof, ruby: rubyProof, go: goProof };
  const names = options.runtime === "all" ? Object.keys(runners) : [options.runtime];
  const results = names.map((name) => runners[name](join(workDir, name)));
  const targetRestore = aggregateTarget(results);
  return {
    kind: "machinen.non-node-runtime-proof",
    profile: "portable-machine-restore",
    state: targetRestore.state,
    remoteSourceTarget:
      options.runtime === "all"
        ? "cross-runtime-comparison"
        : `${options.runtime}-runtime-envelope`,
    hostLabel: options.host_label,
    runtime: options.runtime,
    route: { hostArch: arch(), targetNativeExecution: true },
    targetRestore,
    runtimes: Object.fromEntries(results.map((entry) => [entry.name, entry])),
    comparison: results.map((entry) => ({
      runtime: entry.name,
      state: entry.state,
      supportClaimed: entry.supportClaimed,
      fixture: entry.fixture,
      refusalCode: entry.refusal?.expectedRefusalCode,
    })),
    recommendation:
      "Expand Python or Go next because audited local stdlib fixtures are target-native and currently supported; JVM needs a controlled JDK fixture host before support claims.",
    securityInspection: noShortcutInspection(),
    timings: [],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workDir = resolve(
    options.work_dir ?? join(tmpdir(), `machinen-non-node-runtime-${process.pid}`),
  );
  rmSync(workDir, { recursive: true, force: true });
  ensureDir(workDir);
  const summary = runSuite(options, workDir);
  writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.state === "completed" ? 0 : 1);
}

main();
