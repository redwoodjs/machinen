import AppKit

struct MapEditAction {
    let id: String
    let title: String
    let detail: String
}

/// A lightweight action layer above the current spatial map.
final class MapEditOverlayView: NSView {
    private enum Metrics {
        static let panelWidth: CGFloat = 224
        static let panelInset: CGFloat = 16
        static let headerHeight: CGFloat = 40
        static let rowHeight: CGFloat = 42
        static let footerHeight: CGFloat = 28
    }

    private let actions: [MapEditAction]
    var onAction: ((MapEditAction) -> Void)?
    var onDismiss: (() -> Void)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(frame: NSRect, actions: [MapEditAction]) {
        self.actions = actions
        super.init(frame: frame)
        autoresizingMask = [.width, .height]
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Map edit actions")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ dirtyRect: NSRect) {
        let panel = panelRect()
        NSColor.black.withAlphaComponent(0.12).setFill()
        bounds.fill()
        NSColor(calibratedWhite: 0.10, alpha: 0.96).setFill()
        NSColor(calibratedWhite: 0.42, alpha: 1).setStroke()
        let path = NSBezierPath(roundedRect: panel, xRadius: 7, yRadius: 7)
        path.fill()
        path.lineWidth = 1
        path.stroke()

        drawText(
            "EDIT MAP",
            in: NSRect(x: panel.minX + 12, y: panel.minY + 13, width: panel.width - 24, height: 16),
            font: .monospacedSystemFont(ofSize: 10, weight: .semibold),
            color: NSColor(calibratedWhite: 0.74, alpha: 1)
        )
        for (index, action) in actions.enumerated() {
            let row = rowRect(index: index, panel: panel)
            NSColor(calibratedWhite: 0.16, alpha: 1).setFill()
            NSBezierPath(roundedRect: row, xRadius: 4, yRadius: 4).fill()
            drawText(
                action.title,
                in: NSRect(x: row.minX + 9, y: row.minY + 7, width: row.width - 18, height: 14),
                font: .monospacedSystemFont(ofSize: 11, weight: .medium),
                color: NSColor(calibratedWhite: 0.92, alpha: 1)
            )
            drawText(
                action.detail,
                in: NSRect(x: row.minX + 9, y: row.minY + 22, width: row.width - 18, height: 12),
                font: .monospacedSystemFont(ofSize: 9, weight: .regular),
                color: NSColor(calibratedWhite: 0.54, alpha: 1)
            )
        }
        drawText(
            "⌘E or esc close",
            in: NSRect(x: panel.minX + 12, y: panel.maxY - 20, width: panel.width - 24, height: 12),
            font: .monospacedSystemFont(ofSize: 9, weight: .regular),
            color: NSColor(calibratedWhite: 0.48, alpha: 1)
        )
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            onDismiss?()
        } else {
            super.keyDown(with: event)
        }
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let panel = panelRect()
        guard panel.contains(point) else {
            onDismiss?()
            return
        }
        for (index, action) in actions.enumerated() where rowRect(index: index, panel: panel).contains(point) {
            onAction?(action)
            return
        }
    }

    private func panelRect() -> NSRect {
        let height = Metrics.headerHeight + Metrics.footerHeight + CGFloat(actions.count) * Metrics.rowHeight + 10
        return NSRect(
            x: max(Metrics.panelInset, bounds.maxX - Metrics.panelWidth - Metrics.panelInset),
            y: Metrics.panelInset + 38,
            width: Metrics.panelWidth,
            height: height
        )
    }

    private func rowRect(index: Int, panel: NSRect) -> NSRect {
        NSRect(
            x: panel.minX + 7,
            y: panel.minY + Metrics.headerHeight + 5 + CGFloat(index) * Metrics.rowHeight,
            width: panel.width - 14,
            height: Metrics.rowHeight - 4
        )
    }

    private func drawText(_ text: String, in rect: NSRect, font: NSFont, color: NSColor) {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingTail
        text.draw(
            in: rect,
            withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: style]
        )
    }
}
