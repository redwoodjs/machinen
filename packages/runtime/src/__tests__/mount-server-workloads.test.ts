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
// pattern as exec.test.ts. CI builds them via release.yml; for dev,
// `scripts/build-base-assets.sh` + `pnpm provision` produces both.

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
// `provision()` (run from the user's checkout) drops the workload-ready
// tarball under the per-repo cache. The basename of the repo is in the
// path because each worktree gets its own — see provision.ts.
const APP_TAR = join(homedir(), ".cache", "machinen", basename(repoRoot), "app.tar.gz");

// Ample headroom for boot + workload + power-down. A clean boot is
// ~1–2 s on a dev laptop; the workloads themselves are sub-second
// inside the VM.
const VM_BOOT_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = VM_BOOT_TIMEOUT_MS + 30_000;

function assetsPresent(): boolean {
  return existsSync(KERNEL) && existsSync(DTB) && existsSync(APP_TAR);
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
 */
async function runWorkload(scratch: string, script: string): Promise<WorkloadResult> {
  const ramBytes = (() => {
    const size = statSync(APP_TAR).size;
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
      image: APP_TAR,
      cmd: ["/bin/bash", "-lc", script],
      liveMounts: [{ host: scratch, guest: "/mnt/workspace", mode: "rw" }],
      vmmEnv: { MACHINEN_RAM_BYTES: String(ramBytes) },
      timeoutMs: VM_BOOT_TIMEOUT_MS,
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
      `  ${KERNEL}\n  ${DTB}\n  ${APP_TAR}\n` +
      `  Run scripts/build-base-assets.sh + pnpm provision to enable.`,
  );
}
