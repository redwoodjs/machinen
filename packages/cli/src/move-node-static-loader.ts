import type { MoveDescriptor } from "@machinen/runtime";

type MoveCapture = NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>;
type MoveNodeStaticHttpState = NonNullable<MoveCapture["nodeStaticHttpState"]>;

export function moveNodeStaticHttpLoaderCommand(
  executable: string,
  state: MoveNodeStaticHttpState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tnode-static-http\\trefused\\tmissing-node-static-http-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const probe = `const http=require('http'); const req=http.get('http://127.0.0.1:${state.port}${state.healthPath}', res => { process.exit(res.statusCode === 200 ? 0 : 2); }); req.on('error', () => process.exit(1)); req.setTimeout(2000, () => { req.destroy(); process.exit(1); });`;
  return `set -eu
log=${shellQuote(log)}
if [ ! -f ${shellQuote(state.scriptPath)} ]; then
  printf 'PATCH\tnode-static-http\trefused\tmissing-script\n'
  exit 2
fi
if ${shellQuote(executable)} -e ${shellQuote(probe)} >/dev/null 2>&1; then
  printf 'PATCH\tnode-static-http\trefused\tport-in-use\n'
  exit 2
fi
(cd ${shellQuote(state.cwd)} && ${shellQuote(executable)} ${shellQuote(state.scriptPath)} >"$log" 2>&1) &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tnode-static-http\trefused\tstart-failed\n'
    exit 2
  fi
  if ${shellQuote(executable)} -e ${shellQuote(probe)} >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tnode-static-http\trefused\tnot-serving-health\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-node-static-http-started\n'
printf 'PATCH\tnode-static-http\tready\t%s\t%s\n' ${shellQuote(state.scriptPath)} ${shellQuote(String(state.port))}
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
