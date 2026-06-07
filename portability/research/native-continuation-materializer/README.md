# Native continuation materializer

This lane proves that accepted classifier descriptors can drive target-native
reconstruction. The axis remains CPU/memory/resource shape, not binary name.

Accepted materializer proofs:

1. controlled pty read with empty queue → target pty process continues after a byte
2. empty pipe blocked endpoint → recreated pipe/process tree continues after a byte
3. listener socket with empty accept queue → target listener accepts a client
4. local connected socket with empty queues → target semantic reconnect sends/receives
5. all threads parked in known waits → target-native parked roles wake successfully
6. stream boundaries:
   - `curl` before request / after complete response
   - `tar` before first output block / after file boundary
   - `rsync` before destination mutation / after file boundary
   - `openssl enc` before cipher init / after final block

Retained refusals prove no materializer is available for unsafe mid-state shapes:

- `curl` mid-body
- `tar` mid-file stream
- `rsync` mid-copy
- `openssl enc` mid-cipher stream

Every accepted descriptor denies raw heap/stack/register capture, raw VM replay,
source-ISA emulation, and raw process memory materialization. Socket descriptors
use semantic rebind/reconnect and explicitly do not preserve kernel socket identity.

Run:

```sh
portability/research/native-continuation-materializer/verify.sh
```

Retained output: `retained/report.json`.
