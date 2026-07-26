import Darwin
import Foundation

@MainActor
final class MachinenStatusMetricsMonitor {
    struct GitSnapshot: Equatable {
        let branch: String
        let commits: Int
        let filesChanged: Int
        let additions: Int
        let deletions: Int
        let additionBars: [Double]
        let deletionBars: [Double]
    }

    struct ListeningService: Equatable {
        let process: String
        let pid: Int
        let port: Int
        let addresses: [String]

        var summary: String {
            let address = addresses.first ?? ":\(port)"
            return "\(process) \(address)"
        }
    }

    private enum Metrics {
        static let historyLength = 30
        static let projectProbeInterval = 4
    }

    private var timer: Timer?
    private var tickCount = 0
    private var location: WorkspaceLocation?
    private var workspaceID: String?
    private var generation = 0
    private var gitProcess: Process?
    private var portsProcess: Process?
    private var gitSnapshot: GitSnapshot?
    private var listeningServices: [ListeningService] = []
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
            let additions = Self.formatCompactCount(gitSnapshot.additions)
            let deletions = Self.formatCompactCount(gitSnapshot.deletions)
            let tooltip = [
                "\(gitSnapshot.commits) commits · \(gitSnapshot.filesChanged) files",
                "+\(gitSnapshot.additions) additions · −\(gitSnapshot.deletions) deletions",
            ].joined(separator: "\n")
            result.append(MachinenStatusWidget(
                id: "machinen.git",
                scopeKind: projectScope.kind,
                scopeID: projectScope.id,
                placement: .right,
                kind: .sparkline,
                label: gitSnapshot.branch,
                value: "+\(additions) −\(deletions)",
                progress: nil,
                tone: gitSnapshot.filesChanged == 0 ? .good : .attention,
                tooltip: tooltip,
                priority: 90,
                expiresAt: nil,
                graphStyle: .bars,
                samples: gitSnapshot.additionBars,
                secondarySamples: gitSnapshot.deletionBars
            ))
        }
        if !listeningServices.isEmpty, let location {
            result.append(MachinenStatusWidget(
                id: "machinen.services",
                scopeKind: .machine,
                scopeID: location.machineID,
                placement: .right,
                kind: .state,
                label: "Open ports",
                value: String(listeningServices.count),
                progress: nil,
                tone: .neutral,
                tooltip: listeningServices.map(\.summary).joined(separator: "\n"),
                priority: 80,
                expiresAt: nil,
                states: listeningServices.prefix(16).map { _ in "neutral" },
                links: Self.links(for: listeningServices, location: location)
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

    func setContext(location: WorkspaceLocation?, workspaceID: String?) {
        var normalized = location
        if normalized?.kind == .local, let path = normalized?.path {
            normalized?.path = URL(fileURLWithPath: path).standardizedFileURL.path
        }
        guard normalized != self.location || workspaceID != self.workspaceID else { return }
        self.location = normalized
        self.workspaceID = workspaceID
        generation += 1
        gitProcess?.terminate()
        portsProcess?.terminate()
        gitProcess = nil
        portsProcess = nil
        gitSnapshot = nil
        listeningServices = []
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
        guard let location else { return }
        probeGit(at: location)
        probePorts(at: location)
    }

    private func probeGit(at location: WorkspaceLocation) {
        guard gitProcess == nil else { return }
        let currentGeneration = generation
        let script: String
        let executable: String
        let arguments: [String]
        var environment: [String: String]?
        if let host = location.sshHost {
            script = Self.gitProbeScript(directory: location.remoteShellPath)
            executable = "/usr/bin/ssh"
            arguments = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, script]
        } else {
            script = Self.gitProbeScript(directory: "\"$MACHINEN_STATUS_DIRECTORY\"")
            environment = ProcessInfo.processInfo.environment
            environment?["MACHINEN_STATUS_DIRECTORY"] = location.path
            executable = "/bin/sh"
            arguments = ["-c", script]
        }
        gitProcess = launchCommand(
            executable: executable,
            arguments: arguments,
            environment: environment
        ) { [weak self] output in
            guard let self, self.generation == currentGeneration else { return }
            self.gitProcess = nil
            self.gitSnapshot = output.flatMap(Self.parseGitOutput)
            self.onChange?()
        }
    }

    private func probePorts(at location: WorkspaceLocation) {
        guard portsProcess == nil else { return }
        let currentGeneration = generation
        let executable: String
        let arguments: [String]
        if let host = location.sshHost {
            executable = "/usr/bin/ssh"
            arguments = [
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=5",
                host,
                "/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN -Fpcn",
            ]
        } else {
            executable = "/usr/sbin/lsof"
            arguments = ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]
        }
        portsProcess = launchCommand(
            executable: executable,
            arguments: arguments,
            environment: nil
        ) { [weak self] output in
            guard let self, self.generation == currentGeneration else { return }
            self.portsProcess = nil
            self.listeningServices = output.map(Self.parseListeningServices) ?? []
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

    private static func gitProbeScript(directory: String) -> String {
        """
        cd \(directory) || exit 1
        branch=$(/usr/bin/git branch --show-current 2>/dev/null)
        if [ -z "$branch" ]; then
          branch=$(/usr/bin/git rev-parse --short HEAD 2>/dev/null) || exit 1
        fi
        base_ref=$(/usr/bin/git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)
        if [ -z "$base_ref" ]; then
          for candidate in origin/main main origin/master master; do
            if /usr/bin/git rev-parse --verify --quiet "$candidate" >/dev/null; then
              base_ref=$candidate
              break
            fi
          done
        fi
        base=$(/usr/bin/git merge-base HEAD "$base_ref" 2>/dev/null || true)
        if [ -z "$base" ]; then
          base=$(/usr/bin/git rev-list --max-parents=0 HEAD 2>/dev/null | /usr/bin/tail -1)
        fi
        commits=$(/usr/bin/git rev-list --count "$base"..HEAD 2>/dev/null || printf '0')
        printf '%s\n---MACHINEN-BRANCH-COMMITS---\n%s\n---MACHINEN-BRANCH-NUMSTAT---\n' "$branch" "$commits"
        /usr/bin/git diff --numstat "$base" 2>/dev/null || true
        /usr/bin/git ls-files --others --exclude-standard | while IFS= read -r file; do
          lines=$(/usr/bin/wc -l < "$file" 2>/dev/null | /usr/bin/tr -d ' ')
          printf '%s\t0\t%s\n' "${lines:-0}" "$file"
        done
        """
    }

    static func parseGitOutput(_ output: String) -> GitSnapshot? {
        let commitSections = output.components(separatedBy: "---MACHINEN-BRANCH-COMMITS---")
        guard commitSections.count == 2 else { return nil }
        let changeSections = commitSections[1].components(
            separatedBy: "---MACHINEN-BRANCH-NUMSTAT---"
        )
        guard changeSections.count == 2,
              let commits = Int(changeSections[0].trimmingCharacters(in: .whitespacesAndNewlines))
        else { return nil }
        let branch = commitSections[0].trimmingCharacters(in: .whitespacesAndNewlines)
        guard !branch.isEmpty else { return nil }

        var additions: [Double] = []
        var deletions: [Double] = []
        for line in changeSections[1].split(separator: "\n") {
            let fields = line.split(separator: "\t", omittingEmptySubsequences: false)
            guard fields.count >= 3 else { continue }
            additions.append(Double(fields[0]) ?? 0)
            deletions.append(Double(fields[1]) ?? 0)
        }
        let filesChanged = additions.count
        if additions.isEmpty {
            additions = [0]
            deletions = [0]
        }
        let ranked = zip(additions, deletions)
            .sorted { ($0.0 + $0.1) > ($1.0 + $1.1) }
            .prefix(14)
        return GitSnapshot(
            branch: branch,
            commits: commits,
            filesChanged: filesChanged,
            additions: Int(additions.reduce(0, +)),
            deletions: Int(deletions.reduce(0, +)),
            additionBars: ranked.map(\.0),
            deletionBars: ranked.map(\.1)
        )
    }

    static func parseListeningServices(_ output: String) -> [ListeningService] {
        var currentPID: Int?
        var names: [Int: String] = [:]
        var listeners: [Int: [Int: Set<String>]] = [:]
        for line in output.split(separator: "\n").map(String.init) {
            guard let prefix = line.first else { continue }
            let value = String(line.dropFirst())
            switch prefix {
            case "p":
                currentPID = Int(value)
            case "c":
                if let currentPID { names[currentPID] = value }
            case "n":
                guard let currentPID,
                      let suffix = value.split(separator: ":").last,
                      let port = Int(suffix), port > 0
                else { continue }
                listeners[currentPID, default: [:]][port, default: []].insert(value)
            default:
                continue
            }
        }
        var result: [ListeningService] = []
        for (pid, processListeners) in listeners {
            for (port, addresses) in processListeners {
                result.append(ListeningService(
                    process: names[pid] ?? "PID \(pid)",
                    pid: pid,
                    port: port,
                    addresses: addresses.sorted()
                ))
            }
        }
        return result.sorted {
            $0.port == $1.port ? $0.process < $1.process : $0.port < $1.port
        }
    }

    static func links(
        for services: [ListeningService],
        location: WorkspaceLocation
    ) -> [MachinenStatusWidget.Link] {
        services.compactMap { service in
            var components = URLComponents()
            components.scheme = "http"
            components.host = location.browserHost
            components.port = service.port
            guard let url = components.url else { return nil }
            return MachinenStatusWidget.Link(
                title: "\(service.summary) — \(url.absoluteString)",
                url: url
            )
        }
    }

    static func formatCompactCount(_ value: Int) -> String {
        let count = Double(value)
        let scaled: Double
        let suffix: String
        if value >= 999_500_000 {
            scaled = count / 1_000_000_000
            suffix = "B"
        } else if value >= 999_500 {
            scaled = count / 1_000_000
            suffix = "M"
        } else if value >= 1_000 {
            scaled = count / 1_000
            suffix = "K"
        } else {
            return String(value)
        }
        let displayValue = scaled < 10 ? (scaled * 10).rounded() / 10 : scaled.rounded()
        let format = displayValue == displayValue.rounded() ? "%.0f" : "%.1f"
        return String(format: format, displayValue) + suffix
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
