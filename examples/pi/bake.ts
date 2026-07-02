import { mkdirSync } from "node:fs";
import { provision } from "@machinen/runtime";

mkdirSync("artifacts", { recursive: true });

await provision({
  install: async (vm) => {
    await vm.exec(`
      fnm install 24
      fnm default 24
      npm install -g --ignore-scripts @earendil-works/pi-coding-agent
      pi --version
    `);
  },
  out: "./artifacts/rootfs.tar.gz",
});
