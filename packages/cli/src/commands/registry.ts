import { list, readHostRssBytesMulti, runGc, type RegistryEntry } from "@machinen/runtime";

import { formatMem } from "../format-mem.ts";
import { formatPorts } from "../format-ports.ts";

export async function cmdLs(args: string[]): Promise<number> {
  const { json, rest } = consumeJsonFlag(args);
  if (rest.length > 0) {
    die(`unknown argument: ${rest[0]}`);
  }
  const entries = list();
  const rssByPid = rssByRegistryPid(entries);
  if (json) {
    emitLsJson(entries, rssByPid);
  } else {
    printLsTable(entries, rssByPid);
  }
  return 0;
}

export async function cmdGc(args: string[]): Promise<number> {
  const { json, dryRun, rest } = parseGcOptions(args);
  dieOnUnexpectedArgs(rest);
  const results = runGc({ dryRun });
  if (json) {
    emitGcJson(dryRun, results);
  } else {
    printGcResults(results, dryRun);
  }
  return 0;
}

function rssByRegistryPid(entries: RegistryEntry[]): Map<number, number> {
  return readHostRssBytesMulti(
    entries.map((entry) => ({ pid: entry.pid, statsPath: entry.statsPath })),
  );
}

function emitLsJson(entries: RegistryEntry[], rssByPid: Map<number, number>): void {
  emitJson({
    schema_version: 1,
    vms: entries.map((entry) => vmJson(entry, rssByPid)),
  });
}

function vmJson(entry: RegistryEntry, rssByPid: Map<number, number>): unknown {
  return {
    pid: entry.pid,
    name: nullable(entry.name),
    started_at: entry.startedAt,
    uptime_ms: Date.now() - entry.startedAt,
    memory: vmMemoryJson(entry, rssByPid),
    ports: portsJson(entry),
    forked_from: nullable(entry.forkedFrom),
  };
}

function portsJson(entry: RegistryEntry): NonNullable<RegistryEntry["portForward"]> {
  if (entry.portForward === undefined) {
    return [];
  }
  return entry.portForward;
}

function vmMemoryJson(entry: RegistryEntry, rssByPid: Map<number, number>): unknown {
  return {
    rss_bytes: nullable(rssByPid.get(entry.pid)),
    ceiling_mib: nullable(entry.memoryCeilingMib),
  };
}

function nullable<T>(value: T | undefined): T | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

function printLsTable(entries: RegistryEntry[], rssByPid: Map<number, number>): void {
  if (entries.length === 0) {
    process.stdout.write("(no running VMs)\n");
    return;
  }
  const header = ["PID", "NAME", "UP", "MEM", "PORTS", "FORKED-FROM"];
  const rows = lsRows(entries, rssByPid);
  const widths = tableWidths(header, rows);
  const visible = visibleLsColumns(header, widths);
  printTable(header, rows, widths, visible);
}

function lsRows(entries: RegistryEntry[], rssByPid: Map<number, number>): string[][] {
  return entries.map((entry) => [
    String(entry.pid),
    entry.name ?? "-",
    formatUptime(Date.now() - entry.startedAt),
    formatMem(rssByPid.get(entry.pid) ?? null, entry.memoryCeilingMib),
    formatPorts(entry.portForward),
    entry.forkedFrom ?? "-",
  ]);
}

function tableWidths(header: string[], rows: string[][]): number[] {
  return header.map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => row[index]!.length)),
  );
}

function visibleLsColumns(header: string[], widths: number[]): number[] {
  const gap = "  ";
  const fullWidth =
    widths.reduce((sum, width) => sum + width, 0) + gap.length * (widths.length - 1);
  const cols = process.stdout.columns;
  const includeMem = cols === undefined || fullWidth <= cols;
  return includeMem ? header.map((_, i) => i) : header.map((_, i) => i).filter((i) => i !== 3);
}

function printTable(header: string[], rows: string[][], widths: number[], visible: number[]): void {
  process.stdout.write(`${formatTableLine(header, widths, visible)}\n`);
  for (const row of rows) {
    process.stdout.write(`${formatTableLine(row, widths, visible)}\n`);
  }
}

function formatTableLine(cells: string[], widths: number[], visible: number[]): string {
  return visible.map((index) => cells[index]!.padEnd(widths[index]!)).join("  ");
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h`;
  }
  return `${Math.floor(h / 24)}d`;
}

function parseGcOptions(args: string[]): { json: boolean; dryRun: boolean; rest: string[] } {
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest } = consumeDryRunFlag(afterJson);
  return { json, dryRun, rest };
}

function dieOnUnexpectedArgs(args: string[]): void {
  for (const arg of args) {
    die(`unknown flag: ${arg}`);
  }
}

function emitGcJson(dryRun: boolean, results: ReturnType<typeof runGc>): void {
  emitJson({
    schema_version: 1,
    dry_run: dryRun,
    results: results.map((r) => ({
      pid: r.pid,
      name: r.name ?? null,
      status: r.status,
      removed_paths: r.removedPaths,
      failed_paths: r.failedPaths,
    })),
  });
}

function printGcResults(results: ReturnType<typeof runGc>, dryRun: boolean): void {
  if (results.length === 0) {
    process.stdout.write("(nothing to clean up)\n");
    return;
  }
  for (const result of results) {
    printGcResult(result, dryRun);
  }
}

function printGcResult(result: ReturnType<typeof runGc>[number], dryRun: boolean): void {
  const label = result.name ? `${result.name} (pid ${result.pid})` : `pid ${result.pid}`;
  const verb = dryRun ? "would clean" : "cleaned";
  process.stdout.write(
    `${verb} ${label} [${result.status}]: ${result.removedPaths.length} path(s)\n`,
  );
  printIndentedPaths(result.removedPaths, "");
  printIndentedPaths(result.failedPaths, "failed: ");
}

function printIndentedPaths(paths: string[], prefix: string): void {
  for (const path of paths) {
    process.stdout.write(`  ${prefix}${path}\n`);
  }
}

function consumeJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const rest: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else {
      rest.push(arg);
    }
  }
  return { json, rest };
}

function consumeDryRunFlag(args: string[]): { dryRun: boolean; rest: string[] } {
  const rest: string[] = [];
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else {
      rest.push(arg);
    }
  }
  return { dryRun, rest };
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function die(msg: string): never {
  process.stderr.write(`machinen: ${msg}\n`);
  process.exit(1);
}
