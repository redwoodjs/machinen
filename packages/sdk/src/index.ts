// Container lifecycle
export { freeze, restore, up, destroy, migrate } from "./operations";

// Discovery & shell
export { discover, getShellArgs, status, logs } from "./operations";

// Sync
export { syncOnce, createSyncDaemon } from "./operations";

// Utilities
export {
  currentBranch,
  sanitizeBranch,
  currentContainerName,
  gitRoot,
  syncStatusPath,
  writeSyncStatus,
  isAuthError,
  containerExists,
  checkSyncStatus,
} from "./operations";

// Lower-level modules (re-exported for advanced use)
export { docker, dockerExec, reconnectDocker } from "./docker";
export { checkPrerequisites } from "./preflight";
export { ensureDiND, getDiNDHost } from "./dind";
export { getRegistry, ensureDockerLogin, remoteDockerLogin } from "./registry";
export { createPowerWatcher } from "./power";
export { startBackgroundSync } from "./sync";
export {
  listMachines,
  provisionServer,
  destroyServer,
  remoteRestore,
  remoteFreeze,
  ssh,
  sshScript,
  SSH_OPTS,
  cloudInit,
} from "./cloud";
