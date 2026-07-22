import Darwin
import Foundation

@MainActor
final class MachinenStatusMetricsMonitor {
    private struct GitSnapshot {
        let branch: String
        let modified: Int
        let additions: Int
        let deletions: Int
        let additionBars: [Double]
        let deletionBars: [Double]
    }

    private enum Metrics {
        static let historyLength = 30
        static let projectProbeInterval = 4
    }

    private var timer: Timer?
    private var tickCount = 0
    private var workingDirectory: String?
    private var workspaceID: String?
    private var generation = 0
    private var gitProcess: Process?
    private var portsProcess: Process?
    private var gitSnapshot: GitSnapshot?
    private var listeningPorts: [Int] = []
    private var cpuHistory: [Double] = []
    private var incomingHistory: [Double] = []
    private var outgoingHistory: [Double] = []
    private var previousCPUTicks: (used: UInt64, total: UInt64)?
    private var previousNetwork: (incoming: UInt64, outgoing: UInt64, time: TimeInterval)?

    var onChange: (() -> Void)?

    var widgets: [MachinenStatusWidget] {
        var result: [MachinenStatusWidget] = []
        let projectScope: (kind: MachinenStatusWidget.ScopeKind, id: String?) = workspaceID
            .map { (.workspace, $0) } ?? (.global, nil)
        if let gitSnapshot {
            let tooltip = [
                gitSnapshot.branch,
                "\(gitSnapshot.modified) modified",
                "+\(gitSnapshot.additions)",
                "−\(gitSnapshot.deletions)",
            ].joined(separator: " · ")
            result.append(MachinenStatusWidget(
                id: "machinen.git",
                scopeKind: projectScope.kind,
                scopeID: projectScope.id,
                placement: .right,
                kind: .sparkline,
                label: "Git changes",
                value: "+\(gitSnapshot.additions) −\(gitSnapshot.deletions)",
                progress: nil,
                tone: gitSnapshot.modified == 0 ? .good : .attention,
                tooltip: tooltip,
                priority: 90,
                expiresAt: nil,
                graphStyle: .bars,
                samples: gitSnapshot.additionBars,
                secondarySamples: gitSnapshot.deletionBars
            ))
        }
        if !listeningPorts.isEmpty {
            result.append(MachinenStatusWidget(
                id: "machinen.services",
                scopeKind: projectScope.kind,
                scopeID: projectScope.id,
                placement: .right,
                kind: .state,
                label: "Listening services",
                value: String(listeningPorts.count),
                progress: nil,
                tone: .good,
                tooltip: "Listening: " + listeningPorts.map(String.init).joined(separator: " · "),
                priority: 80,
                expiresAt: nil,
                states: listeningPorts.prefix(16).map { _ in "good" }
            ))
        }
        if cpuHistory.count > 1 {
            let latest = cpuHistory.last ?? 0
            let tone: MachinenStatusWidget.Tone = latest > 0.92
                ? .error
                : (latest > 0.72 ? .attention : .busy)
            result.append(MachinenStatusWidget(
                id: "machinen.cpu",
                scopeKind: .global,
                scopeID: nil,
                placement: .right,
                kind: .sparkline,
                label: "System CPU",
                value: "\(Int((latest * 100).rounded()))%",
                progress: nil,
                tone: tone,
                tooltip: "System CPU \(Int((latest * 100).rounded()))%",
                priority: 50,
                expiresAt: nil,
                graphStyle: .area,
                samples: cpuHistory
            ))
        }
        if incomingHistory.count > 1, outgoingHistory.count > 1 {
            result.append(MachinenStatusWidget(
                id: "machinen.network",
                scopeKind: .global,
                scopeID: nil,
                placement: .right,
                kind: .sparkline,
                label: "Network transfer",
                value: "↓\(formatCompactRate(incomingHistory.last ?? 0)) ↑\(formatCompactRate(outgoingHistory.last ?? 0))",
                progress: nil,
                tone: .busy,
                tooltip: "Network ↓\(formatRate(incomingHistory.last ?? 0)) · ↑\(formatRate(outgoingHistory.last ?? 0))",
                priority: 40,
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
        sampleHostMetrics()
        probeProjectMetrics()
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
        gitProcess?.terminate()
        portsProcess?.terminate()
        gitProcess = nil
        portsProcess = nil
    }

    func setContext(workingDirectory: String?, workspaceID: String?) {
        let standardized = workingDirectory.map {
            URL(fileURLWithPath: $0).standardizedFileURL.path
        }
        guard standardized != self.workingDirectory || workspaceID != self.workspaceID else { return }
        self.workingDirectory = standardized
        self.workspaceID = workspaceID
        generation += 1
        gitProcess?.terminate()
        portsProcess?.terminate()
        gitProcess = nil
        portsProcess = nil
        gitSnapshot = nil
        listeningPorts = []
        if timer != nil {
            probeProjectMetrics()
        }
    }

    @objc private func timerFired(_ timer: Timer) {
        sampleHostMetrics()
        tickCount += 1
        if tickCount.isMultiple(of: Metrics.projectProbeInterval) {
            probeProjectMetrics()
        }
        onChange?()
    }

    private func sampleHostMetrics() {
        if let ticks = cpuTicks() {
            if let previous = previousCPUTicks,
               ticks.total >= previous.total, ticks.used >= previous.used
            {
                let total = ticks.total - previous.total
                if total > 0 {
                    append(Double(ticks.used - previous.used) / Double(total), to: &cpuHistory)
                }
            }
            previousCPUTicks = ticks
        }

        let now = ProcessInfo.processInfo.systemUptime
        if let bytes = networkBytes() {
            if let previous = previousNetwork,
               bytes.incoming >= previous.incoming, bytes.outgoing >= previous.outgoing
            {
                let interval = max(0.001, now - previous.time)
                append(Double(bytes.incoming - previous.incoming) / interval, to: &incomingHistory)
                append(Double(bytes.outgoing - previous.outgoing) / interval, to: &outgoingHistory)
            }
            previousNetwork = (bytes.incoming, bytes.outgoing, now)
        }
    }

    private func append(_ value: Double, to values: inout [Double]) {
        values.append(max(0, value))
        if values.count > Metrics.historyLength {
            values.removeFirst(values.count - Metrics.historyLength)
        }
    }

    private func cpuTicks() -> (used: UInt64, total: UInt64)? {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(
            MemoryLayout<host_cpu_load_info_data_t>.size / MemoryLayout<integer_t>.size
        )
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { rebound in
                host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, rebound, &count)
            }
        }
        guard result == KERN_SUCCESS else { return nil }
        let user = UInt64(info.cpu_ticks.0)
        let system = UInt64(info.cpu_ticks.1)
        let idle = UInt64(info.cpu_ticks.2)
        let nice = UInt64(info.cpu_ticks.3)
        return (user + system + nice, user + system + idle + nice)
    }

    private func networkBytes() -> (incoming: UInt64, outgoing: UInt64)? {
        var first: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&first) == 0, let first else { return nil }
        defer { freeifaddrs(first) }
        var incoming: UInt64 = 0
        var outgoing: UInt64 = 0
        var current: UnsafeMutablePointer<ifaddrs>? = first
        while let pointer = current {
            let interface = pointer.pointee
            if let address = interface.ifa_addr,
               address.pointee.sa_family == UInt8(AF_LINK),
               interface.ifa_flags & UInt32(IFF_UP) != 0,
               interface.ifa_flags & UInt32(IFF_LOOPBACK) == 0,
               let rawData = interface.ifa_data
            {
                let data = rawData.assumingMemoryBound(to: if_data.self).pointee
                incoming += UInt64(data.ifi_ibytes)
                outgoing += UInt64(data.ifi_obytes)
            }
            current = interface.ifa_next
        }
        return (incoming, outgoing)
    }

