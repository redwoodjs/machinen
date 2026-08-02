#import <AppKit/AppKit.h>
#import <dispatch/dispatch.h>
#import <ghostty.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static ghostty_app_t spike_app = NULL;
static ghostty_config_t spike_config = NULL;

@interface SpikeGhosttyView : NSView
@property(nonatomic, assign) ghostty_surface_t ghosttySurface;
@property(nonatomic, assign) BOOL surfaceFocused;
- (BOOL)startSurface;
- (void)invalidateSurface;
- (void)updateSurfaceGeometry;
@end

static SpikeGhosttyView *spike_view_from_userdata(void *userdata) {
    if (userdata == NULL) return nil;
    return (__bridge SpikeGhosttyView *)userdata;
}

static ghostty_input_mods_e spike_modifiers(NSEventModifierFlags flags) {
    uint32_t value = GHOSTTY_MODS_NONE;
    if ((flags & NSEventModifierFlagShift) != 0) value |= GHOSTTY_MODS_SHIFT;
    if ((flags & NSEventModifierFlagControl) != 0) value |= GHOSTTY_MODS_CTRL;
    if ((flags & NSEventModifierFlagOption) != 0) value |= GHOSTTY_MODS_ALT;
    if ((flags & NSEventModifierFlagCommand) != 0) value |= GHOSTTY_MODS_SUPER;
    if ((flags & NSEventModifierFlagCapsLock) != 0) value |= GHOSTTY_MODS_CAPS;
    return (ghostty_input_mods_e)value;
}

static ghostty_input_key_s spike_key_event(NSEvent *event, ghostty_input_action_e action) {
    ghostty_input_key_s key = {0};
    key.action = action;
    key.mods = spike_modifiers(event.modifierFlags);
    key.consumed_mods = spike_modifiers(
        event.modifierFlags & ~(NSEventModifierFlagControl | NSEventModifierFlagCommand)
    );
    key.keycode = event.keyCode;

    NSString *unshifted = [event charactersByApplyingModifiers:0];
    if (unshifted.length > 0) {
        key.unshifted_codepoint = [unshifted characterAtIndex:0];
    }

    NSString *characters = event.characters;
    if (characters.length > 0) {
        unichar first = [characters characterAtIndex:0];
        if (first >= 0x20 && !(first >= 0xF700 && first <= 0xF8FF)) {
            key.text = characters.UTF8String;
        }
    }
    return key;
}

static ghostty_input_mouse_button_e spike_mouse_button(NSEvent *event) {
    switch (event.buttonNumber) {
        case 0: return GHOSTTY_MOUSE_LEFT;
        case 1: return GHOSTTY_MOUSE_RIGHT;
        case 2: return GHOSTTY_MOUSE_MIDDLE;
        default: return GHOSTTY_MOUSE_UNKNOWN;
    }
}

static void spike_tick(void *context) {
    ghostty_app_t app = context;
    if (app != NULL) ghostty_app_tick(app);
}

static void spike_wakeup(void *userdata) {
    (void)userdata;
    if (spike_app != NULL) {
        dispatch_async_f(dispatch_get_main_queue(), spike_app, spike_tick);
    }
}

static bool spike_action(
    ghostty_app_t app,
    ghostty_target_s target,
    ghostty_action_s action
) {
    (void)app;
    (void)target;
    (void)action;
    // This spike only validates rendering and native event delivery. Treat
    // window-management actions as handled so Ghostty does not attempt to own
    // GPUI's application lifecycle.
    return true;
}

static bool spike_read_clipboard(
    void *userdata,
    ghostty_clipboard_e location,
    void *state
) {
    SpikeGhosttyView *view = spike_view_from_userdata(userdata);
    if (view == nil || view.ghosttySurface == NULL || location != GHOSTTY_CLIPBOARD_STANDARD) {
        return false;
    }
    NSString *value = [NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString];
    if (value == nil) return false;
    ghostty_surface_complete_clipboard_request(
        view.ghosttySurface,
        value.UTF8String,
        state,
        false
    );
    return true;
}

