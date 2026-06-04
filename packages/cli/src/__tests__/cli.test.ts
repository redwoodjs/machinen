import { ParseError } from "@machinen/runtime";
import { describe, expect, it } from "vitest";
import { formatMem } from "../format-mem.ts";
import { formatPorts } from "../format-ports.ts";
import { parseForkArgs } from "../parse-fork-args.ts";
import { parseRestoreArgs } from "../parse-restore-args.ts";
import { parseRunArgs } from "../parse-run-args.ts";
import { extractTarget } from "../parse-target.ts";
import { tailLines } from "../tail-lines.ts";

describe("parseRunArgs --env", () => {
  it("collects repeated --env flags into env", () => {
    const parsed = parseRunArgs(["--env", "FOO=bar", "--env", "BAZ=qux", "--", "/bin/echo"]);
    expect(parsed.env).toEqual({ FOO: "bar", BAZ: "qux" });
    expect(parsed.double_dash_args).toEqual(["/bin/echo"]);
  });

  it("supports --env=KEY=VALUE form", () => {
    const parsed = parseRunArgs(["--env=FOO=bar", "--", "/bin/true"]);
    expect(parsed.env).toEqual({ FOO: "bar" });
  });

  it("accepts values that contain '=' characters", () => {
    const parsed = parseRunArgs([
      "--env",
      "WEBHOOK_URL=http://192.168.127.1:9000/hook?x=1",
      "--",
      "/bin/true",
    ]);
    expect(parsed.env).toEqual({
      WEBHOOK_URL: "http://192.168.127.1:9000/hook?x=1",
    });
  });

  it("allows empty string values", () => {
    const parsed = parseRunArgs(["--env", "FOO=", "--", "/bin/true"]);
    expect(parsed.env).toEqual({ FOO: "" });
  });

  it("lets a later --env override an earlier one", () => {
    const parsed = parseRunArgs(["--env", "FOO=first", "--env", "FOO=second", "--", "/bin/true"]);
    expect(parsed.env).toEqual({ FOO: "second" });
  });

  it("returns undefined env when no --env is given", () => {
    const parsed = parseRunArgs(["./my-bundle"]);
    expect(parsed.env).toBeUndefined();
    expect(parsed.positional).toEqual(["./my-bundle"]);
  });

  it("rejects --env without a '=' separator", () => {
    expect(() => parseRunArgs(["--env", "FOO", "--", "/bin/true"])).toThrow(ParseError);
  });

  it("rejects --env with an empty key", () => {
    expect(() => parseRunArgs(["--env", "=bar", "--", "/bin/true"])).toThrow(ParseError);
  });

  it("rejects a bare --env with no following argument", () => {
    expect(() => parseRunArgs(["--env"])).toThrow(/--env requires/);
  });

  it("coexists with --mount", () => {
    const parsed = parseRunArgs([
      "--mount",
      "/tmp/app:/mnt/app",
      "--env",
      "NODE_ENV=production",
      "--",
      "node",
      "/mnt/app/index.js",
    ]);
    expect(parsed.mount).toEqual({ host: "/tmp/app", guest: "/mnt/app" });
    expect(parsed.env).toEqual({ NODE_ENV: "production" });
    expect(parsed.double_dash_args).toEqual(["node", "/mnt/app/index.js"]);
  });
});

