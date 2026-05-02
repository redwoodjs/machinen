// Disable gvproxy auto-install/spawn for the whole test suite.
//
// Most tests boot stub binaries (`/bin/cat`, `/usr/bin/true`, fixture
// VMMs) and don't need a real user-mode network stack. Auto-spawning
// gvproxy — and more importantly auto-downloading it on a fresh host —
// costs seconds of test wall-clock and is just noise. Any test that
// actually wants gvproxy can `delete process.env.MACHINEN_GVPROXY` at
// the top of its case.
process.env.MACHINEN_GVPROXY = "disabled";

// Auto-refresh stale microVM test fixtures from release-assets/.
//
// The kernel + DTB in packages/microvm/test-fixtures/ are copies of the
// canonical artifacts the build script writes to release-assets/. There
// is no automatic resync after `pnpm provision`, so a developer who
// rebuilds release-assets but forgets to copy ends up running boot
// tests against a kernel that is days (or weeks) older than the rootfs
// userspace it has to drive. In #211 that drift kernel-panicked the
// integration tests on every run, and the failures were misread as
// pre-existing flakes. See issue #212.
import { copyFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = import.meta.dirname;
const fixturesDir = resolve(repoRoot, "packages/microvm/test-fixtures");
const releaseDir = resolve(repoRoot, "release-assets");

for (const [src, dst] of [
  ["Image-arm64", "Image"],
  ["virt-arm64.dtb", "virt.dtb"],
] as const) {
  const srcPath = resolve(releaseDir, src);
  const dstPath = resolve(fixturesDir, dst);
  if (!existsSync(srcPath)) {
    continue; // no canonical copy on this checkout — nothing to sync from
  }
  const srcMtime = statSync(srcPath).mtimeMs;
  const dstMtime = existsSync(dstPath) ? statSync(dstPath).mtimeMs : 0;
  if (srcMtime > dstMtime) {
    copyFileSync(srcPath, dstPath);
    console.error(
      `[vitest.setup] test-fixtures/${dst} was stale, refreshed from release-assets/${src}`,
    );
  }
}
