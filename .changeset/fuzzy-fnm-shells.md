---
"@machinen/runtime": patch
---

Make `fnm` available by default in base guest shells, exec calls, PTY sessions, and foreground workloads so Node-based VM recipes can install and run Node without PATH/FNM boilerplate.
