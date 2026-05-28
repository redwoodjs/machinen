#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  boot,
  buildGuestCriuSubstrateRow,
  resolveBaseDtb,
  resolveBaseKernel,
  resolveBaseRootfs,
  summarizeGuestCriuSubstrateRows,
  type GuestCriuSubstrateProfile,
  type GuestCriuSubstrateRow,
} from "../packages/runtime/src/index.ts";

interface Options {
  json: boolean;
  summary?: string;
  profile: GuestCriuSubstrateProfile | "all";
}

interface ProbeResult {
  guestArch: string;
  kernelVersion: string;
  criuVersion: string;
  kernelFeatureProbeOutput: string;
}

interface CProofResult extends ProbeResult {
  preProgress: number;
  postRestoreProgress: number;
  restoredPid: number;
  checkpointLog: string;
  restoreLog: string;
  verifierOutput: string;
  progressTail: string;
}

function usage(): never {
  console.error(
    "usage: tsx scripts/guest-criu-substrate.ts [--json] [--summary file] [--profile all|c-simple|jvm-simple]",
  );
  process.exit(2);
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): Options {
  const pending = [...argv];
  const options: Options = { json: false, profile: "all" };
  while (pending.length > 0) {
    const arg = pending.shift();
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--summary":
        options.summary = requiredValue(pending.shift());
        break;
      case "--profile":
        options.profile = parseProfile(requiredValue(pending.shift()));
        break;
      default:
        usage();
    }
  }
  return options;
}

function requiredValue(value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    usage();
  }
  return value;
}

function parseProfile(value: string): Options["profile"] {
  if (value === "all" || value === "c-simple" || value === "jvm-simple") {
    return value;
  }
  usage();
}

function renderSummary(
  summary: ReturnType<typeof summarizeGuestCriuSubstrateRows>,
  json: boolean,
): string {
  if (json) {
    return `${JSON.stringify(summary, null, 2)}\n`;
  }
  return `guest-criu-substrate: ${summary.state} completed=${summary.completedRows} refused=${summary.refusedRows}\n`;
}

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const vm = await boot({
    image: resolveBaseRootfs(),
    kernel: resolveBaseKernel(),
    dtb: resolveBaseDtb(),
    cmd: ["/bin/sleep", "600"],
    timeoutMs: null,
  });
  try {
    const probe = await runProbe(vm);
    const rows: GuestCriuSubstrateRow[] = [];
    if (options.profile === "all" || options.profile === "c-simple") {
      rows.push(await runCProfile(vm, probe));
    }
    if (options.profile === "all" || options.profile === "jvm-simple") {
      rows.push(await runJvmProfile(vm, probe));
    }
    const summary = summarizeGuestCriuSubstrateRows(rows);
    const rendered = renderSummary(summary, options.json);
    if (options.summary) {
      writeFileSync(resolve(options.summary), `${JSON.stringify(summary, null, 2)}\n`);
    }
    process.stdout.write(rendered);
    process.exitCode = summary.pass ? 0 : 1;
  } finally {
    await vm.kill();
  }
}

async function runProbe(vm: Awaited<ReturnType<typeof boot>>): Promise<ProbeResult> {
  const probeScript = String.raw`json_escape(){ tr '\n' ' ' | tr '"\\' '__'; }
guest_arch=$(uname -m)
kernel_version=$(uname -r)
criu_version=$( (criu --version 2>/dev/null || /usr/sbin/criu --version 2>/dev/null) | head -1)
check_output=$(criu check 2>&1 | tail -20 | json_escape)
seccomp_output=$(criu check --feature seccomp_suspend 2>&1 | tail -20 | json_escape)
printf '{"guestArch":"%s","kernelVersion":"%s","criuVersion":"%s","kernelFeatureProbeOutput":"%s; %s"}\n' "$guest_arch" "$kernel_version" "$criu_version" "$check_output" "$seccomp_output"`;
  await vm.writeFile("/tmp/machinen-guest-criu-probe.sh", probeScript, { mode: 0o755 });
  const result = await vm.exec("/bin/sh /tmp/machinen-guest-criu-probe.sh", {
    execTimeoutMs: 60_000,
  });
  return JSON.parse(result.stdout) as ProbeResult;
}

