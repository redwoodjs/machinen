# CPU resources in machinen

Machinen exposes CPU controls as a goal-driven policy under `resources.cpu`:

```ts
await boot({
  image: "./image.ext4",
  resources: {
    cpu: {
      maxVcpus: 2,
      quotaCpus: 0.5,
      weight: 200,
    },
  },
});
```

CLI flags use the same shape:

```sh
machinen boot ./bundle --cpu-quota 0.5 --cpu-weight 200 --vcpus 2
machinen fork --name app --cpu-quota 0.25 --cpu-weight 50
```

## vCPUs vs quota

`maxVcpus` is the guest-visible CPU count. On linux/x64 KVM hosts, values above
`1` create real guest vCPUs, so commands such as `nproc` see the requested CPU
count. Other host backends still reject values above `1` instead of pretending
that quota is a multi-vCPU feature.

`quotaCpus` is host scheduler budget. A quota of `0.5` means the VMM may consume
about half of one host CPU over the cgroup scheduling period. It does not add
more guest-visible CPUs.

`weight` is relative fairness when VMs contend for CPU. Higher weights receive a
larger share against lower weights. The accepted range is Linux cgroup v2's
`1..10000`, with default `100`.

## Linux enforcement

On Linux, Machinen uses cgroup v2 CPU controls for quota and fairness:

- `quotaCpus` writes `cpu.max` using a `100000` microsecond period.
- `weight` writes `cpu.weight`.
- The spawned VMM process is moved into a per-VM cgroup.
- The quota applies to the whole VMM process, so it caps total host CPU budget
  across all vCPU threads rather than changing the guest-visible CPU count.
- The cgroup path is registered for cleanup when the VM exits or `machinen gc`
  reaps a dead detached VM.

If the host does not provide usable cgroup v2 CPU controls, an explicit quota or
non-default weight fails during boot with a CPU unsupported error.

## macOS behavior

macOS does not provide a cgroup v2 equivalent for hard per-process CPU quota.
Machinen still validates the `resources.cpu` shape so configuration files can be
shared, but hard quota, weight enforcement, and multi-vCPU guests are documented
as unsupported on macOS in this phase. `maxVcpus` remains limited to `1` there.

## Observability

`machinen ls --json` includes the resolved policy and enforcement state:

```json
{
  "cpu": {
    "max_vcpus": 2,
    "quota_cpus": 0.5,
    "weight": 200,
    "enforcement": { "status": "linux-cgroup-v2" }
  }
}
```

The table form also includes a compact `CPU` column.