static void spike_confirm_clipboard(
    void *userdata,
    const char *value,
    void *state,
    ghostty_clipboard_request_e request
) {
    SpikeGhosttyView *view = spike_view_from_userdata(userdata);
    if (view == nil || view.ghosttySurface == NULL) return;
    bool allow = request == GHOSTTY_CLIPBOARD_REQUEST_PASTE;
    ghostty_surface_complete_clipboard_request(
        view.ghosttySurface,
        allow ? value : NULL,
        state,
        allow
    );
}

static void spike_write_clipboard(
    void *userdata,
    ghostty_clipboard_e location,
    const ghostty_clipboard_content_s *content,
    size_t count,
    bool confirm
) {
    if (spike_view_from_userdata(userdata) == nil ||
        location != GHOSTTY_CLIPBOARD_STANDARD || confirm || content == NULL) {
        return;
    }
    for (size_t index = 0; index < count; index++) {
        if (content[index].mime == NULL || content[index].data == NULL) continue;
        if (strcmp(content[index].mime, "text/plain") != 0) continue;
        NSString *value = [NSString stringWithUTF8String:content[index].data];
        if (value == nil) return;
        [NSPasteboard.generalPasteboard clearContents];
        [NSPasteboard.generalPasteboard setString:value forType:NSPasteboardTypeString];
        return;
    }
}

static void spike_close_surface(void *userdata, bool process_alive) {
    (void)process_alive;
    SpikeGhosttyView *view = spike_view_from_userdata(userdata);
    if (view != nil) [view setNeedsDisplay:YES];
}

static BOOL spike_initialize_runtime(const char *resources_directory) {
    if (spike_app != NULL) return YES;
    if (resources_directory == NULL) {
        fprintf(stderr, "gpui-ghostty-spike: no Ghostty resources directory\n");
        return NO;
    }

    fprintf(stderr, "gpui-ghostty-spike: resources=%s\n", resources_directory);
    setenv("GHOSTTY_RESOURCES_DIR", resources_directory, 1);
    static char executable[] = "gpui-ghostty-spike";
    char *arguments[] = {executable, NULL};
    if (ghostty_init(1, arguments) != GHOSTTY_SUCCESS) {
        fprintf(stderr, "gpui-ghostty-spike: ghostty_init failed\n");
        return NO;
    }

    spike_config = ghostty_config_new();
    if (spike_config == NULL) {
        fprintf(stderr, "gpui-ghostty-spike: ghostty_config_new failed\n");
        return NO;
    }
    ghostty_config_load_default_files(spike_config);
    ghostty_config_finalize(spike_config);

    ghostty_runtime_config_s runtime = {
        .userdata = NULL,
        .supports_selection_clipboard = true,
        .wakeup_cb = spike_wakeup,
        .action_cb = spike_action,
        .read_clipboard_cb = spike_read_clipboard,
        .confirm_read_clipboard_cb = spike_confirm_clipboard,
        .write_clipboard_cb = spike_write_clipboard,
        .close_surface_cb = spike_close_surface,
    };
    spike_app = ghostty_app_new(&runtime, spike_config);
    if (spike_app == NULL) {
        fprintf(stderr, "gpui-ghostty-spike: ghostty_app_new failed\n");
        return NO;
    }
    ghostty_app_set_focus(spike_app, true);
    fprintf(stderr, "gpui-ghostty-spike: Ghostty runtime initialized\n");
    return YES;
}

@implementation SpikeGhosttyView

- (instancetype)initWithFrame:(NSRect)frame {
    self = [super initWithFrame:frame];
    if (self != nil) {
        _ghosttySurface = NULL;
        _surfaceFocused = NO;
    }
    return self;
}

- (BOOL)isOpaque {
    return YES;
}

- (BOOL)acceptsFirstResponder {
    return YES;
}

