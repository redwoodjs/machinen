import { describe, expect, it } from "vitest";

import {
  activeTcpConnectionCheckCommand,
  binaryExecutableCheckCommand,
  listeningTcpPortCheckCommand,
  parentDirectoryIdentityCommand,
  regularFileIdentityCommand,
  safeAbsolutePath,
  shellQuote,
  symlinkFreeTreeIdentityCommand,
} from "../move-preflight-helpers.ts";

describe("move preflight helpers", () => {
  it("quotes shell strings safely", () => {
    expect(shellQuote("/tmp/it's-safe")).toBe("'/tmp/it'\\''s-safe'");
  });

  it("validates safe absolute paths", () => {
    expect(safeAbsolutePath("/tmp/proof-root/file.txt")).toBe(true);
    expect(safeAbsolutePath("/tmp/../escape")).toBe(false);
    expect(safeAbsolutePath("/tmp/name with space")).toBe(false);
  });

  it("emits regular file identity preflight", () => {
    const command = regularFileIdentityCommand("input");
    expect(command).toContain('[ ! -f "$input" ]');
    expect(command).toContain('sha256sum "$input"');
  });

  it("emits parent directory identity preflight", () => {
    const command = parentDirectoryIdentityCommand("parent");
    expect(command).toContain('[ ! -d "$parent" ]');
    expect(command).toContain("machinen-parent-entries");
    expect(command).toContain("LC_ALL=C sort");
  });

  it("emits symlink-free tree identity preflight", () => {
    const command = symlinkFreeTreeIdentityCommand("root");
    expect(command).toContain('find "$root" -type l');
    expect(command).toContain("file_count=");
    expect(command).toContain("dir_count=");
    expect(command).toContain("total_bytes=");
  });

  it("emits listener and active-client TCP checks", () => {
    expect(activeTcpConnectionCheckCommand(8147)).toContain('== "01"');
    expect(activeTcpConnectionCheckCommand(8147)).toContain("1FD3");
    expect(listeningTcpPortCheckCommand(8147)).toContain('== "0A"');
    expect(listeningTcpPortCheckCommand(8147)).toContain("1FD3");
  });

  it("emits missing binary refusal preflight", () => {
    const command = binaryExecutableCheckCommand("/usr/bin/tool", "proof-row");
    expect(command).toContain("missing-binary");
    expect(command).toContain("/usr/bin/tool");
    expect(command).toContain("proof-row");
  });
});
