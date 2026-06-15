---
"@machinen/cli": minor
"@machinen/runtime": minor
---

Add persistent attach sessions for reconnectable interactive VM shells and TUIs. Use `machinen attach --session <name> <vm>` to create or reattach a named guest-managed PTY session, `machinen sessions <vm>` to list them, and `machinen session-kill <vm> <session>` to reset one. Plain `machinen attach <vm>` keeps the existing non-persistent behavior.
