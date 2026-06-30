import type { MoveDescriptor, MoveProcessRefusal, VmHandle } from "@machinen/runtime";

type MoveExecutablePackageIdentity = NonNullable<
  NonNullable<MoveDescriptor["resourcePlan"]>["capture"]
>["executablePackage"] extends infer Identity
  ? NonNullable<Identity>
  : never;

export interface MoveLoadTargetValidation {
  state: "ready" | "refused";
  source?: MoveExecutablePackageIdentity;
  target?: MoveExecutablePackageIdentity;
  refusals: MoveProcessRefusal[];
}

export async function readMoveExecutableIdentityInVm(
  vm: VmHandle,
  path: string,
): Promise<MoveExecutablePackageIdentity> {
  const result = await vm.execRaw(moveExecutableIdentityCommand(path), { execTimeoutMs: 10_000 });
  if (result.exitCode !== 0) {
    return { path };
  }
  return parseMoveExecutableIdentity(result.stdout, path);
}

export async function validateMoveLoadTargetInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
  exePath: string,
): Promise<MoveLoadTargetValidation> {
  const source = descriptor.resourcePlan?.capture?.executablePackage;
  const target = await readMoveExecutableIdentityInVm(vm, exePath);
  const refusals = [
    sameVmRefusal(vm, descriptor),
    ...moveExecutableIdentityRefusals(source, target),
  ].filter((refusal): refusal is MoveProcessRefusal => refusal !== undefined);
  return { state: refusals.length === 0 ? "ready" : "refused", source, target, refusals };
}

function moveExecutableIdentityCommand(path: string): string {
  const quoted = shellQuote(path);
  return `set -eu
path=${quoted}
real=$(readlink -f "$path" 2>/dev/null || printf %s "$path")
pkg=""
for candidate in "$path" "$real" "/bin/\${path##*/}" "/usr/bin/\${path##*/}"; do
  [ -n "$pkg" ] && break
  pkg=$(dpkg-query -S "$candidate" 2>/dev/null | head -n1 | cut -d: -f1 || true)
done
if [ -n "$pkg" ]; then
  dpkg-query -W -f 'PKG\t\${Package}\t\${Version}\t\${Architecture}\n' "$pkg" 2>/dev/null || true
fi
printf 'EXE\t%s\t%s\n' "$path" "$real"`;
}

function parseMoveExecutableIdentity(
  stdout: string,
  fallbackPath: string,
): MoveExecutablePackageIdentity {
  const identity: MoveExecutablePackageIdentity = { path: fallbackPath };
  for (const row of stdout.split("\n").filter(Boolean)) {
    const parts = row.split("\t");
    if (parts[0] === "PKG") {
      identity.packageName = emptyToUndefined(parts[1] ?? "");
      identity.version = emptyToUndefined(parts[2] ?? "");
      identity.architecture = emptyToUndefined(parts[3] ?? "");
    }
    if (parts[0] === "EXE") {
      identity.path = parts[1] || fallbackPath;
      identity.realPath = emptyToUndefined(parts[2] ?? "");
    }
  }
  return identity;
}

function sameVmRefusal(vm: VmHandle, descriptor: MoveDescriptor): MoveProcessRefusal | undefined {
  if (descriptor.resourcePlan?.capture?.sourceVm?.pid !== vm.pid) {
    return undefined;
  }
  return {
    code: "target-process-context-unsupported",
    message: "move load target is the same local VM that produced the save bundle",
    detail: { sourceVmPid: vm.pid, boundary: "same-local-vm-load" },
  };
}

function moveExecutableIdentityRefusals(
  source: MoveExecutablePackageIdentity | undefined,
  target: MoveExecutablePackageIdentity,
): MoveProcessRefusal[] {
  if (!source?.packageName || !source.version) {
    return [
      {
        code: "target-build-mismatch",
        message: "source executable package identity was not captured",
        detail: { source, target, boundary: "executable-package-identity" },
      },
    ];
  }
  const failures = executableIdentityFailures(source, target);
  return failures.map((failure) => ({
    code: "target-build-mismatch",
    message: `target executable ${failure} does not match source`,
    detail: { source, target, boundary: "executable-package-identity", failure },
  }));
}

function executableIdentityFailures(
  source: MoveExecutablePackageIdentity,
  target: MoveExecutablePackageIdentity,
): string[] {
  const failures: string[] = [];
  if (target.path !== source.path) {
    failures.push("path");
  }
  if (target.packageName !== source.packageName) {
    failures.push("package");
  }
  if (target.version !== source.version) {
    failures.push("version");
  }
  return failures;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function emptyToUndefined(value: string): string | undefined {
  return value === "" ? undefined : value;
}
