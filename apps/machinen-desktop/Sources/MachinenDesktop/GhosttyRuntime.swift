import AppKit
import Darwin
import GhosttyKit

/// The single embedded libghostty application shared by all terminal surfaces.
final class GhosttyRuntime: @unchecked Sendable {
    static let shared = GhosttyRuntime()

    private(set) var app: ghostty_app_t?
    private var config: ghostty_config_t?

    private init() {
        if let resources = Bundle.module.url(
            forResource: "ghostty",
            withExtension: nil,
            subdirectory: "GhosttyResources"
        ) {
            setenv("GHOSTTY_RESOURCES_DIR", resources.path, 1)
        } else {
            unsetenv("GHOSTTY_RESOURCES_DIR")
        }
        guard ghostty_init(UInt(CommandLine.argc), CommandLine.unsafeArgv) == GHOSTTY_SUCCESS else {
            InputRoutingLog.log("ghostty global initialization failed")
            return
        }
        guard let config = ghostty_config_new() else {
            InputRoutingLog.log("ghostty config initialization failed")
            return
        }
        ghostty_config_load_default_files(config)
        ghostty_config_finalize(config)
        self.config = config

        var runtime = ghostty_runtime_config_s(
            userdata: Unmanaged.passUnretained(self).toOpaque(),
            supports_selection_clipboard: false,
            wakeup_cb: { userdata in GhosttyRuntime.wakeup(userdata) },
            action_cb: { _, target, action in GhosttyRuntime.action(target: target, action: action) },
            read_clipboard_cb: { userdata, location, state in
                GhosttyRuntime.readClipboard(userdata, location: location, state: state)
            },
            confirm_read_clipboard_cb: { userdata, string, state, request in
                GhosttyRuntime.confirmReadClipboard(
                    userdata,
                    string: string,
                    state: state,
                    request: request
                )
            },
            write_clipboard_cb: { userdata, location, content, count, confirm in
                GhosttyRuntime.writeClipboard(
                    userdata,
                    location: location,
                    content: content,
                    count: count,
                    confirm: confirm
                )
            },
            close_surface_cb: { userdata, processAlive in
                GhosttyRuntime.closeSurface(userdata, processAlive: processAlive)
            }
        )
        app = ghostty_app_new(&runtime, config)
        if app != nil {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(applicationDidBecomeActive),
                name: NSApplication.didBecomeActiveNotification,
                object: nil
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(applicationDidResignActive),
                name: NSApplication.didResignActiveNotification,
                object: nil
            )
        } else {
            InputRoutingLog.log("ghostty app initialization failed")
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        if let app { ghostty_app_free(app) }
        if let config { ghostty_config_free(config) }
    }

    @objc private func applicationDidBecomeActive() {
        if let app { ghostty_app_set_focus(app, true) }
    }

    @objc private func applicationDidResignActive() {
        if let app { ghostty_app_set_focus(app, false) }
    }

    private static func wakeup(_ userdata: UnsafeMutableRawPointer?) {
        guard let userdata else { return }
        let runtime = Unmanaged<GhosttyRuntime>.fromOpaque(userdata).takeUnretainedValue()
        DispatchQueue.main.async {
            if let app = runtime.app { ghostty_app_tick(app) }
        }
    }

    private static func view(from userdata: UnsafeMutableRawPointer?) -> MachinenTerminalView? {
        guard let userdata else { return nil }
        return Unmanaged<MachinenTerminalView>.fromOpaque(userdata).takeUnretainedValue()
    }

    private static func view(from target: ghostty_target_s) -> MachinenTerminalView? {
        guard target.tag == GHOSTTY_TARGET_SURFACE,
              let surface = target.target.surface,
              let userdata = ghostty_surface_userdata(surface)
        else { return nil }
        return view(from: userdata)
    }

    private static func closeSurface(_ userdata: UnsafeMutableRawPointer?, processAlive: Bool) {
        guard let view = view(from: userdata) else { return }
        DispatchQueue.main.async { view.ghosttyViewerClosed(processAlive: processAlive) }
    }

