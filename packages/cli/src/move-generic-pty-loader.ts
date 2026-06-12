import type { MoveDescriptor } from "@machinen/runtime";

import { shellQuote } from "./move-preflight-helpers.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];

export function genericPtyLaunchCommand(state: NonNullable<GenericState>): string | undefined {
  const pty = state.ptys?.find(
    (item) => item.support === "target-native-noninteractive-transcript-probe",
  );
  if (!pty) {
    return undefined;
  }
  const rows = pty.winsize?.rows ?? 24;
  const columns = pty.winsize?.columns ?? 80;
  return `pty_pidfile=/tmp/machinen-generic-pty-$$.pid
python3 - ${shellQuote(JSON.stringify(state.argv))} "$log" "$pty_pidfile" ${shellQuote(String(rows))} ${shellQuote(String(columns))} >/tmp/machinen-generic-pty-parent-$$.log 2>&1 <<'PY' &
import fcntl, json, os, pty, select, struct, sys, termios, time
argv = json.loads(sys.argv[1])
log = sys.argv[2]
pidfile = sys.argv[3]
rows = int(sys.argv[4])
columns = int(sys.argv[5])
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
pid = os.fork()
if pid == 0:
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    devnull = os.open('/dev/null', os.O_RDONLY)
    os.dup2(devnull, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    for fd_to_close in range(3, 256):
        try: os.close(fd_to_close)
        except OSError: pass
    os.execvp(argv[0], argv)
os.close(slave)
with open(pidfile, 'w', encoding='utf-8') as f:
    f.write(str(pid))
with open(log, 'ab', buffering=0) as out:
    while True:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try:
                data = os.read(master, 4096)
            except OSError:
                break
            if not data:
                break
            out.write(data)
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            break
        if done == pid:
            time.sleep(0.1)
            try:
                data = os.read(master, 4096)
                if data:
                    out.write(data)
            except OSError:
                pass
            break
PY
for i in $(seq 1 100); do [ -s "$pty_pidfile" ] && break; sleep 0.05; done
pid=$(cat "$pty_pidfile")`;
}
