import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureContainerConfig,
  tmuxAttachArgs,
  stripBindMountEntries,
  resolvePrunePaths,
  DEFAULT_PRUNE_PATHS,
} from "../docker";

// Build a minimal CRIU MntEntry protobuf with just the mountpoint field.
// Field 7 (mountpoint), wire type 2 (length-delimited string):
//   tag byte = (7 << 3) | 2 = 0x3a
function makeMntEntry(mountpoint) {
  const str = Buffer.from(mountpoint, "utf-8");
  // assume len < 128 so single-byte varint suffices
  const payload = Buffer.concat([Buffer.from([0x3a, str.length]), str]);
  const sizeBuf = Buffer.allocUnsafe(4);
  sizeBuf.writeUInt32LE(payload.length);
  return Buffer.concat([sizeBuf, payload]);
}

function writeMountpointsImg(dir, mountpoints) {
  const header = Buffer.alloc(8);
  const entries = mountpoints.map(makeMntEntry);
  fs.writeFileSync(path.join(dir, "mountpoints-000.img"), Buffer.concat([header, ...entries]));
}

function readMountpoints(dir) {
  const data = fs.readFileSync(path.join(dir, "mountpoints-000.img"));
  const results = [];
  let offset = 8; // skip header
  while (offset + 4 <= data.length) {
    const size = data.readUInt32LE(offset);
    if (size === 0 || offset + 4 + size > data.length) {
      break;
    }
    const payload = data.subarray(offset + 4, offset + 4 + size);
    // extract mountpoint: tag 0x3a, then 1-byte len, then string
    if (payload[0] === 0x3a) {
      const len = payload[1];
      results.push(payload.subarray(2, 2 + len).toString("utf-8"));
    }
    offset += 4 + size;
  }
  return results;
}

describe("captureContainerConfig", () => {
  it("extracts the right fields from docker inspect output", () => {
    const info = {
      Config: {
        Image: "ubuntu:24.04",
        Cmd: ["bash", "-c", "echo hello"],
        Env: ["PATH=/usr/bin", "HOME=/root", "MY_VAR=test"],
        WorkingDir: "/app",
        ExposedPorts: { "8080/tcp": {} },
      },
      HostConfig: {
        SecurityOpt: ["seccomp=unconfined"],
        NetworkMode: "host",
        Binds: ["/tmp:/tmp"],
        CapAdd: ["SYS_PTRACE"],
        Privileged: false,
      },
    };

    const config = captureContainerConfig(info);

    expect(config).toEqual({
      Image: "ubuntu:24.04",
      Cmd: ["bash", "-c", "echo hello"],
      Env: ["PATH=/usr/bin", "HOME=/root", "MY_VAR=test"],
      WorkingDir: "/app",
      ExposedPorts: { "8080/tcp": {} },
      SecurityOpt: ["seccomp=unconfined"],
      NetworkMode: "host",
      Binds: ["/tmp:/tmp"],
      CapAdd: ["SYS_PTRACE"],
      Privileged: false,
    });
  });

  it("handles null/undefined fields", () => {
    const info = {
      Config: {
        Image: "alpine",
        Cmd: null,
        Env: null,
        WorkingDir: "",
        ExposedPorts: null,
      },
      HostConfig: {
        SecurityOpt: null,
        NetworkMode: "bridge",
        Binds: null,
        CapAdd: null,
        Privileged: false,
      },
    };

    const config = captureContainerConfig(info);

    expect(config.Image).toBe("alpine");
    expect(config.Cmd).toBeNull();
    expect(config.Env).toBeNull();
    expect(config.NetworkMode).toBe("bridge");
    expect(config.Binds).toBeNull();
  });
});

