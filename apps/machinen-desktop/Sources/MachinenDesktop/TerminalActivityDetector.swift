import Darwin
import Foundation

struct DtachActivityStatus: Decodable {
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
    let tty: String?
}

@MainActor
final class TerminalActivityDetector {
    private enum Metrics {
        static let pollInterval: TimeInterval = 0.5
        static let recentActivityWindow: TimeInterval = 1.5
        static let quietBeforeProbe: TimeInterval = 0.75
        static let probeInterval: TimeInterval = 1.0
        static let legacyInspectionInterval: TimeInterval = 2.0
        static let requiredEvidenceCount = 2
    }

    private let session: TerminalSession
    private var timer: Timer?
    private var sampleProcess: Process?
    private var legacyInspectionProcess: Process?
    private var legacyStatus: DtachActivityStatus?
    private var lastProbeAt: TimeInterval = 0
    private var lastLegacyInspectionAt: TimeInterval = 0
    private var lastObservedActivityAt: TimeInterval = 0
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
        legacyInspectionProcess?.terminate()
        legacyInspectionProcess = nil
    }

    func recordOutput() {
        lastObservedActivityAt = Date().timeIntervalSince1970
        waitingEvidence = 0
        settledQuietState = nil
        report(.working)
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
        let now = Date().timeIntervalSince1970
        let sidecarStatus = readStatus()
        if sidecarStatus == nil {
            refreshLegacyStatus()
            inspectLegacySession(now: now)
        }
        guard let status = sidecarStatus ?? legacyStatus, status.version == 1 else {
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

        let lastActivity = max(status.lastInputAt, status.lastOutputAt, lastObservedActivityAt)
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

    private func inspectLegacySession(now: TimeInterval) {
        guard legacyStatus == nil, legacyInspectionProcess == nil,
              now - lastLegacyInspectionAt >= Metrics.legacyInspectionInterval
        else { return }
        lastLegacyInspectionAt = now

        let process = Process()
        let socketURL = URL(fileURLWithPath: session.socketPath)
        let outputURL = socketURL.deletingLastPathComponent()
            .appendingPathComponent("activity-\(UUID().uuidString).tmp")
        guard FileManager.default.createFile(
            atPath: outputURL.path,
            contents: nil,
            attributes: [.posixPermissions: 0o600]
        ), let output = try? FileHandle(forWritingTo: outputURL)
        else { return }

        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-ww", "-axo", "pid=,ppid=,pgid=,tpgid=,tty=,command="]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        let socketPath = session.socketPath
        process.terminationHandler = { [weak self] process in
            try? output.close()
            let data = (try? Data(contentsOf: outputURL)) ?? Data()
            try? FileManager.default.removeItem(at: outputURL)
            let text = String(decoding: data, as: UTF8.self)
            let succeeded = process.terminationStatus == 0
            Task { @MainActor [weak self] in
                guard let self, self.timer != nil else { return }
                self.legacyInspectionProcess = nil
                self.legacyStatus = succeeded
                    ? Self.parseLegacyStatus(text, socketPath: socketPath)
                    : nil
                self.poll()
            }
        }
        do {
            try process.run()
            legacyInspectionProcess = process
        } catch {
            try? output.close()
            try? FileManager.default.removeItem(at: outputURL)
            legacyInspectionProcess = nil
        }
    }

    static func parseLegacyStatus(
        _ processList: String,
        socketPath: String
    ) -> DtachActivityStatus? {
        struct Row {
            let pid: Int32
            let parentPid: Int32
            let processGroup: Int32
            let foregroundGroup: Int32
            let tty: String
            let command: String
        }

        let rows = processList.split(separator: "\n").compactMap { line -> Row? in
            let fields = line.split(
                maxSplits: 5,
                omittingEmptySubsequences: true,
                whereSeparator: { $0.isWhitespace }
            )
            guard fields.count == 6,
                  let pid = Int32(fields[0]),
                  let parentPid = Int32(fields[1]),
                  let processGroup = Int32(fields[2]),
                  let foregroundGroup = Int32(fields[3])
            else { return nil }
            return Row(
                pid: pid,
                parentPid: parentPid,
                processGroup: processGroup,
                foregroundGroup: foregroundGroup,
                tty: String(fields[4]),
                command: String(fields[5])
            )
        }
        let masters = rows.filter {
            $0.command.contains("machinen-dtach") && $0.command.contains(socketPath)
        }
        for master in masters {
            guard let child = rows.first(where: {
                $0.parentPid == master.pid && !$0.command.contains("machinen-dtach")
            }) else { continue }
            let foreground = child.foregroundGroup > 0
                ? child.foregroundGroup
                : child.processGroup
            let terminal = terminalState(tty: child.tty)
            return DtachActivityStatus(
                version: 1,
                masterPid: master.pid,
                childPid: child.pid,
                foregroundPgrp: terminal.foregroundGroup ?? foreground,
                canonical: terminal.canonical,
                echo: terminal.echo,
                inputBytes: 0,
                outputBytes: 0,
                lastInputAt: 0,
                lastOutputAt: 0,
                tty: child.tty == "??" ? nil : child.tty
            )
        }
        return nil
    }

    private func refreshLegacyStatus() {
        guard let status = legacyStatus, let tty = status.tty else { return }
        let terminal = Self.terminalState(tty: tty)
        legacyStatus = DtachActivityStatus(
            version: status.version,
            masterPid: status.masterPid,
            childPid: status.childPid,
            foregroundPgrp: terminal.foregroundGroup ?? status.foregroundPgrp,
            canonical: terminal.canonical,
            echo: terminal.echo,
            inputBytes: 0,
            outputBytes: 0,
            lastInputAt: 0,
            lastOutputAt: 0,
            tty: tty
        )
    }

    private static func terminalState(
        tty: String
    ) -> (foregroundGroup: Int32?, canonical: Bool, echo: Bool) {
        guard tty != "??" else { return (nil, true, true) }
        let path = tty.hasPrefix("/") ? tty : "/dev/\(tty)"
        let descriptor = open(path, O_RDONLY | O_NONBLOCK | O_NOCTTY)
        guard descriptor >= 0 else { return (nil, true, true) }
        defer { close(descriptor) }
        var attributes = termios()
        let foreground = tcgetpgrp(descriptor)
        guard tcgetattr(descriptor, &attributes) == 0 else {
            return (foreground > 0 ? foreground : nil, true, true)
        }
        return (
            foreground > 0 ? foreground : nil,
            attributes.c_lflag & tcflag_t(ICANON) != 0,
            attributes.c_lflag & tcflag_t(ECHO) != 0
        )
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

        let eventWaits = [
            " kevent",
            " poll",
            " ppoll",
            " select  (in libsystem_kernel",
            " pselect",
        ]
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