async function runCProfile(
  vm: Awaited<ReturnType<typeof boot>>,
  probe: ProbeResult,
): Promise<GuestCriuSubstrateRow> {
  await vm.writeFile("/tmp/machinen-guest-criu-c.sh", cProfileScript(), { mode: 0o755 });
  await vm.exec(
    "rm -f /tmp/guest-criu-c-proof.json /tmp/guest-criu-c-proof.state /tmp/guest-criu-c-failure.log; setsid /tmp/machinen-guest-criu-c.sh >/tmp/guest-criu-c.log 2>&1 </dev/null & echo started=$!",
    { execTimeoutMs: 30_000 },
  );
  const state = await pollProofState(vm, "/tmp/guest-criu-c-proof.state");
  if (state !== "completed") {
    const failure = await vm.execRaw(
      "tail -120 /tmp/guest-criu-c.log 2>/dev/null; echo ---failure---; cat /tmp/guest-criu-c-failure.log 2>/dev/null || true",
      { execTimeoutMs: 30_000 },
    );
    return buildGuestCriuSubstrateRow({
      ...probe,
      profile: "c-simple",
      checkpointLog: failure.stdout,
      restoreLog: "not-run or failed before verifier completion",
      verifierOutput: "C CRIU checkpoint/restore did not complete",
      state: "refused",
      refusalCode: "c-criu-dump-restore-failed",
      remediation:
        "Inspect the guest CRIU dump/restore log and remove unsupported inherited descriptors or kernel features.",
    });
  }
  const proofText = await vm.exec("cat /tmp/guest-criu-c-proof.json", { execTimeoutMs: 30_000 });
  const proof = JSON.parse(proofText.stdout) as CProofResult;
  return buildGuestCriuSubstrateRow({
    ...probe,
    profile: "c-simple",
    checkpointLog: proof.checkpointLog,
    restoreLog: proof.restoreLog,
    verifierOutput: proof.verifierOutput,
    evidence: {
      preCheckpointProgress: proof.preProgress,
      postRestoreProgress: proof.postRestoreProgress,
      restoredPid: proof.restoredPid,
      progressTail: proof.progressTail,
    },
  });
}

async function runJvmProfile(
  vm: Awaited<ReturnType<typeof boot>>,
  probe: ProbeResult,
): Promise<GuestCriuSubstrateRow> {
  const java = await vm.execRaw("command -v java 2>/dev/null || true", { execTimeoutMs: 30_000 });
  if (java.stdout.trim() === "") {
    return buildGuestCriuSubstrateRow({
      ...probe,
      profile: "jvm-simple",
      checkpointLog: "not-run: java is not installed in the base Machinen guest",
      restoreLog: "not-run: java is not installed in the base Machinen guest",
      verifierOutput: "command -v java produced no path",
      state: "refused",
      refusalCode: "jvm-runtime-unavailable",
      remediation:
        "Install a supported JVM in the guest image, then run the JVM CRIU profile and require its verifier to pass.",
    });
  }
  return buildGuestCriuSubstrateRow({
    ...probe,
    profile: "jvm-simple",
    checkpointLog: `not-run: ${java.stdout.trim()} is present, but JVM CRIU state is not enabled by this proof`,
    restoreLog:
      "not-run: JVM private runtime/JIT/thread state requires an explicit supported profile",
    verifierOutput: `java path detected: ${java.stdout.trim()}`,
    state: "refused",
    refusalCode: "jvm-criu-runtime-state-unsupported",
    remediation:
      "Add a JVM-specific CRIU profile that controls JIT/thread state before accepting JVM restore.",
  });
}

