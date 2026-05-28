#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  boot,
  buildAdvancedLinuxFacilityProbeRow,
  resolveBaseDtb,
  resolveBaseKernel,
  resolveBaseRootfs,
  summarizeAdvancedLinuxFacilityProbeRows,
  type AdvancedLinuxFacilityProbeRow,
  type VmHandle,
} from "../packages/runtime/src/index.ts";

interface Options {
  json: boolean;
  summary?: string;
}

interface GuestProbe {
  arch: string;
  kernelVersion: string;
  seccompVerifier: string;
  bpfPolicy: string;
  namespaceVerifier: string;
  cgroupVerifier: string;
  capabilityVerifier: string;
  effectiveCapsHex: string;
}

function usage(): never {
  console.error("usage: tsx scripts/advanced-linux-facility-probe.ts [--json] [--summary file]");
  process.exit(2);
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): Options {
  const pending = [...argv];
  const options: Options = { json: false };
  while (pending.length > 0) {
    const arg = pending.shift();
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--summary":
        options.summary = requiredValue(pending.shift());
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
    const probe = await runGuestProbe(vm);
    const arch = normalizeArch(probe.arch);
    const rows = buildRows(probe, arch);
    const summary = summarizeAdvancedLinuxFacilityProbeRows(rows);
    const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
    if (options.summary) {
      writeFileSync(resolve(options.summary), summaryText);
    }
    process.stdout.write(
      options.json
        ? summaryText
        : `advanced-linux-facility-probe: ${summary.state} rows=${summary.rowCount}\n`,
    );
    process.exitCode = summary.pass ? 0 : 1;
  } finally {
    await vm.kill().catch(() => undefined);
  }
}

async function runGuestProbe(vm: VmHandle): Promise<GuestProbe> {
  await vm.writeFile("/tmp/machinen-advanced-linux-probe.sh", guestProbeScript(), { mode: 0o755 });
  const result = await vm.exec("/tmp/machinen-advanced-linux-probe.sh", { execTimeoutMs: 300_000 });
  return JSON.parse(result.stdout) as GuestProbe;
}

function buildRows(probe: GuestProbe, arch: string): AdvancedLinuxFacilityProbeRow[] {
  const base = { sourceArch: arch, targetArch: arch, kernelVersion: probe.kernelVersion };
  const seccompPassed = probe.seccompVerifier.includes("EPERM-after=true");
  return [
    buildAdvancedLinuxFacilityProbeRow({
      ...base,
      facility: "seccomp",
      stateModel: seccompPassed ? "recreated" : "refused",
      requiredCapabilities: [],
      verifierOutput: probe.seccompVerifier,
      classification: seccompPassed ? "proof-only-feasibility" : "refused",
      refusalCode: seccompPassed
        ? undefined
        : "facility-verifier-ambiguous",
      remediation: seccompPassed
        ? undefined
        : "Run on a kernel that permits installing a minimal seccomp filter and record the verifier result.",
      evidence: { expectedBlockedSyscall: "getppid" },
    }),
    buildAdvancedLinuxFacilityProbeRow({
      ...base,
      facility: "ebpf",
      stateModel: "refused",
      requiredCapabilities: ["CAP_BPF", "CAP_SYS_ADMIN"],
      verifierOutput: probe.bpfPolicy,
      classification: "refused",
      refusalCode: "insufficient-privileges",
      remediation:
        "Run a bounded eBPF fixture in a guest with CAP_BPF/CAP_SYS_ADMIN and record pinned-map/program cleanup before accepting BPF state.",
      evidence: { policy: probe.bpfPolicy },
    }),
    buildAdvancedLinuxFacilityProbeRow({
      ...base,
      facility: "namespace",
      stateModel: "recreated",
      requiredCapabilities: [],
      verifierOutput: probe.namespaceVerifier,
      classification: "proof-only-feasibility",
      evidence: { namespaceIdentity: probe.namespaceVerifier },
    }),
    buildAdvancedLinuxFacilityProbeRow({
      ...base,
      facility: "cgroup",
      stateModel: "recreated",
      requiredCapabilities: [],
      verifierOutput: probe.cgroupVerifier,
      classification: "proof-only-feasibility",
      evidence: { cgroupMembership: probe.cgroupVerifier },
    }),
    buildAdvancedLinuxFacilityProbeRow({
      ...base,
      facility: "capability",
      stateModel: "proven-irrelevant",
      requiredCapabilities: [],
      verifierOutput: probe.capabilityVerifier,
      classification: "proof-only-feasibility",
      evidence: { effectiveCapsHex: probe.effectiveCapsHex },
    }),
  ];
}

