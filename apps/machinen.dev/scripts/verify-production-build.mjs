import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(readFileSync(resolve("dist/client/.vite/manifest.json"), "utf8"));
const clientEntry = manifest["src/client.tsx"];
const worker = readFileSync(resolve("dist/worker/index.js"), "utf8");
const errors = [];

if (!clientEntry?.file) {
  errors.push("the client manifest does not contain a built src/client.tsx entry");
} else {
  const clientPath = `/${clientEntry.file}`;
  if (!worker.includes(`import("${clientPath}")`)) {
    errors.push(`the worker does not import the built client asset ${clientPath}`);
  }
}

if (!clientEntry?.css?.length) {
  errors.push("the client manifest does not contain a built stylesheet");
}

for (const cssFile of clientEntry?.css ?? []) {
  if (!existsSync(resolve("dist/client", cssFile))) {
    errors.push(`the client stylesheet is missing: /${cssFile}`);
  }
}

if (worker.includes('import("/src/client.tsx")')) {
  errors.push("the worker still imports the development client path /src/client.tsx");
}
if (worker.includes("/src/styles.css")) {
  errors.push("the worker still references the development stylesheet path /src/styles.css");
}

if (errors.length > 0) {
  throw new Error(`Invalid production website build:\n- ${errors.join("\n- ")}`);
}

console.log(`verified production website assets: /${clientEntry.file}`);
