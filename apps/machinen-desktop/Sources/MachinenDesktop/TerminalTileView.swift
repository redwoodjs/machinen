import AppKit

final class TerminalTileView: NSView {
    private enum Metrics {
        static let cornerRadius: CGFloat = 7
        static let headerHeight: CGFloat = 32
        static let horizontalInset: CGFloat = 10
        static let badgeHeight: CGFloat = 18
    }

    let session: MockSession
    var isSelected: Bool = false {
        didSet { needsDisplay = true }
    }

    override var isFlipped: Bool { true }

    init(session: MockSession) {
        self.session = session
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = Metrics.cornerRadius
        layer?.masksToBounds = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("\(session.workspace), \(session.name), \(session.state.rawValue)")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        drawBackground()
        drawHeader()
        drawTerminal()
        drawBorder()
    }

    private func drawBackground() {
        NSColor(calibratedWhite: 0.105, alpha: 1).setFill()
        NSBezierPath(
            roundedRect: bounds,
            xRadius: Metrics.cornerRadius,
            yRadius: Metrics.cornerRadius
        ).fill()
    }

    private func drawHeader() {
        let header = NSRect(x: 0, y: 0, width: bounds.width, height: Metrics.headerHeight)
        NSColor(calibratedWhite: 0.135, alpha: 1).setFill()
        NSBezierPath(
            roundedRect: header,
            xRadius: Metrics.cornerRadius,
            yRadius: Metrics.cornerRadius
        ).fill()

        // Square the lower header corners while retaining the top radius.
        NSRect(
            x: 0,
            y: Metrics.cornerRadius,
            width: bounds.width,
            height: Metrics.headerHeight - Metrics.cornerRadius
        ).fill()

        NSColor(calibratedWhite: 0.25, alpha: 1).setStroke()
        let divider = NSBezierPath()
        divider.move(to: NSPoint(x: 0, y: Metrics.headerHeight - 0.5))
        divider.line(to: NSPoint(x: bounds.width, y: Metrics.headerHeight - 0.5))
        divider.lineWidth = 1
        divider.stroke()

        let badgeWidth = max(24, ceil(textSize(session.label, font: Fonts.badge).width) + 10)
        let badgeRect = NSRect(
            x: Metrics.horizontalInset,
            y: (Metrics.headerHeight - Metrics.badgeHeight) / 2,
            width: badgeWidth,
            height: Metrics.badgeHeight
        )
        NSColor(calibratedWhite: 0.16, alpha: 1).setFill()
        NSColor(calibratedWhite: 0.58, alpha: 1).setStroke()
        let badge = NSBezierPath(roundedRect: badgeRect, xRadius: 3, yRadius: 3)
        badge.fill()
        badge.lineWidth = 1
        badge.stroke()
        drawText(
            session.label,
            in: badgeRect,
            font: Fonts.badge,
            color: .white,
            alignment: .center,
            verticalCenter: true
        )

        let stateText = session.state.rawValue
        let stateWidth = ceil(textSize(stateText, font: Fonts.metadata).width)
        let stateRect = NSRect(
            x: bounds.width - Metrics.horizontalInset - stateWidth,
            y: 0,
            width: stateWidth,
            height: Metrics.headerHeight
        )
        drawText(
            stateText,
            in: stateRect,
            font: Fonts.metadata,
            color: NSColor(calibratedWhite: 0.60, alpha: 1),
            alignment: .right,
            verticalCenter: true
        )

        let dotRect = NSRect(
            x: stateRect.minX - 13,
            y: (Metrics.headerHeight - 7) / 2,
            width: 7,
            height: 7
        )
        drawStateDot(in: dotRect)

        let titleX = badgeRect.maxX + 8
        let titleRect = NSRect(
            x: titleX,
            y: 0,
            width: max(0, dotRect.minX - titleX - 9),
            height: Metrics.headerHeight
        )
        drawText(
            "\(session.workspace) / \(session.name)",
            in: titleRect,
            font: Fonts.metadata,
            color: NSColor(calibratedWhite: 0.82, alpha: 1),
            alignment: .left,
            verticalCenter: true
        )
    }

    private func drawStateDot(in rect: NSRect) {
        let path = NSBezierPath(ovalIn: rect)
        NSColor(calibratedWhite: 0.67, alpha: 1).setStroke()
        path.lineWidth = 1

        switch session.state {
        case .working, .live:
            NSColor(calibratedWhite: 0.78, alpha: 1).setFill()
            path.fill()
            path.stroke()
        case .waiting:
            path.stroke()
        case .starting:
            let context = NSGraphicsContext.current?.cgContext
            context?.saveGState()
            context?.setLineDash(phase: 0, lengths: [2, 2])
            path.stroke()
            context?.restoreGState()
        }
    }

    private func drawTerminal() {
        let terminalRect = NSRect(
            x: 12,
            y: Metrics.headerHeight + 10,
            width: max(0, bounds.width - 24),
            height: max(0, bounds.height - Metrics.headerHeight - 18)
        )
        guard terminalRect.width > 0, terminalRect.height > 0 else { return }

        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(rect: terminalRect).addClip()

        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 2
        paragraph.lineBreakMode = .byClipping
        let attributes: [NSAttributedString.Key: Any] = [
            .font: Fonts.terminal,
            .foregroundColor: NSColor(calibratedWhite: 0.73, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        NSAttributedString(string: session.terminalText, attributes: attributes)
            .draw(with: terminalRect, options: [.usesLineFragmentOrigin, .usesFontLeading])

        NSGraphicsContext.restoreGraphicsState()
    }

    private func drawBorder() {
        let inset: CGFloat = isSelected ? 1 : 0.5
        let path = NSBezierPath(
            roundedRect: bounds.insetBy(dx: inset, dy: inset),
            xRadius: Metrics.cornerRadius,
            yRadius: Metrics.cornerRadius
        )
        path.lineWidth = isSelected ? 2 : 1
        let white = isSelected ? 0.92 : 0.31
        NSColor(calibratedWhite: white, alpha: 1).setStroke()
        path.stroke()
    }

    private func drawText(
        _ text: String,
        in rect: NSRect,
        font: NSFont,
        color: NSColor,
        alignment: NSTextAlignment,
        verticalCenter: Bool
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: paragraph,
        ]
        let string = NSAttributedString(string: text, attributes: attributes)
        var target = rect
        if verticalCenter {
            target.origin.y += max(0, (rect.height - string.size().height) / 2)
        }
        string.draw(with: target, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    }

    private func textSize(_ text: String, font: NSFont) -> NSSize {
        (text as NSString).size(withAttributes: [.font: font])
    }
}

@MainActor
private enum Fonts {
    static let badge = NSFont.monospacedSystemFont(ofSize: 10, weight: .bold)
    static let metadata = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    static let terminal = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
}
