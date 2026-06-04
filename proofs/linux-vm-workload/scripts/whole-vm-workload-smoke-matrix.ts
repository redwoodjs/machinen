import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type VmWorkloadRowId =
  | "vm-sqlite-database-smoke"
  | "vm-postgresql-database-smoke"
  | "vm-simple-c-process-smoke"
  | "vm-simple-java-process-smoke"
  | "vm-ebpf-capability-smoke"
  | "vm-seccomp-capability-smoke"
  | "vm-nested-virtualization-smoke";

type RowDisposition = "supported" | "refused";

type RowResult = {
  id: VmWorkloadRowId;
  proofNumber: string;
  disposition: RowDisposition;
  status: "verified";
  accepted: boolean;
  verifier: Record<string, string>;
  refusalCode?: string;
  evidence: string;
};

type Transcript = {
  command: string[];
  status: number | null;
  stdout: string;
  stderr: string;
};

type MatrixReport = {
  kind: "machinen.whole-vm-workload-smoke-matrix";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  proofStatus: "verified" | "not-started";
  publicClaimAllowed: false;
  currentClaim: {
    productSupport: 0;
    broadSupport: 0;
    arbitraryProcessCrossArchRestore: 0;
  };
  scope: string;
  guestArch: "arm64" | "amd64";
  rowResults: RowResult[];
  acceptedRows: number;
  requiredRows: 7;
  supportedRows: number;
  refusedRows: number;
  artifacts: Array<{ name: string; path: string; sha256: string }>;
  noShortcutPolicy: {
    rawVmStateRestoreAccepted: false;
    crossIsaCpuReplayAccepted: false;
    arbitraryProcessRestoreAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
};

const ROWS: Array<{ id: VmWorkloadRowId; proofNumber: string }> = [
  { id: "vm-sqlite-database-smoke", proofNumber: "vm/003" },
  { id: "vm-postgresql-database-smoke", proofNumber: "vm/004" },
  { id: "vm-simple-c-process-smoke", proofNumber: "vm/005" },
  { id: "vm-simple-java-process-smoke", proofNumber: "vm/006" },
  { id: "vm-ebpf-capability-smoke", proofNumber: "vm/007" },
  { id: "vm-seccomp-capability-smoke", proofNumber: "vm/008" },
  { id: "vm-nested-virtualization-smoke", proofNumber: "vm/009" },
];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), "whole-vm-workload-smoke-"));
  try {
    const guestArch = args.guestArch;
    writeProbeFiles(workDir, guestArch);
    const transcript = runVm(workDir, guestArch);
    const rowResults = parseRows(`${transcript.stdout}\n${transcript.stderr}`);
    const accepted =
      transcript.status === 0 && rowResults.length === 7 && rowResults.every((row) => row.accepted);
    const transcriptArtifact = writeJsonArtifact(
      outDir,
      "vm-workload-smoke-transcript.json",
      transcript,
    );
    const rowArtifact = writeJsonArtifact(outDir, "vm-workload-smoke-rows.json", rowResults);
    copyTextArtifact(
      outDir,
      "run-vm-workload-smoke.sh",
      readFileSync(join(workDir, "run-vm-workload-smoke.sh"), "utf8"),
    );
    copyTextArtifact(outDir, "simple-c-smoke.c", SIMPLE_C_SMOKE_C);
    copyTextArtifact(outDir, "seccomp-smoke.c", SECCOMP_SMOKE_C);
    copyTextArtifact(outDir, "ebpf-smoke.c", EBPF_SMOKE_C);
    const report: MatrixReport = {
      kind: "machinen.whole-vm-workload-smoke-matrix",
      version: 1,
      generatedAt: new Date().toISOString(),
      accepted,
      proofStatus: accepted ? "verified" : "not-started",
      publicClaimAllowed: false,
      currentClaim: {
        productSupport: 0,
        broadSupport: 0,
        arbitraryProcessCrossArchRestore: 0,
      },
      scope:
        "Retained VM workload smoke/capability matrix for vm/003-vm/009. Supported rows prove guest execution only; refused rows record stable missing-tool or unavailable-capability boundaries. This does not prove whole-VM cross-architecture restore and does not raise the whole-VM claim.",
      guestArch,
      rowResults,
      acceptedRows: rowResults.filter((row) => row.accepted).length,
      requiredRows: 7,
      supportedRows: rowResults.filter((row) => row.disposition === "supported").length,
      refusedRows: rowResults.filter((row) => row.disposition === "refused").length,
      artifacts: [
        transcriptArtifact,
        rowArtifact,
        artifactFor(join(outDir, "run-vm-workload-smoke.sh")),
        artifactFor(join(outDir, "simple-c-smoke.c")),
        artifactFor(join(outDir, "seccomp-smoke.c")),
        artifactFor(join(outDir, "ebpf-smoke.c")),
      ],
      noShortcutPolicy: {
        rawVmStateRestoreAccepted: false,
        crossIsaCpuReplayAccepted: false,
        arbitraryProcessRestoreAccepted: false,
        metadataOnlySuccessAccepted: false,
      },
    };
    writeJson(join(outDir, "whole-vm-workload-smoke-matrix-report.json"), report);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(
        `whole VM workload smoke matrix: accepted=${report.accepted} supported=${report.supportedRows} refused=${report.refusedRows}\n`,
      );
    }
    if (!report.accepted) {
      process.exitCode = 1;
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function writeProbeFiles(workDir: string, guestArch: "arm64" | "amd64"): void {
  writeFileSync(join(workDir, "simple-c-smoke.c"), SIMPLE_C_SMOKE_C);
  writeFileSync(join(workDir, "seccomp-smoke.c"), SECCOMP_SMOKE_C);
  writeFileSync(join(workDir, "ebpf-smoke.c"), EBPF_SMOKE_C);
  compileProbe(workDir, "simple-c-smoke.c", "simple-c-smoke", guestArch);
  compileProbe(workDir, "seccomp-smoke.c", "seccomp-smoke", guestArch);
  compileProbe(workDir, "ebpf-smoke.c", "ebpf-smoke", guestArch);
  writeFileSync(join(workDir, "run-vm-workload-smoke.sh"), RUN_SCRIPT);
}

function compileProbe(
  workDir: string,
  source: string,
  output: string,
  guestArch: "arm64" | "amd64",
): void {
  const target = guestArch === "arm64" ? "aarch64-linux-musl" : "x86_64-linux-musl";
  const result = spawnSync(
    "zig",
    ["cc", "-target", target, "-static", join(workDir, source), "-o", join(workDir, output)],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`zig cc failed for ${source}: ${result.stderr || result.stdout}`);
  }
}

