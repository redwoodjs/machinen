type ProgressOutput = {
  isTTY?: boolean;
  write(chunk: string): unknown;
};

type AssetProgress = {
  started: boolean;
  complete: boolean;
  receivedBytes: number;
  totalBytes?: number;
};

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const UNKNOWN_TOTAL_TTY_STEP = 8 * MIB;
const UNKNOWN_TOTAL_LOG_STEP = 64 * MIB;

/** Aggregate progress for the base assets downloaded in parallel. */
export class DownloadProgress {
  private readonly assets = new Map<string, AssetProgress>();
  private readonly tty: boolean;
  private lastLine = "";
  private lastPercentageBucket = -1;
  private lastUnknownBytes = -1;
  private maxLineLength = 0;
  private closed = false;

  constructor(
    assetNames: string[],
    private readonly output: ProgressOutput = process.stderr,
  ) {
    for (const name of assetNames) {
      this.assets.set(name, { started: false, complete: false, receivedBytes: 0 });
    }
    this.tty = output.isTTY === true;
  }

  beginAsset(name: string, totalBytes: number | undefined): void {
    if (this.closed) {
      return;
    }
    const asset = this.asset(name);
    asset.started = true;
    asset.totalBytes = validTotalBytes(totalBytes);
    if (this.allStarted()) {
      this.render(true);
    }
  }

  addBytes(name: string, bytes: number): void {
    if (this.closed || !Number.isFinite(bytes) || bytes <= 0) {
      return;
    }
    this.asset(name).receivedBytes += bytes;
    this.render(false);
  }

  finishAsset(name: string): void {
    if (this.closed) {
      return;
    }
    this.asset(name).complete = true;
    if (this.totalBytes() === undefined) {
      this.render(true);
    }
  }

  close(success: boolean): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (success) {
      this.render(true);
    }
    if (this.tty && this.lastLine) {
      this.output.write("\n");
    }
  }

  private render(force: boolean): void {
    if (!this.allStarted()) {
      return;
    }
    const received = this.receivedBytes();
    const total = this.totalBytes();
    if (!force && !this.crossedRenderStep(received, total)) {
      return;
    }
    const line = progressLine(received, total, this.completedAssets(), this.assets.size);
    this.recordRenderedStep(received, total);
    if (line === this.lastLine) {
      return;
    }
    this.lastLine = line;
    if (this.tty) {
      const padding = " ".repeat(Math.max(0, this.maxLineLength - line.length));
      this.maxLineLength = Math.max(this.maxLineLength, line.length);
      this.output.write(`\r${line}${padding}`);
      return;
    }
    this.output.write(`${line}\n`);
  }

  private crossedRenderStep(received: number, total: number | undefined): boolean {
    if (total !== undefined) {
      const percentage = Math.min(100, Math.floor((received / total) * 100));
      const step = this.tty ? 1 : 10;
      return Math.floor(percentage / step) > this.lastPercentageBucket;
    }
    const step = this.tty ? UNKNOWN_TOTAL_TTY_STEP : UNKNOWN_TOTAL_LOG_STEP;
    return this.lastUnknownBytes < 0 || received - this.lastUnknownBytes >= step;
  }

  private recordRenderedStep(received: number, total: number | undefined): void {
    if (total === undefined) {
      this.lastUnknownBytes = received;
      return;
    }
    const percentage = Math.min(100, Math.floor((received / total) * 100));
    const step = this.tty ? 1 : 10;
    this.lastPercentageBucket = Math.floor(percentage / step);
  }

  private asset(name: string): AssetProgress {
    const asset = this.assets.get(name);
    if (!asset) {
      throw new Error(`download progress received unknown asset: ${name}`);
    }
    return asset;
  }

  private allStarted(): boolean {
    return [...this.assets.values()].every((asset) => asset.started);
  }

  private completedAssets(): number {
    return [...this.assets.values()].filter((asset) => asset.complete).length;
  }

  private receivedBytes(): number {
    return [...this.assets.values()].reduce((sum, asset) => sum + asset.receivedBytes, 0);
  }

  private totalBytes(): number | undefined {
    let total = 0;
    for (const asset of this.assets.values()) {
      if (asset.totalBytes === undefined) {
        return undefined;
      }
      total += asset.totalBytes;
    }
    return total > 0 ? total : undefined;
  }
}

function validTotalBytes(bytes: number | undefined): number | undefined {
  return bytes !== undefined && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined;
}

function progressLine(
  received: number,
  total: number | undefined,
  completed: number,
  assetCount: number,
): string {
  if (total === undefined) {
    return (
      `machinen: downloading base assets (${formatBytes(received)}, ` +
      `${completed}/${assetCount} files)`
    );
  }
  const percentage = Math.min(100, Math.floor((received / total) * 100));
  return (
    `machinen: downloading base assets: ${percentage}% ` +
    `(${formatBytes(received)} / ${formatBytes(total)})`
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= GIB) {
    return `${(bytes / GIB).toFixed(1)} GiB`;
  }
  if (bytes >= MIB) {
    return `${(bytes / MIB).toFixed(1)} MiB`;
  }
  if (bytes >= KIB) {
    return `${(bytes / KIB).toFixed(1)} KiB`;
  }
  return `${bytes} B`;
}
