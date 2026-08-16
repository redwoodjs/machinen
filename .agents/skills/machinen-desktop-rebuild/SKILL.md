---
name: machinen-desktop-rebuild
description: Reuses or rebuilds the Machinen project’s macOS Desktop app on the Mac mini, deploys it when needed, and relaunches the app currently hosting the work on either the mini or Air. Use whenever Peter asks to build, rebuild, reinstall, refresh, restart, or relaunch Machinen Desktop from source.
---

# Reuse, build, and relaunch Machinen Desktop

Use the bundled TypeScript script rather than manually building, copying, killing, or opening the app:

```bash
node scripts/rebuild-relaunch.ts
```

The default `auto` mode:

1. Finds the current `machinen-session` terminal ID in the agent's process ancestry.
2. Takes Machinen Desktop snapshots on the mini and Air and selects the app containing that terminal.
3. Falls back to the only running project-built `Machinen.app`; fails rather than guessing when both machines remain plausible.
4. Fingerprints the mini checkout's exact Git `HEAD`, tracked changes, untracked files, and requested build configuration.
5. Reuses a matching signed build from the mini's build cache. It only runs `apps/machinen-desktop/build-app.sh` when that source fingerprint has not already been built.
6. Compares the cached build's code-directory hash with the target app. If they match, it only quits and reopens the app. Otherwise it stages and deploys the cached build before relaunching.
7. Verifies the relaunched process and local API, and restores the previous bundle if a replacement fails.

Builds always happen in `/Users/p4p8/gh/redwoodjs/machinen` on the mini. The Air is only a deployment and launch target. Persistent PTY workers survive the Desktop relaunch, including the terminal running this agent.

Build artifacts and history are stored on the mini under:

```text
/Users/p4p8/.local/state/machinen-desktop-rebuild/
```

The history records source fingerprints, Git revisions, build times, cached artifact paths, deployment targets, and whether each invocation deployed or only relaunched.

## Options

Only override automatic targeting when Peter explicitly identifies the machine:

```bash
node scripts/rebuild-relaunch.ts --target mini
node scripts/rebuild-relaunch.ts --target air
```

Use a debug build or force a fresh build only when requested:

```bash
node scripts/rebuild-relaunch.ts --configuration debug
node scripts/rebuild-relaunch.ts --force-build
```

Inspect decisions or history without changing the app:

```bash
node scripts/rebuild-relaunch.ts --detect-only
node scripts/rebuild-relaunch.ts --history
```

Report the selected machine, bundle path, source fingerprint, whether the build was reused or created, whether deployment was skipped, and relaunch verification. Never build from the Air checkout or deploy to a Machinen app outside a `gh/redwoodjs/*/apps/machinen-desktop` project tree.