function runVm(workDir: string, guestArch: "arm64" | "amd64"): Transcript {
  const command = [
    "node",
    "packages/cli/dist/cli.js",
    "boot",
    "--mount",
    `${workDir}:/mnt/proof`,
    "--",
    "/bin/sh",
    "/mnt/proof/run-vm-workload-smoke.sh",
  ];
  const env = {
    ...process.env,
    MACHINEN_ASSETS_DIR: resolve("release-assets"),
    MACHINEN_GUEST_ARCH: guestArch,
  };
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: resolve("."),
    env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 90_000,
  });
  return { command, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseRows(stdout: string): RowResult[] {
  const rows = new Map<string, RowResult>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("MACHINEN_VM_WORKLOAD_ROW ")) {
      continue;
    }
    const verifier = Object.fromEntries(
      line
        .slice("MACHINEN_VM_WORKLOAD_ROW ".length)
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => {
          const index = part.indexOf("=");
          return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
        }),
    );
    const id = verifier.id as VmWorkloadRowId;
    const rowInfo = ROWS.find((row) => row.id === id);
    if (!rowInfo) {
      continue;
    }
    const disposition = verifier.disposition === "supported" ? "supported" : "refused";
    rows.set(id, {
      id,
      proofNumber: rowInfo.proofNumber,
      disposition,
      status: "verified",
      accepted: verifier.accepted === "true",
      verifier,
      refusalCode: verifier.refusalCode,
      evidence: verifier.evidence ?? line,
    });
  }
  return ROWS.map((row) => rows.get(row.id)).filter((row): row is RowResult => row !== undefined);
}

