import AppKit
import SwiftTerm

/// The terminal-engine boundary for Machinen.
///
/// Workspace layout and camera navigation only depend on this NSView. A future
/// engine can replace SwiftTerm without changing the spatial UI or scripting
/// surface.
final class MachinenTerminalView: LocalProcessTerminalView {
    var onDoubleEscape: (() -> Void)?
    var onProcessExit: ((Int32?) -> Void)?

    private var processStarted = false
    private var previousEscapeTime: TimeInterval?
    nonisolated(unsafe) private var keyEventMonitor: Any?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.105, alpha: 1).cgColor

        // CoreText keeps the transferable SwiftPM build independent of Xcode's
        // offline Metal compiler. The terminal-engine boundary allows a later
        // renderer swap without changing the workspace model.
        try? setUseMetal(false)
        nativeForegroundColor = NSColor(calibratedWhite: 0.82, alpha: 1)
        nativeBackgroundColor = NSColor(calibratedWhite: 0.105, alpha: 1)
        caretColor = NSColor(calibratedWhite: 0.92, alpha: 1)
        getTerminal().setCursorStyle(.steadyBlock)
        keyEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.filterKeyDown(event) ?? event
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard window != nil, !processStarted else { return }
        processStarted = true

        let environment = ProcessInfo.processInfo.environment
        let shell = environment["SHELL"].flatMap { FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil }
            ?? "/bin/zsh"
        let shellName = URL(fileURLWithPath: shell).lastPathComponent
        startProcess(
            executable: shell,
            environment: nil,
            execName: "-\(shellName)",
            currentDirectory: FileManager.default.homeDirectoryForCurrentUser.path
        )
    }

    deinit {
        if let keyEventMonitor {
            NSEvent.removeMonitor(keyEventMonitor)
        }
    }

    private func filterKeyDown(_ event: NSEvent) -> NSEvent? {
        guard event.window === window, window?.firstResponder === self else { return event }
        if event.keyCode == 53 {
            let now = ProcessInfo.processInfo.systemUptime
            if let previousEscapeTime, now - previousEscapeTime <= 0.45 {
                self.previousEscapeTime = nil
                onDoubleEscape?()
                return nil
            }
            previousEscapeTime = now
        } else {
            previousEscapeTime = nil
        }
        return event
    }

    override func processTerminated(_ source: LocalProcess, exitCode: Int32?) {
        super.processTerminated(source, exitCode: exitCode)
        onProcessExit?(exitCode)
    }
}
