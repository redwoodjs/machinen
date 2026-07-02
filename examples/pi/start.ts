import { boot } from "@machinen/runtime";
import {
  imagePath,
  piAgentHost,
  requireImage,
  requirePiAuth,
  vmName,
  workspaceHost,
} from "./common.ts";

requireImage();
requirePiAuth();

await boot({
  image: imagePath,
  name: vmName,
  detached: true,
  liveMounts: [
    { host: workspaceHost, guest: "/mnt/workspace", mode: "rw" },
    { host: piAgentHost, guest: "/root/.pi/agent", mode: "rw" },
  ],
  guestCwd: "/mnt/workspace",
});

console.log(`Booted VM ${vmName}.`);
console.log("Attach to it with:");
console.log(`  npx machinen attach ${vmName}`);
console.log("Then run pi inside the attached shell:");
console.log("  cd /mnt/workspace && HOME=/root pi");
console.log("Stop it with:");
console.log(`  npx machinen stop ${vmName}`);
