# Node snapshot/restore

Node product snapshot/restore uses the normal commands:

```sh
machinen snapshot <node-vm> <bundle-dir>
machinen restore <bundle-dir>
```

No `capture`, `--portable`, or `--runtime node` flag is required.

## Supported subset

`node-http-clean-root-v1` currently requires:

- one Node process running an HTTP service at `127.0.0.1:<guestPort>/`;
- application state contained in the Node process cwd;
- no active accepted TCP/TLS session;
- no inspector/debug session;
- no child-process or IPC tree;
- no cwd under `/mnt` host-mounted state;
- no `.node` native addon files in the captured application tree;
- matching source and target Node versions;
- a passing target-native verifier before success.

## Bundle files

Snapshot augments the normal VM bundle with:

- `portable-node.json`
- `portable-node-app.tar.gz`
- `meta.json.portable`

## Restore behavior

When the target architecture differs from the source architecture, restore boots a target-native VM, uses target-native Node, reconstructs the app directory, starts the Node command, and verifies `GET /` against the captured SHA-256 before returning success.

Successful restore reports:

```json
{
  "migrationCompleted": true,
  "sourceIsaEmulationUsed": false,
  "targetVerifierResult": "passed"
}
```

## Stable refusal codes

Snapshot refusal codes include:

- `node-inspector-session-unsupported`
- `node-child-process-tree-unsupported`
- `node-native-addon-abi-state-unsupported`
- `node-host-mounted-state-ambiguous`
- `node-active-tcp-session-unsupported`
- `node-target-verifier-missing`

Restore refusal codes include:

- `node-target-architecture-mismatch`
- `node-portable-app-digest-mismatch`
- `node-source-target-version-mismatch`
- `node-target-verifier-mismatch`

Every refusal reports `migrationCompleted=false`.