    private static func readClipboard(
        _ userdata: UnsafeMutableRawPointer?,
        location: ghostty_clipboard_e,
        state: UnsafeMutableRawPointer?
    ) -> Bool {
        guard location == GHOSTTY_CLIPBOARD_STANDARD,
              let view = view(from: userdata),
              let surface = view.ghosttySurface,
              let value = NSPasteboard.general.string(forType: .string)
        else { return false }
        value.withCString { ghostty_surface_complete_clipboard_request(surface, $0, state, false) }
        return true
    }

    private static func confirmReadClipboard(
        _ userdata: UnsafeMutableRawPointer?,
        string: UnsafePointer<CChar>?,
        state: UnsafeMutableRawPointer?,
        request: ghostty_clipboard_request_e
    ) {
        guard let view = view(from: userdata), let surface = view.ghosttySurface else { return }
        let allow = request == GHOSTTY_CLIPBOARD_REQUEST_PASTE
        ghostty_surface_complete_clipboard_request(surface, allow ? string : nil, state, allow)
    }

    private static func writeClipboard(
        _ userdata: UnsafeMutableRawPointer?,
        location: ghostty_clipboard_e,
        content: UnsafePointer<ghostty_clipboard_content_s>?,
        count: Int,
        confirm: Bool
    ) {
        guard view(from: userdata) != nil,
              location == GHOSTTY_CLIPBOARD_STANDARD,
              !confirm,
              let content
        else { return }
        for index in 0..<count {
            let item = content[index]
            guard let mime = item.mime, String(cString: mime) == "text/plain", let data = item.data else {
                continue
            }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(String(cString: data), forType: .string)
            return
        }
    }

    private static func action(target: ghostty_target_s, action: ghostty_action_s) -> Bool {
        guard let view = view(from: target) else { return false }
        switch action.tag {
        case GHOSTTY_ACTION_RENDER:
            return true
        case GHOSTTY_ACTION_SET_TITLE:
            guard let title = action.action.set_title.title else { return false }
            let value = String(cString: title)
            DispatchQueue.main.async { view.ghosttyTitleChanged(value) }
            return true
        case GHOSTTY_ACTION_PWD:
            guard let path = action.action.pwd.pwd else { return false }
            let value = String(cString: path)
            DispatchQueue.main.async { view.ghosttyWorkingDirectoryChanged(value) }
            return true
        case GHOSTTY_ACTION_CELL_SIZE:
            let size = action.action.cell_size
            DispatchQueue.main.async {
                view.ghosttyCellSizeChanged(width: size.width, height: size.height)
            }
            return true
        case GHOSTTY_ACTION_MOUSE_SHAPE:
            DispatchQueue.main.async { view.ghosttyMouseShapeChanged(action.action.mouse_shape) }
            return true
        case GHOSTTY_ACTION_MOUSE_VISIBILITY:
            DispatchQueue.main.async {
                view.ghosttyMouseVisibilityChanged(action.action.mouse_visibility == GHOSTTY_MOUSE_VISIBLE)
            }
            return true
        case GHOSTTY_ACTION_RING_BELL:
            DispatchQueue.main.async { NSSound.beep() }
            return true
        case GHOSTTY_ACTION_OPEN_URL:
            let value = action.action.open_url
            guard let bytes = value.url else { return false }
            let data = Data(bytes: bytes, count: Int(value.len))
            guard let string = String(data: data, encoding: .utf8), let url = URL(string: string) else {
                return false
            }
            DispatchQueue.main.async { NSWorkspace.shared.open(url) }
            return true
        case GHOSTTY_ACTION_SHOW_CHILD_EXITED:
            let exitCode = action.action.child_exited.exit_code
            DispatchQueue.main.async { view.ghosttyChildExited(exitCode: exitCode) }
            return true
        case GHOSTTY_ACTION_COMMAND_FINISHED:
            DispatchQueue.main.async { view.ghosttyCommandFinished() }
            return true
        case GHOSTTY_ACTION_RENDERER_HEALTH:
            if action.action.renderer_health == GHOSTTY_RENDERER_HEALTH_UNHEALTHY {
                InputRoutingLog.log("ghostty renderer unhealthy")
            }
            return true
        case GHOSTTY_ACTION_SCROLLBAR, GHOSTTY_ACTION_COLOR_CHANGE, GHOSTTY_ACTION_PROGRESS_REPORT:
            return true
        default:
            return false
        }
    }
}
