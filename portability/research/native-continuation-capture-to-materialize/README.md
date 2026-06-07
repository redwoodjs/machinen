# Native continuation capture to materialize

This lane closes the descriptor loop:

1. start a real source process
2. run `classify.py --pid <pid>` on the source host
3. retain the exact classifier descriptor
4. copy that descriptor to the target host
5. run the target-native materializer using that descriptor
6. verify same-arch, amd64 → arm64, and arm64 → amd64

Accepted rows:

- controlled pty read with empty queue
- empty pipe blocked endpoint
- listener socket with empty accept queue
- local connected socket with empty queues via semantic reconnect
- all threads parked in known waits
- paused-VM atomic pty read observation mode

Refusal rows prove classifier refusals emit no descriptor/materializer input:

- non-empty pty queue
- socket queued/in-flight bytes
- active/unclassified thread

This still does not claim arbitrary raw process restore. It proves that classifier
outputs can become target-native reconstruction inputs for accepted
CPU/memory/resource shapes.

Run:

```sh
portability/research/native-continuation-capture-to-materialize/verify.sh
```

Retained output: `retained/report.json`.
