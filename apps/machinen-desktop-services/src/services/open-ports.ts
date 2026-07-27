import type { StatusWidget, Workspace, WorkspaceLocation } from "@machinen/desktop-sdk";

import { DesktopState } from "../desktop-state.js";
import type { StatusPublisher } from "../status-publisher.js";
import { runWorkspaceProbe } from "../workspace-probe.js";
import { WorkspacePollingService } from "../workspace-polling-service.js";

const rootMarker = "---MACHINEN-PORTS-ROOT---";
const listenersMarker = "---MACHINEN-PORTS-LISTENERS---";
const workingDirectoriesMarker = "---MACHINEN-PORTS-CWDS---";
const defaultPollIntervalMilliseconds = 4_000;
const widgetTTLMilliseconds = 10_000;

export interface ListeningService {
  process: string;
  pid: number;
  port: number;
  addresses: string[];
}

interface OpenPortsServiceOptions {
  pollIntervalMilliseconds?: number;
  probe?: (location: WorkspaceLocation, signal?: AbortSignal) => Promise<ListeningService[]>;
}

export function portsProbeScript(directory: string): string {
  return [
    `root=$(cd ${directory} 2>/dev/null && pwd -P) || exit 1`,
    "lsof=$(command -v lsof) || exit 1",
    'listeners=$("$lsof" -nP -iTCP -sTCP:LISTEN -Fpcn)',
    `printf '%s\\n%s\\n%s\\n%s\\n%s\\n' '${rootMarker}' "$root" '${listenersMarker}' "$listeners" '${workingDirectoriesMarker}'`,
    "pids=$(printf '%s\\n' \"$listeners\" | awk '/^p[0-9]+$/ { print substr($0, 2) }' | sort -u | paste -sd, -)",
    'if [ -n "$pids" ]; then',
    '  "$lsof" -a -p "$pids" -d cwd -Fpn 2>/dev/null || true',
    "fi",
  ].join("\n");
}

async function probeOpenPorts(
  location: WorkspaceLocation,
  signal?: AbortSignal,
): Promise<ListeningService[]> {
  const output = await runWorkspaceProbe(location, portsProbeScript, signal);
  return parseOpenPortsOutput(output);
}

export function parseOpenPortsOutput(output: string): ListeningService[] {
  const rootSection = output.split(`${rootMarker}\n`);
  if (rootSection.length !== 2) {
    return [];
  }
  const listenerSections = rootSection[1].split(`\n${listenersMarker}\n`);
  if (listenerSections.length !== 2) {
    return [];
  }
  const cwdSections = listenerSections[1].split(`\n${workingDirectoriesMarker}\n`);
  if (cwdSections.length !== 2) {
    return [];
  }

  const root = listenerSections[0].trim();
  const services = parseListeningServices(cwdSections[0]);
  const workingDirectories = parseWorkingDirectories(cwdSections[1]);
  return services.filter((service) => {
    const cwd = workingDirectories.get(service.pid);
    return cwd !== undefined && pathIsInside(cwd, root);
  });
}

function parseListeningServices(output: string): ListeningService[] {
  const parser = new ListeningServiceParser();
  for (const line of output.split("\n")) {
    parser.accept(line);
  }
  return parser.services();
}

class ListeningServiceParser {
  private currentPID?: number;
  private readonly names = new Map<number, string>();
  private readonly listeners = new Map<number, Map<number, Set<string>>>();

  accept(line: string): void {
    const prefix = line[0];
    const value = line.slice(1);
    if (prefix === "p") {
      this.selectProcess(value);
      return;
    }
    if (prefix === "c") {
      this.recordName(value);
      return;
    }
    if (prefix === "n") {
      this.recordAddress(value);
    }
  }

  services(): ListeningService[] {
    return [...this.listeners.entries()]
      .flatMap(([pid, processListeners]) =>
        [...processListeners.entries()].map(([port, addresses]) => ({
          process: this.names.get(pid) ?? `PID ${pid}`,
          pid,
          port,
          addresses: [...addresses].sort(),
        })),
      )
      .sort((left, right) => left.port - right.port || left.process.localeCompare(right.process));
  }

  private selectProcess(value: string): void {
    const pid = Number(value);
    this.currentPID = Number.isInteger(pid) ? pid : undefined;
  }

  private recordName(value: string): void {
    if (this.currentPID !== undefined) {
      this.names.set(this.currentPID, value);
    }
  }

  private recordAddress(value: string): void {
    const port = Number(value.split(":").at(-1));
    if (this.currentPID === undefined || !Number.isInteger(port) || port <= 0) {
      return;
    }
    const processListeners = this.listeners.get(this.currentPID) ?? new Map();
    this.listeners.set(this.currentPID, processListeners);
    const addresses = processListeners.get(port) ?? new Set();
    processListeners.set(port, addresses);
    addresses.add(value);
  }
}

function parseWorkingDirectories(output: string): Map<number, string> {
  let currentPID: number | undefined;
  const result = new Map<number, string>();
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      currentPID = Number.isInteger(pid) ? pid : undefined;
    } else if (line.startsWith("n") && currentPID !== undefined) {
      result.set(currentPID, line.slice(1));
    }
  }
  return result;
}

function pathIsInside(path: string, root: string): boolean {
  if (!root) {
    return false;
  }
  return path === root || path.startsWith(root === "/" ? root : `${root}/`);
}

export function openPortsWidget(workspace: Workspace, services: ListeningService[]): StatusWidget {
  const summaries = services.map((service) => {
    const address = service.addresses[0] ?? `:${service.port}`;
    return `${service.process} ${address}`;
  });
  const browserHost =
    workspace.location.kind === "local"
      ? "localhost"
      : (workspace.location.host
          .split("@")
          .at(-1)
          ?.replace(/^\[|\]$/g, "") ?? workspace.location.host);
  return {
    id: "machinen.services",
    scope: { kind: "workspace", id: workspace.id },
    placement: "right",
    kind: "state",
    label: "Open ports",
    value: String(services.length),
    tone: "neutral",
    tooltip: summaries.join("\n"),
    priority: 80,
    ttlMilliseconds: widgetTTLMilliseconds,
    states: services.slice(0, 16).map(() => "neutral"),
    links: services.map((service, index) => ({
      title: `${summaries[index]} — http://${browserHost}:${service.port}`,
      url: `http://${browserHost}:${service.port}`,
    })),
  };
}

export class OpenPortsService extends WorkspacePollingService<ListeningService[]> {
  constructor(
    desktop: StatusPublisher,
    state: DesktopState,
    options: OpenPortsServiceOptions = {},
  ) {
    super(state, {
      name: "Open ports service",
      pollIntervalMilliseconds: options.pollIntervalMilliseconds ?? defaultPollIntervalMilliseconds,
      probe: options.probe ?? probeOpenPorts,
      publish: (workspace, services) =>
        services.length > 0
          ? desktop.status.set(openPortsWidget(workspace, services))
          : Promise.resolve(),
    });
  }
}
