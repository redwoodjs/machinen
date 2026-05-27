# Goal 34.3: Long-lived service lifecycle restore

Parent: [Goal 34](./goal-034.md).

## Objective

Prove long-lived Node service lifecycle behavior: start a server, capture it while
listening, restore it, and make real client requests after restore.

## Requirements

- [x] Start a long-lived HTTP service as a live Node process.
- [x] Capture while the service is listening.
- [x] Preserve or reconstruct listener state safely.
- [x] Restore on Proxmox amd64.
- [x] Issue real HTTP client requests after restore.
- [x] Verify response body, status code, headers, and service-side state changes.
- [x] Record listener socket provenance.
- [x] Refuse ambiguous listener state with a stable code.

## Validation

- [x] Long-lived service restore smoke with post-restore client request.
- [x] Listener provenance test.
- [x] Missing/ambiguous listener refusal test.
- [x] Checked summaries for both arm64 source routes.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when a listening Node service is captured, restored on Proxmox amd64,
and successfully serves post-restore client traffic.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