describe("parseRunArgs --mount-live", () => {
  it("captures a single --mount-live (defaults to rw)", () => {
    const parsed = parseRunArgs(["--mount-live", "./src:/mnt/src", "--", "/bin/true"]);
    expect(parsed.liveMounts).toEqual([{ host: "./src", guest: "/mnt/src", mode: "rw" }]);
  });

  it("accepts the =form", () => {
    const parsed = parseRunArgs(["--mount-live=./src:/mnt/src"]);
    expect(parsed.liveMounts).toEqual([{ host: "./src", guest: "/mnt/src", mode: "rw" }]);
  });

  it("is repeatable and preserves order", () => {
    const parsed = parseRunArgs([
      "--mount-live",
      "./a:/mnt/a",
      "--mount-live=./b:/mnt/b",
      "--mount-live",
      "./c:/mnt/c",
    ]);
    expect(parsed.liveMounts).toEqual([
      { host: "./a", guest: "/mnt/a", mode: "rw" },
      { host: "./b", guest: "/mnt/b", mode: "rw" },
      { host: "./c", guest: "/mnt/c", mode: "rw" },
    ]);
  });

  it("coexists with --mount (copy-once stays separate)", () => {
    const parsed = parseRunArgs(["--mount", "./cfg:/mnt/cfg", "--mount-live", "./src:/mnt/src"]);
    expect(parsed.mount).toEqual({ host: "./cfg", guest: "/mnt/cfg" });
    expect(parsed.liveMounts).toEqual([{ host: "./src", guest: "/mnt/src", mode: "rw" }]);
  });

  it("returns undefined liveMounts when the flag is absent", () => {
    const parsed = parseRunArgs(["./bundle", "--", "ls"]);
    expect(parsed.liveMounts).toBeUndefined();
  });

  it("rejects a malformed spec (missing colon)", () => {
    expect(() => parseRunArgs(["--mount-live", "./src"])).toThrow(
      /expected <host-dir>:<guest-path>\[:<mode>\]/,
    );
  });

  it("rejects a bare --mount-live with no value", () => {
    expect(() => parseRunArgs(["--mount-live"])).toThrow(/--mount-live requires/);
  });

  it("accepts an explicit :ro suffix", () => {
    const parsed = parseRunArgs(["--mount-live", "./src:/mnt/src:ro"]);
    expect(parsed.liveMounts).toEqual([{ host: "./src", guest: "/mnt/src", mode: "ro" }]);
  });

  it("accepts a :rw suffix for write-through", () => {
    const parsed = parseRunArgs(["--mount-live", "./src:/mnt/src:rw"]);
    expect(parsed.liveMounts).toEqual([{ host: "./src", guest: "/mnt/src", mode: "rw" }]);
  });

  it("rejects an unknown trailing modifier", () => {
    expect(() => parseRunArgs(["--mount-live", "./src:/mnt/src:xx"])).toThrow(
      /trailing modifier must be 'ro' or 'rw'/,
    );
  });

  it("rejects a spec with too many colons", () => {
    expect(() => parseRunArgs(["--mount-live", "./src:/mnt/src:rw:extra"])).toThrow(
      /expected <host-dir>:<guest-path>\[:<mode>\]/,
    );
  });

  it("rejects the removed :<protocol> modifier", () => {
    // #338 dropped the FUSE-over-vsock transport and its protocol knob.
    expect(() => parseRunArgs(["--mount-live", "./src:/mnt/src:ro:virtiofs"])).toThrow(
      /expected <host-dir>:<guest-path>\[:<mode>\]/,
    );
  });
});

describe("parseRunArgs -p", () => {
  it("parses a single -p into portForward", () => {
    const parsed = parseRunArgs(["./bundle", "-p", "8080:3000"]);
    expect(parsed.portForward).toEqual([{ hostPort: 8080, guestPort: 3000 }]);
    expect(parsed.positional).toEqual(["./bundle"]);
  });

  it("accepts --publish and =form", () => {
    const parsed = parseRunArgs(["--publish", "8080:3000", "--publish=9090:4000"]);
    expect(parsed.portForward).toEqual([
      { hostPort: 8080, guestPort: 3000 },
      { hostPort: 9090, guestPort: 4000 },
    ]);
  });

  it("returns undefined portForward when no -p is given", () => {
    const parsed = parseRunArgs(["./bundle"]);
    expect(parsed.portForward).toBeUndefined();
  });

  it("rejects duplicate hostPort", () => {
    expect(() => parseRunArgs(["-p", "8080:3000", "-p", "8080:3001"])).toThrow(
      /duplicate hostPort 8080/,
    );
  });

  it("rejects out-of-range ports", () => {
    expect(() => parseRunArgs(["-p", "0:3000"])).toThrow(/hostPort must be in 1..65535/);
    expect(() => parseRunArgs(["-p", "8080:70000"])).toThrow(/guestPort must be in 1..65535/);
  });

  it("rejects non-numeric ports", () => {
    expect(() => parseRunArgs(["-p", "abc:3000"])).toThrow(/hostPort must be numeric/);
  });

  it("rejects a malformed spec", () => {
    expect(() => parseRunArgs(["-p", "8080"])).toThrow(/expected <hostPort>:<guestPort>/);
  });

  it("rejects a bare -p with no following argument", () => {
    expect(() => parseRunArgs(["-p"])).toThrow(/-p requires/);
  });
});

