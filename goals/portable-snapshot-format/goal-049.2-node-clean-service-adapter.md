# Goal 49.2: Node clean-service adapter on the shared contract

Parent: [`goal-049.md`](./goal-049.md)
Depends on: [`goal-049.1-clean-service-contract.md`](./goal-049.1-clean-service-contract.md)

Goal 47 proved a narrow Node HTTP product path. This subgoal keeps that product
behavior but refactors it to use the shared clean-service manifest and planner.
The user-visible workflow must not change.

## Objective

Move the Goal 47 Node subset from a Node-specific portable descriptor into the
shared clean-service contract while preserving bidirectional cross-architecture
restore, target-native verification, and all stable refusals.

## Supported Node subset

The accepted Node clean-service subset is intentionally narrow:

- [ ] one primary Node service process;
- [ ] app/service root is the process cwd or a safely inferred parent root;
- [ ] argv can be reconstructed target-natively;
- [ ] selected env is either empty, allowlisted, or safely captured;
- [ ] one HTTP verifier endpoint or command verifier is available;
- [ ] listening socket may be rebound on the target;
- [ ] no active accepted TCP/TLS session must survive;
- [ ] no inspector/debug session;
- [ ] no child-process/IPC tree;
- [ ] no native `.node` addon state unless explicitly modeled and rebuilt;
- [ ] no dirty writable host-mounted state;
- [ ] no unsupported V8/libuv/OpenSSL private continuation;
- [ ] target Node version/ABI policy is satisfied;
- [ ] target verifier passes before `migrationCompleted=true`.

## Snapshot inspection requirements

`machinen snapshot <node-vm> <bundle>` must discover and record:

- [ ] Node process pid, argv, cwd, runtime version, and relevant `process.versions`;
- [ ] service root and captured app/config files;
- [ ] package metadata when present (`package.json`, lockfiles, package manager
      hints) with digests;
- [ ] native addon presence and refusal reason if found;
- [ ] child processes and IPC/socket/pipe relationships;
- [ ] inspector/debug flags or inspector listener;
- [ ] listening socket descriptors and active accepted connection state;
- [ ] verifier endpoint/command and expected output digest;
- [ ] host mount overlap and dirty-state ambiguity.

## Restore requirements

`machinen restore <bundle>` must:

- [ ] auto-detect the shared clean-service manifest;
- [ ] select the Node adapter from manifest runtime requirements;
- [ ] boot a target-native VM on the destination architecture;
- [ ] install/select target-native Node according to the manifest policy;
- [ ] materialize captured app/config files with digest verification;
- [ ] reconstruct argv/cwd/env within the target service root;
- [ ] start the service target-natively;
- [ ] run the verifier before reporting success;
- [ ] write a restore summary with `migrationCompleted=true` only after the
      verifier passes.

## Required Node refusals

Keep or add stable Node-specific refusal codes for:

- [ ] active accepted TCP session;
- [ ] TLS session state;
- [ ] inspector/debug session;
- [ ] child process or IPC tree;
- [ ] unsupported native addon/ABI state;
- [ ] dirty persistent state;
- [ ] host-mounted ambiguity;
- [ ] source/target Node version or ABI mismatch outside policy;
- [ ] package/provenance mismatch;
- [ ] descriptor/artifact tamper;
- [ ] target architecture mismatch;
- [ ] missing target verifier;
- [ ] target verifier mismatch;
- [ ] target runtime unavailable.

Every refusal must report `migrationCompleted=false`.

## Compatibility requirements

- [ ] Existing Goal 47 Node bundles either remain restorable or fail with a clear
      stable compatibility refusal and remediation path.
- [ ] Same-architecture vmstate/CRIU restore behavior is unchanged.
- [ ] `machinen support` only advertises Node implemented support if the shared
      contract smokes pass.

## Validation environment

Use this machine as the arm64 side and Proxmox `root@192.168.0.8` as the amd64
side. Do not use `friend@100.126.46.90`.

## Required smokes

- [ ] `arm64 -> amd64` Node clean-service product smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] `amd64 -> arm64` Node clean-service product smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] active TCP refusal smoke;
- [ ] inspector refusal smoke;
- [ ] child process refusal smoke;
- [ ] native addon refusal smoke;
- [ ] host mount dirty-state refusal smoke;
- [ ] descriptor tamper restore refusal;
- [ ] verifier mismatch restore refusal;
- [ ] target architecture mismatch restore refusal.

## Completion criteria

Complete when Goal 47's Node product behavior is fully preserved through the
shared clean-service manifest and all listed smokes pass without runtime-specific
workflow flags.