- (BOOL)becomeFirstResponder {
    BOOL accepted = [super becomeFirstResponder];
    if (accepted && self.ghosttySurface != NULL) {
        self.surfaceFocused = YES;
        ghostty_surface_set_focus(self.ghosttySurface, true);
    }
    return accepted;
}

- (BOOL)resignFirstResponder {
    BOOL accepted = [super resignFirstResponder];
    if (accepted && self.ghosttySurface != NULL) {
        self.surfaceFocused = NO;
        ghostty_surface_set_focus(self.ghosttySurface, false);
    }
    return accepted;
}

- (BOOL)startSurface {
    if (self.ghosttySurface != NULL || spike_app == NULL) return NO;

    ghostty_surface_config_s config = ghostty_surface_config_new();
    config.userdata = (__bridge void *)self;
    config.platform_tag = GHOSTTY_PLATFORM_MACOS;
    config.platform.macos.nsview = (__bridge void *)self;
    config.scale_factor = self.window.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor;
    config.context = GHOSTTY_SURFACE_CONTEXT_SPLIT;
    config.working_directory = NSHomeDirectory().fileSystemRepresentation;
    config.command = "/bin/zsh -l";

    self.ghosttySurface = ghostty_surface_new(spike_app, &config);
    if (self.ghosttySurface == NULL) {
        fprintf(stderr, "gpui-ghostty-spike: ghostty_surface_new failed\n");
        [self setNeedsDisplay:YES];
        return NO;
    }
    fprintf(stderr, "gpui-ghostty-spike: Ghostty surface created\n");
    [self updateSurfaceGeometry];
    ghostty_surface_set_focus(self.ghosttySurface, self.surfaceFocused);
    return YES;
}

- (void)invalidateSurface {
    if (self.ghosttySurface == NULL) return;
    ghostty_surface_t surface = self.ghosttySurface;
    self.ghosttySurface = NULL;
    ghostty_surface_free(surface);
    self.wantsLayer = NO;
    self.layer = nil;
}

- (void)updateSurfaceGeometry {
    if (self.ghosttySurface == NULL) return;
    CGFloat scale = self.window.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor;
    NSSize size = self.bounds.size;
    ghostty_surface_set_content_scale(self.ghosttySurface, scale, scale);
    ghostty_surface_set_size(
        self.ghosttySurface,
        (uint32_t)MAX(1, llround(size.width * scale)),
        (uint32_t)MAX(1, llround(size.height * scale))
    );
}

- (void)setFrameSize:(NSSize)newSize {
    [super setFrameSize:newSize];
    [self updateSurfaceGeometry];
}

- (void)viewDidChangeBackingProperties {
    [super viewDidChangeBackingProperties];
    [self updateSurfaceGeometry];
}

- (void)drawRect:(NSRect)dirtyRect {
    [[NSColor colorWithCalibratedWhite:0.055 alpha:1.0] setFill];
    NSRectFill(dirtyRect);
    if (self.ghosttySurface == NULL) {
        NSDictionary *attributes = @{
            NSFontAttributeName: [NSFont monospacedSystemFontOfSize:13 weight:NSFontWeightRegular],
            NSForegroundColorAttributeName: NSColor.systemRedColor,
        };
        [@"Ghostty surface creation failed" drawAtPoint:NSMakePoint(18, 18)
                                         withAttributes:attributes];
    }
}

- (void)keyDown:(NSEvent *)event {
    if (self.ghosttySurface == NULL) return;
    ghostty_input_action_e action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS;
    ghostty_input_key_s key = spike_key_event(event, action);
    ghostty_surface_key(self.ghosttySurface, key);
}

- (void)keyUp:(NSEvent *)event {
    if (self.ghosttySurface == NULL) return;
    ghostty_input_key_s key = spike_key_event(event, GHOSTTY_ACTION_RELEASE);
    ghostty_surface_key(self.ghosttySurface, key);
}

