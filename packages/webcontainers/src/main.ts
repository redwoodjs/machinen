import { WebContainer } from "@webcontainer/api";
import { init, Terminal } from "ghostty-web";

const statusEl = document.getElementById("status")!;
const editorEl = document.getElementById("editor") as HTMLTextAreaElement;
const terminalEl = document.getElementById("terminal")!;
const previewEl = document.getElementById("preview") as HTMLIFrameElement;
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;

await init();

const terminal = new Terminal({
  fontSize: 14,
  theme: {
    background: "#0d1117",
    foreground: "#c9d1d9",
  },
});
terminal.open(terminalEl);

let container: WebContainer;

async function boot() {
  statusEl.textContent = "Booting WebContainer...";
  container = await WebContainer.boot();
  statusEl.textContent = "Ready";
  runBtn.disabled = false;

  container.on("server-ready", (_port, url) => {
    previewEl.src = url;
  });
}

async function run() {
  runBtn.disabled = true;
  terminal.write("\x1b[2J\x1b[H"); // clear screen
  statusEl.textContent = "Writing files...";

  await container.mount({
    "index.js": {
      file: { contents: editorEl.value },
    },
    "package.json": {
      file: {
        contents: JSON.stringify({
          name: "playground",
          type: "module",
          scripts: { start: "node index.js" },
        }),
      },
    },
  });

  statusEl.textContent = "Running...";
  const proc = await container.spawn("node", ["index.js"], {
    terminal: { cols: terminal.cols, rows: terminal.rows },
  });

  proc.output.pipeTo(
    new WritableStream({
      write(data) {
        terminal.write(data);
      },
    }),
  );

  terminal.onData((data) => {
    const writer = proc.input.getWriter();
    writer.write(data);
    writer.releaseLock();
  });

  const exitCode = await proc.exit;
  terminal.write(`\r\nProcess exited with code ${exitCode}\r\n`);
  statusEl.textContent = `Exited (${exitCode})`;
  runBtn.disabled = false;
}

runBtn.addEventListener("click", run);

boot().catch((err) => {
  statusEl.textContent = "Boot failed";
  terminal.write(`Error: ${err.message}\r\n`);
});
