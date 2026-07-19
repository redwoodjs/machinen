import AppKit

final class RestorationView: NSView {
    private var detail: String

    override var isFlipped: Bool { true }

    init(frame: NSRect, detail: String) {
        self.detail = detail
        super.init(frame: frame)
        autoresizingMask = [.width, .height]
        wantsLayer = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Restoring Machinen sessions")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func update(detail: String) {
        self.detail = detail
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.64).setFill()
        bounds.fill()
        let panel = NSRect(x: bounds.midX - 260, y: bounds.midY - 76, width: 520, height: 152)
        NSColor(calibratedWhite: 0.085, alpha: 1).setFill()
        NSColor(calibratedWhite: 0.52, alpha: 1).setStroke()
        let path = NSBezierPath(roundedRect: panel, xRadius: 8, yRadius: 8)
        path.fill()
        path.lineWidth = 1
        path.stroke()

        drawText(
            "RESTORING MACHINEN",
            in: NSRect(x: panel.minX + 22, y: panel.minY + 22, width: panel.width - 44, height: 22),
            size: 15,
            weight: .semibold,
            white: 0.90
        )
        drawText(
            detail,
            in: NSRect(x: panel.minX + 22, y: panel.minY + 62, width: panel.width - 44, height: 58),
            size: 11,
            weight: .regular,
            white: 0.60
        )
        drawText(
            "The underlying sessions were not stopped.",
            in: NSRect(x: panel.minX + 22, y: panel.maxY - 29, width: panel.width - 44, height: 15),
            size: 9,
            weight: .regular,
            white: 0.42
        )
    }

    private func drawText(
        _ text: String,
        in rect: NSRect,
        size: CGFloat,
        weight: NSFont.Weight,
        white: CGFloat
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        NSAttributedString(
            string: text,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: size, weight: weight),
                .foregroundColor: NSColor(calibratedWhite: white, alpha: 1),
                .paragraphStyle: paragraph,
            ]
        ).draw(with: rect, options: [.usesLineFragmentOrigin])
    }
}
