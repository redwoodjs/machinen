import AppKit
import Foundation

struct PerformanceStatistics {
    static func percentile(_ percentile: Double, values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let index = Int((Double(sorted.count - 1) * min(1, max(0, percentile))).rounded())
        return sorted[index]
    }
}

@MainActor
final class PerformanceMonitor {
    typealias SpanID = UInt64

    static let shared = PerformanceMonitor()
    static let preferenceKey = "MachinenPerformanceMonitorEnabled"
    static let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/Machinen/performance.jsonl")

    private struct PendingInput {
        let id: UInt64
        let kind: String
        let startedAt: TimeInterval
        let keyCode: UInt16?
        let modifiers: UInt
    }

    private struct PendingTerminalInput {
        let id: UInt64
        let startedAt: TimeInterval
        let keyCode: UInt16
    }

    private struct Span {
        let id: SpanID
        let name: String
        let startedAt: TimeInterval
        let intendedDurationMilliseconds: Double?
        let metadata: [String: Any]
        var workStartedAt: TimeInterval?
        var firstFrameAt: TimeInterval?
        var lastFrameAt: TimeInterval?
        var frameIntervalsMilliseconds: [Double] = []
        var frameCount = 0
    }

    private let logQueue = DispatchQueue(label: "dev.machinen.performance-log", qos: .utility)
    private let sessionID = UUID().uuidString.lowercased()
    private weak var window: NSWindow?
    private weak var contentView: NSView?
    private var hud: PerformanceHUDView?
    private var eventMonitor: Any?
    private var frameTimer: Timer?
    private var expectedFrameInterval: TimeInterval = 1 / 60
    private var lastFrameAt: TimeInterval?
    private var frameMoments: [TimeInterval] = []
    private var frameIntervalsMilliseconds: [Double] = []
    private var inputLatenciesMilliseconds: [Double] = []
    private var terminalLatenciesMilliseconds: [Double] = []
    private var pendingInputs: [PendingInput] = []
    private var pendingTerminalInputs: [String: PendingTerminalInput] = [:]
    private var spans: [SpanID: Span] = [:]
    private var nextID: UInt64 = 1
    private var stallCount = 0
    private var lastHUDUpdateAt: TimeInterval = 0
    private var lastSnapshotAt: TimeInterval = 0
    private var lastActivityAt: TimeInterval = 0
    private(set) var isEnabled = false

    private init() {}

    func configure(window: NSWindow, contentView: NSView) {
        self.window = window
        self.contentView = contentView
        if UserDefaults.standard.bool(forKey: Self.preferenceKey) { enable() }
    }

    func toggle() {
        isEnabled ? disable() : enable()
    }

    func enable() {
        guard !isEnabled, let contentView else { return }
        isEnabled = true
        UserDefaults.standard.set(true, forKey: Self.preferenceKey)
        resetMetrics()
        installHUD(in: contentView)
        installEventMonitor()
        startFrameTimer()
        appendEvent("benchmark.started", fields: environmentFields())
    }

    func disable() {
        deactivate(persistDisabledState: true)
    }

    func stop() {
        deactivate(persistDisabledState: false)
    }

    private func deactivate(persistDisabledState: Bool) {
        guard isEnabled else { return }
        appendMetricSnapshot(at: ProcessInfo.processInfo.systemUptime)
        appendEvent("benchmark.stopped", fields: ["stall_count": stallCount])
        isEnabled = false
        if persistDisabledState {
            UserDefaults.standard.set(false, forKey: Self.preferenceKey)
        }
        if let eventMonitor { NSEvent.removeMonitor(eventMonitor) }
        eventMonitor = nil
        frameTimer?.invalidate()
        frameTimer = nil
        hud?.removeFromSuperview()
        hud = nil
        pendingInputs.removeAll()
        pendingTerminalInputs.removeAll()
        spans.removeAll()
    }

    func recordGestureInput(_ event: NSEvent) {
        recordInput(event)
    }