describe("parseRunArgs --snapshot", () => {
  it("captures the snapshot path", () => {
    const parsed = parseRunArgs(["--snapshot", "./warm.snap"]);
    expect(parsed.snapshot).toBe("./warm.snap");
  });

  it("supports --snapshot=<path> form", () => {
    const parsed = parseRunArgs(["--snapshot=./warm.snap"]);
    expect(parsed.snapshot).toBe("./warm.snap");
  });

  it("rejects a second --snapshot", () => {
    expect(() => parseRunArgs(["--snapshot", "a.snap", "--snapshot", "b.snap"])).toThrow(
      /at most once/,
    );
  });

  it("rejects a bare --snapshot with no following argument", () => {
    expect(() => parseRunArgs(["--snapshot"])).toThrow(/requires a path value/);
  });
});

describe("parseRunArgs --nested", () => {
  it("captures --nested as a boolean", () => {
    const parsed = parseRunArgs(["--nested", "--", "/bin/true"]);
    expect(parsed.nested).toBe(true);
  });

  it("leaves nested unset when the flag is absent", () => {
    const parsed = parseRunArgs(["./bundle"]);
    expect(parsed.nested).toBeUndefined();
  });

  it("rejects duplicate --nested", () => {
    expect(() => parseRunArgs(["--nested", "--nested"])).toThrow(/at most once/);
  });

  it("rejects --nested=<value>", () => {
    expect(() => parseRunArgs(["--nested=1"])).toThrow(/does not take a value/);
  });
});

describe("parseRunArgs --name", () => {
  it("captures the name", () => {
    const parsed = parseRunArgs(["--name", "worker", "--", "/bin/true"]);
    expect(parsed.name).toBe("worker");
  });

  it("supports --name=<value> form", () => {
    const parsed = parseRunArgs(["--name=worker"]);
    expect(parsed.name).toBe("worker");
  });

  it("rejects a second --name", () => {
    expect(() => parseRunArgs(["--name", "a", "--name", "b"])).toThrow(/at most once/);
  });
});

describe("parseRunArgs --cwd", () => {
  it("captures the cwd", () => {
    const parsed = parseRunArgs(["--cwd", "/mnt/workspace", "--", "/bin/bash"]);
    expect(parsed.guestCwd).toBe("/mnt/workspace");
  });

  it("supports --cwd=<path> form", () => {
    const parsed = parseRunArgs(["--cwd=/srv/y"]);
    expect(parsed.guestCwd).toBe("/srv/y");
  });

  it("leaves guestCwd undefined when not passed", () => {
    const parsed = parseRunArgs(["./bundle"]);
    expect(parsed.guestCwd).toBeUndefined();
  });

  it("rejects a bare --cwd with no following argument", () => {
    expect(() => parseRunArgs(["--cwd"])).toThrow(/--cwd requires/);
  });

  it("rejects a second --cwd", () => {
    expect(() => parseRunArgs(["--cwd", "/a", "--cwd", "/b"])).toThrow(/at most once/);
  });

  // Path-shape validation lives in the runtime (`BOOT_CWD_INVALID`),
  // not the parser — the parser captures the raw string and forwards
  // it. We assert capture only here.
  it("captures relative paths verbatim (runtime validates shape)", () => {
    const parsed = parseRunArgs(["--cwd", "relative/dir"]);
    expect(parsed.guestCwd).toBe("relative/dir");
  });
});

