// Container lifecycle
export {
  freeze,
  restore,
  up,
  destroy,
  migrate,
} from "./operations.mjs";

// Discovery & shell
export {
  discover,
  getShellArgs,
  status,
  logs,
} from "./operations.mjs";

// Sync
export {
  syncOnce,
  createSyncDaemon,
} from "./operations.mjs";

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
} from "./operations.mjs";

// Lower-level modules (re-exported for advanced use)
export { docker, dockerExec, reconnectDocker } from "./docker.mjs";
export { checkPrerequisites } from "./preflight.mjs";
export { ensureDiND, getDiNDHost } from "./dind.mjs";
export { getRegistry, ensureDockerLogin, remoteDockerLogin } from "./registry.mjs";
export { createPowerWatcher } from "./power.mjs";
export { startBackgroundSync } from "./sync.mjs";
export {
  listMachines,
  provisionServer,
  destroyServer,
  remoteRestore,
  remoteFreeze,
  ssh,
  sshScript,
  SSH_OPTS,
} from "./cloud.mjs";