    func recordTerminalInput(tileID: String, event: NSEvent) {
        guard isEnabled else { return }
        let now = ProcessInfo.processInfo.systemUptime
        lastActivityAt = now
        let id = makeID()
        pendingTerminalInputs[tileID] = PendingTerminalInput(
            id: id,
            startedAt: now,
            keyCode: event.keyCode
        )
        appendEvent("terminal.input", fields: [
            "id": id,
            "tile_id": tileID,
            "key_code": Int(event.keyCode),
            "repeat": event.isARepeat,
        ], uptime: now)
    }

    func recordTerminalOutput(tileID: String, byteCount: Int) {
        guard isEnabled else { return }
        let now = ProcessInfo.processInfo.systemUptime
        lastActivityAt = now
        guard let input = pendingTerminalInputs.removeValue(forKey: tileID) else { return }
        guard now - input.startedAt <= 2 else { return }
        let latency = (now - input.startedAt) * 1_000
        appendBounded(latency, to: &terminalLatenciesMilliseconds)
        appendEvent("terminal.output_after_input", fields: [
            "input_id": input.id,
            "tile_id": tileID,
            "key_code": Int(input.keyCode),
            "latency_ms": rounded(latency),
            "output_bytes": byteCount,
            "heuristic": true,
        ], uptime: now)
    }

    func beginSpan(
        _ name: String,
        intendedDuration: TimeInterval? = nil,
        metadata: [String: Any] = [:]
    ) -> SpanID? {
        guard isEnabled else { return nil }
        let id = makeID()
        let now = ProcessInfo.processInfo.systemUptime
        lastActivityAt = now
        spans[id] = Span(
            id: id,
            name: name,
            startedAt: now,
            intendedDurationMilliseconds: intendedDuration.map { $0 * 1_000 },
            metadata: metadata
        )
        appendEvent("interaction.started", fields: [
            "id": id,
            "name": name,
        ].merging(metadata) { current, _ in current }, uptime: now)
        return id
    }

    func markWorkStarted(_ id: SpanID?) {
        guard isEnabled, let id, var span = spans[id] else { return }
        span.workStartedAt = ProcessInfo.processInfo.systemUptime
        spans[id] = span
    }

    func markFrame(_ id: SpanID?) {
        guard isEnabled, let id, var span = spans[id] else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if span.firstFrameAt == nil { span.firstFrameAt = now }
        if let last = span.lastFrameAt {
            span.frameIntervalsMilliseconds.append((now - last) * 1_000)
        }
        span.lastFrameAt = now
        span.frameCount += 1
        spans[id] = span
    }

    func endSpan(_ id: SpanID?, outcome: String = "completed") {
        guard isEnabled, let id, let span = spans.removeValue(forKey: id) else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let expectedMilliseconds = expectedFrameInterval * 1_000
        let droppedFrames = span.frameIntervalsMilliseconds.reduce(into: 0) { result, interval in
            result += max(0, Int((interval / expectedMilliseconds).rounded()) - 1)
        }
        let workDuration = span.workStartedAt.map { now - $0 } ?? 0
        let expectedFrameCount = Int((workDuration / expectedFrameInterval).rounded(.up))
        let redundantFrameUpdates = max(0, span.frameCount - expectedFrameCount)
        var fields = span.metadata
        fields.merge([
            "id": span.id,
            "name": span.name,
            "outcome": outcome,
            "total_ms": rounded((now - span.startedAt) * 1_000),
            "setup_ms": rounded((span.workStartedAt ?? now) - span.startedAt, multiplier: 1_000),
            "frame_count": span.frameCount,
            "frame_interval_p50_ms": rounded(PerformanceStatistics.percentile(
                0.50, values: span.frameIntervalsMilliseconds
            )),
            "frame_interval_p95_ms": rounded(PerformanceStatistics.percentile(
                0.95, values: span.frameIntervalsMilliseconds
            )),
            "frame_interval_max_ms": rounded(span.frameIntervalsMilliseconds.max() ?? 0),
            "estimated_dropped_frames": droppedFrames,
            "expected_frame_count": expectedFrameCount,
            "redundant_frame_updates": redundantFrameUpdates,
        ]) { current, _ in current }
        if let firstFrameAt = span.firstFrameAt {
            fields["first_frame_ms"] = rounded((firstFrameAt - span.startedAt) * 1_000)
        }
        if let workStartedAt = span.workStartedAt {
            fields["work_duration_ms"] = rounded((now - workStartedAt) * 1_000)
        }
        if let intended = span.intendedDurationMilliseconds {
            fields["intended_duration_ms"] = rounded(intended)
        }
        appendEvent("interaction.finished", fields: fields, uptime: now)
    }

