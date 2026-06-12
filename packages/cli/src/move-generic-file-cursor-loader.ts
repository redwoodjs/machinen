import type { MoveDescriptor } from "@machinen/runtime";

import { shellQuote } from "./move-preflight-helpers.ts";

type GenericState = NonNullable<
  NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>["genericResourceGraphState"]
>;

type GenericRegularFile = GenericState["regularFiles"][number];

export function genericRegularFilePreflightCommand(file: GenericRegularFile): string {
  const path = shellQuote(file.path);
  return `test -f ${path} || fail file-missing
[ "$(stat -c %s ${path})" = ${shellQuote(String(file.identity.size))} ] || fail file-size-mismatch
[ "$(sha256sum ${path} | cut -d' ' -f1)" = ${shellQuote(file.identity.sha256)} ] || fail file-identity-mismatch`;
}

export function genericRegularFileCursorLaunchCommand(state: GenericState): string | undefined {
  const files = reconstructableRegularFiles(state);
  if (files.length === 0) {
    return undefined;
  }
  const spec = JSON.stringify({ argv: state.argv, files });
  return `python3 - ${shellQuote(spec)} "$log" <<'PY' &
import json, os, sys
spec = json.loads(sys.argv[1])
log_path = sys.argv[2]
for item in spec['files']:
    fd = os.open(item['path'], os.O_RDONLY)
    os.lseek(fd, int(item['offset']), os.SEEK_SET)
    target_fd = int(item['fd'])
    os.dup2(fd, target_fd)
    if fd != target_fd:
        os.close(fd)
log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(log_fd, 1)
os.dup2(log_fd, 2)
if log_fd not in (1, 2):
    os.close(log_fd)
os.execvp(spec['argv'][0], spec['argv'])
PY
pid=$!`;
}

function reconstructableRegularFiles(state: GenericState): Array<{
  fd: number;
  path: string;
  offset: number;
}> {
  return state.regularFiles.flatMap((file) => {
    if (file.access !== "read-only" || file.fd === undefined) {
      return [];
    }
    return [{ fd: file.fd, path: file.path, offset: file.cursor?.offset ?? file.offset ?? 0 }];
  });
}
