import Darwin
import Foundation

@_silgen_name("proc_pid_rusage")
private func machinenProcPIDRusage(
    _ pid: Int32,
    _ flavor: Int32,
    _ buffer: UnsafeMutableRawPointer
) -> Int32

/// Samples the active process belonging to the focused terminal. CPU comes
/// directly from libproc; network byte totals come from macOS `nettop` for the
/// same PID. Both are best-effort because a foreground process may exit between
/// live session metadata and this probe.
@MainActor
final class TerminalProcessMetricsMonitor {
    private enum Metrics {
        static let historyLength = 30
    }

    private var timer: Timer?
    private var pid: Int32?
    private var terminalID: String?
    private var workspaceID: String?
    private var workspacePIDs: [Int32] = []
    private var previousCPU: (nanoseconds: UInt64, time: TimeInterval)?
    private var previousNetwork: (incoming: UInt64, outgoing: UInt64, time: TimeInterval)?
    private var cpuHistory: [Double] = []
    private var incomingHistory: [Double] = []
    private var outgoingHistory: [Double] = []
    private var nettopProcess: Process?
    private var generation = 0

    var onChange: (() -> Void)?

    var widgets: [MachinenStatusWidget] {
        let scope: (kind: MachinenStatusWidget.ScopeKind, id: String?)
        let displayPID: Int32?
        if let terminalID, let pid {
            scope = (.terminal, terminalID)
            displayPID = pid
        } else if let workspaceID {
            scope = (.workspace, workspaceID)
            displayPID = nil
        } else {
            return []
        }

        var result: [MachinenStatusWidget] = []
        if let displayPID {
            result.append(MachinenStatusWidget(
                id: "machinen.pid",
                scopeKind: scope.kind,
                scopeID: scope.id,
                placement: .right,
                kind: .text,
                label: nil,
                value: "PID \(displayPID)",
                progress: nil,
                tone: .neutral,
                tooltip: "Foreground process PID \(displayPID) · click to copy",
                priority: 110,
                expiresAt: nil
            ))
        }

        if cpuHistory.count > 1 {
            let latest = cpuHistory.last ?? 0
            let tone: MachinenStatusWidget.Tone = latest > 0.92
                ? .error
                : (latest > 0.72 ? .attention : .busy)
            let label = displayPID == nil ? "Tiles CPU" : "PID CPU"
            let tooltip = displayPID.map { "PID \($0) + children CPU \(Int((latest * 100).rounded()))%" }
                ?? "Workspace tiles CPU \(Int((latest * 100).rounded()))%"
            result.append(MachinenStatusWidget(
                id: "machinen.pid.cpu",
                scopeKind: scope.kind,
                scopeID: scope.id,
                placement: .right,
                kind: .sparkline,
                label: label,
                value: "\(Int((latest * 100).rounded()))%",
                progress: nil,
                tone: tone,
                tooltip: tooltip,
                priority: 70,
                expiresAt: nil,
                graphStyle: .area,
                samples: cpuHistory
            ))
        }

        if incomingHistory.count > 1, outgoingHistory.count > 1 {
            let label = displayPID == nil ? "Tiles network" : "PID network"
            let tooltip = displayPID.map {
                "PID \($0) + children network ↓\(formatRate(incomingHistory.last ?? 0)) · ↑\(formatRate(outgoingHistory.last ?? 0))"
            } ?? "Workspace tiles network ↓\(formatRate(incomingHistory.last ?? 0)) · ↑\(formatRate(outgoingHistory.last ?? 0))"
            result.append(MachinenStatusWidget(
                id: "machinen.pid.network",
                scopeKind: scope.kind,
                scopeID: scope.id,
                placement: .right,
                kind: .sparkline,
                label: label,
                value: "↓\(formatCompactRate(incomingHistory.last ?? 0)) ↑\(formatCompactRate(outgoingHistory.last ?? 0))",
                progress: nil,
                tone: .busy,
                tooltip: tooltip,
                priority: 60,
                expiresAt: nil,
                graphStyle: .mirrored,
                samples: incomingHistory,
                secondarySamples: outgoingHistory
            ))
        }
        return result
    }

    func start() {
        guard timer == nil else { return }
        sample()
        let timer = Timer(
            timeInterval: 1,
            target: self,
            selector: #selector(timerFired(_:)),
            userInfo: nil,
            repeats: true
        )
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        generation += 1
        nettopProcess?.terminate()
        nettopProcess = nil
    }

    func setContext(pid: Int32?, terminalID: String?) {
        guard pid != self.pid || terminalID != self.terminalID || workspaceID != nil else { return }
        self.pid = pid
        self.terminalID = terminalID
        workspaceID = nil
        workspacePIDs = []
        resetContext()
    }

    func setWorkspaceContext(pids: [Int32], workspaceID: String?) {
        let normalized = Array(Set(pids)).sorted()
        guard normalized != workspacePIDs || workspaceID != self.workspaceID || pid != nil || terminalID != nil else {
            return
        }
        pid = nil
        terminalID = nil
        self.workspaceID = workspaceID
        workspacePIDs = normalized
        resetContext()
    }

    private func resetContext() {
        generation += 1
        nettopProcess?.terminate()
        nettopProcess = nil
        previousCPU = nil
        previousNetwork = nil
        cpuHistory = []
        incomingHistory = []
        outgoingHistory = []
        if timer != nil { sample() }
    }

    @objc private func timerFired(_ timer: Timer) {
        sample()
    }

    private var contextPIDs: [Int32] {
        pid.map { [$0] } ?? workspacePIDs
    }

    private func sample() {
        let roots = contextPIDs
        guard !roots.isEmpty else { return }
        let pids = processTreePIDs(rootPIDs: roots)
        sampleCPU(pids: pids)
        sampleNetwork(pids: pids, roots: roots)
    }