async function pollProofState(vm: Awaited<ReturnType<typeof boot>>, path: string): Promise<string> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 3_000));
    const state = await vm.execRaw(`cat ${path} 2>/dev/null || true`, { execTimeoutMs: 10_000 });
    const trimmed = state.stdout.trim();
    if (trimmed === "completed" || trimmed === "failed") {
      return trimmed;
    }
  }
  return "timed-out";
}

function cProfileScript(): string {
  return String.raw`#!/bin/sh
set -eu
json_escape(){ tr '\n' ' ' | tr '"\\' '__'; }
export DEBIAN_FRONTEND=noninteractive
apt-get update >/tmp/guest-criu-apt-update.log
apt-get install -y binutils gcc libc6-dev make >/tmp/guest-criu-apt-install.log
mkdir -p /tmp/guest-criu-c/img
cat >/tmp/guest-criu-c/counter.c <<'C'
#include <stdio.h>
#include <unistd.h>
#include <signal.h>
static volatile int keep = 1;
void stop(int sig) { (void)sig; keep = 0; }
int main() {
  for (int fd = 3; fd < 1024; fd++) close(fd);
  signal(SIGTERM, stop);
  int counter = 0;
  while (keep) {
    FILE *f = fopen("/tmp/guest-criu-c/progress.log", "a");
    if (!f) return 2;
    fprintf(f, "pid=%d counter=%d\n", getpid(), counter++);
    fclose(f);
    usleep(100000);
  }
  return 0;
}
C
cd /tmp/guest-criu-c
gcc -B/usr/lib/gcc/aarch64-linux-gnu/12/ -B/usr/bin/ -O2 -o counter counter.c
setsid ./counter </dev/null >/tmp/guest-criu-c/counter.stdout 2>/tmp/guest-criu-c/counter.stderr &
sleep 0.8
pid=$(sed -n 's/^pid=\([0-9][0-9]*\).*/\1/p' /tmp/guest-criu-c/progress.log | tail -1)
pre=$(wc -l </tmp/guest-criu-c/progress.log)
if ! criu dump -t "$pid" -D /tmp/guest-criu-c/img -o dump.log -v4; then
  echo failed >/tmp/guest-criu-c-proof.state
  tail -160 /tmp/guest-criu-c/img/dump.log >/tmp/guest-criu-c-failure.log
  exit 10
fi
if ! criu restore -D /tmp/guest-criu-c/img -d -o restore.log -v4; then
  echo failed >/tmp/guest-criu-c-proof.state
  tail -160 /tmp/guest-criu-c/img/restore.log >/tmp/guest-criu-c-failure.log
  exit 11
fi
sleep 0.8
post=$(wc -l </tmp/guest-criu-c/progress.log)
progress_tail=$(tail -5 /tmp/guest-criu-c/progress.log | tr '\n' ';' | tr '"\\' '__')
dump_bytes=$(wc -c </tmp/guest-criu-c/img/dump.log)
restore_bytes=$(wc -c </tmp/guest-criu-c/img/restore.log)
checkpoint_log="criu dump completed pid=$pid pre=$pre dumpLogBytes=$dump_bytes"
restore_log="criu restore completed pid=$pid post=$post restoreLogBytes=$restore_bytes"
kill "$pid" 2>/dev/null || true
printf '{"guestArch":"%s","kernelVersion":"%s","criuVersion":"%s","kernelFeatureProbeOutput":"%s","preProgress":%s,"postRestoreProgress":%s,"restoredPid":%s,"checkpointLog":"%s","restoreLog":"%s","verifierOutput":"pre=%s post=%s restoredPid=%s tail=%s","progressTail":"%s"}\n' \
  "$(uname -m)" "$(uname -r)" "$(criu --version | head -1)" "$(criu check 2>&1 | tail -5 | json_escape)" \
  "$pre" "$post" "$pid" "$checkpoint_log" "$restore_log" "$pre" "$post" "$pid" "$progress_tail" "$progress_tail" \
  >/tmp/guest-criu-c-proof.json
echo completed >/tmp/guest-criu-c-proof.state
`;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
