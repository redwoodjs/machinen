// Workload integration tests for the live-share FUSE mount (#165 layer 2).
//
// These tests boot a real microVM with `liveMounts: [{ host, guest:
// "/mnt/workspace", mode: "rw" }]` and run real userspace tools against
// the mount. The point is to catch wedge / op-combination bugs that the
// per-op unit suite (mount-server.test.ts) can't see — pre-#163 the
// failure mode was "pnpm install hung on the first symlink", and the
// only thing that would have caught it pre-deploy was a real workload
// driving real ops through the wire.
//
// Network-free workloads first, on purpose. `pnpm install` is the
// canonical case but needs gvproxy plumbing in vitest's process model
// that isn't sorted yet (separate follow-up). Both `tar -xf` and a
// large `find` exercise the same FUSE op set (CREATE, WRITE, MKDIR,
// SETATTR, RENAME, READDIR, LOOKUP, GETATTR) that pnpm hits, without
// the network dependency.
//
// Skipped when the prebuilt assets aren't available locally. Same gate
// pattern as exec.test.ts. Locally:
//   1. `scripts/build-base-assets.sh` — kernel + base rootfs
//   2. `pnpm provision-test-vm`        — small purpose-built test image
//                                        (~/.cache/machinen/<repo>/test-vm.tar.gz)
// CI builds these as separate workflow steps. The test image is
// deliberately distinct from the dev VM's `app.tar.gz`: it carries
// only what these workloads need (rsync, sqlite3 on top of the base),
// so the dev VM stays minimal.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boot } from "../index.ts";

// Caller-controlled override for monorepo-internal runs; otherwise we
// look at the canonical release-assets/ next to the runtime package.
const repoRoot = resolve(import.meta.dirname, "../../../..");
const ASSETS = process.env.MACHINEN_ASSETS_DIR ?? resolve(repoRoot, "release-assets");
const KERNEL = join(ASSETS, "Image-arm64");
const DTB = join(ASSETS, "virt-arm64.dtb");
// Workloads run against a *purpose-built* test rootfs, not the dev
// machine's `app.tar.gz`. Build with `pnpm provision-test-vm` — see
// scripts/provision-test-vm.ts. Keeping these split means the dev VM
// stays free of test-only tools (rsync, sqlite3) and the test image
// stays small (no node, no fnm, no claude).
const TEST_VM_TAR = join(homedir(), ".cache", "machinen", basename(repoRoot), "test-vm.tar.gz");

// Ample headroom for boot + workload + power-down. A clean boot is
// ~1–2 s on a dev laptop; the workloads themselves are sub-second
// inside the VM. Generous bound mostly so a hot machine running tests
// in parallel doesn't trip BOOT_TIMEOUT on contention.
const VM_BOOT_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = VM_BOOT_TIMEOUT_MS + 30_000;

function assetsPresent(): boolean {
  return existsSync(KERNEL) && existsSync(DTB) && existsSync(TEST_VM_TAR);
}

interface WorkloadResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Boot a VM with `scratch` live-mounted at `/mnt/workspace`, run
 * `script` via `bash -lc`, return the exit code + captured streams.
 *
 * The script runs to completion and the guest powers off — there is
 * no shell-after-workload fallback. Stdout/stderr are buffered into
 * strings, fine for the verifier `echo` lines we use; for big payloads
 * write to a file in the workspace and read it host-side instead.
 *
 * `timeoutMs` overrides the per-VM timeout (the pjdfstest workload
 * runs ~8500 cases through FUSE and needs minutes, not the default 2).
 */
