import { describe, expect, it } from "vitest";
import { ParseRunArgsError, parseRunArgs } from "../parse-run-args.ts";

describe("parseRunArgs --env", () => {
  it("collects repeated --env flags into guestEnv", () => {
    const parsed = parseRunArgs(["--env", "FOO=bar", "--env", "BAZ=qux", "--", "/bin/echo"]);
    expect(parsed.guestEnv).toEqual({ FOO: "bar", BAZ: "qux" });
    expect(parsed.double_dash_args).toEqual(["/bin/echo"]);
  });

  it("supports --env=KEY=VALUE form", () => {
    const parsed = parseRunArgs(["--env=FOO=bar", "--", "/bin/true"]);
    expect(parsed.guestEnv).toEqual({ FOO: "bar" });
  });

  it("accepts values that contain '=' characters", () => {
    const parsed = parseRunArgs([
      "--env",
      "FNM_NODE_DIST_MIRROR=http://192.168.127.1:9000/node-dist?x=1",
      "--",
      "/bin/true",
    ]);
    expect(parsed.guestEnv).toEqual({
      FNM_NODE_DIST_MIRROR: "http://192.168.127.1:9000/node-dist?x=1",
    });
  });

  it("allows empty string values", () => {
    const parsed = parseRunArgs(["--env", "FOO=", "--", "/bin/true"]);
    expect(parsed.guestEnv).toEqual({ FOO: "" });
  });

  it("lets a later --env override an earlier one", () => {
    const parsed = parseRunArgs(["--env", "FOO=first", "--env", "FOO=second", "--", "/bin/true"]);
    expect(parsed.guestEnv).toEqual({ FOO: "second" });
  });

  it("returns undefined guestEnv when no --env is given", () => {
    const parsed = parseRunArgs(["./my-bundle"]);
    expect(parsed.guestEnv).toBeUndefined();
    expect(parsed.positional).toEqual(["./my-bundle"]);
  });

  it("rejects --env without a '=' separator", () => {
    expect(() => parseRunArgs(["--env", "FOO", "--", "/bin/true"])).toThrow(ParseRunArgsError);
  });

  it("rejects --env with an empty key", () => {
    expect(() => parseRunArgs(["--env", "=bar", "--", "/bin/true"])).toThrow(ParseRunArgsError);
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
    expect(parsed.guestEnv).toEqual({ NODE_ENV: "production" });
    expect(parsed.double_dash_args).toEqual(["node", "/mnt/app/index.js"]);
  });
});
