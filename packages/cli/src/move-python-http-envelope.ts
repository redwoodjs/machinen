import type { MoveDescriptor, MovePidGraphNode, VmHandle } from "@machinen/runtime";
import { readMoveHttpState } from "./move-envelope-capture.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type MoveHttpState = NonNullable<MoveCapture["httpState"]>;

export async function readMoveHttpStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["httpState"]> {
  const parsed =
    readMoveHttpState(node, resourcePlan) ?? readExplicitBindHttpState(node, resourcePlan);
  if (
    !parsed ||
    !hasExplicitLocalBind(node) ||
    !safeHttpPath(parsed.cwd) ||
    !safeHttpPath(parsed.directory ?? parsed.cwd)
  ) {
    return undefined;
  }
  const root = parsed.directory ?? parsed.cwd;
  const result = await vm.execRaw(moveHttpDirectoryIdentityCommand(root), {
    execTimeoutMs: 30_000,
  });
  const directoryIdentity = parseHttpDirectoryIdentity(result.stdout);
  return result.exitCode === 0 && directoryIdentity
    ? {
        ...parsed,
        bindAddress: "127.0.0.1",
        mode: parsed.directory ? "explicit-bind-directory" : "explicit-bind-cwd",
        listenerState: "idle-single-listener",
        directoryIdentity,
      }
    : undefined;
}

export function moveHttpDirectoryIdentityCommand(rootPath: string): string {
  return `set -eu
root=${shellQuote(rootPath)}
[ -d "$root" ]
[ ! -L "$root" ]
if find "$root" -type l -print -quit | grep -q .; then
  printf 'PATCH\tpython-http-server\trefused\tsymlink-entry-unsupported\n'
  exit 2
fi
if find "$root" -printf '%P\n' | LC_ALL=C grep -Ev '^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]*$' | grep -q .; then
  printf 'PATCH\tpython-http-server\trefused\tunsafe-directory-path\n'
  exit 2
fi
tree_file=/tmp/machinen-http-directory-$$.txt
: >"$tree_file"
printf '.\tdirectory\t%s\t%s\n' "$(stat -c %f "$root")" "$(stat -c %s "$root")" >>"$tree_file"
find "$root" -mindepth 1 -printf '%P\n' | LC_ALL=C sort | while IFS= read -r rel; do
  path="$root/$rel"
  entry_type=$(find "$path" -maxdepth 0 -printf '%y')
  if [ "$entry_type" = f ]; then
    printf '%s\tfile\t%s\t%s\t%s\n' "$rel" "$(stat -c %f "$path")" "$(stat -c %s "$path")" "$(sha256sum "$path" | cut -d' ' -f1)" >>"$tree_file"
  elif [ "$entry_type" = d ]; then
    printf '%s\tdirectory\t%s\t%s\n' "$rel" "$(stat -c %f "$path")" "$(stat -c %s "$path")" >>"$tree_file"
  else
    printf 'PATCH\tpython-http-server\trefused\tunsupported-entry-type\n'
    exit 2
  fi
done
file_count=$(awk -F '\t' '$2 == "file" { n++ } END { print n + 0 }' "$tree_file")
directory_count=$(awk -F '\t' '$2 == "directory" { n++ } END { print n + 0 }' "$tree_file")
total_bytes=$(awk -F '\t' '$2 == "file" { n += $4 } END { print n + 0 }' "$tree_file")
tree_digest=$(sha256sum "$tree_file" | cut -d' ' -f1)
printf '%s\n%s\n%s\n%s\n' "$file_count" "$directory_count" "$total_bytes" "$tree_digest"
rm -f "$tree_file"
`;
}

function parseHttpDirectoryIdentity(
  stdout: string,
): MoveHttpState["directoryIdentity"] | undefined {
  const [fileLine, dirLine, bytesLine, treeDigest] = stdout.trim().split("\n");
  const fileCount = Number(fileLine);
  const directoryCount = Number(dirLine);
  const totalBytes = Number(bytesLine);
  return Number.isSafeInteger(fileCount) &&
    fileCount >= 0 &&
    Number.isSafeInteger(directoryCount) &&
    directoryCount > 0 &&
    Number.isSafeInteger(totalBytes) &&
    totalBytes >= 0 &&
    /^[0-9a-f]{64}$/.test(treeDigest ?? "")
    ? { fileCount, directoryCount, totalBytes, treeDigest: treeDigest as string }
    : undefined;
}

function readExplicitBindHttpState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): MoveCapture["httpState"] {
  const moduleIndex = node.argv.findIndex((arg) => arg === "-m");
  const args = node.argv.slice(moduleIndex + 2);
  const port = Number(args[4] ?? args[2]);
  const directory = args[2] === "--directory" ? args[3] : undefined;
  return (node.argv[0]?.endsWith("python3") || node.argv[0]?.endsWith("python3.11")) &&
    node.argv[moduleIndex + 1] === "http.server" &&
    args[0] === "--bind" &&
    args[1] === "127.0.0.1" &&
    Number.isInteger(port) &&
    port > 0 &&
    resourcePlan.resources.filter((resource) => resource.kind === "socket").length === 1 &&
    (!directory || directory.startsWith("/"))
    ? {
        executable: "python3",
        port,
        cwd: node.cwd ?? "/",
        ...(directory ? { directory } : {}),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

function hasExplicitLocalBind(node: MovePidGraphNode): boolean {
  return node.argv.some((arg, index) => arg === "--bind" && node.argv[index + 1] === "127.0.0.1");
}

function safeHttpPath(path: string): boolean {
  return (
    path === "/" ||
    (path.startsWith("/") && path.split("/").filter(Boolean).every(safePathComponent))
  );
}

function safePathComponent(component: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(component) && component !== "." && component !== "..";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
