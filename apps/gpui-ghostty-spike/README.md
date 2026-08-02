# GPUI + Ghostty interop spike

This disposable macOS experiment tests the riskiest part of replacing Machinen
Desktop's Swift/AppKit shell with Rust and GPUI: keeping Ghostty's native macOS
embedding surface.

The window chrome and terminal placeholder are rendered by GPUI. A small
Objective-C bridge obtains GPUI's raw AppKit `NSView`, installs a child `NSView`,
and gives that child to `ghostty_surface_new`. The bridge forwards basic
keyboard, mouse, scroll, focus, clipboard, and resize events to libghostty.

## Run

Prepare the same pinned and patched Ghostty build used by Machinen Desktop, then
run the Rust app:

```sh
cd apps/gpui-ghostty-spike
../machinen-desktop/prepare-ghostty.sh
cargo run
```

Click inside the terminal and run commands. Resize the window and use **Inset
terminal** / **Fill window** to exercise coordination between GPUI layout and
the native Ghostty view.

## What this proves

- GPUI exposes its backing AppKit `NSView` through `raw-window-handle`.
- A Ghostty `NSView` and its Metal layer can render above GPUI's Metal content.
- The native view can be resized and repositioned from GPUI-owned state.
- Basic terminal focus, typing, pointer input, scrolling, and clipboard callbacks
  can cross the framework boundary.

## What this intentionally does not prove

This is not a second Machinen Desktop implementation. It does not use the
persistent session worker, spatial camera, several simultaneous surfaces,
`NSTextInputClient` composition, native menus, accessibility, or Machinen's
interaction tests. In particular, arbitrary GPUI transforms and clipping do not
automatically apply to the overlaid `NSView`; production code would need an
explicit native-view layout/compositing layer.
