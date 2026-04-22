// CLI shim for the shell fixtures (smoke.sh, try.sh, handoff.sh).
// Delegates to @machinen/runtime's mkinitramfs library, keeping the
// same argv surface as the old Python script.
import { mkinitramfsCli } from "../../../runtime/src/index.ts";
mkinitramfsCli(process.argv.slice(2));
