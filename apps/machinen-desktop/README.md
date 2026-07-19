# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 8 — First real terminal**

A workspace containing one terminal gives that terminal the entire workspace screen, without a redundant wrapper or inset. The `website / shell` surface is now a real local PTY running the user's login shell. It is the same live AppKit view when seen inside a workspace screen, entered as a session, and focused edge to edge; camera navigation never recreates it. It supports normal terminal input, selection, scrolling, clipboard operations, resizing, and `Esc, Esc` navigation. Other surfaces and lifecycle actions remain simulated during this checkpoint.

Machinen's product boundary is terminals plus automation. Agent launchers are not hardcoded into the desktop application. A future lightweight scripting layer will let users create workspace screens, launch commands, label terminals, and control the camera/UI. The language is intentionally undecided, while `MachinenTerminalView` isolates the terminal engine from that future API.

SwiftTerm `v1.15.0` is pinned to commit `dd2fb8ac5b861e7bf617c872895e338f38165648` for this terminal checkpoint because it builds with Command Line Tools. Ghostty's current macOS embedding path requires its private, unstable application API and the full Xcode Metal toolchain; the terminal host boundary keeps a later engine replacement contained.

## Run

```sh
cd apps/machinen-desktop
swift run MachinenDesktop
```

To build a transferable application bundle:

```sh
./build-app.sh release
open Machinen.app
```

Requires macOS 14 or newer.