describe("parseRunArgs --detached", () => {
  it("captures --detached as a boolean", () => {
    const parsed = parseRunArgs(["--detached", "--", "/bin/true"]);
    expect(parsed.detached).toBe(true);
  });

  it("accepts --detach as an alias", () => {
    const parsed = parseRunArgs(["--detach", "--", "/bin/true"]);
    expect(parsed.detached).toBe(true);
  });

  it("leaves detached unset when the flag is absent", () => {
    const parsed = parseRunArgs(["./bundle"]);
    expect(parsed.detached).toBeUndefined();
  });

  it("rejects a duplicate --detached", () => {
    expect(() => parseRunArgs(["--detached", "--detached"])).toThrow(/at most once/);
  });

  // The parser doesn't gate flag combinations — it captures whatever
  // it sees and lets the runtime apply semantic checks. In-VMM virtio-fs
  // removed the last detach compat gate (mount, liveMounts, and
  // portForward all coexist with --detached), so there is nothing for
  // the parser to mirror here.
});

describe("parseRunArgs --memory (#263 phase A)", () => {
  it("captures --memory as a decimal MiB count", () => {
    const parsed = parseRunArgs(["--memory", "1024", "--", "/bin/true"]);
    expect(parsed.memory).toBe(1024);
  });

  it("supports the --memory=<mib> form", () => {
    const parsed = parseRunArgs(["--memory=32768", "--", "/bin/true"]);
    expect(parsed.memory).toBe(32768);
  });

  it("leaves memory unset when the flag is absent", () => {
    const parsed = parseRunArgs(["./bundle"]);
    expect(parsed.memory).toBeUndefined();
  });

  it("rejects unit suffixes — MACHINEN_MEMORY is bare MiB", () => {
    expect(() => parseRunArgs(["--memory", "1G", "--", "/bin/true"])).toThrow(/decimal integer/);
    expect(() => parseRunArgs(["--memory", "1024M", "--", "/bin/true"])).toThrow(/decimal integer/);
  });

  it("rejects negative or zero", () => {
    expect(() => parseRunArgs(["--memory", "-1", "--"])).toThrow(/decimal integer/);
    expect(() => parseRunArgs(["--memory", "0", "--"])).toThrow(/must be > 0/);
  });

  it("rejects a bare --memory with no following argument", () => {
    expect(() => parseRunArgs(["--memory"])).toThrow(/--memory requires/);
  });

  it("rejects a duplicate --memory", () => {
    expect(() => parseRunArgs(["--memory", "1024", "--memory", "2048"])).toThrow(/at most once/);
  });
});

