import { describe, expect, it } from "vitest";

import {
  consumeDatabase,
  defaultSessionDatabasePath,
  nativeInvocation,
} from "../commands/terminal.ts";

describe("host terminal command", () => {
  it("extracts a database override without disturbing operation arguments", () => {
    expect(consumeDatabase(["work", "--database", "/tmp/sessions.db", "--read-only"])).toEqual({
      database: "/tmp/sessions.db",
      rest: ["work", "--read-only"],
    });
  });

  it("leaves command arguments after -- untouched", () => {
    expect(
      consumeDatabase(["--database", "/tmp/session.db", "--", "tool", "--database", "app.db"]),
    ).toEqual({
      database: "/tmp/session.db",
      rest: ["--", "tool", "--database", "app.db"],
    });
  });

  it("fills a stable session ID, cwd, and login shell for new", () => {
    const invocation = nativeInvocation("new", ["--name", "work"]);
    expect(invocation.args).toContain("--id");
    expect(invocation.args.find((value) => value.startsWith("term_"))).toMatch(/^term_[0-9a-f-]+$/);
    expect(invocation.args).toContain("--cwd");
    expect(invocation.args).toContain("--");
  });

  it("passes a take-control target and client ID to the native helper", () => {
    expect(nativeInvocation("take", ["--client-id", "42", "work"])).toEqual({
      args: ["--client-id", "42", "work"],
    });
  });

  it("passes explicit terminal geometry to the native helper", () => {
    expect(nativeInvocation("resize", ["--columns", "120", "--rows", "36", "work"])).toEqual({
      args: ["--columns", "120", "--rows", "36", "work"],
    });
  });

  it("turns terminal send text into stdin and can append a newline", () => {
    expect(nativeInvocation("send", ["work", "--newline", "hello", "there"])).toEqual({
      args: ["work"],
      input: "hello there\n",
    });
  });

  it("uses conventional macOS and Linux state locations", () => {
    expect(defaultSessionDatabasePath("darwin", {})).toMatch(
      /Library\/Application Support\/Machinen\/sessions\.sqlite3$/,
    );
    expect(defaultSessionDatabasePath("linux", { XDG_STATE_HOME: "/state" })).toBe(
      "/state/machinen/sessions.sqlite3",
    );
  });
});
