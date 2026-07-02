import { boot } from "@machinen/runtime";
import {
  imagePath,
  piAgentHost,
  requireImage,
  requirePiAuth,
  shellQuote,
  workspaceHost,
} from "./common.ts";

requireImage();
requirePiAuth();

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error('Usage: pnpm ask -- "Write fizzbuzz in TypeScript. Code only."');
  process.exit(1);
}

const vm = await boot({
  image: imagePath,
  liveMounts: [
    { host: workspaceHost, guest: "/mnt/workspace", mode: "rw" },
    { host: piAgentHost, guest: "/root/.pi/agent", mode: "rw" },
  ],
  guestCwd: "/mnt/workspace",
});

try {
  const result = await vm.exec(`HOME=/root pi -p ${shellQuote(prompt)}`, {
    execTimeoutMs: 180_000,
  });

  if (result.stderr) process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
} finally {
  await vm.kill();
}
