import type { MoveDescriptor } from "@machinen/runtime";

export type MoveCapture = NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>;
export type MoveTailState = NonNullable<MoveCapture["tailState"]>;
export type MoveLessState = NonNullable<MoveCapture["lessState"]>;
export type MoveViState = NonNullable<MoveCapture["viState"]>;
export type MoveReaderState = NonNullable<MoveCapture["readerState"]>;
export type MoveGrepState = NonNullable<MoveCapture["grepState"]>;
export type MoveWatchState = NonNullable<MoveCapture["watchState"]>;
export type MoveShellState = NonNullable<MoveCapture["shellState"]>;
export type MoveHttpState = NonNullable<MoveCapture["httpState"]>;
export type MoveBusyboxHttpState = NonNullable<MoveCapture["busyboxHttpState"]>;
export type MoveNcState = NonNullable<MoveCapture["ncState"]>;
export type MoveEnvState = NonNullable<MoveCapture["envState"]>;
export type MoveTimeoutState = NonNullable<MoveCapture["timeoutState"]>;
export type MovePythonStaticRouteState = NonNullable<MoveCapture["pythonStaticRouteState"]>;
export type MoveGoStaticHttpState = NonNullable<MoveCapture["goStaticHttpState"]>;
export type MoveRustStaticHttpState = NonNullable<MoveCapture["rustStaticHttpState"]>;
export type MoveNativeStaticHttpState = MoveGoStaticHttpState | MoveRustStaticHttpState;
export type MoveTailGrepPipelineState = NonNullable<MoveCapture["tailGrepPipelineState"]>;
export type MoveDdState = NonNullable<MoveCapture["ddState"]>;
export type MoveCpState = NonNullable<MoveCapture["cpState"]>;
export type MoveMvState = NonNullable<MoveCapture["mvState"]>;
export type MoveSortState = NonNullable<MoveCapture["sortState"]>;
export type MoveWcState = NonNullable<MoveCapture["wcState"]>;
export type MoveSha256State = NonNullable<MoveCapture["sha256State"]>;
export type MoveFindState = NonNullable<MoveCapture["findState"]>;
export type MoveTarState = NonNullable<MoveCapture["tarState"]>;

export function moveTailLoaderCommand(
  executable: string,
  tailState: MoveTailState | undefined,
): string {
  if (!tailState) {
    return "printf 'PATCH\\ttail-offset\\trefused\\tmissing-tail-state\\n'; exit 2";
  }
  const offsetArg = `+${tailState.offset + 1}`;
  return `set -eu
log="/tmp/machinen-move-loader-$$.log"
test -f ${shellQuote(tailState.path)}
${shellQuote(executable)} -c ${shellQuote(offsetArg)} -f -- ${shellQuote(tailState.path)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-tail-follow-started\n'
printf 'PATCH\ttail-offset\tready\t%s\t%s\n' ${shellQuote(tailState.path)} ${shellQuote(String(tailState.offset))}
`;
}

export function moveScriptPtyLoaderCommand(
  executable: string,
  kind: "less" | "vi",
  state: MoveLessState | MoveViState | undefined,
): string {
  if (!state) {
    return `printf 'PATCH\t${kind}-script-pty\trefused\tmissing-state\n'; exit 2`;
  }
  const log = `/tmp/machinen-move-loader-$$.typescript`;
  const command = moveScriptPtyAppCommand(executable, kind, state);
  return `set -eu
log=${shellQuote(log)}
setsid sh -c ${shellQuote(`tail -f /dev/null | TERM=xterm script -q -c ${shellQuote(command)} "$1" >/dev/null 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-${kind}-script-pty-started\n'
printf 'PATCH\t${kind}-script-pty\tready\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.line))}
`;
}

function moveScriptPtyAppCommand(
  executable: string,
  kind: "less" | "vi",
  state: MoveLessState | MoveViState,
): string {
  const args = [shellQuote(executable), `+${state.line}`];
  if (kind === "vi") {
    const viState = state as MoveViState;
    if (viState.searchPattern) {
      args.push(shellQuote(`+/${viState.searchPattern}`));
    }
    if (viState.dirtyText !== undefined) {
      args.push(shellQuote(`+normal! Go${viState.dirtyText}`));
    }
  }
  args.push("--", shellQuote(state.path));
  return args.join(" ");
}

export function moveReaderLoaderCommand(
  executable: string,
  state: MoveReaderState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\treader-offset\\trefused\\tmissing-reader-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
exec 3<${shellQuote(state.path)}
dd bs=1 count=${state.offset} <&3 >/dev/null 2>&1 || true
${shellQuote(executable)} <&3 >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-reader-offset-started\n'
printf 'PATCH\treader-offset\tready\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.offset))}
`;
}

