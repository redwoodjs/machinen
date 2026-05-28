#!/usr/bin/env tsx
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  boot,
  buildPortableSnapshotGuestCheckpointCompositionRow,
  resolveBaseDtb,
  resolveBaseKernel,
  resolveBaseRootfs,
  restore,
  summarizePortableSnapshotGuestCheckpointCompositionRows,
  type VmHandle,
} from "../packages/runtime/src/index.ts";

interface Options {
  json: boolean;
  summary?: string;
  keepWorkDir: boolean;
  workDir?: string;
}

interface GuestCheckpointProof {
  guestArch: string;
  kernelVersion: string;
  checkpointToolVersion: string;
  verifierOutput: string;
  imageDigest: string;
  checkpointLog: string;
  restoreLog: string;
  preProgress: number;
  postRestoreProgress: number;
  restoredPid: number;
}

function usage(): never {
  console.error(
    "usage: tsx scripts/portable-snapshot-guest-checkpoint-composition.ts [--json] [--summary file] [--work-dir path] [--keep-work-dir]",
  );
  process.exit(2);
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): Options {
  const pending = [...argv];
  const options: Options = { json: false, keepWorkDir: false };
  while (pending.length > 0) {
    const arg = pending.shift();
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--summary":
        options.summary = requiredValue(pending.shift());
        break;
      case "--work-dir":
        options.workDir = requiredValue(pending.shift());
        break;
      case "--keep-work-dir":
        options.keepWorkDir = true;
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

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const workDir = options.workDir
    ? resolve(options.workDir)
    : mkdtempSync(join(tmpdir(), "machinen-checkpoint-composition."));
  const snapDir = join(workDir, "outer-vmstate-snapshot");
  const image = resolveBaseRootfs();
  const kernel = resolveBaseKernel();
  const dtb = resolveBaseDtb();
  let source: VmHandle | undefined;
  let restored: VmHandle | undefined;
  try {
    source = await boot({ image, kernel, dtb, cmd: ["/bin/sleep", "900"], timeoutMs: null });
    await installGuestProofScript(source);
    const pre = await runGuestCheckpointProof(source, "pre-snapshot");
    const sourceArch = normalizeArch(pre.guestArch);
    const storedDigestBefore = await storedImageDigest(
      source,
      "/tmp/machinen-checkpoint-composition-pre-snapshot/img",
    );
    const snapshot = await source.snapshot({
      outDir: snapDir,
      timeoutMs: 120_000,
      leaveRunning: true,
    });
    restored = await restore({ snapDir: snapshot.snapDir, image, kernel, dtb, timeoutMs: null });
    const storedDigestAfter = await storedImageDigest(
      restored,
      "/tmp/machinen-checkpoint-composition-pre-snapshot/img",
    );
    await installGuestProofScript(restored);
    const post = await runGuestCheckpointProof(restored, "post-restore");
    const row = buildPortableSnapshotGuestCheckpointCompositionRow({
      sourceArch,
      targetArch: normalizeArch(post.guestArch),
      machinenStateModel: snapshot.engine === "vmstate" ? "same-arch-vmstate" : "other-supported",
      guestCheckpointVersion: post.checkpointToolVersion,
      preSnapshotGuestCheckpointVerifier: pre.verifierOutput,
      postRestoreGuestCheckpointVerifier: post.verifierOutput,
      storedCheckpointImageDigest: storedDigestBefore,
      storedCheckpointImageReadableAfterRestore: storedDigestBefore === storedDigestAfter,
      migrationCompleted: true,
      evidence: {
        snapshotEngine: snapshot.engine,
        snapshotDir: snapshot.snapDir,
        snapshotElapsedMs: snapshot.elapsedMs,
        preCheckpointLog: pre.checkpointLog,
        preRestoreLog: pre.restoreLog,
        postCheckpointLog: post.checkpointLog,
        postRestoreLog: post.restoreLog,
        storedDigestBefore,
        storedDigestAfter,
        storedCheckpointImagePath: "/tmp/machinen-checkpoint-composition-pre-snapshot/img",
      },
    });
    const summary = summarizePortableSnapshotGuestCheckpointCompositionRows([row]);
    writeSummary(summary, options);
    process.exitCode = summary.pass ? 0 : 1;
  } finally {
    await restored?.kill().catch(() => undefined);
    await source?.kill().catch(() => undefined);
    if (!options.keepWorkDir && !options.workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

function writeSummary(
  summary: ReturnType<typeof summarizePortableSnapshotGuestCheckpointCompositionRows>,
  options: Options,
): void {
  const json = `${JSON.stringify(summary, null, 2)}\n`;
  if (options.summary) {
    writeFileSync(resolve(options.summary), json);
  }
  process.stdout.write(
    options.json
      ? json
      : `portable-snapshot-guest-checkpoint-composition: ${summary.state} completed=${summary.completedRows} refused=${summary.refusedRows}\n`,
  );
}

async function installGuestProofScript(vm: VmHandle): Promise<void> {
  await vm.writeFile("/tmp/machinen-checkpoint-composition-proof.sh", guestProofScript(), {
    mode: 0o755,
  });
}

async function runGuestCheckpointProof(vm: VmHandle, label: string): Promise<GuestCheckpointProof> {
  const safeLabel = label.replace(/[^A-Za-z0-9_.-]/g, "-");
  const root = `/tmp/machinen-checkpoint-composition-${safeLabel}`;
  await vm.exec(`/tmp/machinen-checkpoint-composition-proof.sh ${root}`, {
    execTimeoutMs: 300_000,
  });
  const result = await vm.exec(`cat ${root}/proof.json`, { execTimeoutMs: 30_000 });
  return JSON.parse(result.stdout) as GuestCheckpointProof;
}

async function storedImageDigest(vm: VmHandle, imageDir: string): Promise<string> {
  const cmd = `if [ ! -d ${imageDir} ]; then exit 44; fi; find ${imageDir} -type f -print | sort | while IFS= read -r file; do sha256sum "$file"; done | sha256sum | awk '{print $1}'`;
  const result = await vm.exec(cmd, { execTimeoutMs: 60_000 });
  return result.stdout.trim();
}

// fallow-ignore-next-line complexity
function normalizeArch(guestArch: string): string {
  if (guestArch === "aarch64" || guestArch === "arm64") {
    return "arm64";
  }
  if (guestArch === "x86_64" || guestArch === "amd64") {
    return "amd64";
  }
  return guestArch;
}

function guestProofScript(): string {
  return String.raw`#!/bin/sh
set -eu
root="$1"
json_escape(){ tr '\n' ' ' | tr '"\\' '__'; }
ensure_toolchain(){
  if command -v gcc >/dev/null 2>&1 && command -v ld >/dev/null 2>&1; then
    return 0
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update >"$root-apt-update.log"
  apt-get install -y binutils gcc libc6-dev make >"$root-apt-install.log"
}
rm -rf "$root"
mkdir -p "$root/img"
ensure_toolchain
cat >"$root/counter.c" <<'C'
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
    FILE *f = fopen("PROGRESS_PATH", "a");
    if (!f) return 2;
    fprintf(f, "pid=%d counter=%d\n", getpid(), counter++);
    fclose(f);
    usleep(100000);
  }
  return 0;
}
C
progress_path="$root/progress.log"
sed "s|PROGRESS_PATH|$progress_path|g" "$root/counter.c" >"$root/counter.final.c"
cd "$root"
gcc -B/usr/lib/gcc/aarch64-linux-gnu/12/ -B/usr/bin/ -O2 -o counter counter.final.c
setsid ./counter </dev/null >counter.stdout 2>counter.stderr &
sleep 0.8
pid=$(sed -n 's/^pid=\([0-9][0-9]*\).*/\1/p' progress.log | tail -1)
pre=$(wc -l <progress.log)
if ! criu dump -t "$pid" -D "$root/img" -o dump.log -v4; then
  tail -160 "$root/img/dump.log" >"$root/failure.log"
  exit 10
fi
if ! criu restore -D "$root/img" -d -o restore.log -v4; then
  tail -160 "$root/img/restore.log" >"$root/failure.log"
  exit 11
fi
sleep 0.8
post=$(wc -l <progress.log)
progress_tail=$(tail -5 progress.log | tr '\n' ';' | tr '"\\' '__')
dump_bytes=$(wc -c <"$root/img/dump.log")
restore_bytes=$(wc -c <"$root/img/restore.log")
image_digest=$(find "$root/img" -type f -print | sort | while IFS= read -r file; do sha256sum "$file"; done | sha256sum | awk '{print $1}')
checkpoint_log="criu dump completed pid=$pid pre=$pre dumpLogBytes=$dump_bytes"
restore_log="criu restore completed pid=$pid post=$post restoreLogBytes=$restore_bytes"
kill "$pid" 2>/dev/null || true
printf '{"guestArch":"%s","kernelVersion":"%s","checkpointToolVersion":"%s","verifierOutput":"pre=%s post=%s restoredPid=%s tail=%s","imageDigest":"%s","checkpointLog":"%s","restoreLog":"%s","preProgress":%s,"postRestoreProgress":%s,"restoredPid":%s}\n' \
  "$(uname -m)" "$(uname -r)" "$(criu --version | head -1)" \
  "$pre" "$post" "$pid" "$progress_tail" "$image_digest" "$checkpoint_log" "$restore_log" "$pre" "$post" "$pid" \
  >"$root/proof.json"
`;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
