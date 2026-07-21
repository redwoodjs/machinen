import AppKit

struct MachinenStatusWidget {
    enum ScopeKind: String {
        case global
        case workspace
        case terminal
    }

    enum Placement: String {
        case left
        case right
    }

    enum Kind: String {
        case text
        case count
        case state
        case progress
        case timer
        case sparkline
        case separator
    }

    enum Tone: String {
        case neutral
        case good
        case busy
        case attention
        case error
    }

    enum GraphStyle: String {
        case line
        case area
        case bars
        case mirrored
    }

    let id: String
    let scopeKind: ScopeKind
    let scopeID: String?
    var placement: Placement
    var kind: Kind
    var label: String?
    var value: String
    var progress: Double?
    var tone: Tone
    var tooltip: String?
    var priority: Int
    var expiresAt: TimeInterval?
    var graphStyle: GraphStyle?
    var samples: [Double]
    var secondarySamples: [Double]
    var states: [String]

    init(
        id: String,
        scopeKind: ScopeKind,
        scopeID: String?,
        placement: Placement,
        kind: Kind,
        label: String?,
        value: String,
        progress: Double?,
        tone: Tone,
        tooltip: String?,
        priority: Int,
        expiresAt: TimeInterval?,
        graphStyle: GraphStyle? = nil,
        samples: [Double] = [],
        secondarySamples: [Double] = [],
        states: [String] = []
    ) {
        self.id = id
        self.scopeKind = scopeKind
        self.scopeID = scopeID
        self.placement = placement
        self.kind = kind
        self.label = label
        self.value = value
        self.progress = progress
        self.tone = tone
        self.tooltip = tooltip
        self.priority = priority
        self.expiresAt = expiresAt
        self.graphStyle = graphStyle
        self.samples = samples
        self.secondarySamples = secondarySamples
        self.states = states
    }

    var storageKey: String {
        "\(scopeKind.rawValue):\(scopeID ?? ""):" + id
    }

    func json() -> [String: Any] {
        let scope: [String: Any] = [
            "kind": scopeKind.rawValue,
            "id": scopeID ?? NSNull(),
        ]
        var result: [String: Any] = [
            "id": id,
            "scope": scope,
            "placement": placement.rawValue,
            "kind": kind.rawValue,
            "value": value,
            "tone": tone.rawValue,
            "priority": priority,
            "label": label ?? NSNull(),
            "progress": progress ?? NSNull(),
            "tooltip": tooltip ?? NSNull(),
            "expiresAt": expiresAt ?? NSNull(),
            "graphStyle": graphStyle?.rawValue ?? NSNull(),
            "samples": samples,
            "secondarySamples": secondarySamples,
            "states": states,
        ]
        if kind == .separator {
            result["value"] = ""
        }
        return result
    }
}

final class MachinenStatusBarView: NSView, NSViewToolTipOwner {
    private enum Metrics {
        static let height: CGFloat = 40
        static let leftInset: CGFloat = 92
        static let rightInset: CGFloat = 14
        static let sectionGap: CGFloat = 14
        static let widgetGap: CGFloat = 7
        static let widgetHeight: CGFloat = 26
    }

    private struct WidgetFrame {
        let widget: MachinenStatusWidget
        let rect: NSRect
    }

    var breadcrumb = "MACHINEN" {
        didSet { needsDisplay = true }
    }

    var widgets: [MachinenStatusWidget] = [] {
        didSet { needsDisplay = true }
    }

    private var widgetFrames: [WidgetFrame] = []
    private var tooltipRegions: [String: (tag: NSView.ToolTipTag, rect: NSRect)] = [:]
    private var tooltipWidgetIDs: [NSView.ToolTipTag: String] = [:]
    private var tooltipTextByID: [String: String] = [:]

