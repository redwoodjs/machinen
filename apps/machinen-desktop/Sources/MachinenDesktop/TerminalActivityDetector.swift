import Foundation

private struct DtachActivityStatus: Decodable {
    let version: Int
    let masterPid: Int32
    let childPid: Int32
    let foregroundPgrp: Int32
    let canonical: Bool
    let echo: Bool
    let inputBytes: UInt64
    let outputBytes: UInt64
    let lastInputAt: TimeInterval
    let lastOutputAt: TimeInterval
}

@MainActor
final class TerminalActivityDetector {
    private enum Metrics {
        static let pollInterval: TimeInterval = 0.5
        static let recentActivityWindow: TimeInterval = 1.5
        static let quietBeforeProbe: TimeInterval = 0.75
        static let probeInterval: TimeInterval = 1.0
        static let requiredEvidenceCount = 2
    }

    private let session: TerminalSession
    private var timer: Timer?
    private var sampleProcess: Process?
    private var lastProbeAt: TimeInterval = 0
    private var waitingEvidence = 0
    private var observedForegroundPgrp: Int32?
    private var settledQuietState: TerminalSession.ActivityState?
    private var lastReportedState: TerminalSession.ActivityState = .unknown

    var onActivityChange: ((TerminalSession.ActivityState) -> Void)?

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
        sampleProcess?.terminate()
        sampleProcess = nil
    }

    @objc private func pollTimerFired(_ timer: Timer) {
        poll()
    }

    private func poll() {
        guard session.state == .running || session.state == .starting || session.state == .detached else {
            waitingEvidence = 0
            observedForegroundPgrp = nil
            settledQuietState = nil
            report(.unknown)
            return
        }
        guard let status = readStatus(), status.version == 1 else {
            observedForegroundPgrp = nil
            settledQuietState = nil
            report(.unknown)
            return
        }

        if observedForegroundPgrp != status.foregroundPgrp {
            observedForegroundPgrp = status.foregroundPgrp
            waitingEvidence = 0
            settledQuietState = nil
        }

        let now = Date().timeIntervalSince1970
        let lastActivity = max(status.lastInputAt, status.lastOutputAt)
        if now - lastActivity <= Metrics.recentActivityWindow {
            waitingEvidence = 0
            settledQuietState = nil
            report(.working)
            return
        }

        if session.launch.kind == .loginShell,
           status.foregroundPgrp == status.childPid
        {
            waitingEvidence = 0
            settledQuietState = .idle
            report(.idle)
            return
        }
        if let settledQuietState {
            report(settledQuietState)
            return
        }

        guard now - lastActivity >= Metrics.quietBeforeProbe else {
            report(.working)
            return
        }
        probeForegroundProcess(status, now: now)
    }

    private func readStatus() -> DtachActivityStatus? {
        let url = URL(fileURLWithPath: session.socketPath + ".status")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(DtachActivityStatus.self, from: data)
    }

    private func probeForegroundProcess(_ status: DtachActivityStatus, now: TimeInterval) {
        guard sampleProcess == nil,
              now - lastProbeAt >= Metrics.probeInterval
        else { return }
        let pid = status.foregroundPgrp > 0 ? status.foregroundPgrp : status.childPid
        guard pid > 0 else {
            report(.unknown)
            return
        }

        lastProbeAt = now
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sample")
        process.arguments = [String(pid), "0.05", "1", "-file", "/dev/stdout"]
        process.standardOutput = output
        process.standardError = output
        process.terminationHandler = { [weak self] process in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor in
                self?.sampleFinished(text: text, succeeded: process.terminationStatus == 0, status: status)
            }
        }
        do {
            try process.run()
            sampleProcess = process
        } catch {
            sampleProcess = nil
            report(.unknown)
        }
    }

    private func sampleFinished(
        text: String,
        succeeded: Bool,
        status: DtachActivityStatus
    ) {
        sampleProcess = nil
        guard succeeded else {
            waitingEvidence = 0
            report(.unknown)
            return
        }

        let verdict = Self.classifySample(
            text,
            canonical: status.canonical,
            echo: status.echo
        )
        switch verdict {
        case .waiting:
            waitingEvidence += 1
            if waitingEvidence >= Metrics.requiredEvidenceCount {
                settledQuietState = .waiting
                report(.waiting)
            } else {
                report(.working)
            }
        case .working:
            waitingEvidence = 0
            settledQuietState = .working
            report(.working)
        case .unknown:
            waitingEvidence = 0
            report(.unknown)
        }
    }

    enum SampleVerdict: Equatable {
        case waiting
        case working
        case unknown
    }

    static func classifySample(
        _ text: String,
        canonical: Bool,
        echo: Bool
    ) -> SampleVerdict {
        let sample = text.lowercased()
        let inputWaits = [
            " read  (in libsystem_kernel",
            " readline",
            " el_gets",
            " wgetnstr",
            " wgetch",
            " tgetch",
        ]
        if inputWaits.contains(where: sample.contains) {
            return .waiting
        }

        let nonInputWaits = [
            " nanosleep",
            " wait4",
            " waitpid",
            " recvfrom",
            " connect  (in libsystem_kernel",
            " semaphore_wait",
        ]
        if nonInputWaits.contains(where: sample.contains) {
            return .working
        }

        let eventWaits = [" kevent", " poll", " select  (in libsystem_kernel"]
        if eventWaits.contains(where: sample.contains), !canonical || !echo {
            return .waiting
        }
        if sample.contains("call graph:") {
            return .working
        }
        return .unknown
    }

    private func report(_ state: TerminalSession.ActivityState) {
        guard state != lastReportedState else { return }
        lastReportedState = state
        onActivityChange?(state)
    }
}