    func revealLog() {
        prepareLogDirectory()
        if !FileManager.default.fileExists(atPath: Self.logURL.path) {
            try? Data().write(to: Self.logURL)
        }
        NSWorkspace.shared.activateFileViewerSelecting([Self.logURL])
    }

    func clearLog() {
        try? FileManager.default.removeItem(at: Self.logURL)
        if isEnabled { appendEvent("benchmark.log_cleared") }
    }

    private func installEventMonitor() {
        let mask: NSEvent.EventTypeMask = [
            .keyDown, .keyUp, .flagsChanged,
            .leftMouseDown, .leftMouseUp, .leftMouseDragged,
            .rightMouseDown, .rightMouseUp, .rightMouseDragged,
            .otherMouseDown, .otherMouseUp, .otherMouseDragged,
            .magnify, .rotate, .gesture, .pressure,
        ]
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
            guard let self, event.window === self.window else { return event }
            self.recordInput(event)
            return event
        }
    }

    private func recordInput(_ event: NSEvent) {
        guard isEnabled else { return }
        let now = ProcessInfo.processInfo.systemUptime
        lastActivityAt = now
        let id = makeID()
        let input = PendingInput(
            id: id,
            kind: inputKind(event.type),
            startedAt: now,
            keyCode: event.type == .keyDown || event.type == .keyUp ? event.keyCode : nil,
            modifiers: event.modifierFlags.intersection([
                .command, .control, .option, .shift,
            ]).rawValue
        )
        pendingInputs.append(input)
        if pendingInputs.count > 200 { pendingInputs.removeFirst(pendingInputs.count - 200) }
        var fields: [String: Any] = [
            "id": id,
            "kind": input.kind,
            "modifiers": input.modifiers,
        ]
        if let keyCode = input.keyCode { fields["key_code"] = Int(keyCode) }
        appendEvent("input.received", fields: fields, uptime: now)
    }

    private func inputKind(_ type: NSEvent.EventType) -> String {
        switch type {
        case .keyDown: "key_down"
        case .keyUp: "key_up"
        case .flagsChanged: "flags_changed"
        case .leftMouseDown: "left_mouse_down"
        case .leftMouseUp: "left_mouse_up"
        case .leftMouseDragged: "left_mouse_dragged"
        case .rightMouseDown: "right_mouse_down"
        case .rightMouseUp: "right_mouse_up"
        case .rightMouseDragged: "right_mouse_dragged"
        case .otherMouseDown: "other_mouse_down"
        case .otherMouseUp: "other_mouse_up"
        case .otherMouseDragged: "other_mouse_dragged"
        case .scrollWheel: "scroll_wheel"
        case .swipe: "swipe"
        case .magnify: "magnify"
        case .rotate: "rotate"
        case .gesture: "gesture"
        case .pressure: "pressure"
        default: "event_\(type.rawValue)"
        }
    }

    private func startFrameTimer() {
        let framesPerSecond = max(30, window?.screen?.maximumFramesPerSecond ?? 60)
        expectedFrameInterval = 1 / Double(framesPerSecond)
        let timer = Timer(
            timeInterval: expectedFrameInterval,
            target: self,
            selector: #selector(framePulse(_:)),
            userInfo: nil,
            repeats: true
        )
        timer.tolerance = expectedFrameInterval * 0.1
        frameTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    @objc private func framePulse(_ timer: Timer) {
        guard isEnabled else {
            timer.invalidate()
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        if let lastFrameAt {
            let interval = (now - lastFrameAt) * 1_000
            appendBounded(interval, to: &frameIntervalsMilliseconds)
            let monitorsActiveInteraction = now - lastActivityAt <= 1 || !spans.isEmpty
            if interval > max(50, expectedFrameInterval * 2.5 * 1_000),
               monitorsActiveInteraction,
               NSApp.isActive,
               window?.isKeyWindow == true
            {
                stallCount += 1
                appendEvent("main_thread.stall", fields: [
                    "duration_ms": rounded(interval),
                    "stall_count": stallCount,
                ], uptime: now)
            }
        }
        lastFrameAt = now
        frameMoments.append(now)
        frameMoments.removeAll { now - $0 > 5 }

        let readyInputs = pendingInputs
        pendingInputs.removeAll(keepingCapacity: true)
        for input in readyInputs {
            let latency = (now - input.startedAt) * 1_000
            appendBounded(latency, to: &inputLatenciesMilliseconds)
            appendEvent("input.frame_available", fields: [
                "input_id": input.id,
                "kind": input.kind,
                "latency_ms": rounded(latency),
            ], uptime: now)
        }

        if now - lastHUDUpdateAt >= 0.25 {
            lastHUDUpdateAt = now
            updateHUD(at: now)
        }
        if now - lastSnapshotAt >= 1 {
            lastSnapshotAt = now
            appendMetricSnapshot(at: now)
        }
    }

    private func updateHUD(at now: TimeInterval) {
        let snapshot = metricFields(at: now)
        hud?.text = [
            "PERF  \(Int((snapshot["fps"] as? Double ?? 0).rounded())) / \(Int(1 / expectedFrameInterval)) FPS",
            "FRAME  p95 \(format(snapshot["frame_p95_ms"])) ms   max \(format(snapshot["frame_max_ms"])) ms",
            "INPUT  p50 \(format(snapshot["input_p50_ms"])) ms   p95 \(format(snapshot["input_p95_ms"])) ms",
            "ECHO   p50 \(format(snapshot["terminal_p50_ms"])) ms   p95 \(format(snapshot["terminal_p95_ms"])) ms",
            "STALLS \(stallCount)   ● REC",
        ].joined(separator: "\n")
    }

    private func appendMetricSnapshot(at now: TimeInterval) {
        appendEvent("metric.snapshot", fields: metricFields(at: now), uptime: now)
    }

    private func metricFields(at now: TimeInterval) -> [String: Any] {
        let oneSecondFrames = frameMoments.filter { now - $0 <= 1 }
        let oneSecondIntervals = Array(frameIntervalsMilliseconds.suffix(120))
        let recentInputs = Array(inputLatenciesMilliseconds.suffix(300))
        let recentTerminal = Array(terminalLatenciesMilliseconds.suffix(300))
        return [
            "fps": rounded(Double(oneSecondFrames.count)),
            "target_fps": Int(1 / expectedFrameInterval),
            "frame_p50_ms": rounded(PerformanceStatistics.percentile(0.50, values: oneSecondIntervals)),
            "frame_p95_ms": rounded(PerformanceStatistics.percentile(0.95, values: oneSecondIntervals)),
            "frame_max_ms": rounded(oneSecondIntervals.max() ?? 0),
            "input_p50_ms": rounded(PerformanceStatistics.percentile(0.50, values: recentInputs)),
            "input_p95_ms": rounded(PerformanceStatistics.percentile(0.95, values: recentInputs)),
            "input_max_ms": rounded(recentInputs.max() ?? 0),
            "terminal_p50_ms": rounded(PerformanceStatistics.percentile(0.50, values: recentTerminal)),
            "terminal_p95_ms": rounded(PerformanceStatistics.percentile(0.95, values: recentTerminal)),
            "terminal_max_ms": rounded(recentTerminal.max() ?? 0),
            "stall_count": stallCount,
            "active_spans": spans.count,
        ]
    }

    private func environmentFields() -> [String: Any] {
        let screen = window?.screen
        var fields: [String: Any] = [
            "pid": ProcessInfo.processInfo.processIdentifier,
            "machine": Host.current().localizedName ?? "unknown",
            "app_version": Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String ?? "unknown",
            "app_build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion")
                as? String ?? "unknown",
            "target_fps": Int(1 / expectedFrameInterval),
            "log_path": Self.logURL.path,
        ]
        if let screen {
            fields["display_width"] = Int(screen.frame.width)
            fields["display_height"] = Int(screen.frame.height)
        }
        return fields
    }

    private func installHUD(in contentView: NSView) {
        let hud = PerformanceHUDView(frame: .zero)
        hud.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(hud, positioned: .above, relativeTo: nil)
        NSLayoutConstraint.activate([
            hud.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 46),
            hud.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            hud.widthAnchor.constraint(equalToConstant: 310),
            hud.heightAnchor.constraint(equalToConstant: 112),
        ])
        self.hud = hud
    }

    private func resetMetrics() {
        expectedFrameInterval = 1 / Double(max(30, window?.screen?.maximumFramesPerSecond ?? 60))
        lastFrameAt = nil
        frameMoments.removeAll()
        frameIntervalsMilliseconds.removeAll()
        inputLatenciesMilliseconds.removeAll()
        terminalLatenciesMilliseconds.removeAll()
        pendingInputs.removeAll()
        pendingTerminalInputs.removeAll()
        spans.removeAll()
        stallCount = 0
        lastHUDUpdateAt = 0
        lastSnapshotAt = 0
        lastActivityAt = 0
    }

    private func appendEvent(
        _ event: String,
        fields: [String: Any] = [:],
        uptime: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) {
        guard isEnabled || event == "benchmark.stopped" else { return }
        var record = fields
        record["event"] = event
        record["session_id"] = sessionID
        record["pid"] = ProcessInfo.processInfo.processIdentifier
        record["timestamp"] = ISO8601DateFormatter().string(from: Date())
        record["uptime_ms"] = rounded(uptime * 1_000)
        guard JSONSerialization.isValidJSONObject(record),
              var encoded = try? JSONSerialization.data(
                  withJSONObject: record,
                  options: [.sortedKeys]
              )
        else { return }
        encoded.append(0x0A)
        let data = encoded
        let url = Self.logURL
        logQueue.async {
            Self.append(data, to: url)
        }
    }

    nonisolated private static func append(_ data: Data, to url: URL) {
        let manager = FileManager.default
        try? manager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
           size > 20_000_000
        {
            let previous = url.appendingPathExtension("previous")
            try? manager.removeItem(at: previous)
            try? manager.moveItem(at: url, to: previous)
        }
        if manager.fileExists(atPath: url.path), let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: url, options: .atomic)
        }
    }

    private func prepareLogDirectory() {
        try? FileManager.default.createDirectory(
            at: Self.logURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
    }

    private func makeID() -> UInt64 {
        defer { nextID &+= 1 }
        return nextID
    }

    private func appendBounded(_ value: Double, to values: inout [Double]) {
        values.append(value)
        if values.count > 2_000 { values.removeFirst(values.count - 2_000) }
    }

    private func rounded(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    private func rounded(_ value: TimeInterval, multiplier: Double) -> Double {
        rounded(value * multiplier)
    }

    private func format(_ value: Any?) -> String {
        String(format: "%.1f", value as? Double ?? 0)
    }
}

private final class PerformanceHUDView: NSView {
    var text = "PERF\nCollecting data…" {
        didSet { needsDisplay = true }
    }

    override var isFlipped: Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.035, alpha: 0.88).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 8, yRadius: 8).fill()
        NSColor(calibratedRed: 0.25, green: 1, blue: 0.58, alpha: 0.85).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 8, yRadius: 8)
        border.lineWidth = 1
        border.stroke()
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 2
        text.draw(
            in: bounds.insetBy(dx: 12, dy: 9),
            withAttributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .medium),
                .foregroundColor: NSColor(calibratedWhite: 0.94, alpha: 1),
                .paragraphStyle: style,
            ]
        )
    }
}