    static var preferredHeight: CGFloat { Metrics.height }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    override func hitTest(_ point: NSPoint) -> NSView? {
        widgetFrames.contains(where: { $0.rect.contains(point) }) ? self : nil
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard bounds.width > 0 else { return }

        let background = NSGradient(colors: [
            NSColor(calibratedWhite: 0.035, alpha: 0.88),
            NSColor(calibratedWhite: 0.035, alpha: 0.18),
        ])
        background?.draw(in: bounds, angle: 270)

        let baseline = NSRect(
            x: Metrics.leftInset,
            y: 14,
            width: max(0, bounds.width - Metrics.leftInset - Metrics.rightInset),
            height: 16
        )
        let breadcrumbWidth = drawText(
            breadcrumb,
            at: baseline.origin,
            color: NSColor(calibratedWhite: 0.72, alpha: 1),
            weight: .semibold
        )
        var leftX = baseline.minX + breadcrumbWidth + Metrics.sectionGap
        var rightX = bounds.width - Metrics.rightInset
        var frames: [WidgetFrame] = []

        let rightWidgets = widgets
            .filter { $0.placement == .right }
            .sorted { ($0.priority, $0.id) > ($1.priority, $1.id) }
        for widget in rightWidgets {
            let width = itemWidth(widget)
            let origin = rightX - width
            guard origin > leftX + Metrics.sectionGap else { continue }
            let rect = NSRect(x: origin, y: 7, width: width, height: Metrics.widgetHeight)
            draw(widget, in: rect)
            frames.append(WidgetFrame(widget: widget, rect: rect))
            rightX = origin - Metrics.widgetGap
        }

        let leftWidgets = widgets
            .filter { $0.placement == .left }
            .sorted { ($0.priority, $0.id) > ($1.priority, $1.id) }
        for widget in leftWidgets {
            let width = itemWidth(widget)
            guard leftX + width < rightX - Metrics.sectionGap else { continue }
            let rect = NSRect(x: leftX, y: 7, width: width, height: Metrics.widgetHeight)
            draw(widget, in: rect)
            frames.append(WidgetFrame(widget: widget, rect: rect))
            leftX += width + Metrics.widgetGap
        }

        widgetFrames = frames
        updateTooltips()
    }

    private func draw(_ widget: MachinenStatusWidget, in rect: NSRect) {
        if widget.kind == .separator {
            let color = color(for: widget.tone)
            color.withAlphaComponent(0.35).setStroke()
            let path = NSBezierPath()
            path.move(to: NSPoint(x: rect.midX, y: rect.minY + 4))
            path.line(to: NSPoint(x: rect.midX, y: rect.maxY - 4))
            path.lineWidth = 1
            path.stroke()
            return
        }

        drawCard(in: rect, tone: widget.tone)
        let content = rect.insetBy(dx: 5, dy: 4)
        switch widget.kind {
        case .state:
            if widget.states.isEmpty {
                drawStateRing(widget.tone, in: content)
            } else {
                drawStatePips(widget.states, in: content)
            }
        case .progress:
            drawProgressRing(widget.progress ?? 0, tone: widget.tone, in: content)
        case .sparkline:
            drawGraph(widget, in: content)
        case .count:
            drawCenteredText(widget.value, in: content, color: color(for: widget.tone), weight: .medium)
        case .timer:
            drawTimer(widget, in: content)
        case .text:
            drawCenteredText(displayText(widget), in: content, color: color(for: widget.tone), weight: .medium)
        case .separator:
            break
        }
    }

    private func drawCard(in rect: NSRect, tone: MachinenStatusWidget.Tone) {
        let card = NSBezierPath(roundedRect: rect, xRadius: 6, yRadius: 6)
        NSColor(calibratedWhite: 0.105, alpha: 0.82).setFill()
        card.fill()
        color(for: tone).withAlphaComponent(tone == .neutral ? 0.12 : 0.25).setStroke()
        card.lineWidth = 1
        card.stroke()
    }

    private func drawStatePips(_ states: [String], in rect: NSRect) {
        let visible = Array(states.prefix(16))
        guard !visible.isEmpty else { return }
        let columns = min(8, visible.count)
        let rows = Int(ceil(Double(visible.count) / Double(columns)))
        let cellWidth = min(9, rect.width / CGFloat(columns))
        let cellHeight = rect.height / CGFloat(rows)
        for (index, state) in visible.enumerated() {
            let column = index % columns
            let row = index / columns
            let center = NSPoint(
                x: rect.midX + (CGFloat(column) - CGFloat(columns - 1) / 2) * cellWidth,
                y: rect.minY + (CGFloat(row) + 0.5) * cellHeight
            )
            drawPip(state, center: center)
        }
    }

