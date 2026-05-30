import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

const bundlePath = process.argv[2];
const resultPath = process.argv[3];
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const arch = process.arch === "x64" ? "amd64" : process.arch;
if (bundle.architecture.source !== "arm64" || bundle.architecture.target !== "amd64") {
  throw new Error("cross-arch arm64-to-amd64 bundle required");
}
if (arch !== "amd64") {
  throw new Error(`target must be amd64, got ${arch}`);
}
let count = bundle.heapGraphIr.count;
let graphTotal = bundle.heapGraphIr.graphTotal;
const server = createServer((_req, res) => {
  count += 1;
  graphTotal += 1;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      count,
      graphTotal,
      processArch: arch,
      targetNativeNodeUsed: true,
      sourceIsaEmulationUsed: false,
    }) + "\n",
  );
});
server.listen(3000, "0.0.0.0", () => {
  writeFileSync(
    resultPath,
    JSON.stringify(
      { targetStarted: true, processArch: arch, sourceIsaEmulationUsed: false },
      null,
      2,
    ),
  );
});