export function moveGrepLoaderCommand(
  executable: string,
  state: MoveGrepState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tgrep-offset\\trefused\\tmissing-grep-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
exec 3<${shellQuote(state.path)}
dd bs=1 count=${state.offset} <&3 >/dev/null 2>&1 || true
${shellQuote(executable)} -- ${shellQuote(state.pattern)} <&3 >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-grep-offset-started\n'
printf 'PATCH\tgrep-offset\tready\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.offset))}
`;
}

export function moveWatchLoaderCommand(
  executable: string,
  state: MoveWatchState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\twatch-loop\\trefused\\tmissing-watch-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.typescript";
  const command = [
    shellQuote(executable),
    "-n",
    shellQuote(String(state.intervalSeconds)),
    ...state.command.map(shellQuote),
  ].join(" ");
  return `set -eu
log=${shellQuote(log)}
setsid sh -c ${shellQuote(`tail -f /dev/null | TERM=xterm script -q -c ${shellQuote(command)} "$1" >/dev/null 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-watch-loop-started\n'
printf 'PATCH\twatch-loop\tready\t%s\t%s\n' ${shellQuote(String(state.intervalSeconds))} ${shellQuote(state.command.join(" "))}
`;
}

export function moveShellLoaderCommand(
  executable: string,
  state: MoveShellState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tsh-script-pty\\trefused\\tmissing-shell-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.typescript";
  const command = `cd ${shellQuote(state.cwd)} && exec ${shellQuote(executable)}`;
  return `set -eu
log=${shellQuote(log)}
setsid sh -c ${shellQuote(`tail -f /dev/null | TERM=xterm script -q -c ${shellQuote(command)} "$1" >/dev/null 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-sh-script-pty-started\n'
printf 'PATCH\tsh-script-pty\tready\t%s\n' ${shellQuote(state.cwd)}
`;
}

export function moveGoStaticHttpLoaderCommand(
  executable: string,
  state: MoveGoStaticHttpState | undefined,
): string {
  return moveNativeStaticHttpLoaderCommand(executable, state, "go-static-http", "go");
}

export function moveRustStaticHttpLoaderCommand(
  executable: string,
  state: MoveRustStaticHttpState | undefined,
): string {
  return moveNativeStaticHttpLoaderCommand(executable, state, "rust-static-http", "rust");
}

function moveNativeStaticHttpLoaderCommand(
  executable: string,
  state: MoveNativeStaticHttpState | undefined,
  patchName: "go-static-http" | "rust-static-http",
  runtimeName: "go" | "rust",
): string {
  if (!state) {
    return `printf 'PATCH\t${patchName}\trefused\tmissing-${patchName}-state\n'; exit 2`;
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const probe = `from urllib.request import urlopen; import sys; body=urlopen('http://127.0.0.1:${state.port}${state.healthPath}', timeout=2).read().decode(); sys.exit(0 if body == 'ok\\n' else 2)`;
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\t${patchName}\trefused\tmissing-binary\n'
  exit 2
fi
if python3 -c ${shellQuote(probe)} >/dev/null 2>&1; then
  printf 'PATCH\t${patchName}\trefused\tport-in-use\n'
  exit 2
fi
setsid sh -c ${shellQuote(`cd ${shellQuote(state.cwd)} && exec ${shellQuote(executable)} --machinen-move-envelope ${shellQuote(state.markerVersion)} --port ${state.port} --health ${shellQuote(state.healthPath)} >"$1" 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\t${patchName}\trefused\tstart-failed\n'
    exit 2
  fi
  if python3 -c ${shellQuote(probe)} >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\t${patchName}\trefused\tnot-serving-health\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-${runtimeName}-static-http-started\n'
printf 'PATCH\t${patchName}\tready\t%s\t%s\t%s\n' ${shellQuote(executable)} ${shellQuote(String(state.port))} ${shellQuote(state.healthPath)}
`;
}

export function movePythonStaticRouteLoaderCommand(
  executable: string,
  state: MovePythonStaticRouteState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tpython-static-route\\trefused\\tmissing-python-static-route-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const probe = `from urllib.request import urlopen; import sys; body=urlopen('http://127.0.0.1:${state.port}${state.route}', timeout=2).read().decode(); sys.exit(0 if body == ${JSON.stringify(state.expectedBody)} else 2)`;
  return `set -eu
log=${shellQuote(log)}
if [ ! -f ${shellQuote(state.scriptPath)} ]; then
  printf 'PATCH\tpython-static-route\trefused\tmissing-script\n'
  exit 2
fi
if ${shellQuote(executable)} -c ${shellQuote(probe)} >/dev/null 2>&1; then
  printf 'PATCH\tpython-static-route\trefused\tport-in-use\n'
  exit 2
fi
(cd ${shellQuote(state.cwd)} && exec ${shellQuote(executable)} ${shellQuote(state.scriptPath)} >"$log" 2>&1) &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tpython-static-route\trefused\tstart-failed\n'
    exit 2
  fi
  if ${shellQuote(executable)} -c ${shellQuote(probe)} >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tpython-static-route\trefused\tnot-serving-route\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-python-static-route-started\n'
printf 'PATCH\tpython-static-route\tready\t%s\t%s\t%s\n' ${shellQuote(state.scriptPath)} ${shellQuote(String(state.port))} ${shellQuote(state.route)}
`;
}

export function moveTimeoutLoaderCommand(
  executable: string,
  state: MoveTimeoutState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\ttimeout-python-http-server\\trefused\\tmissing-timeout-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const httpState = state.httpState;
  const probe = `import socket; s=socket.create_connection(("127.0.0.1", ${httpState.port}), 2); s.close()`;
  const directoryArg = httpState.directory ? ` --directory ${shellQuote(httpState.directory)}` : "";
  return `set -eu
log=${shellQuote(log)}
if [ ! -d ${shellQuote(httpState.cwd)} ]; then
  printf 'PATCH\ttimeout-python-http-server\trefused\tmissing-cwd\n'
  exit 2
fi
if [ "${httpState.directory ? "1" : "0"}" = "1" ] && [ ! -d ${shellQuote(httpState.directory ?? "/")} ]; then
  printf 'PATCH\ttimeout-python-http-server\trefused\tmissing-directory\n'
  exit 2
fi
if /usr/bin/python3 -c ${shellQuote(probe)} >/dev/null 2>&1; then
  printf 'PATCH\ttimeout-python-http-server\trefused\tport-in-use\n'
  exit 2
fi
(cd ${shellQuote(httpState.cwd)} && exec ${shellQuote(executable)} ${state.seconds} /usr/bin/python3 -m http.server ${httpState.port} --bind 127.0.0.1${directoryArg} >"$log" 2>&1) &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\ttimeout-python-http-server\trefused\tstart-failed\n'
    exit 2
  fi
  if /usr/bin/python3 -c ${shellQuote(probe)} >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\ttimeout-python-http-server\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-timeout-python-http-server-started\n'
printf 'PATCH\ttimeout-python-http-server\tready\t%s\t%s\t%s\n' ${shellQuote(String(state.seconds))} ${shellQuote(String(httpState.port))} ${shellQuote(httpState.directory ?? "")}
`;
}

export function moveNcLoaderCommand(executable: string, state: MoveNcState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tnc-listener\\trefused\\tmissing-nc-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const probe = `import socket; s=socket.create_connection(("127.0.0.1", ${state.port}), 2); s.close()`;
  return `set -eu
log=${shellQuote(log)}
if python3 -c ${shellQuote(probe)} >/dev/null 2>&1; then
  printf 'PATCH\tnc-listener\trefused\tport-in-use\n'
  exit 2
fi
${shellQuote(executable)} -l ${state.port} >"$log" 2>&1 &
pid=$!
sleep 0.5
if ! kill -0 "$pid" 2>/dev/null; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tnc-listener\trefused\tstart-failed\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-nc-listener-started\n'
printf 'PATCH\tnc-listener\tready\t%s\n' ${shellQuote(String(state.port))}
`;
}

export function moveBusyboxHttpLoaderCommand(
  executable: string,
  state: MoveBusyboxHttpState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tbusybox-httpd\\trefused\\tmissing-busybox-http-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const probe = `import socket; s=socket.create_connection(("127.0.0.1", ${state.port}), 2); s.close()`;
  return `set -eu
log=${shellQuote(log)}
if [ ! -d ${shellQuote(state.root)} ]; then
  printf 'PATCH\tbusybox-httpd\trefused\tmissing-root\n'
  exit 2
fi
if python3 -c ${shellQuote(probe)} >/dev/null 2>&1; then
  printf 'PATCH\tbusybox-httpd\trefused\tport-in-use\n'
  exit 2
fi
${shellQuote(executable)} httpd -f -p 127.0.0.1:${state.port} -h ${shellQuote(state.root)} >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tbusybox-httpd\trefused\tstart-failed\n'
    exit 2
  fi
  if python3 -c ${shellQuote(probe)} >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tbusybox-httpd\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-busybox-httpd-started\n'
printf 'PATCH\tbusybox-httpd\tready\t%s\t%s\n' ${shellQuote(state.root)} ${shellQuote(String(state.port))}
`;
}

export function moveHttpLoaderCommand(
  executable: string,
  state: MoveHttpState | undefined,
  envState?: MoveEnvState,
): string {
  if (!state) {
    return "printf 'PATCH\\tpython-http-server\\trefused\\tmissing-http-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const probe = `import socket; s=socket.create_connection(("127.0.0.1", ${state.port}), 2); s.close()`;
  const directoryArg = state.directory ? ` --directory ${shellQuote(state.directory)}` : "";
  const envPrefix = envState ? `env ${shellQuote(`${envState.key}=${envState.value}`)} ` : "";
  return `set -eu
log=${shellQuote(log)}
if [ ! -d ${shellQuote(state.cwd)} ]; then
  printf 'PATCH\tpython-http-server\trefused\tmissing-cwd\n'
  exit 2
fi
if [ "${state.directory ? "1" : "0"}" = "1" ] && [ ! -d ${shellQuote(state.directory ?? "/")} ]; then
  printf 'PATCH\tpython-http-server\trefused\tmissing-directory\n'
  exit 2
fi
if ${shellQuote(executable)} -c ${shellQuote(probe)} >/dev/null 2>&1; then
  printf 'PATCH\tpython-http-server\trefused\tport-in-use\n'
  exit 2
fi
(cd ${shellQuote(state.cwd)} && exec ${envPrefix}${shellQuote(executable)} -m http.server ${state.port} --bind 127.0.0.1${directoryArg} >"$log" 2>&1) &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tpython-http-server\trefused\tstart-failed\n'
    exit 2
  fi
  if ${shellQuote(executable)} -c ${shellQuote(probe)} >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tpython-http-server\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-python-http-server-started\n'
printf 'PATCH\tpython-http-server\tready\t%s\t%s\t%s\n' ${shellQuote(state.cwd)} ${shellQuote(String(state.port))} ${shellQuote(state.directory ?? "")}
`;
}

export function moveTarLoaderCommand(executable: string, state: MoveTarState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\ttar-create\\trefused\\tmissing-tar-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
rm -f ${shellQuote(state.archivePath)}
if ! ${shellQuote(executable)} -cf ${shellQuote(state.archivePath)} ${shellQuote(state.sourceDir)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\ttar-create\trefused\ttar-failed\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-tar-create-completed\n'
printf 'PATCH\ttar-create\tready\t%s\t%s\n' ${shellQuote(state.archivePath)} ${shellQuote(state.sourceDir)}
`;
}

export function moveFindLoaderCommand(
  executable: string,
  state: MoveFindState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tfind-cursor\\trefused\\tmissing-find-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const last = state.lastPath ?? "";
  return `set -eu
log=${shellQuote(log)}
${shellQuote(executable)} ${shellQuote(state.rootPath)} -type f -print | awk -v last=${shellQuote(last)} 'BEGIN { emit = (last == "") } emit { print; next } $0 == last { emit = 1; next }' >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-find-cursor-started\n'
printf 'PATCH\tfind-cursor\tready\t%s\t%s\n' ${shellQuote(state.rootPath)} ${shellQuote(last)}
`;
}

export function moveSha256LoaderCommand(
  executable: string,
  state: MoveSha256State | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tsha256sum-file\\trefused\\tmissing-sha256-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
if [ ! -f ${shellQuote(state.path)} ]; then
  printf 'PATCH\tsha256sum-file\trefused\tmissing-input\n'
  exit 2
fi
actual_digest=$(${shellQuote(executable)} ${shellQuote(state.path)} | awk '{print $1}')
if [ "$actual_digest" != ${shellQuote(state.expectedDigest)} ]; then
  printf 'PATCH\tsha256sum-file\trefused\tchanged-input-identity\n'
  exit 2
fi
${shellQuote(executable)} ${shellQuote(state.path)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-sha256sum-file-started\n'
printf 'PATCH\tsha256sum-file\tready\t%s\n' ${shellQuote(state.path)}
`;
}

export function moveWcLoaderCommand(executable: string, state: MoveWcState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\twc-line\\trefused\\tmissing-wc-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
if [ ! -f ${shellQuote(state.path)} ]; then
  printf 'PATCH\twc-line\trefused\tmissing-input\n'
  exit 2
fi
${shellQuote(executable)} -l ${shellQuote(state.path)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-wc-line-started\n'
printf 'PATCH\twc-line\tready\t%s\n' ${shellQuote(state.path)}
`;
}

export function moveSortLoaderCommand(
  executable: string,
  state: MoveSortState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tsort-file\\trefused\\tmissing-sort-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
if [ ! -f ${shellQuote(state.path)} ]; then
  printf 'PATCH\tsort-file\trefused\tmissing-input\n'
  exit 2
fi
${shellQuote(executable)} ${shellQuote(state.path)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-sort-file-started\n'
printf 'PATCH\tsort-file\tready\t%s\n' ${shellQuote(state.path)}
`;
}

export function moveMvLoaderCommand(executable: string, state: MoveMvState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tmv-rename\\trefused\\tmissing-mv-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const destinationParent = shellQuote(dirnamePath(state.destinationPath));
  return `set -eu
log=${shellQuote(log)}
if [ ! -f ${shellQuote(state.sourcePath)} ] || [ -e ${shellQuote(state.destinationPath)} ] || [ "$(stat -c %d ${shellQuote(state.sourcePath)})" != "$(stat -c %d ${destinationParent})" ]; then
  printf 'PATCH\tmv-rename\trefused\tpreflight\n'
  exit 2
fi
${shellQuote(executable)} ${shellQuote(state.sourcePath)} ${shellQuote(state.destinationPath)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-mv-rename-started\n'
printf 'PATCH\tmv-rename\tready\t%s\t%s\n' ${shellQuote(state.sourcePath)} ${shellQuote(state.destinationPath)}
`;
}

export function moveCpLoaderCommand(executable: string, state: MoveCpState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tcp-offset\\trefused\\tmissing-cp-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const offset = Math.min(state.sourceOffset, state.destinationOffset);
  return `set -eu
log=${shellQuote(log)}
${shellQuote(executable)} --version >"$log" 2>&1 || true
( tail -c +$(( ${offset} + 1 )) ${shellQuote(state.sourcePath)} >>${shellQuote(state.destinationPath)} ) >>"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-cp-offset-started\n'
printf 'PATCH\tcp-offset\tready\t%s\t%s\t%s\n' ${shellQuote(state.sourcePath)} ${shellQuote(state.destinationPath)} ${shellQuote(String(offset))}
`;
}

export function moveDdLoaderCommand(executable: string, state: MoveDdState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tdd-offset\\trefused\\tmissing-dd-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const argv = [
    shellQuote(executable),
    `if=${shellQuote(state.inputPath)}`,
    `of=${shellQuote(state.outputPath)}`,
    `bs=${shellQuote(String(state.blockSize))}`,
    `skip=${shellQuote(String(state.outputOffset))}`,
    `seek=${shellQuote(String(state.outputOffset))}`,
    "iflag=skip_bytes",
    "oflag=seek_bytes",
    "conv=notrunc",
  ].join(" ");
  return `set -eu
log=${shellQuote(log)}
${argv} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-dd-offset-started\n'
printf 'PATCH\tdd-offset\tready\t%s\t%s\t%s\t%s\n' ${shellQuote(state.inputPath)} ${shellQuote(state.outputPath)} ${shellQuote(String(state.inputOffset))} ${shellQuote(String(state.outputOffset))}
`;
}

export function moveTailGrepPipelineLoaderCommand(
  state: MoveTailGrepPipelineState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\ttail-grep-pipeline\\trefused\\tmissing-tail-grep-pipeline-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const tailArgv = ["tail", "-c", `+${state.offset + 1}`, "-f", "--", state.tailPath]
    .map(shellQuote)
    .join(" ");
  const grepArgv = ["grep", "--line-buffered", "--", state.pattern].map(shellQuote).join(" ");
  return `set -eu
log=${shellQuote(log)}
setsid sh -c ${shellQuote(`${tailArgv} | ${grepArgv} >"$1" 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-tail-grep-pipeline-started\n'
printf 'PATCH\ttail-grep-pipeline\tready\t%s\t%s\t%s\n' ${shellQuote(state.tailPath)} ${shellQuote(String(state.offset))} ${shellQuote(state.pattern)}
`;
}

function dirnamePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