- (void)mouseDown:(NSEvent *)event {
    [self.window makeFirstResponder:self];
    if (self.ghosttySurface == NULL) return;
    NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
    ghostty_surface_mouse_pos(
        self.ghosttySurface,
        point.x,
        self.bounds.size.height - point.y,
        spike_modifiers(event.modifierFlags)
    );
    ghostty_surface_mouse_button(
        self.ghosttySurface,
        GHOSTTY_MOUSE_PRESS,
        spike_mouse_button(event),
        spike_modifiers(event.modifierFlags)
    );
}

- (void)mouseDragged:(NSEvent *)event {
    if (self.ghosttySurface == NULL) return;
    NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
    ghostty_surface_mouse_pos(
        self.ghosttySurface,
        point.x,
        self.bounds.size.height - point.y,
        spike_modifiers(event.modifierFlags)
    );
}

- (void)mouseUp:(NSEvent *)event {
    if (self.ghosttySurface == NULL) return;
    ghostty_surface_mouse_button(
        self.ghosttySurface,
        GHOSTTY_MOUSE_RELEASE,
        spike_mouse_button(event),
        spike_modifiers(event.modifierFlags)
    );
}

- (void)rightMouseDown:(NSEvent *)event {
    [self mouseDown:event];
}

- (void)rightMouseDragged:(NSEvent *)event {
    [self mouseDragged:event];
}

- (void)rightMouseUp:(NSEvent *)event {
    [self mouseUp:event];
}

- (void)scrollWheel:(NSEvent *)event {
    if (self.ghosttySurface == NULL) return;
    double x = event.scrollingDeltaX;
    double y = event.scrollingDeltaY;
    if (event.hasPreciseScrollingDeltas) {
        x *= 2;
        y *= 2;
    }
    ghostty_input_scroll_mods_t modifiers = event.hasPreciseScrollingDeltas ? 1 : 0;
    ghostty_surface_mouse_scroll(self.ghosttySurface, x, y, modifiers);
}

@end

static void spike_set_frame(
    SpikeGhosttyView *view,
    double left,
    double bottom,
    double right,
    double top
) {
    NSRect bounds = view.superview.bounds;
    view.frame = NSMakeRect(
        left,
        bottom,
        MAX(1, bounds.size.width - left - right),
        MAX(1, bounds.size.height - bottom - top)
    );
}

void *spike_ghostty_terminal_create(
    void *parent_pointer,
    const char *resources_directory,
    double left,
    double bottom,
    double right,
    double top
) {
    if (parent_pointer == NULL || !spike_initialize_runtime(resources_directory)) return NULL;

    NSView *parent = (__bridge NSView *)parent_pointer;
    SpikeGhosttyView *view = [[SpikeGhosttyView alloc] initWithFrame:NSZeroRect];
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [parent addSubview:view];
    spike_set_frame(view, left, bottom, right, top);
    fprintf(
        stderr,
        "gpui-ghostty-spike: parent=%s bounds=%s window=%s child=%s scale=%.2f\n",
        NSStringFromClass(parent.class).UTF8String,
        NSStringFromRect(parent.bounds).UTF8String,
        parent.window == nil ? "nil" : "ready",
        NSStringFromRect(view.frame).UTF8String,
        view.window.backingScaleFactor
    );
    if (![view startSurface]) {
        [view removeFromSuperview];
        return NULL;
    }
    return (__bridge_retained void *)view;
}

void spike_ghostty_terminal_set_insets(
    void *handle,
    double left,
    double bottom,
    double right,
    double top
) {
    SpikeGhosttyView *view = spike_view_from_userdata(handle);
    if (view == nil || view.superview == nil) return;
    spike_set_frame(view, left, bottom, right, top);
    [view updateSurfaceGeometry];
}

void spike_ghostty_terminal_focus(void *handle) {
    SpikeGhosttyView *view = spike_view_from_userdata(handle);
    if (view != nil) [view.window makeFirstResponder:view];
}

void spike_ghostty_terminal_destroy(void *handle) {
    if (handle == NULL) return;
    SpikeGhosttyView *view = (__bridge_transfer SpikeGhosttyView *)handle;
    [view invalidateSurface];
    [view removeFromSuperview];
}
