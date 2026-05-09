// bake.ts
import { readFileSync } from "node:fs";
import { provision } from "@machinen/runtime";

await provision({
  install: async (vm) => {
    await vm.exec("fnm install --lts && ln -sf $(fnm exec --using=lts/* which node) /usr/bin/node");
    await vm.writeFile("/opt/counter.mjs", readFileSync("./counter.mjs"));
  },
  cmd: ["/usr/bin/node", "/opt/counter.mjs"],
  out: "./counter.tar.gz",
});
