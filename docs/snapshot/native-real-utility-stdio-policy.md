# Native real utility inherited stdio policy

Issue #496 defines a narrow resource policy for real utilities that inherit
stdio from the target launch environment.

## Rule

Regular file descriptors still use reopen recipes. Non-file kernel resources
still fail closed unless an exact rule exists.

File descriptors 1 and 2 are special only when the caller asks for the explicit
policy:

```ts
inheritedStdio: {
  mode: "inherit-output";
}
```

With that policy, stdout and stderr receive recipes that inherit the target
process output handles. A `require-explicit` check mode reports the same stdio
fds as `inherited-stdio-policy-required` without accepting them. This is a
launch/materialization rule. It does not snapshot or replay pipe/socket buffers.

Stdin is still refused when it is a pipe/socket-like kernel resource because
pending input and libc buffering are not modeled yet.

## Precise refusals

- `inherited-stdio-policy-required` — fd 1/2 is non-file stdio, but no explicit
  inherit policy was requested.
- `stdin-buffer-state-unsupported` — fd 0 has unmodeled input/buffer state.
- `non-stdio-kernel-state-unsupported` — a pipe/socket/timer/eventfd/epoll/etc.
  is not fd 1/2 stdio and cannot be inherited by this policy.
- `fd-kind-unsupported` — the descriptor kind is unknown.

The older `kernel-state-unsupported` refusal remains the default for brokerless
non-file resources when no inherited-stdio policy is being evaluated.

## Proof

`pnpm native-real-utility-stdio-policy --json` checks all policy branches:

- stdout/stderr refuse without an explicit policy;
- stdout/stderr are accepted with inherited output recipes under the policy;
- stdin pipe state refuses as `stdin-buffer-state-unsupported`;
- non-stdio socket state refuses as `non-stdio-kernel-state-unsupported`;
- a regular file descriptor keeps its reopen recipe.

It emits:

```text
real-utility-inherited-stdio-policy-proved-with-precise-resource-refusals
```