describe("stripBindMountEntries", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-test-"));
  });

  it("strips /proc/* and /sys/* masking mounts", () => {
    writeMountpointsImg(tmpDir, ["/proc/cpuinfo", "/sys/kernel/debug", "/var/data"]);
    stripBindMountEntries(tmpDir);
    expect(readMountpoints(tmpDir)).toEqual(["/var/data"]);
  });

  it("strips /etc/hosts, /etc/hostname, /etc/resolv.conf", () => {
    writeMountpointsImg(tmpDir, ["/etc/hosts", "/etc/hostname", "/etc/resolv.conf", "/etc/passwd"]);
    stripBindMountEntries(tmpDir);
    expect(readMountpoints(tmpDir)).toEqual(["/etc/passwd"]);
  });

  it("keeps /dev and /dev/* (needed for PTY restoration)", () => {
    writeMountpointsImg(tmpDir, ["/dev", "/dev/shm", "/dev/pts", "/dev/mqueue"]);
    stripBindMountEntries(tmpDir);
    expect(readMountpoints(tmpDir)).toEqual(["/dev", "/dev/shm", "/dev/pts", "/dev/mqueue"]);
  });

  it("strips user-specified bind paths", () => {
    writeMountpointsImg(tmpDir, ["/workspace", "/cache", "/var/data"]);
    stripBindMountEntries(tmpDir, ["/workspace", "/cache"]);
    expect(readMountpoints(tmpDir)).toEqual(["/var/data"]);
  });

  it("keeps /, /proc, /sys, /dev (only their children are stripped)", () => {
    writeMountpointsImg(tmpDir, ["/", "/proc", "/sys", "/dev"]);
    stripBindMountEntries(tmpDir);
    expect(readMountpoints(tmpDir)).toEqual(["/", "/proc", "/sys", "/dev"]);
  });

  it("is a no-op when nothing matches", () => {
    writeMountpointsImg(tmpDir, ["/app", "/data"]);
    stripBindMountEntries(tmpDir);
    expect(readMountpoints(tmpDir)).toEqual(["/app", "/data"]);
  });
});

describe("tmuxAttachArgs", () => {
  it("returns docker exec args targeting the machinen session", () => {
    const args = tmuxAttachArgs("my-container");
    expect(args).toEqual([
      "exec",
      "-it",
      "my-container",
      "tmux",
      "attach-session",
      "-t",
      "machinen",
    ]);
  });

  it("inserts --user when provided", () => {
    const args = tmuxAttachArgs("my-container", { user: "vscode" });
    expect(args).toEqual([
      "exec",
      "-it",
      "--user",
      "vscode",
      "my-container",
      "tmux",
      "attach-session",
      "-t",
      "machinen",
    ]);
  });

  it("respects a custom session name", () => {
    const args = tmuxAttachArgs("my-container", { sessionName: "work" });
    expect(args).toEqual(["exec", "-it", "my-container", "tmux", "attach-session", "-t", "work"]);
  });
});

describe("resolvePrunePaths", () => {
  it("returns defaults when no env is provided", () => {
    expect(resolvePrunePaths([])).toEqual(DEFAULT_PRUNE_PATHS);
  });

  it("appends comma-separated paths from MACHINEN_PRUNE_PATHS", () => {
    const env = ["FOO=bar", "MACHINEN_PRUNE_PATHS=/a,/b/c,/d/*"];
    expect(resolvePrunePaths(env)).toEqual([...DEFAULT_PRUNE_PATHS, "/a", "/b/c", "/d/*"]);
  });

  it("appends newline-separated paths and trims whitespace", () => {
    const env = ["MACHINEN_PRUNE_PATHS=  /a  \n  /b  \n"];
    expect(resolvePrunePaths(env)).toEqual([...DEFAULT_PRUNE_PATHS, "/a", "/b"]);
  });

  it("ignores empty entries", () => {
    const env = ["MACHINEN_PRUNE_PATHS=,,/a,,"];
    expect(resolvePrunePaths(env)).toEqual([...DEFAULT_PRUNE_PATHS, "/a"]);
  });

  it("only matches the full env-var name, not prefixes", () => {
    const env = ["MACHINEN_PRUNE_PATHS_OTHER=/nope"];
    expect(resolvePrunePaths(env)).toEqual(DEFAULT_PRUNE_PATHS);
  });
});
