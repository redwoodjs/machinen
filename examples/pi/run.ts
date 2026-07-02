import { homedir } from "node:os";
import { resolve } from "node:path";
import { boot } from "@machinen/runtime";

const vm = await boot({
  image: "./artifacts/rootfs.tar.gz",
  liveMounts: [
    { host: process.cwd(), guest: "/mnt/workspace", mode: "rw" },
    { host: resolve(homedir(), ".pi/agent"), guest: "/root/.pi/agent", mode: "rw" },
  ],
  guestCwd: "/mnt/workspace",
  cmd: ["/bin/bash", "-lc", "exec pi"],
  env: { HOME: "/root" },
  stdio: "inherit",
  timeoutMs: null,
});

const { code } = await vm.wait();
process.exitCode = code ?? 0;