    private func drawPip(_ state: String, center: NSPoint) {
        let rect = NSRect(x: center.x - 3, y: center.y - 3, width: 6, height: 6)
        let path = NSBezierPath(ovalIn: rect)
        switch state {
        case "working", "busy":
            let pulse = 0.68 + 0.22 * sin(ProcessInfo.processInfo.systemUptime * 5)
            color(for: .busy).withAlphaComponent(pulse).setFill()
            path.fill()
            color(for: .busy).withAlphaComponent(0.28).setStroke()
            NSBezierPath(ovalIn: rect.insetBy(dx: -2, dy: -2)).stroke()
        case "waiting", "attention":
            color(for: .attention).setStroke()
            path.lineWidth = 1.5
            path.stroke()
            color(for: .attention).setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2)).fill()
        case "good":
            color(for: .good).setStroke()
            path.lineWidth = 1.5
            path.stroke()
        case "error", "failed":
            color(for: .error).setFill()
            path.fill()
        case "idle", "neutral":
            color(for: .neutral).withAlphaComponent(0.62).setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1)).fill()
        default:
            color(for: .neutral).withAlphaComponent(0.55).setStroke()
            path.lineWidth = 1
            path.stroke()
        }
    }

    private func drawStateRing(_ tone: MachinenStatusWidget.Tone, in rect: NSRect) {
        let diameter = min(12, min(rect.width, rect.height))
        let ringRect = NSRect(
            x: rect.midX - diameter / 2,
            y: rect.midY - diameter / 2,
            width: diameter,
            height: diameter
        )
        let ring = NSBezierPath(ovalIn: ringRect)
        color(for: tone).setStroke()
        ring.lineWidth = 2
        ring.stroke()
        if tone == .error {
            color(for: tone).setFill()
            NSBezierPath(ovalIn: ringRect.insetBy(dx: 4, dy: 4)).fill()
        }
    }

    private func drawProgressRing(_ progress: Double, tone: MachinenStatusWidget.Tone, in rect: NSRect) {
        let radius = min(rect.width, rect.height) / 2 - 1
        let center = NSPoint(x: rect.midX, y: rect.midY)
        let track = NSBezierPath()
        track.appendArc(withCenter: center, radius: radius, startAngle: 0, endAngle: 360)
        NSColor(calibratedWhite: 0.25, alpha: 0.8).setStroke()
        track.lineWidth = 2
        track.stroke()

        let arc = NSBezierPath()
        arc.appendArc(
            withCenter: center,
            radius: radius,
            startAngle: 90,
            endAngle: 90 - 360 * CGFloat(min(1, max(0, progress))),
            clockwise: true
        )
        color(for: tone).setStroke()
        arc.lineWidth = 2
        arc.lineCapStyle = .round
        arc.stroke()
    }

    private func drawTimer(_ widget: MachinenStatusWidget, in rect: NSRect) {
        let phase = widget.progress ?? Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 60) / 60
        drawProgressRing(phase, tone: widget.tone, in: rect)
    }

    private func drawGraph(_ widget: MachinenStatusWidget, in rect: NSRect) {
        let primary = widget.samples
        guard !primary.isEmpty else {
            color(for: widget.tone).withAlphaComponent(0.4).setStroke()
            let baseline = NSBezierPath()
            baseline.move(to: NSPoint(x: rect.minX, y: rect.midY))
            baseline.line(to: NSPoint(x: rect.maxX, y: rect.midY))
            baseline.stroke()
            return
        }
        switch widget.graphStyle ?? .line {
        case .line:
            drawLineGraph(primary, in: rect, color: color(for: widget.tone), fill: false)
        case .area:
            drawLineGraph(primary, in: rect, color: color(for: widget.tone), fill: true)
        case .bars:
            drawBarGraph(primary, secondary: widget.secondarySamples, in: rect)
        case .mirrored:
            drawMirroredGraph(primary, secondary: widget.secondarySamples, in: rect)
        }
    }

    private func drawLineGraph(_ samples: [Double], in rect: NSRect, color: NSColor, fill: Bool) {
        let values = Array(samples.suffix(32))
        let observedMaximum = values.max() ?? 1
        let maximum = observedMaximum <= 1 ? 1 : max(0.000_001, observedMaximum)
        let step = values.count > 1 ? rect.width / CGFloat(values.count - 1) : 0
        let points = values.enumerated().map { index, value in
            NSPoint(
                x: rect.minX + CGFloat(index) * step,
                y: rect.maxY - CGFloat(max(0, value) / maximum) * rect.height
            )
        }
        guard let first = points.first, let last = points.last else { return }
        if fill {
            let area = NSBezierPath()
            area.move(to: NSPoint(x: first.x, y: rect.maxY))
            area.line(to: first)
            for point in points.dropFirst() { area.line(to: point) }
            area.line(to: NSPoint(x: last.x, y: rect.maxY))
            area.close()
            color.withAlphaComponent(0.2).setFill()
            area.fill()
        }
        let line = NSBezierPath()
        line.move(to: first)
        for point in points.dropFirst() { line.line(to: point) }
        color.setStroke()
        line.lineWidth = 1.25
        line.lineJoinStyle = .round
        line.stroke()
    }

    private func drawBarGraph(_ primary: [Double], secondary: [Double], in rect: NSRect) {
        let count = min(14, max(primary.count, secondary.count))
        guard count > 0 else { return }
        let first = Array(primary.suffix(count))
        let second = Array(secondary.suffix(count))
        let maximum = max(1, (first + second).max() ?? 1)
        NSColor(calibratedWhite: 0.3, alpha: 0.45).setStroke()
        let baseline = NSBezierPath()
        baseline.move(to: NSPoint(x: rect.minX, y: rect.midY))
        baseline.line(to: NSPoint(x: rect.maxX, y: rect.midY))
        baseline.lineWidth = 0.5
        baseline.stroke()
        let gap: CGFloat = 1
        let width = max(1, (rect.width - CGFloat(count - 1) * gap) / CGFloat(count))
        for index in 0..<count {
            let x = rect.minX + CGFloat(index) * (width + gap)
            let upper = index < first.count ? first[index] : 0
            let lower = index < second.count ? second[index] : 0
            if upper > 0 {
                NSColor.systemGreen.withAlphaComponent(0.85).setFill()
                NSRect(
                    x: x,
                    y: rect.midY - CGFloat(upper / maximum) * rect.height / 2,
                    width: width,
                    height: CGFloat(upper / maximum) * rect.height / 2
                ).fill()
            }
            if lower > 0 {
                NSColor.systemRed.withAlphaComponent(0.8).setFill()
                NSRect(
                    x: x,
                    y: rect.midY,
                    width: width,
                    height: CGFloat(lower / maximum) * rect.height / 2
                ).fill()
            }
        }
    }

    private func drawMirroredGraph(_ primary: [Double], secondary: [Double], in rect: NSRect) {
        let count = min(32, max(primary.count, secondary.count))
        guard count > 0 else { return }
        let first = Array(primary.suffix(count))
        let second = Array(secondary.suffix(count))
        let maximum = max(1, (first + second).max() ?? 1)
        let step = count > 1 ? rect.width / CGFloat(count - 1) : 0
        let upper = NSBezierPath()
        let lower = NSBezierPath()
        for index in 0..<count {
            let x = rect.minX + CGFloat(index) * step
            let incoming = index < first.count ? first[index] : 0
            let outgoing = index < second.count ? second[index] : 0
            let upperPoint = NSPoint(
                x: x,
                y: rect.midY - CGFloat(incoming / maximum) * rect.height / 2
            )
            let lowerPoint = NSPoint(
                x: x,
                y: rect.midY + CGFloat(outgoing / maximum) * rect.height / 2
            )
            if index == 0 {
                upper.move(to: upperPoint)
                lower.move(to: lowerPoint)
            } else {
                upper.line(to: upperPoint)
                lower.line(to: lowerPoint)
            }
        }
        NSColor.systemBlue.setStroke()
        upper.lineWidth = 1.2
        upper.stroke()
        NSColor.systemTeal.setStroke()
        lower.lineWidth = 1.2
        lower.stroke()
    }

    private func displayText(_ widget: MachinenStatusWidget) -> String {
        let parts = [widget.label, widget.value.isEmpty ? nil : widget.value].compactMap { $0 }
        return parts.joined(separator: " ")
    }

    private func itemWidth(_ widget: MachinenStatusWidget) -> CGFloat {
        switch widget.kind {
        case .separator:
            return 1
        case .state:
            if widget.states.isEmpty { return 26 }
            let columns = min(8, widget.states.count)
            return max(26, min(72, CGFloat(columns) * 9 + 10))
        case .progress, .timer:
            return 28
        case .sparkline:
            return 62
        case .count:
            let digits = max(1, widget.value.count)
            return max(26, CGFloat(digits) * 7 + 12)
        case .text:
            let font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
            return ceil((displayText(widget) as NSString).size(withAttributes: [.font: font]).width) + 12
        }
    }

    private func drawCenteredText(
        _ text: String,
        in rect: NSRect,
        color: NSColor,
        weight: NSFont.Weight
    ) {
        let font = NSFont.monospacedSystemFont(ofSize: 10, weight: weight)
        let size = (text as NSString).size(withAttributes: [.font: font])
        _ = drawText(
            text,
            at: NSPoint(x: rect.midX - ceil(size.width) / 2, y: rect.midY - 7),
            color: color,
            weight: weight
        )
    }

    @discardableResult
    private func drawText(
        _ text: String,
        at point: NSPoint,
        color: NSColor,
        weight: NSFont.Weight
    ) -> CGFloat {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 10, weight: weight),
            .foregroundColor: color,
        ]
        let size = (text as NSString).size(withAttributes: attributes)
        NSAttributedString(string: text, attributes: attributes).draw(
            in: NSRect(x: point.x, y: point.y, width: ceil(size.width), height: 15)
        )
        return ceil(size.width)
    }

    private func updateTooltips() {
        let activeIDs = Set(widgetFrames.map(\.widget.id))
        for id in Array(tooltipRegions.keys) where !activeIDs.contains(id) {
            guard let region = tooltipRegions.removeValue(forKey: id) else { continue }
            removeToolTip(region.tag)
            tooltipWidgetIDs.removeValue(forKey: region.tag)
            tooltipTextByID.removeValue(forKey: id)
        }

        for frame in widgetFrames {
            let progress = frame.widget.progress.map { "\(Int(($0 * 100).rounded()))%" }
            let tooltip = frame.widget.tooltip
                ?? [frame.widget.label, frame.widget.value.isEmpty ? nil : frame.widget.value, progress]
                .compactMap { $0 }
                .joined(separator: " ")
            guard !tooltip.isEmpty else { continue }
            tooltipTextByID[frame.widget.id] = tooltip

            if let existing = tooltipRegions[frame.widget.id], existing.rect == frame.rect {
                continue
            }
            if let existing = tooltipRegions.removeValue(forKey: frame.widget.id) {
                removeToolTip(existing.tag)
                tooltipWidgetIDs.removeValue(forKey: existing.tag)
            }
            let tag = addToolTip(frame.rect, owner: self, userData: nil)
            tooltipRegions[frame.widget.id] = (tag, frame.rect)
            tooltipWidgetIDs[tag] = frame.widget.id
        }
    }

    func view(
        _ view: NSView,
        stringForToolTip tag: NSView.ToolTipTag,
        point: NSPoint,
        userData: UnsafeMutableRawPointer?
    ) -> String {
        tooltipWidgetIDs[tag].flatMap { tooltipTextByID[$0] } ?? ""
    }

    private func color(for tone: MachinenStatusWidget.Tone) -> NSColor {
        switch tone {
        case .neutral:
            NSColor(calibratedWhite: 0.58, alpha: 1)
        case .good:
            NSColor.systemGreen
        case .busy:
            NSColor.systemBlue
        case .attention:
            NSColor.systemOrange
        case .error:
            NSColor.systemRed
        }
    }
}
