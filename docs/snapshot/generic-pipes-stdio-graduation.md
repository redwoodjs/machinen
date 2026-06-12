# Generic pipes and stdio graduation

This document defines the completion boundary for graduating pipes and nontrivial stdio into the generic resource graph move envelope.

It does **not** claim arbitrary shell pipeline movement, PTY or terminal teleportation, live process memory continuation, or source-ISA emulation. Pipes and stdio are supported only when the observed fd graph is fully understood and target-native reconstruction has explicit proof.

## Product scope

The first graduated pipes/stdio support may accept only explicit, finite, target-native shapes whose descriptors include:

- stdio policy for fd `0`, `1`, and `2`;
- every pipe fd with inode, direction, flags, offset policy, and peer relationship;
- producer/consumer roles and process lifecycle;
- whether each peer is inside the moved graph or external;
- buffered-data policy;
- loader strategy, launch order, and cleanup behavior;
- visible target evidence.

Any missing, ambiguous, or unsupported pipe/stdio resource must remain refused with exact evidence.

## Supported pilot shapes

The first pilot shapes are intentionally narrow:

1. **finite pipe replay**
   - a finite producer has already materialized deterministic bytes into a regular target-validated input file or descriptor;
   - the target-native consumer reads from a reconstructed pipe whose contents are explicitly provided by the descriptor;
   - EOF behavior is deterministic;
   - no shell state is required after capture.

2. **long-running producer/consumer pair**
   - both producer and consumer commands are explicitly described as target-native argv/cwd/env;
   - the pipe connects exactly one producer write end to exactly one consumer read end;
   - launch order and shutdown behavior are deterministic;
   - health/target evidence observes the consumer output;
   - no hidden shell semantics are required.

3. **nontrivial stdio by explicit policy**
   - stdio may be `/dev/null`, closed, inherited noninteractive with declared policy, or connected to a modeled pipe;
   - inherited terminal/PTY stdio is refused;
   - unknown fd targets on `0`, `1`, or `2` are refused.

## Refused shapes

The generic classifier must refuse:

- PTYs and controlling terminals;
- shell wrappers whose behavior depends on unmodeled shell state;
- job control, traps, expansions, aliases, variables, or interactive shell state;
- missing pipe peers;
- fan-in, fan-out, or cycles unless explicitly modeled in a later contract;
- active partial writes or unread kernel pipe buffers whose bytes are not captured;
- blocked reads/writes without a deterministic lifecycle;
- unknown anon inodes, sockets, devices, or file locks attached to the pipe graph;
- nontrivial inherited stdio without an explicit policy;
- any target-side stale preflight or failed health evidence.

## Descriptor taxonomy

A pipes/stdio descriptor should include these normalized fields, whether public or internal:

```ts
stdioGraph: {
  policy: "dev-null-or-closed" | "modeled-pipe" | "inherited-noninteractive" | "refused";
  fds: Array<{
    fd: 0 | 1 | 2;
    target: "closed" | "dev-null" | "pipe" | "regular-file" | "refused";
    access: "read" | "write" | "read-write";
    evidence: string;
  }>;
}

pipeGraph: {
  pipes: Array<{
    inode: string;
    readFds: PipeEndpoint[];
    writeFds: PipeEndpoint[];
    topology: "one-producer-one-consumer" | "fan-in" | "fan-out" | "cycle" | "missing-peer";
    bufferedDataPolicy: "empty" | "captured-bytes" | "refused-unknown";
    lifecycle: "finite-replay" | "long-running-pair" | "refused";
  }>;
}

PipeEndpoint = {
  pid: number;
  fd: number;
  role: "producer" | "consumer" | "unknown";
  insideMovedGraph: boolean;
  flags: string[];
  cloexec?: boolean;
  nonblocking?: boolean;
  command?: string;
  argv?: string[];
};
```

## Loader strategy

A target-native loader for pipes/stdio must:

1. validate executable identity for every launched target-native process;
2. validate cwd, data files, and regular output files before launch;
3. create pipe fds before launching connected processes;
4. launch producers/consumers in a deterministic order;
5. close unused pipe ends to guarantee EOF behavior;
6. emit `LOAD_PID` only after preflight gates pass and the supported process graph is launched;
7. kill every spawned target process on preflight, launch, or health failure;
8. return `targetPid=null` on refusal.

## Target evidence

A happy-path proof must retain JSON/timing artifacts showing:

- accepted save and load;
- a descriptor containing `stdioGraph`/`pipeGraph` or equivalent generic resource graph fields;
- no hidden shell-state acceptance;
- target-native loader strategy;
- visible output from the target consumer;
- EOF or long-running lifecycle behavior as appropriate.

## Non-goals

This graduation does not support:

- arbitrary shell pipeline movement;
- arbitrary shell command reconstruction;
- interactive terminal sessions;
- PTY/editor/session restoration;
- source-ISA emulation;
- same-arch memory/register continuation;
- metadata-only success where unsupported pipe state is ignored.

## Graduation rule

Pipes/stdio graduate only when the same change set includes descriptor fields, capture/classifier behavior, target-native loader behavior, happy-path matrix rows, refusal matrix rows, coverage inventory updates, docs, and final validation.
