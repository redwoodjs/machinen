#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

function usage() {
  console.error("usage: package-release-benchmark.mjs <version> <raw.json> <output-dir>");
  process.exit(2);
}

function requireVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`invalid release version: ${value}`);
  }
  return value;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`benchmark JSON is missing ${label}`);
  }
  return value;
}

function number(value, digits = 1) {
  return typeof value === "number" ? value.toFixed(digits) : "—";
}

function millisecondsRow(label, aggregate) {
  return `| ${label} | ${number(aggregate.avg)} | ${number(aggregate.med)} | ${number(aggregate.p95)} | ${number(aggregate.min)} | ${number(aggregate.max)} | ms |`;
}

function latencyRows(result) {
  const latency = requireObject(result.latency, "latency results");
  return [
    millisecondsRow("boot cold total", latency.boot_cold.aggregates.total),
    millisecondsRow("boot warm total", latency.boot_warm.aggregates.total),
    millisecondsRow("snapshot elapsed", latency.snapshot.aggregates.elapsed_ms),
    millisecondsRow("restore cold total", latency.restore_cold.aggregates.total),
    millisecondsRow("restore warm total", latency.restore_warm.aggregates.total),
    millisecondsRow("fork total", latency.fork.aggregates.total),
  ];
}

function cpuRows(result) {
  const cpu = requireObject(result.resources?.cpu, "CPU results");
  const divisor = 1024 * 1024;
  return Object.entries({
    "host native SHA256": cpu.host_native,
    "guest no quota SHA256": cpu.guest_no_quota,
    "guest quota 1 SHA256": cpu.guest_quota_1,
    "guest quota 0.5 SHA256": cpu.guest_quota_0_5,
  }).map(([label, scenario]) => {
    const stats = scenario.aggregate.throughput_bytes_per_sec;
    return `| ${label} | ${number(stats.avg / divisor)} | ${number(stats.med / divisor)} | ${number(stats.p95 / divisor)} |`;
  });
}

function memoryRows(result) {
  const scenarios = result.resources?.memory?.by_touched_mib ?? {};
  return Object.values(scenarios)
    .sort((left, right) => left.touchedMib - right.touchedMib)
    .map((scenario) => {
      const rss = scenario.host_rss_bytes;
      const divisor = 1024 * 1024;
      return `| ${scenario.touchedMib} | ${number(rss?.avg / divisor)} | ${number(rss?.med / divisor)} | ${number(rss?.p95 / divisor)} |`;
    });
}

function networkRow(label, phase) {
  const stats = phase.aggregate;
  return `| ${label} | ${number(stats.avg)} | ${number(stats.med)} | ${number(stats.p95)} | ${number(stats.min)} | ${number(stats.max)} | ${phase.metric} |`;
}

function externalRows(result) {
  const mount = requireObject(result.mount?.phases, "mount results");
  const net = requireObject(result.net?.phases, "network results");
  return [
    millisecondsRow("mount tar extract", mount.tar_extract_wall_ms),
    networkRow("network latency", net.latency),
    networkRow("network RX", net.rx),
    networkRow("network TX", net.tx),
  ];
}

function summaryMarkdown(version, result, rawName) {
  const host = requireObject(result.host, "host metadata");
  const config = requireObject(result.config, "benchmark config");
  const git = requireObject(result.git, "git metadata");
  return `# Machinen v${version} benchmark baseline

- Kind: \`release-baseline\`
- Source: \`runtime-v${version}\` (\`${git.commit}\`, dirty=${git.dirty})
- Host: \`${host.platform}/${host.arch}\`, ${host.cpu_model}, ${host.cpu_count} CPUs, kernel ${host.release}
- Guest: \`${result.assets?.guest_arch}\`, accelerator: \`hvf\`
- Samples: \`n=${config.n}\`, environment: \`${config.environment}\`
- Raw artifact: \`${rawName}\`

## Latency

| phase | avg | med | p95 | min | max | unit |
|---|---:|---:|---:|---:|---:|---|
${latencyRows(result).join("\n")}

## CPU throughput

| scenario | avg MiB/s | med MiB/s | p95 MiB/s |
|---|---:|---:|---:|
${cpuRows(result).join("\n")}

## Memory RSS

| touched MiB | avg host RSS MiB | med host RSS MiB | p95 host RSS MiB |
|---:|---:|---:|---:|
${memoryRows(result).join("\n")}

## Mount and network

| scenario | avg | med | p95 | min | max | unit |
|---|---:|---:|---:|---:|---:|---|
${externalRows(result).join("\n")}
`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const [, , versionArg, rawPathArg, outputDirArg] = process.argv;
if (!versionArg || !rawPathArg || !outputDirArg) {
  usage();
}

const version = requireVersion(versionArg);
const rawPath = resolve(rawPathArg);
const outputDir = resolve(outputDirArg);
const rawBytes = readFileSync(rawPath);
const result = JSON.parse(rawBytes.toString("utf8"));
requireObject(result, "root object");
if (result.git?.dirty !== false) {
  throw new Error("release baseline must come from a clean source checkout");
}
if (result.git?.commit === undefined) {
  throw new Error("release baseline is missing its source commit");
}

const hostOs = result.host?.platform;
const hostArch = result.host?.arch;
const guestArch = result.assets?.guest_arch;
if (hostOs !== "darwin" || hostArch !== "arm64" || guestArch !== "arm64") {
  throw new Error(`unsupported release baseline matrix: ${hostOs}/${hostArch} -> ${guestArch}`);
}

mkdirSync(outputDir, { recursive: true });
const rawName = `bench-all-darwin-arm64-arm64-hvf-n${result.config?.n}-v${version}.json.gz`;
const compressed = gzipSync(rawBytes, { level: 9 });
const rawOutput = join(outputDir, rawName);
writeFileSync(rawOutput, compressed);

const summary = summaryMarkdown(version, result, rawName);
writeFileSync(join(outputDir, "summary.md"), summary);
const metadata = {
  schema_version: 1,
  kind: "release-baseline",
  source: {
    repo: "redwoodjs/machinen",
    release: `runtime-v${version}`,
    version,
    commit: result.git.commit,
    branch: result.git.branch,
    dirty: result.git.dirty,
  },
  benchmark: result.benchmark,
  benchmark_harness: { commit: result.git.commit },
  created_at: result.generated_at,
  host: result.host,
  guest_arch: guestArch,
  accelerator: "hvf",
  environment: result.config?.environment,
  suite: result.config?.suites,
  sample_count: result.config?.n,
  command: `pnpm bench --n ${result.config?.n} --json <output>`,
  packages: {
    "@machinen/runtime": version,
    "@machinen/cli": version,
    "@machinen/native-arm64-darwin": version,
  },
  assets: result.assets,
  artifacts: [
    {
      name: rawName,
      size_bytes: statSync(rawOutput).size,
      sha256: sha256(compressed),
    },
    { name: "metadata.json" },
    { name: "summary.md" },
  ],
};
writeFileSync(join(outputDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(join(outputDir, basename(rawOutput)));
