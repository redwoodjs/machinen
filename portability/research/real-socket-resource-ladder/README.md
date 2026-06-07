# Real socket resource ladder

This lane starts turning the previous blanket socket refusal into a precise
socket resource ladder.

Accepted descriptor-reconstruction cases:

- TCP listener with no pending accepts, reconstructed on a new ephemeral port
- TCP listener closed before materialization, rebound on the same local port
- Unix domain listener path unlinked and rebound
- local TCP echo pair with no in-flight bytes, semantically reconnected
- bound UDP socket with no queued datagrams, reconstructed and receiving a new datagram
- owned local socketpair with no queued bytes, reconstructed as a new socketpair

Refused cases:

- connected TCP socket with unread bytes
- UDP socket with queued datagram
- unclassified/external socket fd

This is not preservation of kernel socket identity or arbitrary live TCP
connection restore. Supported rows are target-native descriptor reconstruction
under controlled empty/local conditions. Refusal rows keep in-flight bytes,
queued datagrams, and unclassified socket ownership out of support.

Run:

```sh
portability/research/real-socket-resource-ladder/verify.sh
```

The retained result is `proved-with-refusals` in `retained/report.json`.
