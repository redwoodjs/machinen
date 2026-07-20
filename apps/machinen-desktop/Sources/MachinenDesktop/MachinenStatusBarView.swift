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
        ]
        if kind == .separator {
            result["value"] = ""
        }
        return result
    }
}

final class MachinenStatusBarView: NSView {
    private enum Metrics {
        static let height: CGFloat = 40
        static let leftInset: CGFloat = 92
        static let rightInset: CGFloat = 18
        static let gap: CGFloat = 18
        static let itemPadding: CGFloat = 7
    }

    var breadcrumb = "MACHINEN" {
        didSet { needsDisplay = true }
    }

    var widgets: [MachinenStatusWidget] = [] {
        didSet { needsDisplay = true }
    }

    static var preferredHeight: CGFloat { Metrics.height }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard bounds.width > 0 else { return }

        let background = NSGradient(colors: [
            NSColor(calibratedWhite: 0.035, alpha: 0.86),
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
        var leftX = baseline.minX + breadcrumbWidth + Metrics.gap
        var rightX = bounds.width - Metrics.rightInset

        let rightWidgets = widgets
            .filter { $0.placement == .right }
            .sorted { ($0.priority, $0.id) > ($1.priority, $1.id) }
        for widget in rightWidgets {
            let width = itemWidth(widget)
            let origin = rightX - width
            guard origin > leftX + Metrics.gap else { continue }
            draw(widget, in: NSRect(x: origin, y: 10, width: width, height: 22))
            rightX = origin - Metrics.gap
        }

        let leftWidgets = widgets
            .filter { $0.placement == .left }
            .sorted { ($0.priority, $0.id) > ($1.priority, $1.id) }
        for widget in leftWidgets {
            let width = itemWidth(widget)
            guard leftX + width < rightX - Metrics.gap else { continue }
            draw(widget, in: NSRect(x: leftX, y: 10, width: width, height: 22))
            leftX += width + Metrics.gap
        }
    }

    private func draw(_ widget: MachinenStatusWidget, in rect: NSRect) {
        let color = color(for: widget.tone)
        if widget.kind == .separator {
            color.withAlphaComponent(0.45).setStroke()
            let path = NSBezierPath()
            path.move(to: NSPoint(x: rect.midX, y: rect.minY + 3))
            path.line(to: NSPoint(x: rect.midX, y: rect.maxY - 3))
            path.lineWidth = 1
            path.stroke()
            return
        }

        if widget.kind == .state {
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: rect.minX, y: rect.midY - 3, width: 6, height: 6)).fill()
        }

        if widget.kind == .progress, let progress = widget.progress {
            let track = NSRect(x: rect.minX, y: rect.maxY - 3, width: rect.width, height: 2)
            NSColor(calibratedWhite: 0.24, alpha: 1).setFill()
            track.fill()
            color.setFill()
            NSRect(x: track.minX, y: track.minY, width: track.width * CGFloat(min(1, max(0, progress))), height: track.height).fill()
        }

        let x = rect.minX + (widget.kind == .state ? 10 : 0)
        _ = drawText(
            displayText(widget),
            at: NSPoint(x: x, y: rect.minY + 4),
            color: color,
            weight: widget.tone == .neutral ? .regular : .medium
        )
    }

    private func displayText(_ widget: MachinenStatusWidget) -> String {
        let parts = [widget.label, widget.value.isEmpty ? nil : widget.value].compactMap { $0 }
        return parts.joined(separator: " ")
    }

    private func itemWidth(_ widget: MachinenStatusWidget) -> CGFloat {
        if widget.kind == .separator { return 1 }
        let font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        let width = ceil((displayText(widget) as NSString).size(withAttributes: [.font: font]).width)
        return width + (widget.kind == .state ? 10 : 0) + Metrics.itemPadding
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
