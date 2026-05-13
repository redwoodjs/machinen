---
"@machinen/runtime": patch
---

Fix `VsockExec.run` collecting a parallel buffered copy of every
chunk when the caller passes `onStdout` / `onStderr`. The buffered
copy was concatenated and decoded as UTF-8 at finish time, so any
streaming caller whose cumulative output crossed V8's ~512 MiB max
string length crashed with `ERR_STRING_TOO_LONG` from
`Buffer.concat(...).toString("utf8")` in `finish()`.

The snapshot path uses `onStdout` to pump criu tar bytes into a
host-side `tar -x`. For workloads with more than ~512 MiB of dirty
pages the dump produces enough stdout to trip the limit, so every
such snapshot failed with a V8 internal error instead of completing.
The S5 smoke test (`scripts/smoke-tests.sh`, 2 GiB-dirty workload)
was the most visible victim — closing #325.

Fix: when `onStdout` is set, skip pushing chunks into `stdoutBufs`;
same for `onStderr` / `stderrBufs`. The result's `stdout` / `stderr`
fields come back as empty strings for streaming callers, which is
documented in `VsockExecResult` and is what those callers want
anyway — they already have the bytes via the callback.

Adds `__tests__/exec-streaming.test.ts` covering: streamed-stdout
result is empty + callback sees every byte, same for stderr, the
existing buffered path still collects when no callback is set, and
the mixed case (one channel streamed, the other buffered).

Closes #325.