    private func probeProjectMetrics() {
        guard let workingDirectory else { return }
        probeGit(in: workingDirectory)
        probePorts(in: workingDirectory)
    }

    private func probeGit(in directory: String) {
        guard gitProcess == nil else { return }
        let currentGeneration = generation
        let script = """
        /usr/bin/git -C "$MACHINEN_STATUS_DIRECTORY" status --porcelain=v1 --branch || exit 1
        printf '\n---MACHINEN-NUMSTAT---\n'
        /usr/bin/git -C "$MACHINEN_STATUS_DIRECTORY" diff --numstat HEAD 2>/dev/null || true
        """
        var environment = ProcessInfo.processInfo.environment
        environment["MACHINEN_STATUS_DIRECTORY"] = directory
        gitProcess = launchCommand(
            executable: "/bin/sh",
            arguments: ["-c", script],
            environment: environment
        ) { [weak self] output in
            guard let self, self.generation == currentGeneration else { return }
            self.gitProcess = nil
            self.gitSnapshot = output.flatMap(Self.parseGitOutput)
            self.onChange?()
        }
    }

    private func probePorts(in directory: String) {
        guard portsProcess == nil else { return }
        let currentGeneration = generation
        portsProcess = launchCommand(
            executable: "/usr/sbin/lsof",
            arguments: ["-nP", "-iTCP", "-sTCP:LISTEN", "-d", "cwd", "-Fpcfn"],
            environment: nil
        ) { [weak self] output in
            guard let self, self.generation == currentGeneration else { return }
            self.portsProcess = nil
            self.listeningPorts = output.map {
                Self.parseListeningPorts($0, workingDirectory: directory)
            } ?? []
            self.onChange?()
        }
    }

