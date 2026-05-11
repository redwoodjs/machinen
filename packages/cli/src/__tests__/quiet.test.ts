// Tests for the quiet UX helper — #286.

import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUFFER_BYTES,
  formatElapsed,
  isBootNoiseLine,
  isQuiet,
  NoiseFilter,
  printDiagnostics,
  printHeadline,
  RingBuffer,
} from "../quiet.ts";

describe("RingBuffer", () => {
  it("appends and concatenates strings + buffers", () => {
    const rb = new RingBuffer(64);
    rb.push("hello ");
    rb.push(Buffer.from("world"));
    expect(rb.toString()).toBe("hello world");
    expect(rb.byteLength()).toBe(11);
    expect(rb.isEmpty()).toBe(false);
  });

  it("drops oldest chunks when capacity is exceeded", () => {
    const rb = new RingBuffer(10);
    rb.push("aaaa");
    rb.push("bbbb");
    rb.push("cccc"); // total 12 > 10 — first chunk drops
    expect(rb.toString()).toBe("bbbbcccc");
    expect(rb.byteLength()).toBe(8);
  });

  it("keeps the most recent chunk even when it alone exceeds capacity", () => {
    // The implementation keeps at least one chunk so callers always
    // see *some* tail rather than an empty buffer when a single
    // chunk is larger than the cap. Common when CRIU writes a huge
    // single line on failure.
    const rb = new RingBuffer(4);
    rb.push("aaaa");
    rb.push("xxxxxxxx");
    expect(rb.toString()).toBe("xxxxxxxx");
  });

  it("treats empty pushes as no-ops", () => {
    const rb = new RingBuffer();
    rb.push("");
    rb.push(Buffer.alloc(0));
    expect(rb.isEmpty()).toBe(true);
  });

  it("default capacity matches the exported constant", () => {
    const rb = new RingBuffer();
    rb.push("x".repeat(BUFFER_BYTES + 100));
    expect(rb.byteLength()).toBeLessThanOrEqual(BUFFER_BYTES + 100);
  });
});

describe("isBootNoiseLine", () => {
  const noiseSamples = [
    "[    0.123456] Booting Linux on physical CPU 0x0",
    "[ 1234.567] EXT4-fs (vda): mounted",
    "init: machinen-netup exited non-zero — network may not be up",
    "checkpoint: post-tryRootDiskPivot",
    "checkpoint: post-bringUpNetwork",
    "mountdisk: mkfs.ext4 ok",
    "machinen-restore: lazy-pages daemon pid=42",
    "machinen-supervisor: spawning workload",
    "machinen-dump: criu exit=0",
    "machinen-netup: gvproxy ready",
  ];

  it.each(noiseSamples)("classifies %s as boot noise", (line) => {
    expect(isBootNoiseLine(line)).toBe(true);
  });

  const workloadSamples = [
    "hello-world",
    "Listening on http://localhost:3000",
    "node:fs:1234 fs.readFile()",
    "Error: ENOENT: no such file or directory",
    "",
    "    indented log line",
  ];

  it.each(workloadSamples)("classifies %s as workload output", (line) => {
    expect(isBootNoiseLine(line)).toBe(false);
  });
});

describe("NoiseFilter", () => {
  it("routes noise lines to buffer, workload lines to out, and fires onReady once", () => {
    const buffer = new RingBuffer();
    const out = new PassThrough();
    let outBytes = "";
    out.on("data", (chunk: Buffer) => {
      outBytes += chunk.toString();
    });
    const onReady = vi.fn();

    const f = new NoiseFilter({ buffer, out, onReady });
    f.push(Buffer.from("[    0.001] Booting Linux\n"));
    f.push(Buffer.from("checkpoint: post-tryRootDiskPivot\n"));
    f.push(Buffer.from("hello workload\n"));
    f.push(Buffer.from("another workload line\n"));

    expect(buffer.toString()).toContain("Booting Linux");
    expect(buffer.toString()).toContain("post-tryRootDiskPivot");
    // Post-ready lines are rolling-buffered too so a late workload
    // crash still has context for the dump.
    expect(buffer.toString()).toContain("hello workload");
    expect(outBytes).toContain("hello workload");
    expect(outBytes).toContain("another workload line");
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(f.ready).toBe(true);
  });

  it("handles chunks split mid-line", () => {
    const buffer = new RingBuffer();
    const out = new PassThrough();
    let outBytes = "";
    out.on("data", (chunk: Buffer) => {
      outBytes += chunk.toString();
    });

    const f = new NoiseFilter({ buffer, out });
    f.push(Buffer.from("checkpoint: po"));
    f.push(Buffer.from("st-bringUpNetwork\nhel"));
    f.push(Buffer.from("lo\n"));
    expect(buffer.toString()).toContain("post-bringUpNetwork");
    expect(outBytes).toBe("hello\n");
  });

  it("flush() drains a trailing residual line as noise pre-ready", () => {
    const buffer = new RingBuffer();
    const out = new PassThrough();
    let outBytes = "";
    out.on("data", (chunk: Buffer) => {
      outBytes += chunk.toString();
    });

    const f = new NoiseFilter({ buffer, out });
    f.push(Buffer.from("checkpoint: ha"));
    f.push(Buffer.from("lf-line-no-newline"));
    f.flush();
    expect(buffer.toString()).toBe("checkpoint: half-line-no-newline");
    expect(outBytes).toBe("");
  });

  it("blank pre-ready lines stay buffered and don't flip the gate", () => {
    const buffer = new RingBuffer();
    const out = new PassThrough();
    const onReady = vi.fn();

    const f = new NoiseFilter({ buffer, out, onReady });
    f.push(Buffer.from("checkpoint: x\n\n\n"));
    expect(onReady).not.toHaveBeenCalled();
    expect(f.ready).toBe(false);
  });
});

