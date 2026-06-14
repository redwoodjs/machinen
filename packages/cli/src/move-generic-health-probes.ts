import type { MoveDescriptor } from "@machinen/runtime";

import { shellQuote } from "./move-preflight-helpers.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];

export function healthProbeCommand(probe: NonNullable<GenericState>["healthProbe"]): string {
  if (probe.kind === "process-alive") {
    return `kill -0 "$pid" 2>/dev/null || probe_fail health-process-dead`;
  }
  if (probe.kind === "tcp-connect") {
    return probe.expectedBannerSha256
      ? tcpBannerProbeCommand(probe.host, probe.port, probe.expectedBannerSha256)
      : tcpConnectProbeCommand(probe.host, probe.port, "health-tcp-connect-failed");
  }
  if (probe.kind === "unix-connect") {
    return unixConnectProbeCommand(probe.path);
  }
  if (probe.kind === "http") {
    return `python3 - ${shellQuote(probe.url)} ${shellQuote(String(probe.expectedStatus ?? 200))} <<'PY' || probe_fail health-http-failed
import sys, time, urllib.request
for _ in range(30):
    try:
        response = urllib.request.urlopen(sys.argv[1], timeout=1)
        sys.exit(0 if response.status == int(sys.argv[2]) else 1)
    except Exception:
        time.sleep(0.1)
sys.exit(1)
PY`;
  }
  const digestCheck = probe.expectedStdoutSha256
    ? `[ "$(sha256sum /tmp/machinen-generic-health-$$.out | cut -d' ' -f1)" = ${shellQuote(probe.expectedStdoutSha256)} ] || probe_fail health-command-digest-mismatch`
    : "";
  return `${probe.argv.map(shellQuote).join(" ")} >/tmp/machinen-generic-health-$$.out 2>/dev/null || probe_fail health-command-failed
${digestCheck}`;
}

function unixConnectProbeCommand(path: string): string {
  return `python3 - ${shellQuote(path)} <<'PY' || probe_fail health-unix-connect-failed
import socket, sys, time
for _ in range(30):
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.connect(sys.argv[1])
        s.close()
        sys.exit(0)
    except OSError:
        time.sleep(0.1)
sys.exit(1)
PY`;
}

function tcpConnectProbeCommand(host: string, port: number, reason: string): string {
  return `python3 - ${shellQuote(host)} ${shellQuote(String(port))} <<'PY' || probe_fail ${reason}
import socket, sys, time
for _ in range(30):
    try:
        s = socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1)
        s.close()
        sys.exit(0)
    except OSError:
        time.sleep(0.1)
sys.exit(1)
PY`;
}

function tcpBannerProbeCommand(host: string, port: number, expectedSha256: string): string {
  return `python3 - ${shellQuote(host)} ${shellQuote(String(port))} ${shellQuote(expectedSha256)} <<'PY' || probe_fail health-tcp-banner-failed
import hashlib, socket, sys, time
for _ in range(30):
    try:
        s = socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1)
        data = s.recv(4096)
        s.close()
        sys.exit(0 if hashlib.sha256(data).hexdigest() == sys.argv[3] else 1)
    except OSError:
        time.sleep(0.1)
sys.exit(1)
PY`;
}
