import { describe, expect, it } from "vitest";

import { DownloadProgress } from "../download-progress.ts";

function output(isTTY: boolean): { chunks: string[]; stream: TestOutput } {
  const chunks: string[] = [];
  return {
    chunks,
    stream: {
      isTTY,
      write(chunk: string) {
        chunks.push(chunk);
      },
    },
  };
}

type TestOutput = {
  isTTY: boolean;
  write(chunk: string): void;
};

const MIB = 1024 * 1024;

describe("DownloadProgress", () => {
  it("updates one aggregate percentage line while parallel assets download on a TTY", () => {
    const sink = output(true);
    const progress = new DownloadProgress(["kernel", "rootfs"], sink.stream);

    progress.beginAsset("kernel", 100 * MIB);
    progress.beginAsset("rootfs", 100 * MIB);
    progress.addBytes("kernel", 10 * MIB);
    progress.addBytes("kernel", 1);
    progress.addBytes("kernel", 90 * MIB - 1);
    progress.addBytes("rootfs", 100 * MIB);
    progress.finishAsset("kernel");
    progress.finishAsset("rootfs");
    progress.close(true);

    expect(sink.chunks.join("")).toContain("downloading base assets: 0%");
    expect(sink.chunks.join("")).toContain("downloading base assets: 5%");
    expect(sink.chunks.join("")).toContain("downloading base assets: 50%");
    expect(sink.chunks.join("")).toContain("200.0 MiB / 200.0 MiB");
    expect(sink.chunks.filter((chunk) => chunk.includes("base assets"))).toHaveLength(4);
    expect(sink.chunks.at(-1)).toBe("\n");
  });

  it("emits newline-delimited 10% milestones when stderr is not a TTY", () => {
    const sink = output(false);
    const progress = new DownloadProgress(["kernel", "rootfs"], sink.stream);

    progress.beginAsset("kernel", 100);
    progress.beginAsset("rootfs", 100);
    progress.addBytes("kernel", 19);
    progress.addBytes("kernel", 1);
    progress.addBytes("rootfs", 180);
    progress.finishAsset("kernel");
    progress.finishAsset("rootfs");
    progress.close(true);

    expect(sink.chunks).toEqual([
      "machinen: downloading base assets: 0% (0 B / 200 B)\n",
      "machinen: downloading base assets: 10% (20 B / 200 B)\n",
      "machinen: downloading base assets: 100% (200 B / 200 B)\n",
    ]);
  });

  it("reports downloaded bytes and completed files when content lengths are unavailable", () => {
    const sink = output(false);
    const progress = new DownloadProgress(["rootfs"], sink.stream);

    progress.beginAsset("rootfs", undefined);
    progress.addBytes("rootfs", 1024);
    progress.finishAsset("rootfs");
    progress.close(true);

    expect(sink.chunks).toEqual([
      "machinen: downloading base assets (0 B, 0/1 files)\n",
      "machinen: downloading base assets (1.0 KiB, 1/1 files)\n",
    ]);
  });
});
