import AppKit

final class ActionConfirmationView: NSView {
    private let heading: String
    private let message: String
    private let consequence: String
    private let confirmTitle: String

    var onCancel: (() -> Void)?
    var onConfirm: (() -> Void)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(
        frame: NSRect,
        heading: String,
        message: String,
        consequence: String,
        confirmTitle: String
    ) {
        self.heading = heading
        self.message = message
        self.consequence = consequence
        self.confirmTitle = confirmTitle
        super.init(frame: frame)
        autoresizingMask = [.width, .height]
        wantsLayer = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel(heading)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemRed.withAlphaComponent(0.10).setFill()
        bounds.fill()
        let tilePath = NSBezierPath(
            roundedRect: bounds.insetBy(dx: 2, dy: 2),
            xRadius: 16,
            yRadius: 16
        )
        tilePath.setLineDash([9, 7], count: 2, phase: 0)
        NSColor.systemRed.withAlphaComponent(0.90).setStroke()
        tilePath.lineWidth = 3
        tilePath.stroke()

        let panel = panelRect()
        NSColor(calibratedWhite: 0.09, alpha: 0.96).setFill()
        NSColor.systemRed.withAlphaComponent(0.86).setStroke()
        let path = NSBezierPath(roundedRect: panel, xRadius: 9, yRadius: 9)
        path.fill()
        path.lineWidth = 1
        path.stroke()

        drawText(
            heading,
            in: NSRect(x: panel.minX + 24, y: panel.minY + 22, width: panel.width - 48, height: 26),
            font: .monospacedSystemFont(ofSize: 17, weight: .semibold),
            color: NSColor(calibratedWhite: 0.94, alpha: 1)
        )
        drawText(
            message,
            in: NSRect(x: panel.minX + 24, y: panel.minY + 64, width: panel.width - 48, height: 42),
            font: .monospacedSystemFont(ofSize: 12, weight: .regular),
            color: NSColor(calibratedWhite: 0.76, alpha: 1)
        )
        drawText(
            consequence,
            in: NSRect(x: panel.minX + 24, y: panel.minY + 116, width: panel.width - 48, height: 40),
            font: .monospacedSystemFont(ofSize: 11, weight: .regular),
            color: NSColor(calibratedWhite: 0.52, alpha: 1)
        )

        drawButton(cancelButtonRect(), title: "Cancel", emphasized: false)
        drawButton(confirmButtonRect(), title: confirmTitle, emphasized: true)
        drawText(
            "esc cancel    return confirm",
            in: NSRect(x: panel.minX + 24, y: panel.maxY - 18, width: panel.width - 48, height: 14),
            font: .monospacedSystemFont(ofSize: 10, weight: .regular),
            color: NSColor(calibratedWhite: 0.46, alpha: 1),
            alignment: .right
        )
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53:
            onCancel?()
        case 36, 76:
            onConfirm?()
        default:
            super.keyDown(with: event)
        }
    }

    func performShortcut(_ action: DesktopShortcutAction) -> Bool {
        switch action {
        case .enter:
            onConfirm?()
            return true
        case .leave:
            onCancel?()
            return true
        default:
            return false
        }
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if confirmButtonRect().contains(point) {
            onConfirm?()
        } else if cancelButtonRect().contains(point) || !panelRect().contains(point) {
            onCancel?()
        }
    }

    private func panelRect() -> NSRect {
        let width = min(620, max(280, bounds.width - 48))
        return NSRect(x: bounds.midX - width / 2, y: max(28, bounds.midY - 115), width: width, height: 230)
    }

    private func cancelButtonRect() -> NSRect {
        let panel = panelRect()
        return NSRect(x: panel.maxX - 282, y: panel.maxY - 54, width: 112, height: 32)
    }

    private func confirmButtonRect() -> NSRect {
        let panel = panelRect()
        return NSRect(x: panel.maxX - 158, y: panel.maxY - 54, width: 134, height: 32)
    }

    private func drawButton(_ rect: NSRect, title: String, emphasized: Bool) {
        (emphasized ? NSColor.systemRed : NSColor(calibratedWhite: 0.17, alpha: 1)).setFill()
        (emphasized
            ? NSColor.systemRed.withAlphaComponent(0.95)
            : NSColor(calibratedWhite: 0.42, alpha: 1)).setStroke()
        let path = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
        path.fill()
        path.lineWidth = 1
        path.stroke()
        drawText(
            title,
            in: NSRect(x: rect.minX + 8, y: rect.minY + 8, width: rect.width - 16, height: 18),
            font: .monospacedSystemFont(ofSize: 11, weight: .medium),
            color: emphasized ? NSColor(calibratedWhite: 0.08, alpha: 1) : NSColor(calibratedWhite: 0.82, alpha: 1),
            alignment: .center
        )
    }

    private func drawText(
        _ text: String,
        in rect: NSRect,
        font: NSFont,
        color: NSColor,
        alignment: NSTextAlignment = .left
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byWordWrapping
        NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraph,
            ]
        ).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading])
    }
}
