import Foundation

struct TerminalProcessInfo: Equatable {
    let shellPID: Int32
    let processPID: Int32
}

/// Reports activity that the Desktop viewer can observe directly.
///
/// Foreground process metadata belongs in the native session protocol. Until
/// that protocol exposes it, detached or quiet sessions remain `unknown`
/// instead of being guessed from host process lists.
@MainActor
final class TerminalActivityDetector {
    private enum Metrics {
        static let pollInterval: TimeInterval = 0.5
        static let recentActivityWindow: TimeInterval = 1.5
    }

    private let session: TerminalSession
    private var timer: Timer?
    private var lastObservedActivityAt: TimeInterval = 0
    private var lastReportedState: TerminalSession.ActivityState = .unknown

    var onActivityChange: ((TerminalSession.ActivityState) -> Void)?
    var onCommandChange: ((String) -> Void)?
    var onShellNameChange: ((String) -> Void)?
    var onProcessInfoChange: ((TerminalProcessInfo?) -> Void)?

    init(session: TerminalSession) {
        self.session = session
        lastReportedState = session.activityState
    }

    func start() {
        guard timer == nil else { return }
        poll()
        let timer = Timer(
            timeInterval: Metrics.pollInterval,
            target: self,
            selector: #selector(pollTimerFired(_:)),
            userInfo: nil,
            repeats: true
        )
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func recordOutput() {
        lastObservedActivityAt = Date().timeIntervalSince1970
        report(.working)
    }

    @objc private func pollTimerFired(_ timer: Timer) {
        poll()
    }

    private func poll() {
        guard session.state == .running || session.state == .starting || session.state == .detached else {
            report(.unknown)
            return
        }
        let age = Date().timeIntervalSince1970 - lastObservedActivityAt
        report(age <= Metrics.recentActivityWindow ? .working : .unknown)
    }

    private func report(_ state: TerminalSession.ActivityState) {
        guard state != lastReportedState else { return }
        lastReportedState = state
        onActivityChange?(state)
    }
}
