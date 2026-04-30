// Test harness for #200's parent-death assertion.
//
// Boots a long-running stand-in for the VMM (`/usr/bin/yes`) via
// `boot()`, prints `VMM_PID=<pid>` to stdout, and blocks forever.
// The parent test SIGKILLs this process and asserts the VMM PID is
// gone within a deadline — proving the spawn was wrapped through
// the parent-death shim.

import { boot } from "../../index.ts";

// `/bin/sleep` doesn't write to stdout, so it won't exit via SIGPIPE
// when the parent's stdio pipes close. That makes it a faithful
// stand-in for the real VMM (which the orphan repro in #200 left
// running for 39 minutes after the parent died).
const vm = await boot({ binary: "/bin/sleep", args: ["99999"], timeoutMs: null });
process.stdout.write(`VMM_PID=${vm.pid}\n`);
setInterval(() => {}, 1 << 30);