    private func sampleCPU(pids: [Int32]) {
        let current = pids.reduce(UInt64(0)) { total, pid in
            total + (cpuNanoseconds(pid: pid) ?? 0)
        }
        guard current > 0 else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if let previous = previousCPU, current >= previous.nanoseconds {
            let interval = max(0.001, now - previous.time)
            append(Double(current - previous.nanoseconds) / (interval * 1_000_000_000), to: &cpuHistory)
        }
        previousCPU = (current, now)
        onChange?()
    }

    private func sampleNetwork(pids: [Int32], roots: [Int32]) {
        guard nettopProcess == nil else { return }
        let process = Process()
        let output = Pipe()
        let currentGeneration = generation
        if pids.count == 1, let pid = pids.first {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/nettop")
            process.arguments = ["-P", "-L", "1", "-x", "-p", String(pid)]
        } else {
            // macOS nettop supports repeated -p in theory, but some releases
            // fail to finish logging mode with multiple selectors. Probe each
            // tile PID once instead and aggregate the CSV rows below.
            let commands = pids.map { "/usr/bin/nettop -P -L 1 -x -p \($0)" }
            process.executableURL = URL(fileURLWithPath: "/bin/sh")
            process.arguments = ["-c", commands.joined(separator: "; ")]
        }
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] process in
            let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            Task { @MainActor in
                guard let self, self.generation == currentGeneration else { return }
                guard self.contextPIDs == roots else { return }
                self.nettopProcess = nil
                guard process.terminationStatus == 0,
                      let bytes = Self.parseNetworkBytes(text)
                else { return }
                let now = ProcessInfo.processInfo.systemUptime
                if let previous = self.previousNetwork,
                   bytes.incoming >= previous.incoming,
                   bytes.outgoing >= previous.outgoing
                {
                    let interval = max(0.001, now - previous.time)
                    self.append(Double(bytes.incoming - previous.incoming) / interval, to: &self.incomingHistory)
                    self.append(Double(bytes.outgoing - previous.outgoing) / interval, to: &self.outgoingHistory)
                }
                self.previousNetwork = (bytes.incoming, bytes.outgoing, now)
                self.onChange?()
            }
        }
        do {
            try process.run()
            nettopProcess = process
        } catch {
            nettopProcess = nil
        }
    }

    /// Include the full local descendant tree. A tile commonly points at an
    /// SSH, Node, or shell process whose useful work is in one of its children.
    private func processTreePIDs(rootPIDs: [Int32]) -> [Int32] {
        var discovered = Set<Int32>()
        var pending = rootPIDs.filter { $0 > 0 }
        while let pid = pending.popLast() {
            guard discovered.insert(pid).inserted else { continue }
            pending.append(contentsOf: childPIDs(of: pid).filter { !discovered.contains($0) })
        }
        return discovered.sorted()
    }

    private func childPIDs(of parentPID: Int32) -> [Int32] {
        var buffer = [Int32](repeating: 0, count: 512)
        let result = proc_listchildpids(
            parentPID,
            &buffer,
            Int32(buffer.count * MemoryLayout<Int32>.stride)
        )
        guard result > 0 else { return [] }
        // libproc versions differ on whether this return is an entry count or
        // a byte count. Filtering zero-filled trailing entries handles both.
        let count = result > buffer.count
            ? Int(result) / MemoryLayout<Int32>.stride
            : Int(result)
        return buffer.prefix(min(buffer.count, count)).filter { $0 > 0 }
    }

    private func cpuNanoseconds(pid: Int32) -> UInt64? {
        var info = rusage_info_current()
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            machinenProcPIDRusage(pid, Int32(RUSAGE_INFO_CURRENT), UnsafeMutableRawPointer(pointer))
        }
        guard result == 0 else { return nil }
        return info.ri_user_time + info.ri_system_time
    }

    private static func parseNetworkBytes(_ text: String) -> (incoming: UInt64, outgoing: UInt64)? {
        let rows = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        guard let header = rows.first else { return nil }
        let names = header.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        guard let incomingIndex = names.firstIndex(of: "bytes_in"),
              let outgoingIndex = names.firstIndex(of: "bytes_out")
        else { return nil }

        var incoming: UInt64 = 0
        var outgoing: UInt64 = 0
        var found = false
        for row in rows.dropFirst() {
            let values = row.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
            guard values.indices.contains(incomingIndex), values.indices.contains(outgoingIndex),
                  let rowIncoming = UInt64(values[incomingIndex]),
                  let rowOutgoing = UInt64(values[outgoingIndex])
            else { continue }
            incoming += rowIncoming
            outgoing += rowOutgoing
            found = true
        }
        return found ? (incoming, outgoing) : nil
    }

    private func append(_ value: Double, to values: inout [Double]) {
        values.append(max(0, value))
        if values.count > Metrics.historyLength {
            values.removeFirst(values.count - Metrics.historyLength)
        }
    }

    private func formatRate(_ bytesPerSecond: Double) -> String {
        if bytesPerSecond >= 1_000_000 { return String(format: "%.1f MB/s", bytesPerSecond / 1_000_000) }
        if bytesPerSecond >= 1_000 { return String(format: "%.0f KB/s", bytesPerSecond / 1_000) }
        return "\(Int(bytesPerSecond)) B/s"
    }

    private func formatCompactRate(_ bytesPerSecond: Double) -> String {
        if bytesPerSecond >= 1_000_000 { return String(format: "%.1fM", bytesPerSecond / 1_000_000) }
        if bytesPerSecond >= 1_000 { return String(format: "%.0fK", bytesPerSecond / 1_000) }
        return "\(Int(bytesPerSecond))B"
    }
}