function parseArgs(argv: string[]): {
  outDir: string;
  guestArch: "arm64" | "amd64";
  json: boolean;
} {
  let outDir = "proofs/linux-vm-workload/smoke-matrix/retained";
  let guestArch: "arm64" | "amd64" =
    process.env.MACHINEN_GUEST_ARCH === "amd64" ? "amd64" : "arm64";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--out-dir") {
      outDir = argv[++index] ?? outDir;
    } else if (arg === "--guest-arch") {
      const value = argv[++index];
      if (value !== "arm64" && value !== "amd64") {
        throw new Error("--guest-arch must be arm64 or amd64");
      }
      guestArch = value;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { outDir, guestArch, json };
}

function writeJsonArtifact(
  outDir: string,
  name: string,
  value: unknown,
): { name: string; path: string; sha256: string } {
  const path = join(outDir, name);
  writeJson(path, value);
  return artifactFor(path);
}

function copyTextArtifact(outDir: string, name: string, value: string): void {
  const path = join(outDir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function artifactFor(path: string): { name: string; path: string; sha256: string } {
  return { name: path.split("/").pop() ?? path, path, sha256: sha256File(path) };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const SIMPLE_C_SMOKE_C = `#include <stdio.h>\n#include <unistd.h>\nint main(void) { printf("C_SMOKE_OK pid=%ld\\n", (long)getpid()); return 0; }\n`;

const SECCOMP_SMOKE_C = `#include <errno.h>\n#include <linux/filter.h>\n#include <linux/seccomp.h>\n#include <stddef.h>\n#include <stdio.h>\n#include <sys/prctl.h>\n#include <sys/syscall.h>\n#include <unistd.h>\nint main(void) {\n  struct sock_filter filter[] = {\n    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (unsigned int)offsetof(struct seccomp_data, nr)),\n    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_getpid, 0, 1),\n    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | 1),\n    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),\n  };\n  struct sock_fprog prog = { .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter };\n  int nnp = prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);\n  int install = prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog);\n  errno = 0;\n  long blocked = syscall(SYS_getpid);\n  printf("SECCOMP_SMOKE nnp=%d install=%d getpid=%ld errno=%d\\n", nnp, install, blocked, errno);\n  return (nnp == 0 && install == 0 && blocked == -1 && errno == 1) ? 0 : 1;\n}\n`;

const EBPF_SMOKE_C = `#include <errno.h>\n#include <linux/bpf.h>\n#include <stdio.h>\n#include <string.h>\n#include <sys/syscall.h>\n#include <unistd.h>\nint main(void) {\n  union bpf_attr attr;\n  memset(&attr, 0, sizeof(attr));\n  attr.map_type = BPF_MAP_TYPE_ARRAY;\n  attr.key_size = 4;\n  attr.value_size = 4;\n  attr.max_entries = 1;\n  errno = 0;\n  long fd = syscall(__NR_bpf, BPF_MAP_CREATE, &attr, sizeof(attr));\n  printf("EBPF_SMOKE fd=%ld errno=%d\\n", fd, errno);\n  if (fd >= 0) { close((int)fd); return 0; }\n  return errno == EPERM ? 77 : 1;\n}\n`;

const RUN_SCRIPT = `#!/bin/sh\nset +e\nrow() { printf 'MACHINEN_VM_WORKLOAD_ROW %s\\n' "$*"; }\nif command -v sqlite3 >/dev/null 2>&1; then\n  db=/tmp/machinen-sqlite-smoke.db\n  sqlite3 "$db" 'create table t(id integer primary key, name text); insert into t(name) values ("alpha"),("beta");' >/tmp/sqlite.out 2>/tmp/sqlite.err\n  got=$(sqlite3 "$db" 'select count(*) from t;' 2>>/tmp/sqlite.err)\n  if [ "$got" = "2" ]; then row 'id=vm-sqlite-database-smoke disposition=supported accepted=true evidence=sqlite-count-2'; else row 'id=vm-sqlite-database-smoke disposition=refused accepted=false refusalCode=vm-workload-sqlite-verifier-failed evidence=sqlite-count-mismatch'; fi\nelse\n  row 'id=vm-sqlite-database-smoke disposition=refused accepted=true refusalCode=vm-workload-tool-missing tool=sqlite3 evidence=sqlite3-not-installed-in-guest'\nfi\nif command -v psql >/dev/null 2>&1 && command -v postgres >/dev/null 2>&1; then\n  row 'id=vm-postgresql-database-smoke disposition=supported accepted=false evidence=postgres-tools-present-but-no-server-proof-runner-yet'\nelse\n  row 'id=vm-postgresql-database-smoke disposition=refused accepted=true refusalCode=vm-workload-tool-missing tool=postgresql evidence=postgresql-tools-not-installed-in-guest'\nfi\n/mnt/proof/simple-c-smoke >/tmp/c.out 2>/tmp/c.err\nif grep -q C_SMOKE_OK /tmp/c.out; then row 'id=vm-simple-c-process-smoke disposition=supported accepted=true evidence=target-native-static-c-binary-executed'; else row 'id=vm-simple-c-process-smoke disposition=refused accepted=false refusalCode=vm-workload-c-smoke-failed evidence=c-binary-did-not-run'; fi\nif command -v java >/dev/null 2>&1; then\n  row 'id=vm-simple-java-process-smoke disposition=supported accepted=false evidence=java-runtime-present-but-no-retained-java-source-yet'\nelse\n  row 'id=vm-simple-java-process-smoke disposition=refused accepted=true refusalCode=vm-workload-tool-missing tool=java evidence=java-runtime-not-installed-in-guest'\nfi\n/mnt/proof/ebpf-smoke >/tmp/ebpf.out 2>/tmp/ebpf.err; ebpf_status=$?\nif [ "$ebpf_status" = "0" ]; then row 'id=vm-ebpf-capability-smoke disposition=supported accepted=true evidence=bpf-map-create-succeeded'; elif [ "$ebpf_status" = "77" ]; then row 'id=vm-ebpf-capability-smoke disposition=refused accepted=true refusalCode=vm-workload-ebpf-insufficient-privileges evidence=bpf-map-create-eperm'; else row 'id=vm-ebpf-capability-smoke disposition=refused accepted=false refusalCode=vm-workload-ebpf-probe-failed evidence=bpf-map-create-unexpected'; fi\n/mnt/proof/seccomp-smoke >/tmp/seccomp.out 2>/tmp/seccomp.err\nif grep -q 'SECCOMP_SMOKE nnp=0 install=0 getpid=-1 errno=1' /tmp/seccomp.out; then row 'id=vm-seccomp-capability-smoke disposition=supported accepted=true evidence=seccomp-filter-blocked-getpid-with-eperm'; else row 'id=vm-seccomp-capability-smoke disposition=refused accepted=false refusalCode=vm-workload-seccomp-probe-failed evidence=seccomp-filter-did-not-block'; fi\nif [ -e /dev/kvm ]; then row 'id=vm-nested-virtualization-smoke disposition=supported accepted=true evidence=/dev/kvm-present'; else row 'id=vm-nested-virtualization-smoke disposition=refused accepted=true refusalCode=vm-workload-nested-virtualization-unavailable evidence=/dev/kvm-missing'; fi\nexit 0\n`;

main();
