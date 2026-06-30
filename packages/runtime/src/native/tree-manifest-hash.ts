import type { ErrorCode } from "../errors.ts";
import { defineRuntimeCommand } from "./runtime-command.ts";

interface TreeManifestHashData {
  hash: string;
}

export const treeManifestHashNative = defineRuntimeCommand<string, TreeManifestHashData, string>({
  command: "tree-manifest-hash",
  errorCode: "BOOT_MOUNTDISK_TOOL_MISSING",
  data: (root) => ({ root }),
  output: (response) => response.hash,
  mapFailure: mapTreeManifestHashFailure,
  isData: isTreeManifestHashData,
});

function mapTreeManifestHashFailure(error: {
  code: string;
  message: string;
}): { errorCode: ErrorCode } | undefined {
  switch (error.code) {
    case "PATH_NOT_FOUND":
      return { errorCode: "BOOT_MOUNT_HOST_NOT_FOUND" };
    case "PATH_NOT_DIRECTORY":
      return { errorCode: "BOOT_MOUNT_INVALID" };
    default:
      return undefined;
  }
}

function isTreeManifestHashData(value: unknown): value is TreeManifestHashData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<TreeManifestHashData>;
  return typeof data.hash === "string" && /^[0-9a-f]{64}$/.test(data.hash);
}
