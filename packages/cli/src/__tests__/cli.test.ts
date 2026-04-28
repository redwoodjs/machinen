import { ParseError } from "@machinen/runtime";
import { describe, expect, it } from "vitest";
import { parseRunArgs } from "../parse-run-args.ts";

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
      "FNM_NODE_DIST_MIRROR=http://192.168.127.1:9000/node-dist?x=1",
      "--",
      "/bin/true",
    ]);
    expect(parsed.env).toEqual({
      FNM_NODE_DIST_MIRROR: "http://192.168.127.1:9000/node-dist?x=1",
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

  it("rejects an unknown mode", () => {
    expect(() => parseRunArgs(["--mount-live", "./src:/mnt/src:xx"])).toThrow(
      /mode must be 'ro' or 'rw'/,
    );
  });

  it("rejects a spec with too many colons", () => {
    expect(() => parseRunArgs(["--mount-live", "./src:/mnt/src:rw:extra"])).toThrow(
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