describe("parseForkArgs", () => {
  it("captures --new-name and --out-dir", () => {
    const parsed = parseForkArgs([
      "--name",
      "src",
      "--new-name",
      "fork-b",
      "--out-dir",
      "./bundle",
    ]);
    expect(parsed.newName).toBe("fork-b");
    expect(parsed.outDir).toBe("./bundle");
    expect(parsed.rest).toEqual(["--name", "src"]);
  });

  it("supports --new-name=<v> and --out-dir=<v>", () => {
    const parsed = parseForkArgs(["--new-name=fork-b", "--out-dir=./bundle"]);
    expect(parsed.newName).toBe("fork-b");
    expect(parsed.outDir).toBe("./bundle");
  });

  it("captures --tcp-keep and --detach", () => {
    const parsed = parseForkArgs(["--tcp-keep", "--detach"]);
    expect(parsed.tcpKeep).toBe(true);
    expect(parsed.detach).toBe(true);
  });

  it("defaults tcpKeep, detach, lazy, and portForward when no flags are given", () => {
    const parsed = parseForkArgs(["--name", "src"]);
    expect(parsed.tcpKeep).toBe(false);
    expect(parsed.detach).toBe(false);
    expect(parsed.lazy).toBe(false);
    expect(parsed.portForward).toEqual([]);
    expect(parsed.newName).toBeUndefined();
    expect(parsed.outDir).toBeUndefined();
  });

  it("captures --lazy", () => {
    const parsed = parseForkArgs(["--lazy"]);
    expect(parsed.lazy).toBe(true);
    expect(parsed.detach).toBe(false);
  });

  it("forces lazy=false when --detach is set (FUSE server can't survive detach yet)", () => {
    const parsed = parseForkArgs(["--detach", "--lazy"]);
    expect(parsed.detach).toBe(true);
    expect(parsed.lazy).toBe(false);
  });

  it("collects -p / --publish into portForward", () => {
    const parsed = parseForkArgs([
      "-p",
      "3001:3000",
      "--publish",
      "5433:5432",
      "--publish=8081:8080",
    ]);
    expect(parsed.portForward).toEqual([
      { hostPort: 3001, guestPort: 3000 },
      { hostPort: 5433, guestPort: 5432 },
      { hostPort: 8081, guestPort: 8080 },
    ]);
  });

  it("rejects duplicate hostPort across the same fork", () => {
    expect(() => parseForkArgs(["-p", "3001:3000", "-p", "3001:3001"])).toThrow(
      /duplicate hostPort 3001/,
    );
  });

  it("rejects malformed -p", () => {
    expect(() => parseForkArgs(["-p", "3001"])).toThrow(/expected <hostPort>:<guestPort>/);
  });

  it("rejects out-of-range -p ports", () => {
    expect(() => parseForkArgs(["-p", "0:3000"])).toThrow(/hostPort must be in 1..65535/);
    expect(() => parseForkArgs(["-p", "3001:70000"])).toThrow(/guestPort must be in 1..65535/);
  });

  it("rejects a bare -p with no following argument", () => {
    expect(() => parseForkArgs(["-p"])).toThrow(/-p requires/);
  });

  it("rejects a bare --new-name with no following argument", () => {
    expect(() => parseForkArgs(["--new-name"])).toThrow(/--new-name requires/);
  });

  it("rejects a bare --out-dir with no following argument", () => {
    expect(() => parseForkArgs(["--out-dir"])).toThrow(/--out-dir requires/);
  });

  it("rejects a duplicate --new-name", () => {
    expect(() => parseForkArgs(["--new-name", "a", "--new-name", "b"])).toThrow(/at most once/);
  });

  it("rejects a duplicate --out-dir", () => {
    expect(() => parseForkArgs(["--out-dir", "a", "--out-dir", "b"])).toThrow(/at most once/);
  });

  it("throws ParseError (not generic Error) so the CLI can format it", () => {
    expect(() => parseForkArgs(["-p"])).toThrow(ParseError);
  });

  it("preserves unknown args in rest for parseTargetFlags", () => {
    const parsed = parseForkArgs(["--name", "src", "--pid", "1234", "--detach"]);
    expect(parsed.rest).toEqual(["--name", "src", "--pid", "1234"]);
    expect(parsed.detach).toBe(true);
  });

  it("captures --mount and --mount-live", () => {
    const parsed = parseForkArgs([
      "--mount",
      "/tmp/host:/mnt/in",
      "--mount-live",
      "/tmp/live:/mnt/live:ro",
    ]);
    expect(parsed.mount).toEqual({ host: "/tmp/host", guest: "/mnt/in" });
    expect(parsed.liveMounts).toEqual([{ host: "/tmp/live", guest: "/mnt/live", mode: "ro" }]);
  });

  it("captures --env (repeatable) and --cwd", () => {
    const parsed = parseForkArgs(["--env", "FOO=bar", "--env=BAZ=qux", "--cwd", "/mnt/in"]);
    expect(parsed.env).toEqual({ FOO: "bar", BAZ: "qux" });
    expect(parsed.guestCwd).toBe("/mnt/in");
  });

  it("captures --memory and rejects malformed values", () => {
    expect(parseForkArgs(["--memory", "1024"]).memory).toBe(1024);
    expect(parseForkArgs(["--memory=2048"]).memory).toBe(2048);
    expect(() => parseForkArgs(["--memory", "1g"])).toThrow(/decimal integer/);
    expect(() => parseForkArgs(["--memory", "0"])).toThrow(/must be > 0/);
    expect(() => parseForkArgs(["--memory", "1024", "--memory", "2048"])).toThrow(/at most once/);
  });

  it("rejects a duplicate --mount but allows repeated --mount-live", () => {
    expect(() => parseForkArgs(["--mount", "a:/m/a", "--mount", "b:/m/b"])).toThrow(/at most once/);
    const parsed = parseForkArgs(["--mount-live", "a:/m/a", "--mount-live", "b:/m/b:ro"]);
    expect(parsed.liveMounts).toHaveLength(2);
  });

  it("rejects an invalid --mount-live modifier", () => {
    expect(() => parseForkArgs(["--mount-live", "h:/m/x:bogus"])).toThrow(
      /trailing modifier must be 'ro' or 'rw'/,
    );
  });

  it("rejects a duplicate --cwd", () => {
    expect(() => parseForkArgs(["--cwd", "/a", "--cwd", "/b"])).toThrow(/at most once/);
  });
});

