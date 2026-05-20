# Native real utility attempts

Issue #451 applies the native process-image stack to real Linux utilities.

## Command

```sh
pnpm native-real-utility
```

On non-Linux hosts the proof skips because it needs `/proc` and `ptrace`.

## Candidate ladder

The current ladder attempts:

1. `sleep 30` — long-lived and externally capturable;
2. `cat <regular-file>` — currently refused because a plain regular-file `cat`
   exits before an external live capture point;
3. `ping 127.0.0.1` — attempted when the host has `ping`; any sockets/raw
   sockets are surfaced as resource recipes/refusals.

## Outcomes

Each attempt is either:

- `captured`, with mapping/thread/resource counts;
- `refused`, with a stable refusal code and detail;
- `skipped`, when the utility is absent.

`ping` is not declared solved. The proof records the resource kinds and any
resource-broker refusals so the missing raw-socket/capability/timer/signal work
is explicit.

## Boundary

This issue does not claim arbitrary utility continuation. It is a first real
utility probe that exercises external capture and resource classification beyond
controlled fixtures.
