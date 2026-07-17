import { createHash } from "node:crypto";
import { existsSync, readlinkSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import type { RunRecipe, RunStatePermission } from "./run-registry.ts";

const GUEST_HOME = "/root";
const MAX_LIVE_MOUNTS = 5;
const MAX_SCANNED_ENTRIES = 250_000;

interface RunAccessMount {
  host: string;
  guest: string;
  mode: "ro" | "rw";
}

interface RunAccessGrantMount extends RunAccessMount {
  resolvedHost?: string;
}

interface PlannedRunState extends RunAccessGrantMount {
  name: string;
  source: "home" | "isolated";
  linked: RunAccessGrantMount[];
  unresolvedLinks: string[];
}

export interface RunAccessPlan {
  workspace?: RunAccessMount;
  states: PlannedRunState[];
  liveMounts: RunAccessMount[];
  fingerprint: string;
}

interface PlanOptions {
  cwd?: string;
  home?: string;
}

interface InternalMount extends RunAccessMount {
  canonicalHost: string;
}

interface LinkedMountPlan {
  mounts: InternalMount[];
  unresolvedLinks: string[];
}

interface ScanBudget {
  entries: number;
}

/**
 * Resolve a signed recipe's effective host access before asking for approval.
 * State below `/root` mirrors the same path below the host home. Other state
 * remains recipe-isolated under `~/.machinen/run/state`.
 */
export function planRunAccess(recipe: RunRecipe, options: PlanOptions = {}): RunAccessPlan {
  const home = resolve(options.home ?? homedir());
  const cwd = resolve(options.cwd ?? process.cwd());
  const workspace = planWorkspace(recipe, cwd);
  const states = recipe.permissions.state.map((state) => planState(recipe, state, home));
  const liveMounts = [
    ...(workspace ? [workspace] : []),
    ...states.flatMap(({ host, guest, mode, linked }) => [
      { host, guest, mode },
      ...linked.map(({ host, guest, mode }) => ({ host, guest, mode })),
    ]),
  ];
  if (liveMounts.length > MAX_LIVE_MOUNTS) {
    throw new Error(
      `run recipe requires ${liveMounts.length} live mounts after resolving linked state; ` +
        `at most ${MAX_LIVE_MOUNTS} are supported`,
    );
  }
  return {
    workspace,
    states,
    liveMounts,
    fingerprint: accessFingerprint(recipe, states),
  };
}

function planWorkspace(recipe: RunRecipe, cwd: string): RunAccessMount | undefined {
  if (recipe.permissions.workspace === "none") {
    return undefined;
  }
  return { host: cwd, guest: "/mnt/workspace", mode: recipe.permissions.workspace };
}

function planState(recipe: RunRecipe, state: RunStatePermission, home: string): PlannedRunState {
  const homePath = hostHomePath(state.guest, home);
  const source = homePath === undefined ? "isolated" : "home";
  const host = homePath ?? recipeStatePath(recipe, state.name, home);
  const root: InternalMount = {
    host,
    guest: state.guest,
    mode: state.mode,
    canonicalHost: canonicalPath(host),
  };
  const linked = source === "home" ? discoverLinkedMounts(root) : emptyLinkedMountPlan();
  return {
    name: state.name,
    source,
    host,
    guest: state.guest,
    mode: state.mode,
    ...resolvedHostField(host, root.canonicalHost),
    linked: linked.mounts.map(grantMount),
    unresolvedLinks: linked.unresolvedLinks,
  };
}

function hostHomePath(guest: string, home: string): string | undefined {
  if (guest !== GUEST_HOME && !guest.startsWith(`${GUEST_HOME}/`)) {
    return undefined;
  }
  const relativeGuest = posix.relative(GUEST_HOME, posix.normalize(guest));
  if (escapesGuestRoot(relativeGuest)) {
    return undefined;
  }
  return resolve(home, relativeGuest);
}

function recipeStatePath(recipe: RunRecipe, name: string, home: string): string {
  return join(home, ".machinen", "run", "state", recipe.publisher, recipe.name, name);
}

function emptyLinkedMountPlan(): LinkedMountPlan {
  return { mounts: [], unresolvedLinks: [] };
}

function discoverLinkedMounts(root: InternalMount): LinkedMountPlan {
  if (!existsSync(root.host)) {
    return emptyLinkedMountPlan();
  }

  const mounts: InternalMount[] = [];
  const unresolvedLinks: string[] = [];
  const queue: InternalMount[] = [root];
  const scanned = new Set<string>();
  const budget: ScanBudget = { entries: 0 };

  while (queue.length > 0) {
    const current = queue.shift()!;
    const scanKey = `${current.canonicalHost}\0${current.guest}`;
    if (scanned.has(scanKey)) {
      continue;
    }
    scanned.add(scanKey);
    scanMount(current, budget, (hostLink, guestLink, target) => {
      const resolved = resolveLinkTarget(hostLink, guestLink, target);
      if (resolved === undefined) {
        unresolvedLinks.push(`${guestLink} -> ${target}`);
        return;
      }
      if ([root, ...mounts].some((mount) => mountCoversTarget(mount, resolved))) {
        return;
      }
      const candidate = linkedMountForTarget(resolved, root.mode);
      addLinkedMount(candidate, mounts, queue, root);
    });
  }

  return {
    mounts: mounts.sort((a, b) => a.guest.localeCompare(b.guest)),
    unresolvedLinks: unresolvedLinks.sort(),
  };
}

function scanMount(
  mount: InternalMount,
  budget: ScanBudget,
  onLink: (hostLink: string, guestLink: string, target: string) => void,
): void {
  scanDirectory(mount.host, mount.guest, budget, onLink);
}

function scanDirectory(
  hostDir: string,
  guestDir: string,
  budget: ScanBudget,
  onLink: (hostLink: string, guestLink: string, target: string) => void,
): void {
  let entries;
  try {
    entries = readdirSync(hostDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    budget.entries += 1;
    if (budget.entries > MAX_SCANNED_ENTRIES) {
      throw new Error(
        `run state symlink discovery exceeded ${MAX_SCANNED_ENTRIES} filesystem entries`,
      );
    }
    const hostPath = join(hostDir, entry.name);
    const guestPath = posix.join(guestDir, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        onLink(hostPath, guestPath, readlinkSync(hostPath));
      } catch {
        // A concurrently removed link cannot grant host access during this boot.
      }
      continue;
    }
    if (entry.isDirectory()) {
      scanDirectory(hostPath, guestPath, budget, onLink);
    }
  }
}

interface ResolvedLinkTarget {
  host: string;
  canonicalHost: string;
  guest: string;
  directory: boolean;
}

function resolveLinkTarget(
  hostLink: string,
  guestLink: string,
  target: string,
): ResolvedLinkTarget | undefined {
  const host = isAbsolute(target) ? resolve(target) : resolve(dirname(hostLink), target);
  const guest = posix.isAbsolute(target)
    ? posix.normalize(target)
    : posix.resolve(posix.dirname(guestLink), target);
  try {
    const stats = statSync(host);
    return {
      host,
      canonicalHost: realpathSync(host),
      guest,
      directory: stats.isDirectory(),
    };
  } catch {
    return undefined;
  }
}

function linkedMountForTarget(target: ResolvedLinkTarget, mode: "ro" | "rw"): InternalMount {
  const host = target.directory ? target.host : dirname(target.host);
  const guest = target.directory ? target.guest : posix.dirname(target.guest);
  return { host, guest, mode, canonicalHost: canonicalPath(host) };
}

function addLinkedMount(
  candidate: InternalMount,
  mounts: InternalMount[],
  queue: InternalMount[],
  root: InternalMount,
): void {
  if ([root, ...mounts].some((mount) => mountCoversMount(mount, candidate))) {
    return;
  }
  for (let index = mounts.length - 1; index >= 0; index -= 1) {
    if (mountCoversMount(candidate, mounts[index]!)) {
      mounts.splice(index, 1);
    }
  }
  mounts.push(candidate);
  queue.push(candidate);
}

function mountCoversMount(parent: InternalMount, child: InternalMount): boolean {
  return mappingRelative(parent, child.canonicalHost, child.guest) !== undefined;
}

function mountCoversTarget(mount: InternalMount, target: ResolvedLinkTarget): boolean {
  return mappingRelative(mount, target.canonicalHost, target.guest) !== undefined;
}

function mappingRelative(
  mount: InternalMount,
  canonicalHostTarget: string,
  guestTarget: string,
): string | undefined {
  const hostRelative = relative(mount.canonicalHost, canonicalHostTarget);
  const guestRelative = posix.relative(mount.guest, guestTarget);
  if (escapesRoot(hostRelative) || escapesGuestRoot(guestRelative)) {
    return undefined;
  }
  const normalizedHostRelative = hostRelative.split(sep).join("/");
  return normalizedHostRelative === guestRelative ? guestRelative : undefined;
}

function escapesRoot(path: string): boolean {
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function escapesGuestRoot(path: string): boolean {
  return path === ".." || path.startsWith("../") || posix.isAbsolute(path);
}

function canonicalPath(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      return resolve(path);
    }
    missing.unshift(basename(existing));
    existing = parent;
  }
  try {
    return resolve(realpathSync(existing), ...missing);
  } catch {
    return resolve(path);
  }
}

function grantMount(mount: InternalMount): RunAccessGrantMount {
  return {
    host: mount.host,
    guest: mount.guest,
    mode: mount.mode,
    ...resolvedHostField(mount.host, mount.canonicalHost),
  };
}

function resolvedHostField(host: string, canonicalHost: string): { resolvedHost?: string } {
  return canonicalHost === resolve(host) ? {} : { resolvedHost: canonicalHost };
}

function accessFingerprint(recipe: RunRecipe, states: PlannedRunState[]): string {
  const capabilities = {
    version: 1,
    workspace: recipe.permissions.workspace,
    states: states.map((state) => ({
      name: state.name,
      source: state.source,
      host: canonicalPath(state.host),
      guest: state.guest,
      mode: state.mode,
      linked: state.linked.map((mount) => ({
        host: canonicalPath(mount.host),
        guest: mount.guest,
        mode: mount.mode,
      })),
      unresolvedLinks: state.unresolvedLinks,
    })),
  };
  return createHash("sha256").update(JSON.stringify(capabilities)).digest("hex");
}
