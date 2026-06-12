import type { MoveDescriptor } from "@machinen/runtime";

import { shellQuote } from "./move-preflight-helpers.ts";

type GenericState = NonNullable<
  NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>["genericResourceGraphState"]
>;

type GenericEventfd = NonNullable<GenericState["eventfds"]>[number];
type GenericEpoll = NonNullable<GenericState["epolls"]>[number];

export function genericEventfdLaunchCommand(state: GenericState): string | undefined {
  const eventfd = reconstructableEventfd(state);
  if (!eventfd) {
    return undefined;
  }
  const epoll = reconstructableEpoll(state);
  const spec = JSON.stringify({ argv: state.argv, eventfd, epoll });
  return `python3 - ${shellQuote(spec)} "$log" <<'PY' &
import ctypes, json, os, sys
spec = json.loads(sys.argv[1])
log_path = sys.argv[2]
libc = ctypes.CDLL(None)
libc.eventfd.argtypes = [ctypes.c_uint, ctypes.c_int]
libc.eventfd.restype = ctypes.c_int
libc.epoll_create1.argtypes = [ctypes.c_int]
libc.epoll_create1.restype = ctypes.c_int
libc.epoll_ctl.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
libc.epoll_ctl.restype = ctypes.c_int
class EpollEvent(ctypes.Structure):
    _fields_ = [('events', ctypes.c_uint32), ('data', ctypes.c_uint64)]
def dup_to(fd, target_fd):
    if fd == target_fd:
        os.set_inheritable(fd, True)
    else:
        os.dup2(fd, target_fd, inheritable=True)
        os.close(fd)
eventfd = spec['eventfd']
fd = libc.eventfd(ctypes.c_uint(int(eventfd['counter'], 16)), 0)
if fd < 0:
    raise OSError(ctypes.get_errno(), 'eventfd')
eventfd_target = int(eventfd['fd'])
dup_to(fd, eventfd_target)
epoll = spec.get('epoll')
if epoll:
    epfd = libc.epoll_create1(0)
    if epfd < 0:
        raise OSError(ctypes.get_errno(), 'epoll_create1')
    watch = epoll['watchedFds'][0]
    event = EpollEvent(int(watch['events'], 16), int(watch['data'], 16))
    if libc.epoll_ctl(epfd, 1, int(watch['targetFd']), ctypes.byref(event)) != 0:
        raise OSError(ctypes.get_errno(), 'epoll_ctl')
    dup_to(epfd, int(epoll['fd']))
log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(log_fd, 1)
os.dup2(log_fd, 2)
if log_fd not in (1, 2):
    os.close(log_fd)
os.execvp(spec['argv'][0], spec['argv'])
PY
pid=$!`;
}

function reconstructableEventfd(state: GenericState): GenericEventfd | undefined {
  const eventfds = state.eventfds?.filter((item) => item.support === "target-native-counter") ?? [];
  return eventfds.length === 1 ? eventfds[0] : undefined;
}

function reconstructableEpoll(state: GenericState): GenericEpoll | undefined {
  const epolls =
    state.epolls?.filter((item) => item.support === "target-native-eventfd-watch") ?? [];
  return epolls.length === 1 ? epolls[0] : undefined;
}
