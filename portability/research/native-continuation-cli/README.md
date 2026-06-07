# Native continuation CLI

This lane exposes the research classifier/capture/materializer path through a
single experimental CLI shape:

```sh
python3 continuation_cli.py classify --pid <pid>
python3 continuation_cli.py capture --pid <pid> --out descriptor.json
python3 continuation_cli.py materialize --descriptor descriptor.json --out result.json
```

It is still a research CLI, but it behaves like the product-facing primitive we
want: arbitrary live PIDs are classified into CPU/memory/resource shapes,
accepted captures emit architecture-neutral descriptors, and target materializers
consume those descriptors unchanged.

Accepted rows:

- controlled pty read with empty queue
- empty pipe blocked endpoint
- listener socket with empty accept queue
- local connected socket with empty queues via semantic reconnect
- all threads parked in known waits
- paused-VM atomic pty read observation mode

Refusal rows:

- non-empty pty queue
- socket queued/in-flight bytes
- active/unclassified thread

Run:

```sh
portability/research/native-continuation-cli/verify.sh
```

Retained output: `retained/report.json`.