describe("isQuiet", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.DEBUG;
    delete process.env.DEBUG;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = saved;
    }
  });

  it("returns true with no DEBUG set", () => {
    expect(isQuiet()).toBe(true);
  });

  it("respects DEBUG=machinen:* as an opt-out (operator mode)", () => {
    process.env.DEBUG = "machinen:*";
    expect(isQuiet()).toBe(false);
  });

  it("respects DEBUG=machinen:boot (single namespace)", () => {
    process.env.DEBUG = "machinen:boot";
    expect(isQuiet()).toBe(false);
  });

  it("respects DEBUG=machinen (bare namespace)", () => {
    process.env.DEBUG = "machinen";
    expect(isQuiet()).toBe(false);
  });

  it("respects DEBUG=* (catch-all wildcard)", () => {
    process.env.DEBUG = "*";
    expect(isQuiet()).toBe(false);
  });

  it("stays quiet for unrelated DEBUG namespaces", () => {
    process.env.DEBUG = "express:*";
    expect(isQuiet()).toBe(true);
  });

  it("recognises a machinen entry alongside others", () => {
    process.env.DEBUG = "express:*,machinen:boot";
    expect(isQuiet()).toBe(false);
  });

  it("treats `-machinen:*` (negation) as not-opted-in", () => {
    process.env.DEBUG = "express:*,-machinen:*";
    expect(isQuiet()).toBe(true);
  });
});

describe("formatElapsed", () => {
  it("formats ms as seconds with 2 decimals", () => {
    expect(formatElapsed(1450)).toBe("1.45s");
    expect(formatElapsed(623)).toBe("0.62s");
    expect(formatElapsed(0)).toBe("0.00s");
    expect(formatElapsed(-5)).toBe("0.00s");
  });
});

describe("printHeadline", () => {
  let written = "";
  let savedDebug: string | undefined;
  const origWrite = process.stderr.write.bind(process.stderr);
  beforeEach(() => {
    savedDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    written = "";
    // @ts-ignore monkeypatch for test
    process.stderr.write = (chunk: string | Buffer) => {
      written += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };
  });
  afterEach(() => {
    process.stderr.write = origWrite;
    if (savedDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = savedDebug;
    }
  });

  it("writes a single newline-terminated line in quiet mode", () => {
    printHeadline("booting counter…");
    expect(written).toBe("booting counter…\n");
  });

  it("is silent when DEBUG=machinen:* is set", () => {
    process.env.DEBUG = "machinen:*";
    printHeadline("booting counter…");
    expect(written).toBe("");
  });
});

describe("printDiagnostics", () => {
  let written = "";
  let savedDebug: string | undefined;
  const origWrite = process.stderr.write.bind(process.stderr);
  beforeEach(() => {
    savedDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    written = "";
    // @ts-ignore monkeypatch for test
    process.stderr.write = (chunk: string | Buffer) => {
      written += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };
  });
  afterEach(() => {
    process.stderr.write = origWrite;
    if (savedDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = savedDebug;
    }
  });

  it("emits summary + envelope + hint when there's buffered content", () => {
    const rb = new RingBuffer();
    rb.push("checkpoint: post-bringUpNetwork\n");
    rb.push("init: panic\n");
    printDiagnostics("boot counter failed: guest did not respond", { buffer: rb });
    expect(written).toContain("boot counter failed: guest did not respond");
    expect(written).toContain("--- diagnostics ---");
    expect(written).toContain("checkpoint: post-bringUpNetwork");
    expect(written).toContain("init: panic");
    expect(written).toContain("--------------------");
    expect(written).toContain("run with DEBUG=machinen:* for live output");
  });

  it("skips the envelope when the buffer is empty (still prints summary + hint)", () => {
    printDiagnostics("install failed: 404");
    expect(written).toContain("install failed: 404");
    expect(written).not.toContain("--- diagnostics ---");
    expect(written).toContain("run with DEBUG=machinen:* for live output");
  });

  it("renders labeled tails inside the envelope", () => {
    printDiagnostics("restore counter failed: criu", {
      buffer: "lazy-pages daemon died\n",
      tails: { "restore.log": "criu: cannot open img/core.img\n" },
    });
    expect(written).toContain("[restore.log]");
    expect(written).toContain("criu: cannot open img/core.img");
  });

  it("in operator mode emits just the summary line, no envelope, no hint", () => {
    process.env.DEBUG = "machinen:*";
    const rb = new RingBuffer();
    rb.push("checkpoint: x\n");
    printDiagnostics("boot counter failed: x", { buffer: rb });
    expect(written).toBe("boot counter failed: x\n");
  });
});
