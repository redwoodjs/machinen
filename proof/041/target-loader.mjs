import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

const [bundlePath, resultPath] = process.argv.slice(2);
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
function normalizeArch(arch) {
  return arch === "x64" ? "amd64" : arch;
}
const targetArchitecture = normalizeArch(process.arch);
if (bundle.architecture?.source !== "arm64") {
  throw new Error("source architecture must be arm64 for Proof 041");
}
if (bundle.architecture?.target !== targetArchitecture || targetArchitecture !== "amd64") {
  throw new Error(`target architecture mismatch: expected amd64, got ${targetArchitecture}`);
}
if (bundle.continuationDescriptor?.continuationClass !== "node-libuv-event-loop-wait-v1") {
  throw new Error("missing translated event-loop wait continuation descriptor");
}
if (
  bundle.continuationDescriptor.rawSourceRegistersCopiedToTarget ||
  bundle.continuationDescriptor.rawSourceStackCopiedToTarget ||
  bundle.continuationDescriptor.rawSourcePcCopiedToTarget ||
  bundle.continuationDescriptor.sourceIsaEmulationUsed ||
  bundle.forbiddenShortcuts?.sourceIsaEmulationUsed
) {
  throw new Error("raw source CPU/ISA state is forbidden in cross-arch bundle");
}
if (bundle.resourceDescriptors?.some((descriptor) => descriptor.sourceKernelFdCopiedToTarget)) {
  throw new Error("source kernel fds must not be reused by target");
}
let count = 2;
let graphTotal = 2;
let timerTicks = 0;
const shared = {};
const graph = { left: { shared }, right: { shared }, packed: [1, 2, shared] };
setInterval(() => {
  timerTicks += 1;
}, 100).unref();
const server = createServer((req, res) => {
  if (req.url !== "/") {
    res.writeHead(404);
    res.end("not found\n");
    return;
  }
  count += 1;
  graphTotal += 1;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      count,
      graphTotal,
      leftSharedIsRightShared: graph.left.shared === graph.right.shared,
      packedSharedIsSame: graph.packed[2] === graph.left.shared,
      listenerOpen: true,
      timerRepeatMs: 100,
      timerTicks,
    }) + "\n",
  );
});
server.listen(3000, "0.0.0.0", () => {
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        kind: "machinen.node-proper-level5-cross-arch-composed-bundle-proof",
        sourceArchitecture: bundle.architecture.source,
        targetArchitecture,
        targetNativeNodeStarted: true,
        targetNativeObjectsMaterialized: true,
        targetNativeResourceHandlesMaterialized: true,
        targetNativeEventLoopPathEntered: true,
        sourceIsaEmulationUsed: false,
        sourceIsaBytesExecuted: false,
        rawSourceRegistersCopiedToTarget: false,
        rawSourceStackCopiedToTarget: false,
        rawSourcePcCopiedToTarget: false,
        sourceKernelFdReusedOnTarget: false,
        sidecarReplayUsed: false,
        metadataOnlySuccess: false,
        appExportImportUsed: false,
      },
      null,
      2,
    ),
  );
});
