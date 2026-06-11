export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function safeAbsolutePath(path: string): boolean {
  return path.split("/").filter(Boolean).every(safePathComponent);
}

export function safePathComponent(component: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(component) && component !== "." && component !== "..";
}

export function regularFileIdentityCommand(pathVariable = "path"): string {
  return `if [ ! -f "$${pathVariable}" ] || [ -L "$${pathVariable}" ]; then
  exit 2
fi
printf '%s\n%s\n' "$(stat -c %s "$${pathVariable}")" "$(sha256sum "$${pathVariable}" | cut -d' ' -f1)"`;
}

export function parentDirectoryIdentityCommand(pathVariable = "parent"): string {
  return `if [ ! -d "$${pathVariable}" ] || [ -L "$${pathVariable}" ]; then
  exit 2
fi
entries_file=/tmp/machinen-parent-entries-$$.txt
: >"$entries_file"
find "$${pathVariable}" -mindepth 1 -maxdepth 1 -printf '%f\t%y\t%f\n' | LC_ALL=C sort >"$entries_file"
printf '%s\n%s\n' "$(stat -c %f "$${pathVariable}")" "$(sha256sum "$entries_file" | cut -d' ' -f1)"
rm -f "$entries_file"`;
}

export function symlinkFreeTreeIdentityCommand(rootVariable = "root"): string {
  return `if [ ! -d "$${rootVariable}" ] || [ -L "$${rootVariable}" ]; then
  exit 2
fi
if find "$${rootVariable}" -type l -print -quit | grep -q .; then
  exit 2
fi
tree_file=/tmp/machinen-tree-identity-$$.txt
: >"$tree_file"
find "$${rootVariable}" -xdev -printf '%P\t%y\t%s\t%m\n' | LC_ALL=C sort >"$tree_file"
file_count=$(find "$${rootVariable}" -xdev -type f | wc -l | tr -d ' ')
dir_count=$(find "$${rootVariable}" -xdev -type d | wc -l | tr -d ' ')
total_bytes=$(find "$${rootVariable}" -xdev -type f -printf '%s\n' | awk '{s += $1} END {print s + 0}')
printf '%s\n%s\n%s\n%s\n' "$file_count" "$dir_count" "$total_bytes" "$(sha256sum "$tree_file" | cut -d' ' -f1)"
rm -f "$tree_file"`;
}

export function activeTcpConnectionCheckCommand(port: number): string {
  return tcpStatePortCheckCommand(port, "01", true);
}

export function listeningTcpPortCheckCommand(port: number): string {
  return tcpStatePortCheckCommand(port, "0A", false);
}

export function binaryExecutableCheckCommand(executable: string, refusalName: string): string {
  return `if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\t%s\trefused\tmissing-binary\n' ${shellQuote(refusalName)}
  exit 2
fi`;
}

function tcpStatePortCheckCommand(port: number, tcpState: string, includeRemote: boolean): string {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const remoteCheck = includeRemote ? ` || toupper(r[2]) == "${hexPort}"` : "";
  return `awk '$4 == "${tcpState}" { split($2, l, ":"); split($3, r, ":"); if (toupper(l[2]) == "${hexPort}"${remoteCheck}) found = 1 } END { exit found ? 0 : 1 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null`;
}
