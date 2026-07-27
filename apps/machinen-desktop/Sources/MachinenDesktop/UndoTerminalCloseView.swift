import AppKit

final class UndoTerminalCloseView: NSView {
    var terminalName = "terminal" {
        didSet { needsDisplay = true }
    }
    var deadline = Date() {
        didSet { needsDisplay = true }
    }
    var onUndo: (() -> Void)?
    var onTerminateNow: (() -> Void)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.masksToBounds = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Terminal closed. Undo or terminate now.")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.10, alpha: 0.98).setFill()
        bounds.fill()
        NSColor(calibratedWhite: 0.42, alpha: 1).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 8, yRadius: 8)
        border.lineWidth = 1
        border.stroke()

        drawText(
            "Closed \(terminalName)",
            in: NSRect(x: 16, y: 12, width: max(1, bounds.width - 300), height: 18),
            color: NSColor(calibratedWhite: 0.92, alpha: 1),
            weight: .semibold
        )
        let minutes = max(1, Int(ceil(deadline.timeIntervalSinceNow / 60)))
        drawText(
            "The same process remains available for undo for about \(minutes) min.",
            in: NSRect(x: 16, y: 34, width: max(1, bounds.width - 300), height: 16),
            color: NSColor(calibratedWhite: 0.58, alpha: 1),
            weight: .regular
        )
        drawButton(terminateRect(), title: "Terminate now", emphasized: false)
        drawButton(undoRect(), title: "Undo  ⇧⌘T", emphasized: true)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if undoRect().contains(point) {
            onUndo?()
        } else if terminateRect().contains(point) {
            onTerminateNow?()
        }
    }

    private func undoRect() -> NSRect {
        NSRect(x: bounds.maxX - 140, y: 14, width: 124, height: 34)
    }

    private func terminateRect() -> NSRect {
        NSRect(x: bounds.maxX - 274, y: 14, width: 122, height: 34)
    }

    private func drawButton(_ rect: NSRect, title: String, emphasized: Bool) {
        NSColor(calibratedWhite: emphasized ? 0.84 : 0.18, alpha: 1).setFill()
        NSColor(calibratedWhite: emphasized ? 0.95 : 0.46, alpha: 1).setStroke()
        let path = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
        path.fill()
        path.lineWidth = 1
        path.stroke()
        drawText(
            title,
            in: NSRect(x: rect.minX + 6, y: rect.minY + 9, width: rect.width - 12, height: 16),
            color: emphasized ? NSColor(calibratedWhite: 0.08, alpha: 1) : NSColor(calibratedWhite: 0.82, alpha: 1),
            weight: .medium,
            alignment: .center
        )
    }

    private func drawText(
        _ text: String,
        in rect: NSRect,
        color: NSColor,
        weight: NSFont.Weight,
        alignment: NSTextAlignment = .left
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        NSAttributedString(
            string: text,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 11, weight: weight),
                .foregroundColor: color,
                .paragraphStyle: paragraph,
            ]
        ).draw(with: rect, options: [.usesLineFragmentOrigin])
    }
}
