use std::{env, ffi::CString, os::raw::c_void, ptr::NonNull};

use gpui::{
    App, Application, Bounds, Context, Window, WindowBounds, WindowOptions, div, prelude::*, px,
    rgb, size,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

const NORMAL_INSETS: Insets = Insets {
    left: 24.0,
    bottom: 24.0,
    right: 24.0,
    top: 76.0,
};
const COMPACT_INSETS: Insets = Insets {
    left: 116.0,
    bottom: 72.0,
    right: 116.0,
    top: 124.0,
};

#[derive(Clone, Copy)]
struct Insets {
    left: f64,
    bottom: f64,
    right: f64,
    top: f64,
}

unsafe extern "C" {
    fn spike_ghostty_terminal_create(
        parent: *mut c_void,
        resources_directory: *const std::os::raw::c_char,
        left: f64,
        bottom: f64,
        right: f64,
        top: f64,
    ) -> *mut c_void;
    fn spike_ghostty_terminal_set_insets(
        handle: *mut c_void,
        left: f64,
        bottom: f64,
        right: f64,
        top: f64,
    );
    fn spike_ghostty_terminal_focus(handle: *mut c_void);
    fn spike_ghostty_terminal_destroy(handle: *mut c_void);
}

struct GhosttyTerminal(NonNull<c_void>);

impl GhosttyTerminal {
    fn attach(
        parent: *mut c_void,
        resources_directory: &CString,
        insets: Insets,
    ) -> Result<Self, &'static str> {
        // SAFETY: `parent` is GPUI's live NSView. The Objective-C bridge keeps
        // its child NSView retained until this handle is dropped.
        let handle = unsafe {
            spike_ghostty_terminal_create(
                parent,
                resources_directory.as_ptr(),
                insets.left,
                insets.bottom,
                insets.right,
                insets.top,
            )
        };
        NonNull::new(handle)
            .map(Self)
            .ok_or("Ghostty failed to create a terminal surface; see stderr for details")
    }

    fn set_insets(&self, insets: Insets) {
        // SAFETY: The bridge handle remains valid for the lifetime of `self`.
        unsafe {
            spike_ghostty_terminal_set_insets(
                self.0.as_ptr(),
                insets.left,
                insets.bottom,
                insets.right,
                insets.top,
            );
        }
    }

    fn focus(&self) {
        // SAFETY: The bridge handle remains valid for the lifetime of `self`.
        unsafe { spike_ghostty_terminal_focus(self.0.as_ptr()) }
    }
}

impl Drop for GhosttyTerminal {
    fn drop(&mut self) {
        // SAFETY: This is the single owning bridge handle and Drop runs once.
        unsafe { spike_ghostty_terminal_destroy(self.0.as_ptr()) }
    }
}

struct SpikeView {
    terminal: Option<GhosttyTerminal>,
    terminal_error: Option<&'static str>,
    compact: bool,
}

impl SpikeView {
    fn insets(&self) -> Insets {
        if self.compact {
            COMPACT_INSETS
        } else {
            NORMAL_INSETS
        }
    }

    fn toggle_compact(&mut self, cx: &mut Context<Self>) {
        self.compact = !self.compact;
        if let Some(terminal) = &self.terminal {
            terminal.set_insets(self.insets());
        }
        cx.notify();
    }
}

impl Render for SpikeView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let insets = self.insets();
        let toggle_label = if self.compact {
            "Fill window"
        } else {
            "Inset terminal"
        };
        let status = self
            .terminal_error
            .unwrap_or("GPUI chrome around a native Ghostty NSView");
        let status_color = if self.terminal_error.is_some() {
            rgb(0xff6b6b)
        } else {
            rgb(0x9298a6)
        };

        div()
            .relative()
            .size_full()
            .bg(rgb(0x111318))
            .text_color(rgb(0xe6e7eb))
            .font_family(".SystemUIFont")
            .child(
                div()
                    .absolute()
                    .left(px(24.0))
                    .right(px(24.0))
                    .top(px(18.0))
                    .h(px(42.0))
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(div().text_lg().child("GPUI + Ghostty interop spike"))
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(status_color)
                                    .child(status),
                            ),
                    )
                    .child(
                        div()
                            .id("toggle-terminal-frame")
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(rgb(0x2a3140))
                            .hover(|style| style.bg(rgb(0x374156)))
                            .cursor_pointer()
                            .text_sm()
                            .child(toggle_label)
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_compact(cx))),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .left(px(insets.left as f32 - 1.0))
                    .right(px(insets.right as f32 - 1.0))
                    .top(px(insets.top as f32 - 1.0))
                    .bottom(px(insets.bottom as f32 - 1.0))
                    .rounded_lg()
                    .border_1()
                    .border_color(rgb(0x4a5367))
                    .bg(rgb(0x0e1014)),
            )
            .child(
                div()
                    .absolute()
                    .left(px(24.0))
                    .bottom(px(4.0))
                    .text_xs()
                    .text_color(rgb(0x697083))
                    .child("Click the terminal to focus it. Resize the window and try the inset toggle."),
            )
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(|this, _, _, _| {
                    if let Some(terminal) = &this.terminal {
                        terminal.focus();
                    }
                }),
            )
    }
}

fn main() {
    Application::new().run(|cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1040.0), px(720.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |window, cx| {
                let raw_handle = HasWindowHandle::window_handle(window)
                    .expect("GPUI did not expose a native window handle")
                    .as_raw();
                let parent = match raw_handle {
                    RawWindowHandle::AppKit(handle) => handle.ns_view.as_ptr(),
                    other => panic!("expected GPUI's AppKit window, got {other:?}"),
                };
                let resources_path = env::var("GHOSTTY_RESOURCES_DIR").unwrap_or_else(|_| {
                    concat!(
                        env!("CARGO_MANIFEST_DIR"),
                        "/../machinen-desktop/Sources/MachinenDesktop/GhosttyResources/ghostty"
                    )
                    .to_owned()
                });
                let resources = CString::new(resources_path)
                    .expect("GHOSTTY_RESOURCES_DIR contains an embedded null byte");
                let terminal = GhosttyTerminal::attach(parent, &resources, NORMAL_INSETS);
                let terminal_error = terminal.as_ref().err().copied();
                cx.new(|_| SpikeView {
                    terminal: terminal.ok(),
                    terminal_error,
                    compact: false,
                })
            },
        )
        .expect("failed to open the GPUI window");
        cx.activate(true);
    });
}
