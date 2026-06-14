import type { MoveDescriptor } from "@machinen/runtime";

import { shellQuote } from "./move-preflight-helpers.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericResource = MoveResourcePlan["resources"][number];
type GenericResourceClass = NonNullable<GenericState>["resourceClasses"][number];
type GenericRefusalClass = NonNullable<GenericState>["refusalClasses"][number];
type MmapMapping = NonNullable<NonNullable<GenericState>["mmapMappings"]>[number];

export function genericMmapMappings(resourcePlan: MoveResourcePlan): MmapMapping[] {
  const stateMappings = resourcePlan.capture?.genericResourceGraphState?.mmapMappings;
  if (stateMappings?.length) {
    return stateMappings;
  }
  return resourcePlan.resources.flatMap((resource) => {
    const recipe = resource.recipe ?? {};
    if (recipe.mmapModel !== "file-backed-clean-v1" || typeof resource.path !== "string") {
      return [];
    }
    const length = numericRecipeValue(resource, "mmapLength") ?? 0;
    const offset = numericRecipeValue(resource, "mmapOffset") ?? 0;
    return [
      {
        fd: resource.fd,
        path: resource.path,
        offset,
        length,
        permissions: recipe.mmapPermissions === "r--" ? "r--" : "rw-",
        sharing: recipe.mmapSharing === "shared" ? "shared" : "private",
        fileIdentity: {
          size: numericRecipeValue(resource, "mmapFileSize") ?? 0,
          sha256: stringRecipeValue(resource, "mmapSha256") ?? "unknown",
        },
        dirtyPolicy: "clean-file-backed",
        support: supportedRecipe(resource, length)
          ? "target-native-file-backed-clean"
          : "refused-baseline",
      },
    ];
  });
}

export function genericMmapResourceClasses(mappings: MmapMapping[]): GenericResourceClass[] {
  if (mappings.length === 0) {
    return [];
  }
  const supported = mappings.some((item) => item.support === "target-native-file-backed-clean");
  return [
    {
      resourceClass: supported ? "mmapFileBackedClean" : "mmapFileBaseline",
      status: supported ? "supported" : "refused",
      evidence: `mmap file-backed descriptors recorded for paths=${mappings.map((item) => item.path).join(",")}`,
    },
  ];
}

export function genericMmapRefusals(mappings: MmapMapping[]): GenericRefusalClass[] {
  return mappings.some((item) => item.support !== "target-native-file-backed-clean")
    ? [
        {
          resourceClass: "mmapFile",
          status: "refused",
          reason: "mmap state is outside the clean file-backed mapping contract",
          evidence: JSON.stringify(mappings),
          nextAction:
            "model dirty ranges, anonymous memory, permissions, truncation, and backing identity before accepting mmap continuation",
        },
      ]
    : [];
}

export function genericMmapPreflightCommands(state: NonNullable<GenericState>): string[] {
  return (state.mmapMappings ?? [])
    .filter((item) => item.support === "target-native-file-backed-clean")
    .map((mapping) => {
      const path = shellQuote(mapping.path);
      return `test -f ${path} || fail mmap-file-missing\n[ "$(stat -c '%s' ${path})" = ${shellQuote(String(mapping.fileIdentity.size))} ] || fail mmap-file-size-mismatch\n[ "$(sha256sum ${path} | cut -d' ' -f1)" = ${shellQuote(mapping.fileIdentity.sha256)} ] || fail mmap-file-identity-mismatch`;
    });
}

export function genericMmapLaunchCommand(state: NonNullable<GenericState>): string | undefined {
  const mappings =
    state.mmapMappings?.filter((item) => item.support === "target-native-file-backed-clean") ?? [];
  if (mappings.length === 0) {
    return undefined;
  }
  const spec = JSON.stringify({ mappings });
  return `python3 - ${shellQuote(spec)} "$log" <<'PY' &
import json, mmap, os, sys, time
spec = json.loads(sys.argv[1])
log_path = sys.argv[2]
held = []
for mapping in spec['mappings']:
    fd = os.open(mapping['path'], os.O_RDONLY)
    view = mmap.mmap(fd, int(mapping['length']), access=mmap.ACCESS_READ, offset=int(mapping['offset']))
    held.append((fd, view))
log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(log_fd, 1)
os.dup2(log_fd, 2)
if log_fd not in (1, 2):
    os.close(log_fd)
for _fd, view in held:
    print('mmap-read:' + view[:].decode('utf-8', 'replace').strip(), flush=True)
time.sleep(60)
PY
pid=$!`;
}

function supportedRecipe(resource: GenericResource, length: number): boolean {
  const recipe = resource.recipe ?? {};
  const permissions = recipe.mmapPermissions;
  const sharing = recipe.mmapSharing;
  const sha256 = stringRecipeValue(resource, "mmapSha256");
  return (
    length > 0 &&
    permissions === "r--" &&
    (sharing === "private" || sharing === "shared") &&
    typeof sha256 === "string" &&
    sha256 !== "unknown"
  );
}

function numericRecipeValue(resource: GenericResource, key: string): number | undefined {
  const value = resource.recipe?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function stringRecipeValue(resource: GenericResource, key: string): string | undefined {
  const value = resource.recipe?.[key];
  return typeof value === "string" ? value : undefined;
}
