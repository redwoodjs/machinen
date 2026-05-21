/** Shared helpers for readelf .eh_frame text parsing. */

interface NativeEhFrameTextBlock {
  start: bigint;
  end: bigint;
  lines: string[];
}

export function nativeEhFrameTextBlocks(stdout: string): NativeEhFrameTextBlock[] {
  const blocks: NativeEhFrameTextBlock[] = [];
  let current: NativeEhFrameTextBlock | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const match = /FDE .* pc=([0-9a-fA-F]+)\.\.([0-9a-fA-F]+)/.exec(line);
    if (match?.[1] && match[2]) {
      current = { start: BigInt(`0x${match[1]}`), end: BigInt(`0x${match[2]}`), lines: [] };
      blocks.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return blocks;
}

export function nativeLastCapture(lines: string[], pattern: RegExp): string | undefined {
  let captured: string | undefined;
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1] && match[2]) {
      captured = `${match[1]}:${match[2]}`;
      continue;
    }
    if (match?.[1]) {
      captured = match[1];
    }
  }
  return captured;
}
