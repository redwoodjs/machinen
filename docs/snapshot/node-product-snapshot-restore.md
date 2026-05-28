# Node product snapshot/restore

Goal 47 wires the first portable Node subset through the normal product verbs:

```sh
machinen snapshot <node-vm> <bundle-dir>
machinen restore <bundle-dir>
```

No `capture`, `--portable`, or `--runtime node` flag is required. During
snapshot, Machinen inspects the running VM for a Node HTTP service. If the service
matches the `node-http-clean-root-v1` subset, the normal snapshot bundle is
augmented with:

- `portable-node.json` — component descriptor, source architecture, Node argv,
  verifier, refusal semantics, and integrity metadata;
- `portable-node-app.tar.gz` — captured application directory;
- `meta.json.portable` — product component report with route policy,
  provenance, digests, verifier requirements, and refusal codes.

On restore, Machinen detects `portable-node.json`. When the target architecture is
different from the descriptor source architecture, it boots a target-native VM,
installs/uses target-native Node, reconstructs the app directory, starts the Node
command, and verifies `GET /` against the captured SHA-256 before returning
`migrationCompleted=true`.

## Supported subset

`node-http-clean-root-v1` currently requires:

- one Node process running an HTTP service reachable at `127.0.0.1:<guestPort>/`
  (`guestPort` comes from the VM registry port forward when present, otherwise
  `3000`);
- application state contained in the Node process cwd;
- no active accepted TCP/TLS session (a listening socket is allowed);
- no inspector/debug session;
- no child-process or IPC tree;
- no cwd under `/mnt` host-mounted state;
- no `.node` native addon files in the captured application tree;
- matching source/target Node version;
- a passing target-native verifier before success.

## Stable refusal codes

Snapshot refuses nearby unsafe Node states with stable codes in the error text,
including:

- `node-inspector-session-unsupported`
- `node-child-process-tree-unsupported`
- `node-native-addon-abi-state-unsupported`
- `node-host-mounted-state-ambiguous`
- `node-active-tcp-session-unsupported`
- `node-target-verifier-missing`

Restore writes `portable-node-restore-summary.json` and, with `--json`, prints a
machine-readable summary. Restore refusal codes include:

- `node-target-architecture-mismatch`
- `node-portable-app-digest-mismatch`
- `node-source-target-version-mismatch`
- `node-target-verifier-mismatch`

Every refusal reports `migrationCompleted=false`; successful restore reports
`migrationCompleted=true`, `sourceIsaEmulationUsed=false`, and
`targetVerifierResult="passed"`.