    private func launchCommand(
        executable: String,
        arguments: [String],
        environment: [String: String]?,
        completion: @escaping @MainActor (String?) -> Void
    ) -> Process? {
        let directory = "/tmp/machinen-\(getuid())"
        try? FileManager.default.createDirectory(
            atPath: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let outputURL = URL(fileURLWithPath: directory)
            .appendingPathComponent("metrics-\(UUID().uuidString).tmp")
        guard FileManager.default.createFile(
            atPath: outputURL.path,
            contents: nil,
            attributes: [.posixPermissions: 0o600]
        ), let output = try? FileHandle(forWritingTo: outputURL)
        else { return nil }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = environment
        process.standardOutput = output
        process.standardError = output
        process.terminationHandler = { process in
            try? output.close()
            let data = (try? Data(contentsOf: outputURL)) ?? Data()
            try? FileManager.default.removeItem(at: outputURL)
            let text = process.terminationStatus == 0
                ? String(decoding: data, as: UTF8.self)
                : nil
            Task { @MainActor in completion(text) }
        }
        do {
            try process.run()
            return process
        } catch {
            try? output.close()
            try? FileManager.default.removeItem(at: outputURL)
            return nil
        }
    }

    private static func parseGitOutput(_ output: String) -> GitSnapshot? {
        let sections = output.components(separatedBy: "---MACHINEN-NUMSTAT---")
        guard let statusSection = sections.first else { return nil }
        let statusLines = statusSection.split(separator: "\n").map(String.init)
        guard let header = statusLines.first, header.hasPrefix("## ") else { return nil }
        let branchDescription = String(header.dropFirst(3))
        let branch = branchDescription
            .replacingOccurrences(of: "No commits yet on ", with: "")
            .components(separatedBy: "...").first ?? branchDescription
        let modified = max(0, statusLines.count - 1)

        var additions: [Double] = []
        var deletions: [Double] = []
        if sections.count > 1 {
            for line in sections[1].split(separator: "\n") {
                let fields = line.split(separator: "\t", omittingEmptySubsequences: false)
                guard fields.count >= 2 else { continue }
                additions.append(Double(fields[0]) ?? 0)
                deletions.append(Double(fields[1]) ?? 0)
            }
        }
        let represented = additions.count
        if modified > represented {
            for _ in 0..<(modified - represented) {
                additions.append(1)
                deletions.append(0)
            }
        }
        if additions.isEmpty {
            additions = [0]
            deletions = [0]
        }
        let ranked = zip(additions, deletions)
            .sorted { ($0.0 + $0.1) > ($1.0 + $1.1) }
            .prefix(14)
        let additionBars = ranked.map(\.0)
        let deletionBars = ranked.map(\.1)
        return GitSnapshot(
            branch: branch,
            modified: modified,
            additions: Int(additions.reduce(0, +)),
            deletions: Int(deletions.reduce(0, +)),
            additionBars: additionBars,
            deletionBars: deletionBars
        )
    }

    private static func parseListeningPorts(
        _ output: String,
        workingDirectory: String
    ) -> [Int] {
        var currentPID: Int?
        var expectsWorkingDirectory = false
        var directories: [Int: String] = [:]
        var ports: [Int: Set<Int>] = [:]
        for line in output.split(separator: "\n").map(String.init) {
            guard let prefix = line.first else { continue }
            let value = String(line.dropFirst())
            switch prefix {
            case "p":
                currentPID = Int(value)
                expectsWorkingDirectory = false
            case "f":
                expectsWorkingDirectory = value == "cwd"
            case "n":
                guard let currentPID else { continue }
                if expectsWorkingDirectory {
                    directories[currentPID] = value
                    expectsWorkingDirectory = false
                } else if let suffix = value.split(separator: ":").last,
                          let port = Int(suffix), port > 0
                {
                    ports[currentPID, default: []].insert(port)
                }
            default:
                continue
            }
        }
        let root = URL(fileURLWithPath: workingDirectory).standardizedFileURL.path
        var result = Set<Int>()
        for (pid, processPorts) in ports {
            guard let directory = directories[pid] else { continue }
            let processRoot = URL(fileURLWithPath: directory).standardizedFileURL.path
            if processRoot == root || processRoot.hasPrefix(root + "/") || root.hasPrefix(processRoot + "/") {
                result.formUnion(processPorts)
            }
        }
        return result.sorted()
    }

    private func formatRate(_ bytesPerSecond: Double) -> String {
        if bytesPerSecond >= 1_000_000 {
            return String(format: "%.1f MB/s", bytesPerSecond / 1_000_000)
        }
        if bytesPerSecond >= 1_000 {
            return String(format: "%.0f KB/s", bytesPerSecond / 1_000)
        }
        return "\(Int(bytesPerSecond)) B/s"
    }

    private func formatCompactRate(_ bytesPerSecond: Double) -> String {
        if bytesPerSecond >= 1_000_000 {
            return String(format: "%.1fM", bytesPerSecond / 1_000_000)
        }
        if bytesPerSecond >= 1_000 {
            return String(format: "%.0fK", bytesPerSecond / 1_000)
        }
        return "\(Int(bytesPerSecond))B"
    }
}