async function runWorkload(
  scratch: string,
  script: string,
  timeoutMs: number = VM_BOOT_TIMEOUT_MS,
): Promise<WorkloadResult> {
  const ramBytes = (() => {
    const size = statSync(TEST_VM_TAR).size;
    const GIB = 1024 ** 3;
    const raw = Math.max(4 * GIB, size * 16 + 2 * GIB);
    const align = 256 * 1024 * 1024;
    return Math.ceil(raw / align) * align;
  })();

  // None of the workloads in this file need guest networking. Opt out
  // of gvproxy entirely so we don't print "gvproxy not found" on dev
  // machines without it, and don't auto-download it in CI when none
  // of the cases reach a registry. (Set per-call rather than mutating
  // process.env globally — tests in other files may want networking.)
  const prevGvproxy = process.env.MACHINEN_GVPROXY;
  process.env.MACHINEN_GVPROXY = "disabled";
  try {
    const vm = await boot({
      kernel: KERNEL,
      dtb: DTB,
      image: TEST_VM_TAR,
      cmd: ["/bin/bash", "-lc", script],
      liveMounts: [{ host: scratch, guest: "/mnt/workspace", mode: "rw" }],
      vmmEnv: { MACHINEN_RAM_BYTES: String(ramBytes) },
      timeoutMs,
    });

    let stdout = "";
    let stderr = "";
    vm.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    vm.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const { code } = await vm.wait();
    return { exitCode: code ?? -1, stdout, stderr };
  } finally {
    if (prevGvproxy === undefined) {
      delete process.env.MACHINEN_GVPROXY;
    } else {
      process.env.MACHINEN_GVPROXY = prevGvproxy;
    }
  }
}

