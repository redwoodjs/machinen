import Foundation

struct TerminalProcessInfo: Equatable {
    let shellPID: Int32
    let processPID: Int32
}

/// Reports foreground activity from the worker that owns the session's PTY.
/// Older live workers remain `unknown` until explicitly restarted.
@MainActor
final class TerminalActivityDetector {
    private enum Metrics {
        static let pollInterval: TimeInterval = 1
        static let recentActivityWindow: TimeInterval = 1.5
        static let shellNames: Set<String> = [
            "sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "nu",
        ]
        static let interactiveTransportNames: Set<String> = ["ssh"]
    }

    private let session: TerminalSession
    private let telemetryProvider: (
        @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
    ) -> Void
    private var timer: DispatchSourceTimer?
    private var queryInFlight = false
    private var lastObservedActivityAt: TimeInterval = 0
    private var lastReportedState: TerminalSession.ActivityState = .unknown
    private var lastCommand: String?
    private var lastShellName: String?
    private var lastProcessInfo: TerminalProcessInfo?
    private var lastGeometry: TerminalGeometry?

    var onActivityChange: ((TerminalSession.ActivityState) -> Void)?
    var onCommandChange: ((String) -> Void)?
    var onShellNameChange: ((String) -> Void)?
    var onProcessInfoChange: ((TerminalProcessInfo?) -> Void)?
    var onGeometryChange: ((TerminalGeometry) -> Void)?

    convenience init(session: TerminalSession) {
        let backend = TerminalSessionBackendFactory.backend
        self.init(session: session) { completion in
            backend.inspect(session, completion: completion)
        }
    }

    init(
        session: TerminalSession,
        telemetryProvider: @escaping (
            @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
        ) -> Void
    ) {
        self.session = session
        self.telemetryProvider = telemetryProvider
        lastReportedState = session.activityState
    }

    func start() {
        guard timer == nil else { return }
        poll()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(
            deadline: .now() + Metrics.pollInterval,
            repeating: Metrics.pollInterval
        )
        timer.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                self?.poll()
            }
        }
        self.timer = timer
        timer.resume()
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    func recordOutput() {
        lastObservedActivityAt = Date().timeIntervalSince1970
        if let command = lastCommand,
           Metrics.shellNames.contains(command),
           let process = lastProcessInfo,
           process.processPID != process.shellPID
        {
            // A nested interactive shell can redraw its prompt or a TUI while
            // it waits for input. Its authoritative foreground identity is
            // idle; renderer bytes alone must not leave it permanently active.
            report(.idle)
            return
        }
        report(.working)
    }

    private func poll() {
        // The native worker is authoritative. A renderer can be stopped or
        // disconnected while its persistent PTY is still running.
        guard !queryInFlight else { return }
        queryInFlight = true
        telemetryProvider { [weak self] telemetry in
            guard let self else { return }
            self.queryInFlight = false
            self.reportTelemetry(telemetry)
        }
    }

    private func reportTelemetry(_ telemetry: TerminalTelemetry?) {
        if let geometry = telemetry?.geometry, geometry != lastGeometry {
            lastGeometry = geometry
            onGeometryChange?(geometry)
        }
        guard let telemetry,
              telemetry.activity != .unknown || telemetry.shellPid != nil
                || telemetry.processPid != nil || telemetry.shellName != nil
                || telemetry.command != nil
        else {
            // Protocol-v1 workers cannot expose foreground telemetry without
            // replacing their live PTY. Preserve those sessions and derive a
            // conservative active/idle state from viewer output instead.
            let canBeRunning = session.state == .running || session.state == .starting
                || session.state == .detached || session.state == .disconnected
            let age = Date().timeIntervalSince1970 - lastObservedActivityAt
            report(canBeRunning && age <= Metrics.recentActivityWindow ? .working : (canBeRunning ? .idle : .unknown))
            updateProcessInfo(nil)
            return
        }
        let activity = if telemetry.activity == .working,
                          let command = telemetry.command,
                          Metrics.shellNames.contains(command)
                            || Metrics.interactiveTransportNames.contains(command)
        {
            TerminalSession.ActivityState.idle
        } else {
            telemetry.activity
        }
        report(activity)
        if let command = telemetry.command, !command.isEmpty, command != lastCommand {
            lastCommand = command
            onCommandChange?(command)
        }
        if let shellName = telemetry.shellName, !shellName.isEmpty, shellName != lastShellName {
            lastShellName = shellName
            onShellNameChange?(shellName)
        }
        let processInfo: TerminalProcessInfo? = if let shellPID = telemetry.shellPid,
                             let processPID = telemetry.processPid
        {
            TerminalProcessInfo(shellPID: shellPID, processPID: processPID)
        } else {
            nil
        }
        updateProcessInfo(processInfo)
    }

    private func updateProcessInfo(_ info: TerminalProcessInfo?) {
        guard info != lastProcessInfo else { return }
        lastProcessInfo = info
        onProcessInfoChange?(info)
    }

    private func report(_ state: TerminalSession.ActivityState) {
        guard state != lastReportedState else { return }
        lastReportedState = state
        onActivityChange?(state)
    }
}