describe("parseRestoreArgs", () => {
  it("captures the snap-dir positional", () => {
    const parsed = parseRestoreArgs(["./warm"]);
    expect(parsed.positional).toEqual(["./warm"]);
    expect(parsed.name).toBeUndefined();
    expect(parsed.image).toBeUndefined();
    expect(parsed.portForward).toEqual([]);
    expect(parsed.lazy).toBe(false);
  });

  it("captures --lazy (opt into the lazy-pages restore path)", () => {
    const parsed = parseRestoreArgs(["./warm", "--lazy"]);
    expect(parsed.lazy).toBe(true);
  });

  it("captures --name and --image (space and = forms)", () => {
    const a = parseRestoreArgs(["./warm", "--name", "restored", "--image", "./rootfs.tar.gz"]);
    expect(a.name).toBe("restored");
    expect(a.image).toBe("./rootfs.tar.gz");
    const b = parseRestoreArgs(["--name=restored", "--image=./rootfs.tar.gz", "./warm"]);
    expect(b.name).toBe("restored");
    expect(b.image).toBe("./rootfs.tar.gz");
  });

  it("captures portable product restore verifier flags", () => {
    const parsed = parseRestoreArgs([
      "./pg.portable",
      "--target-arch",
      "amd64",
      "--target-verifier-output=./verify.txt",
    ]);
    expect(parsed.targetArch).toBe("amd64");
    expect(parsed.targetVerifierOutput).toBe("./verify.txt");
  });

  it("captures PostgreSQL no-dump product restore flags", () => {
    const parsed = parseRestoreArgs([
      "./pg.portable",
      "--target-arch",
      "arm64",
      "--postgres-docker-host",
      "root@192.168.0.8",
      "--postgres-container",
      "pg-target",
      "--database",
      "machinen_pg",
      "--target-verifier-sql",
      "./verify.sql",
    ]);
    expect(parsed.targetArch).toBe("arm64");
    expect(parsed.postgresDockerHost).toBe("root@192.168.0.8");
    expect(parsed.postgresContainer).toBe("pg-target");
    expect(parsed.postgresDatabase).toBe("machinen_pg");
    expect(parsed.postgresTargetVerifierSql).toBe("./verify.sql");
  });

  it("captures Node Level 5 proof-only restore flags", () => {
    const parsed = parseRestoreArgs([
      "./node-proof",
      "--verify-proof-only",
      "--allow-proof-only-success",
    ]);
    expect(parsed.verifyProofOnly).toBe(true);
    expect(parsed.allowProofOnlySuccess).toBe(true);
  });

  it("collects -p / --publish into portForward", () => {
    const parsed = parseRestoreArgs([
      "./warm",
      "-p",
      "3001:3000",
      "--publish",
      "5433:5432",
      "--publish=8081:8080",
    ]);
    expect(parsed.portForward).toEqual([
      { hostPort: 3001, guestPort: 3000 },
      { hostPort: 5433, guestPort: 5432 },
      { hostPort: 8081, guestPort: 8080 },
    ]);
  });

  it("rejects duplicate hostPort across the same restore", () => {
    expect(() => parseRestoreArgs(["./warm", "-p", "3001:3000", "-p", "3001:3001"])).toThrow(
      /duplicate hostPort 3001/,
    );
  });

  it("rejects malformed -p", () => {
    expect(() => parseRestoreArgs(["./warm", "-p", "3001"])).toThrow(
      /expected <hostPort>:<guestPort>/,
    );
  });

  it("rejects out-of-range -p ports", () => {
    expect(() => parseRestoreArgs(["./warm", "-p", "0:3000"])).toThrow(
      /hostPort must be in 1..65535/,
    );
    expect(() => parseRestoreArgs(["./warm", "-p", "3001:70000"])).toThrow(
      /guestPort must be in 1..65535/,
    );
  });

  it("rejects a bare -p with no following argument", () => {
    expect(() => parseRestoreArgs(["./warm", "-p"])).toThrow(/-p requires/);
  });

  it("rejects a bare --name / --image with no following argument", () => {
    expect(() => parseRestoreArgs(["./warm", "--name"])).toThrow(/--name requires/);
    expect(() => parseRestoreArgs(["./warm", "--image"])).toThrow(/--image requires/);
  });

  it("rejects a duplicate --name / --image", () => {
    expect(() => parseRestoreArgs(["./warm", "--name", "a", "--name", "b"])).toThrow(
      /at most once/,
    );
    expect(() => parseRestoreArgs(["./warm", "--image", "a", "--image", "b"])).toThrow(
      /at most once/,
    );
  });

  it("rejects unknown flags", () => {
    expect(() => parseRestoreArgs(["./warm", "--bogus"])).toThrow(/unknown flag: --bogus/);
  });

  it("throws ParseError (not generic Error) so the CLI can format it", () => {
    expect(() => parseRestoreArgs(["./warm", "-p"])).toThrow(ParseError);
  });

  // #273: --mount-live on restore is the per-guest override knob for
  // the bundle's recorded liveMounts. Same wire shape as boot's
  // --mount-live, different semantics — restore() refuses unknown
  // guests at the runtime layer, the parser just collects entries.
  it("collects --mount-live overrides with default :rw mode", () => {
    const parsed = parseRestoreArgs(["./warm", "--mount-live", "/host/work:/mnt/work"]);
    expect(parsed.liveMounts).toEqual([{ host: "/host/work", guest: "/mnt/work", mode: "rw" }]);
  });

  it("collects --mount-live with explicit :ro and :rw modes", () => {
    const parsed = parseRestoreArgs([
      "./warm",
      "--mount-live",
      "/host/cache:/mnt/cache:ro",
      "--mount-live=/host/work:/mnt/work:rw",
    ]);
    expect(parsed.liveMounts).toEqual([
      { host: "/host/cache", guest: "/mnt/cache", mode: "ro" },
      { host: "/host/work", guest: "/mnt/work", mode: "rw" },
    ]);
  });

  it("rejects two --mount-live overrides for the same guest", () => {
    // Last-write-wins on the runtime side would silently swallow a
    // typo; surface it at parse time so the user notices.
    expect(() =>
      parseRestoreArgs([
        "./warm",
        "--mount-live",
        "/host/a:/mnt/work",
        "--mount-live",
        "/host/b:/mnt/work",
      ]),
    ).toThrow(/--mount-live override for guest=\/mnt\/work given more than once/);
  });

  it("rejects malformed --mount-live spec on restore (same as boot)", () => {
    expect(() => parseRestoreArgs(["./warm", "--mount-live", "no-colon"])).toThrow(
      /--mount-live: expected/,
    );
  });
});

