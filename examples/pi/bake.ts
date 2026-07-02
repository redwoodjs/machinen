import { provision } from "@machinen/runtime";
import { ensureArtifactDir, imagePath } from "./common.ts";

ensureArtifactDir();

await provision({
  install: async (vm) => {
    await vm.exec("apt-get update");
    await vm.exec(
      "apt-get install -y --no-install-recommends ca-certificates curl git ripgrep unzip xz-utils",
    );
    await vm.exec(
      "curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /opt/fnm --skip-shell",
    );
    await vm.exec("FNM_DIR=/opt/fnm /opt/fnm/fnm install 24");
    await vm.exec("FNM_DIR=/opt/fnm /opt/fnm/fnm default 24");
    await vm.exec("ln -sf /opt/fnm/aliases/default/bin/* /usr/local/bin/");
    await vm.exec("npm install -g --ignore-scripts @earendil-works/pi-coding-agent");
    await vm.exec("ln -sf /opt/fnm/aliases/default/bin/* /usr/local/bin/");
  },
  cmd: ["/bin/sleep", "infinity"],
  out: imagePath,
});

console.log(`Wrote ${imagePath}`);
