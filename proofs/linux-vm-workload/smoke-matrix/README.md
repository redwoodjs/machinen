# Whole VM workload smoke matrix

This retained proof covers dashboard rows `vm/003` through `vm/009` by booting a real Machinen Linux VM and running guest workload/capability probes.

It does **not** prove whole-VM snapshot/restore and does **not** raise the whole-VM claim. The public claim remains:

```json
{
  "productSupport": 0,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

Rows may be either:

- `supported` — the guest probe actually ran and passed; or
- `refused` — the VM lacks the tool/capability and the proof retains a stable refusal.

Current retained result:

- SQLite database smoke: refused, `sqlite3` missing in guest.
- PostgreSQL database smoke: refused, PostgreSQL tools missing in guest.
- Simple C process smoke: supported, target-native static Linux binary executed in the VM.
- Simple Java process smoke: refused, Java runtime missing in guest.
- eBPF capability smoke: supported, minimal `bpf(BPF_MAP_CREATE)` probe succeeded.
- seccomp capability smoke: supported, guest-installed seccomp filter blocked `getpid` with `EPERM`.
- nested virtualization smoke: refused, `/dev/kvm` missing in guest.

Run:

```sh
bash scripts/smoke/whole-vm-workload-smoke-matrix.sh
```

Retained report:

- `retained/whole-vm-workload-smoke-matrix-report.json`