describe("formatPorts (machinen ls PORTS column)", () => {
  it("renders '-' when no forwards are configured", () => {
    expect(formatPorts(undefined)).toBe("-");
    expect(formatPorts([])).toBe("-");
  });

  it("renders a single forward as <hostPort>:<guestPort>", () => {
    expect(formatPorts([{ hostPort: 3000, guestPort: 3000 }])).toBe("3000:3000");
  });

  it("comma-separates multiple forwards", () => {
    expect(
      formatPorts([
        { hostPort: 3000, guestPort: 3000 },
        { hostPort: 5432, guestPort: 5432 },
      ]),
    ).toBe("3000:3000,5432:5432");
  });

  it("ignores hostAddr in the rendered cell (kept terse for the table)", () => {
    expect(formatPorts([{ hostPort: 5432, guestPort: 5432, hostAddr: "0.0.0.0" }])).toBe(
      "5432:5432",
    );
  });
});

describe("formatMem (machinen ls MEM column, #274)", () => {
  const KIB = 1024;
  const MIB = 1024 * 1024;
  const GIB = 1024 * 1024 * 1024;

  it("renders '-' when neither rss nor ceiling is known", () => {
    expect(formatMem(null, undefined)).toBe("-");
    expect(formatMem(undefined, undefined)).toBe("-");
    expect(formatMem(0, undefined)).toBe("-");
  });

  it("renders just rss when ceiling is unknown", () => {
    expect(formatMem(512 * MIB, undefined)).toBe("512M");
    expect(formatMem(2 * GIB, undefined)).toBe("2.0G");
  });

  it("renders ?/<ceiling> when rss isn't readable but ceiling is", () => {
    expect(formatMem(null, 4096)).toBe("?/4.0G");
  });

  it("renders rss/ceiling in the same scale", () => {
    expect(formatMem(1.2 * GIB, 4096)).toBe("1.2G/4.0G");
    expect(formatMem(16 * GIB, 16384)).toBe("16G/16G");
    expect(formatMem(256 * MIB, 512)).toBe("256M/512M");
  });

  it("rounds down to integer once a side hits 10 (keeps the cell narrow)", () => {
    expect(formatMem(11.4 * GIB, 16384)).toBe("11G/16G");
    expect(formatMem(10 * MIB, 512)).toBe("10M/512M");
  });

  it("falls through to KiB / bytes for tiny values", () => {
    expect(formatMem(8 * KIB, undefined)).toBe("8K");
    expect(formatMem(42, undefined)).toBe("42B");
  });
});

