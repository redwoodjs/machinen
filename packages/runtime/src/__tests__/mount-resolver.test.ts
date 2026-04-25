// Path-containment tests for `--mount-live` (#78).
//
// Containment is the only thing standing between a compromised guest
// and the host filesystem, so the resolver gets exercised *before* any
// transport code lands. Everything else in the live-share stack routes
// through `resolveUnderRoot`; if these tests pass, the escape surface
// is no wider than what NFS/virtio-fs hosts already accept.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MountError, isMachinenError } from "../errors.ts";
import { resolveUnderRoot } from "../mount-resolver.ts";

// Every test gets a fresh two-directory layout:
//
//   <scratch>/
//     root/        <- the mount root
//       file.txt
//       subdir/
//         nested.txt
//       link-to-subdir -> subdir         (safe inner symlink)
//       link-to-outside -> <scratch>/outside   (escape)
//       link-to-self-dir -> ..           (escape via `..`)
//       link-chain -> link-to-outside    (chained escape)
//     outside/
//       secret.txt

let scratch: string;
let root: string;
let outside: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "machinen-mount-resolver-"));
  root = join(scratch, "root");
  outside = join(scratch, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(root, "file.txt"), "inside");
  mkdirSync(join(root, "subdir"));
  writeFileSync(join(root, "subdir/nested.txt"), "nested");
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync("subdir", join(root, "link-to-subdir"));
  symlinkSync(outside, join(root, "link-to-outside"));
  symlinkSync("..", join(root, "link-to-self-dir"));
  symlinkSync("link-to-outside", join(root, "link-chain"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function expectEscape(p: Promise<unknown>): Promise<void> {
  return expect(p).rejects.toSatisfy(
    (err) => isMachinenError(err, "MOUNT_PATH_ESCAPE") && err instanceof MountError,
  );
}

function expectInvalid(p: Promise<unknown>): Promise<void> {
  return expect(p).rejects.toSatisfy(
    (err) => isMachinenError(err, "MOUNT_PATH_INVALID") && err instanceof MountError,
  );
}

describe("resolveUnderRoot — well-formed paths", () => {
  it("empty string resolves to the root itself", async () => {
    expect(await resolveUnderRoot(root, "")).toBe(realpathSync(root));
  });

  it("'/' resolves to the root itself (FUSE paths are mount-rooted)", async () => {
    expect(await resolveUnderRoot(root, "/")).toBe(realpathSync(root));
  });

  it("'//' (repeated leading slashes) resolves to the root", async () => {
    expect(await resolveUnderRoot(root, "//")).toBe(realpathSync(root));
  });

  it("plain file under root", async () => {
    expect(await resolveUnderRoot(root, "file.txt")).toBe(join(realpathSync(root), "file.txt"));
  });

  it("nested file with absolute-looking prefix", async () => {
    expect(await resolveUnderRoot(root, "/subdir/nested.txt")).toBe(
      join(realpathSync(root), "subdir/nested.txt"),
    );
  });

  it("`.` components are normalized", async () => {
    expect(await resolveUnderRoot(root, "./subdir/./nested.txt")).toBe(
      join(realpathSync(root), "subdir/nested.txt"),
    );
  });

  it("`..` that stays inside root is allowed", async () => {
    expect(await resolveUnderRoot(root, "subdir/../file.txt")).toBe(
      join(realpathSync(root), "file.txt"),
    );
  });

  it("repeated slashes collapse", async () => {
    expect(await resolveUnderRoot(root, "subdir//nested.txt")).toBe(
      join(realpathSync(root), "subdir/nested.txt"),
    );
  });

  it("unicode filenames pass through unchanged", async () => {
    writeFileSync(join(root, "café.txt"), "x");
    expect(await resolveUnderRoot(root, "café.txt")).toBe(join(realpathSync(root), "café.txt"));
  });

  it("symlink pointing inside root is followed to its target", async () => {
    expect(await resolveUnderRoot(root, "link-to-subdir/nested.txt")).toBe(
      join(realpathSync(root), "subdir/nested.txt"),
    );
  });
});

describe("resolveUnderRoot — escape attempts", () => {
  it("`..` that exits root", async () => {
    await expectEscape(resolveUnderRoot(root, "../outside/secret.txt"));
  });

  it("`..` chain that exits root", async () => {
    await expectEscape(resolveUnderRoot(root, "subdir/../../outside/secret.txt"));
  });

  it("deep `..` chain that exits root", async () => {
    await expectEscape(resolveUnderRoot(root, "a/b/c/../../../../outside/secret.txt"));
  });

  it("absolute-looking guest path that escapes via `..`", async () => {
    await expectEscape(resolveUnderRoot(root, "/../outside/secret.txt"));
  });

  it("symlink inside root pointing at an outside directory", async () => {
    await expectEscape(resolveUnderRoot(root, "link-to-outside/secret.txt"));
  });

  it("chained symlinks that eventually exit root", async () => {
    await expectEscape(resolveUnderRoot(root, "link-chain/secret.txt"));
  });

  it("symlink whose target is `..` (resolving to scratch, outside root)", async () => {
    await expectEscape(resolveUnderRoot(root, "link-to-self-dir/outside/secret.txt"));
  });

  it("sibling directory whose name shares the root's prefix", async () => {
    // /tmp/xxx/root vs /tmp/xxx/root-evil — must not pass the prefix
    // check just because `root-evil` starts with `root`.
    const evil = `${root}-evil`;
    mkdirSync(evil);
    writeFileSync(join(evil, "secret.txt"), "gotcha");
    symlinkSync(evil, join(root, "sneaky"));
    try {
      await expectEscape(resolveUnderRoot(root, "sneaky/secret.txt"));
    } finally {
      rmSync(evil, { recursive: true, force: true });
    }
  });
});

describe("resolveUnderRoot — malformed input", () => {
  it("rejects null bytes in the guest path", async () => {
    await expectInvalid(resolveUnderRoot(root, "foo\0bar"));
  });

  it("rejects a non-absolute mount root", async () => {
    await expectInvalid(resolveUnderRoot("relative/root", "file.txt"));
  });

  it("ENOENT is propagated when `mustExist` is true (default)", async () => {
    await expect(resolveUnderRoot(root, "missing.txt")).rejects.toSatisfy(
      (err) => (err as NodeJS.ErrnoException).code === "ENOENT",
    );
  });
});

describe("resolveUnderRoot — create/write mode (mustExist: false)", () => {
  it("returns a path beneath root when the target doesn't exist yet", async () => {
    const out = await resolveUnderRoot(root, "subdir/new-file.txt", { mustExist: false });
    expect(out).toBe(join(realpathSync(root), "subdir/new-file.txt"));
  });

  it("rejects creating through a symlink that escapes", async () => {
    await expectEscape(
      resolveUnderRoot(root, "link-to-outside/new-secret.txt", { mustExist: false }),
    );
  });

  it("rejects creating a sibling outside root via `..`", async () => {
    await expectEscape(resolveUnderRoot(root, "../outside/new-secret.txt", { mustExist: false }));
  });

  it("propagates ENOENT when the parent directory doesn't exist", async () => {
    await expect(
      resolveUnderRoot(root, "no-such-dir/new-file.txt", { mustExist: false }),
    ).rejects.toSatisfy((err) => (err as NodeJS.ErrnoException).code === "ENOENT");
  });

  it("still returns the root itself if asked for an existing root with mustExist=false", async () => {
    expect(await resolveUnderRoot(root, "", { mustExist: false })).toBe(realpathSync(root));
  });
});

describe("resolveUnderRoot — root itself is a symlink", () => {
  it("resolves the root symlink once and confines relative to the real target", async () => {
    const realRoot = join(scratch, "real-root");
    const linkedRoot = join(scratch, "linked-root");
    mkdirSync(realRoot);
    writeFileSync(join(realRoot, "inside.txt"), "ok");
    symlinkSync(realRoot, linkedRoot);
    // Using the symlink as the mount root still contains correctly.
    expect(await resolveUnderRoot(linkedRoot, "inside.txt")).toBe(
      join(realpathSync(linkedRoot), "inside.txt"),
    );
    await expectEscape(resolveUnderRoot(linkedRoot, "../outside/secret.txt"));
  });
});