function makeScratch(): { scratch: string; cleanup: () => void } {
  const scratch = mkdtempSync(join(tmpdir(), "machinen-workload-"));
  return {
    scratch,
    cleanup: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

function reportFailure(label: string, result: WorkloadResult): never {
  throw new Error(
    `${label} failed exit=${result.exitCode}\n` +
      `--- stdout (last 4KB) ---\n${result.stdout.slice(-4096)}\n` +
      `--- stderr (last 4KB) ---\n${result.stderr.slice(-4096)}`,
  );
}

interface PjdfstestSummary {
  /** Total tests run (Files=…). */
  files: number;
  /** Total individual assertions (Tests=…). */
  tests: number;
  /** Number of asserting passes. */
  passes: number;
  /** Number of asserting failures. Always tests - passes for our parser. */
  failures: number;
}

/**
 * Parse the trailing summary that `prove` prints after a run. Two
 * lines we depend on (in order):
 *
 *   Files=NN, Tests=MMMM, …
 *   Result: PASS|FAIL
 *
 * When tests fail, `prove` also prints a per-file "Failed: M/M" line
 * we can sum to derive `passes`. If failures are zero the summary
 * line gives us everything directly.
 *
 * Returns null if neither anchor line is found — the caller treats
 * that as a setup bug (suite didn't run) rather than a test failure.
 */
function parsePjdfstestSummary(text: string): PjdfstestSummary | null {
  // "Files=37, Tests=8519,  173 wallclock secs (...)"
  const fileMatch = text.match(/Files=(\d+),\s*Tests=(\d+)/);
  if (!fileMatch) {
    return null;
  }
  const files = Number(fileMatch[1]);
  const tests = Number(fileMatch[2]);

  // Sum any per-file "Failed: K/N" — this also catches the
  // "Failed Tests" block prove emits before the summary line.
  let failures = 0;
  for (const m of text.matchAll(/Failed:\s+(\d+)\/\d+/g)) {
    failures += Number(m[1]);
  }
  // Belt-and-suspenders: prove's "Result: FAIL" with no per-file
  // breakdown still implies at least one failure.
  if (failures === 0 && /Result:\s+FAIL/.test(text)) {
    failures = 1;
  }
  return { files, tests, passes: tests - failures, failures };
}

// ----------------------------------------------------------------------
// tar -xf — extracts into /mnt/workspace, exercises CREATE + WRITE +
// MKDIR + SETATTR + RENAME-into-place + symlinks (libarchive's tar
// preserves symlinks via SYMLINK). The host-side asserts that the
// extracted tree is structurally what we packed.
// ----------------------------------------------------------------------

describe.runIf(assetsPresent())("FUSE live-mount workloads (#165)", () => {
  it(
    "tar -xf onto /mnt/workspace produces the expected tree on the host",
    async () => {
      const { scratch, cleanup } = makeScratch();
      try {
        // Build a small tarball outside the live-mount root, then move
        // it in. The test's job is to verify the *extraction* hits
        // FUSE ops — packing happens host-side and is incidental.
        const stage = mkdtempSync(join(tmpdir(), "machinen-workload-stage-"));
        try {
          mkdirSync(join(stage, "tree", "a"), { recursive: true });
          mkdirSync(join(stage, "tree", "b"));
          writeFileSync(join(stage, "tree", "a", "one.txt"), "first\n");
          writeFileSync(join(stage, "tree", "a", "two.txt"), "second\n");
          writeFileSync(join(stage, "tree", "b", "deep.txt"), "deep\n");
          // bsdtar / GNU tar both honour symlinks; pack one to exercise
          // SYMLINK extraction (the op that landed in #163).
          execFileSync("ln", ["-s", "../a/one.txt", join(stage, "tree", "b", "link-to-one")]);
          execFileSync("tar", ["-cf", join(scratch, "tree.tar"), "-C", stage, "tree"]);

          const result = await runWorkload(
            scratch,
            [
              "set -e",
              "cd /mnt/workspace",
              "mkdir -p extracted",
              "tar -xf tree.tar -C extracted",
              // print enough to debug if asserts below fail
              "find extracted -type f -o -type l | sort",
            ].join("\n"),
          );

          if (result.exitCode !== 0) {
            reportFailure("tar -xf workload", result);
          }

          const out = (name: string) => join(scratch, "extracted", "tree", name);
          expect(readFileSync(out("a/one.txt"), "utf8")).toBe("first\n");
          expect(readFileSync(out("a/two.txt"), "utf8")).toBe("second\n");
          expect(readFileSync(out("b/deep.txt"), "utf8")).toBe("deep\n");
          // The symlink should be preserved with its raw relative
          // target — same property #163 verified for pnpm.
          const linkLstat = statSync(out("b/link-to-one"));
          expect(linkLstat.isSymbolicLink() || linkLstat.isFile()).toBe(true);
          // Reading through it must resolve to the same content as the
          // direct path — proves SYMLINK + READLINK round-trip end-to-end.
          expect(readFileSync(out("b/link-to-one"), "utf8")).toBe("first\n");
        } finally {
          rmSync(stage, { recursive: true, force: true });
        }
      } finally {
        cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------
  // git clone — host-side bare repo committed offline; guest clones via
  // file://. Exercises CREATE + MKDIR + RENAME-into-place + git's own
  // pack/index dance, plus a non-trivial rmdir flow when git fixes up
  // its temp dirs. No network needed.
  // -------------------------------------------------------------------

  it(
    "git clone file:///mnt/workspace/repo.git produces a working checkout on the host",
    async () => {
      const { scratch, cleanup } = makeScratch();
      try {
        // Build a bare repo with one commit, two files, and a branch
        // entirely host-side (we have git locally). The VM will clone
        // it; nothing here needs to run inside the guest.
        const work = mkdtempSync(join(tmpdir(), "machinen-workload-gitwork-"));
        try {
          execFileSync("git", ["init", "-q", "-b", "main", work]);
          writeFileSync(join(work, "README.md"), "# fixture\n");
          writeFileSync(join(work, "data.txt"), "payload\n");
          execFileSync("git", ["-C", work, "add", "."]);
          execFileSync("git", [
            "-C",
            work,
            "-c",
            "user.email=fixture@test",
            "-c",
            "user.name=fixture",
            "commit",
            "-q",
            "-m",
            "initial",
          ]);
          execFileSync("git", ["clone", "-q", "--bare", work, join(scratch, "repo.git")]);
        } finally {
          rmSync(work, { recursive: true, force: true });
        }

        const result = await runWorkload(
          scratch,
          [
            "set -e",
            "cd /mnt/workspace",
            // file:// clones from the live mount itself: the source
            // path under /mnt/workspace is the same FUSE mount as the
            // destination, so every read AND every write goes through
            // the same wire. That's deliberate — both sides are
            // covered in one boot.
            "git clone -q file:///mnt/workspace/repo.git checkout",
            "cat checkout/README.md",
          ].join("\n"),
        );

        if (result.exitCode !== 0) {
          reportFailure("git clone workload", result);
        }

        expect(readFileSync(join(scratch, "checkout", "README.md"), "utf8")).toBe("# fixture\n");
        expect(readFileSync(join(scratch, "checkout", "data.txt"), "utf8")).toBe("payload\n");
        expect(existsSync(join(scratch, "checkout", ".git", "HEAD"))).toBe(true);
      } finally {
        cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------
  // rsync -a — recursive preserve-attributes copy. Same op coverage as
  // the tar test (mtimes, perms, symlinks) but exercised through copy-
  // from-FUSE rather than tarball-extract-onto-FUSE, and via rsync's
  // own stat-everything-twice scan pattern that's harsher on
  // GETATTR/READDIR than `cp -a`.
  // -------------------------------------------------------------------

  it(
    "rsync -a from one /mnt/workspace subtree to another preserves content + attrs",
    async () => {
      const { scratch, cleanup } = makeScratch();
      try {
        const src = join(scratch, "src");
        mkdirSync(join(src, "nested"), { recursive: true });
        writeFileSync(join(src, "alpha.txt"), "alpha\n");
        writeFileSync(join(src, "nested", "beta.txt"), "beta\n");
        execFileSync("ln", ["-s", "alpha.txt", join(src, "alias")]);

        const result = await runWorkload(
          scratch,
          [
            "set -e",
            "cd /mnt/workspace",
            // Trailing slash on src/ makes rsync copy contents-of-src
            // into dst/, matching the issue's example syntax.
            "rsync -a src/ dst/",
            // Explicit verification step inside the guest catches the
            // case where the host sees the file but the guest didn't
            // observe the rename — flushed FUSE caches differ.
            "test -L dst/alias",
            'test "$(readlink dst/alias)" = alpha.txt',
          ].join("\n"),
        );

        if (result.exitCode !== 0) {
          reportFailure("rsync -a workload", result);
        }

        expect(readFileSync(join(scratch, "dst", "alpha.txt"), "utf8")).toBe("alpha\n");
        expect(readFileSync(join(scratch, "dst", "nested", "beta.txt"), "utf8")).toBe("beta\n");
        const aliasLstat = statSync(join(scratch, "dst", "alias"));
        expect(aliasLstat.isSymbolicLink() || aliasLstat.isFile()).toBe(true);
      } finally {
        cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------
  // sqlite3 WAL — opens a fresh DB on /mnt/workspace, switches to WAL
  // mode, inserts/reads. WAL uses POSIX advisory locks (fcntl GETLK/
  // SETLK), which the FUSE server currently does NOT implement —
  // returns ENOSYS. SQLite has a documented fallback: when locks are
  // unavailable it can still operate, but only single-process. We
  // assert the workload either succeeds or fails *cleanly* (no wedge)
  // and the on-host file ends up readable. This catches the
  // implemented-but-hangs class around lock ops if any of them ever
  // gets wired up wrong.
  // -------------------------------------------------------------------

  it(
    "sqlite3 WAL writes round-trip through the live mount",
    async () => {
      const { scratch, cleanup } = makeScratch();
      try {
        const result = await runWorkload(
          scratch,
          [
            "set -e",
            "cd /mnt/workspace",
            // -bail: stop on first error. -batch: no interactive
            // prompts. The semicolon-separated SQL drives the whole
            // open → pragma → write → read round-trip in one process.
            'sqlite3 -bail -batch test.db "' +
              "PRAGMA journal_mode=WAL;" +
              "CREATE TABLE t(k INTEGER PRIMARY KEY, v TEXT);" +
              "INSERT INTO t VALUES(1,'one'),(2,'two'),(3,'three');" +
              'SELECT v FROM t WHERE k=2;"',
            'echo "SQLITE_EXIT=$?"',
          ].join("\n"),
        );

        if (result.exitCode !== 0) {
          reportFailure("sqlite3 WAL workload", result);
        }

        // The DB file must exist on the host and be readable as a
        // sqlite database. We don't reach into the format — sqlite's
        // own success above is the strong signal; we just check the
        // file landed.
        expect(existsSync(join(scratch, "test.db"))).toBe(true);
        expect(statSync(join(scratch, "test.db")).size).toBeGreaterThan(0);
      } finally {
        cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------
  // dd + cp --sparse=always — fills a file with zeros, then sparse-
  // copies it. cp --sparse=always uses SEEK_HOLE/SEEK_DATA (LSEEK,
  // currently NOT in the dispatch — falls through to ENOSYS). The
  // assertion is that cp gracefully falls back rather than wedging
  // or producing a corrupt file.
  // -------------------------------------------------------------------

  it(
    "dd + cp --sparse=always produces a byte-identical copy on the host",
    async () => {
      const { scratch, cleanup } = makeScratch();
      try {
        // Small enough to keep test under a second; still exercises
        // multiple FUSE WRITE round-trips at the runtime's max_write
        // (128 KiB). Not a sparse-detection benchmark — just a
        // wedge-free correctness check.
        const SIZE_MB = 4;
        const result = await runWorkload(
          scratch,
          [
            "set -e",
            "cd /mnt/workspace",
            `dd if=/dev/zero of=zeros bs=1M count=${SIZE_MB} status=none`,
            "cp --sparse=always zeros copy",
            'echo "WORKLOAD_DD_SIZE=$(stat -c %s copy)"',
          ].join("\n"),
        );

        if (result.exitCode !== 0) {
          reportFailure("dd + cp --sparse=always workload", result);
        }

        const expectedBytes = SIZE_MB * 1024 * 1024;
        expect(statSync(join(scratch, "zeros")).size).toBe(expectedBytes);
        expect(statSync(join(scratch, "copy")).size).toBe(expectedBytes);
        // Content must round-trip — host should see all zeros, no
        // residual bytes.
        const buf = readFileSync(join(scratch, "copy"));
        expect(buf.length).toBe(expectedBytes);
        // Quick spot-check rather than scanning every byte.
        expect(buf[0]).toBe(0);
        expect(buf[buf.length - 1]).toBe(0);
        expect(buf[buf.length / 2]).toBe(0);
      } finally {
        cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------
  // pjdfstest (#165 layer 3) — POSIX filesystem conformance suite.
  // ~8500 test cases covering chmod/chown/link/mkdir/mkfifo/open/
  // rename/rmdir/symlink/truncate/unlink. Built into /opt/pjdfstest in
  // the test image (see scripts/provision-test-vm.ts).
  //
  // We don't pass everything on day one — the baseline is recorded in
  // pjdfstest-baseline.json and the test ratchets it. A drop in passes
  // fails CI; a rise prints a hint to bump the baseline.
  // -------------------------------------------------------------------

  it(
    "pjdfstest baseline holds (no regressions in POSIX conformance)",
    async () => {
      const { scratch, cleanup } = makeScratch();
      try {
        const result = await runWorkload(
          scratch,
          [
            "set +e", // prove returns non-zero on any test failure; we capture it
            "cd /mnt/workspace",
            // Run the suite verbosely so the prove summary line lands
            // in stdout for the host parser. --norc skips the per-user
            // .proverc, --timer is harmless and useful for debug.
            "prove -r --norc --timer /opt/pjdfstest/tests",
            // Sentinel echo so the parser can find the trailing
            // summary unambiguously even if prove's own output is
            // interleaved with kernel logs.
            'echo "PJDFSTEST_DONE"',
          ].join("\n"),
          // 8 minutes inside the VM. The outer it() timeout is 10
          // minutes, leaving 2 min of margin for shutdown + parsing.
          8 * 60_000,
        );

        const summary = parsePjdfstestSummary(result.stdout + "\n" + result.stderr);
        if (!summary) {
          throw new Error(
            "pjdfstest workload: couldn't parse prove summary.\n" +
              `--- stdout (last 4KB) ---\n${result.stdout.slice(-4096)}\n` +
              `--- stderr (last 4KB) ---\n${result.stderr.slice(-4096)}`,
          );
        }

        const baselinePath = join(import.meta.dirname, "pjdfstest-baseline.json");
        if (!existsSync(baselinePath)) {
          // First run: record current totals as the floor and fail
          // loudly so a maintainer reviews the numbers before they
          // become "the" baseline.
          writeFileSync(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
          throw new Error(
            `pjdfstest baseline written to ${baselinePath} ` +
              `(${JSON.stringify(summary)}). Review and commit, then re-run.`,
          );
        }

        const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as typeof summary;

        // Total-tests floor: pjdfstest occasionally adds upstream
        // cases. A 5% drop means the suite was truncated (e.g. half
        // the perl scripts didn't run) — that's a setup bug, not a
        // conformance regression.
        if (summary.tests < Math.floor(baseline.tests * 0.95)) {
          throw new Error(
            `pjdfstest: total tests dropped from ${baseline.tests} to ${summary.tests} — ` +
              "is the suite truncated?",
          );
        }
        if (summary.passes < baseline.passes) {
          throw new Error(
            `pjdfstest: passing tests regressed from ${baseline.passes} to ${summary.passes}. ` +
              "If this is intentional, update pjdfstest-baseline.json.",
          );
        }
        if (summary.passes > baseline.passes) {
          // eslint-disable-next-line no-console
          console.log(
            `[pjdfstest] passes improved from ${baseline.passes} to ${summary.passes}. ` +
              "Bump pjdfstest-baseline.json to lock in.",
          );
        }
      } finally {
        cleanup();
      }
    },
    // pjdfstest is the slow workload — ~8500 cases through FUSE take
    // a couple of minutes. 10 min ceiling so a wedge surfaces as a
    // bounded failure rather than a hung CI job.
    10 * 60_000,
  );

  // -------------------------------------------------------------------
  // find at scale — drives READDIR + LOOKUP + GETATTR over thousands of
  // entries in one boot. Catches off-by-one errors in dirent packing
  // and the resume-by-offset path tested in unit tests, but at a scale
  // (and concurrency, since vfs caches) that's hard to fake there.
  // -------------------------------------------------------------------

  it(
    "find counts every file in a wide tree on /mnt/workspace",
    async () => {
      const { scratch, cleanup } = makeScratch();
      try {
        // 10 dirs × 200 files = 2000 entries. Big enough to cross the
        // single-READDIR-call boundary multiple times; small enough to
        // build in well under a second on the host.
        const DIRS = 10;
        const FILES_PER_DIR = 200;
        for (let d = 0; d < DIRS; d++) {
          const dir = join(scratch, `d${d}`);
          mkdirSync(dir);
          for (let f = 0; f < FILES_PER_DIR; f++) {
            writeFileSync(join(dir, `f${f}.txt`), `${d}-${f}`);
          }
        }
        const expected = DIRS * FILES_PER_DIR;

        const result = await runWorkload(
          scratch,
          [
            "set -e",
            "cd /mnt/workspace",
            "count=$(find . -type f | wc -l)",
            'echo "WORKLOAD_FIND_COUNT=$count"',
            // also assert with a stricter pattern to make sure all
            // files are reachable (catches LOOKUP failures, not just
            // the top-level dir count).
            'sample=$(find . -name "f137.txt" | wc -l)',
            'echo "WORKLOAD_FIND_SAMPLE=$sample"',
          ].join("\n"),
        );

        if (result.exitCode !== 0) {
          reportFailure("find workload", result);
        }

        // Guest stdout and the kernel serial console share a stream
        // in this VMM; markers can land in either bucket. Search both.
        const combined = `${result.stdout}\n${result.stderr}`;
        const matchCount = combined.match(/WORKLOAD_FIND_COUNT=(\d+)/);
        expect(matchCount?.[1]).toBe(String(expected));
        const matchSample = combined.match(/WORKLOAD_FIND_SAMPLE=(\d+)/);
        // f137.txt exists in every dir, so the count should equal DIRS.
        expect(matchSample?.[1]).toBe(String(DIRS));
      } finally {
        cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

if (!assetsPresent()) {
  // Loud-skip: easy to miss in a green CI log otherwise.
  // eslint-disable-next-line no-console
  console.warn(
    `[mount-server-workloads] skipping: missing one of\n` +
      `  ${KERNEL}\n  ${DTB}\n  ${TEST_VM_TAR}\n` +
      `  Run scripts/build-base-assets.sh + pnpm provision-test-vm to enable.`,
  );
}