describe("tailLines (machinen attach --tail slicing)", () => {
  it("returns content unchanged when tail is 'all' and content ends with newline", () => {
    expect(tailLines("a\nb\nc\n", "all")).toBe("a\nb\nc\n");
  });

  it("appends a trailing newline when content has none", () => {
    expect(tailLines("a\nb\nc", "all")).toBe("a\nb\nc\n");
  });

  it("treats tail=0 as 'all' (preserves the legacy `--tail 0` quirk)", () => {
    expect(tailLines("a\nb\nc\n", 0)).toBe("a\nb\nc\n");
  });

  it("returns the last N lines, terminated with a newline", () => {
    expect(tailLines("a\nb\nc\nd\ne\n", 2)).toBe("d\ne\n");
  });

  it("doesn't double-count the trailing-newline empty in line counts", () => {
    // Without the trim, a 3-line file with trailing \n would split
    // into 4 elements and `tail=3` would return only 2 actual lines.
    expect(tailLines("a\nb\nc\n", 3)).toBe("a\nb\nc\n");
  });

  it("handles content without a trailing newline", () => {
    expect(tailLines("a\nb\nc", 2)).toBe("b\nc\n");
  });

  it("returns empty string for empty content", () => {
    expect(tailLines("", "all")).toBe("");
    expect(tailLines("", 5)).toBe("");
  });

  it("returns the whole content when tail >= line count", () => {
    expect(tailLines("a\nb\n", 99)).toBe("a\nb\n");
  });
});

describe("extractTarget", () => {
  it("treats a non-digit positional as a name", () => {
    const r = extractTarget(["worker"], "exec");
    expect(r.target).toEqual({ name: "worker" });
    expect(r.rest).toEqual([]);
  });

  it("treats an all-digits positional as a pid", () => {
    const r = extractTarget(["12345"], "stop");
    expect(r.target).toEqual({ pid: 12345 });
  });

  it("accepts path-shaped names (slash-separated)", () => {
    const r = extractTarget(["a/b/c"], "exec");
    expect(r.target).toEqual({ name: "a/b/c" });
  });

  it("returns extra positionals in rest (e.g. snapshot's out-dir)", () => {
    const r = extractTarget(["worker", "./warm"], "snapshot");
    expect(r.target).toEqual({ name: "worker" });
    expect(r.rest).toEqual(["./warm"]);
  });

  it("rejects no target at all", () => {
    expect(() => extractTarget([], "exec")).toThrow(/requires a target/);
  });

  it("rejects unknown flags (legacy --name/--pid no longer recognized)", () => {
    expect(() => extractTarget(["--name", "worker"], "exec")).toThrow(/unknown argument: --name/);
    expect(() => extractTarget(["--pid", "1234"], "stop")).toThrow(/unknown argument: --pid/);
    expect(() => extractTarget(["--bogus"], "exec")).toThrow(/unknown argument: --bogus/);
  });

  it("throws ParseError so the CLI can format it", () => {
    expect(() => extractTarget([], "exec")).toThrow(ParseError);
  });
});