function normalizeArch(value: string): string {
  if (value === "aarch64") {
    return "arm64";
  }
  if (value === "x86_64") {
    return "amd64";
  }
  return value;
}

function guestProbeScript(): string {
  return String.raw`#!/bin/sh
set -eu
json_escape(){ tr '\n' ';' | tr '"\\' '__'; }
export DEBIAN_FRONTEND=noninteractive
apt-get update >/tmp/advanced-linux-apt-update.log
apt-get install -y binutils gcc libc6-dev make >/tmp/advanced-linux-apt-install.log
cat >/tmp/seccomp-deny-getppid.c <<'C'
#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#ifndef SECCOMP_RET_KILL_PROCESS
#define SECCOMP_RET_KILL_PROCESS SECCOMP_RET_KILL
#endif
int main() {
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_AARCH64, 0, 5),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_getppid, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
  };
  struct sock_fprog prog = { .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter };
  int before = syscall(__NR_getppid) > 0;
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) { perror("no_new_privs"); return 2; }
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) { perror("seccomp"); return 3; }
  errno = 0;
  long blocked = syscall(__NR_getppid);
  printf("before=%d blocked=%ld errno=%d EPERM-before=%s EPERM-after=%s\n", before, blocked, errno, before ? "true" : "false", (blocked == -1 && errno == EPERM) ? "true" : "false");
  return (blocked == -1 && errno == EPERM) ? 0 : 4;
}
C
gcc -B/usr/lib/gcc/aarch64-linux-gnu/12/ -B/usr/bin/ -O2 -o /tmp/seccomp-deny-getppid /tmp/seccomp-deny-getppid.c
seccomp_verifier=$(/tmp/seccomp-deny-getppid 2>&1 | json_escape)
bpf_policy="unprivileged_bpf_disabled=$(cat /proc/sys/kernel/unprivileged_bpf_disabled 2>/dev/null || echo unknown); bpftool=$(command -v bpftool 2>/dev/null || echo missing); CapEff=$(awk '/CapEff/{print $2}' /proc/self/status)"
namespace_verifier=$(for ns in ipc mnt net pid user uts cgroup time; do printf "%s=%s " "$ns" "$(readlink /proc/self/ns/$ns 2>/dev/null || echo unavailable)"; done | json_escape)
cgroup_verifier=$(cat /proc/self/cgroup 2>/dev/null | json_escape)
if [ -z "$cgroup_verifier" ]; then cgroup_verifier="empty-cgroup-membership"; fi
cap_eff=$(awk '/CapEff/{print $2}' /proc/self/status)
capability_verifier="CapEff=$cap_eff CapPrm=$(awk '/CapPrm/{print $2}' /proc/self/status) NoNewPrivs=$(awk '/NoNewPrivs/{print $2}' /proc/self/status)"
printf '{"arch":"%s","kernelVersion":"%s","seccompVerifier":"%s","bpfPolicy":"%s","namespaceVerifier":"%s","cgroupVerifier":"%s","capabilityVerifier":"%s","effectiveCapsHex":"%s"}\n' \
  "$(uname -m)" "$(uname -r)" "$seccomp_verifier" "$bpf_policy" "$namespace_verifier" "$cgroup_verifier" "$capability_verifier" "$cap_eff"
`;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
