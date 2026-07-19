import AppKit

enum TileKind {
    case workspace
    case session
}

final class TerminalTileView: NSView {
    private enum Metrics {
        static let cornerRadius: CGFloat = 7
        static let headerHeight: CGFloat = 32
        static let horizontalInset: CGFloat = 10
        static let badgeHeight: CGFloat = 18
    }

    let session: MockSession
    let kind: TileKind
    private let clusterSessions: [TerminalTileView]
    private var displayState: MockSession.State
    private var displayTerminalText: String
    private var embeddedTerminalView: NSView?
    var onSelect: (() -> Void)?
    var onActivate: (() -> Void)?
    var onDragBegan: ((NSEvent) -> Void)?
    var onDragChanged: ((NSEvent) -> Void)?
    var onDragEnded: ((NSEvent) -> Void)?

    var isSelected: Bool = false {
        didSet { needsDisplay = true }
    }

    var isActivated: Bool = false {
        didSet { needsDisplay = true }
    }

    var showsWorkspaceContext = false {
        didSet { needsDisplay = true }
    }

    var simulationTick = 38 {
        didSet { needsDisplay = true }
    }

    var currentState: MockSession.State { displayState }
    var currentTerminalText: String { displayTerminalText }

    var isFocused = false {
        didSet {
            layer?.cornerRadius = isFocused ? 0 : Metrics.cornerRadius
            needsDisplay = true
        }
    }

    override var isFlipped: Bool { true }

    init(
        session: MockSession,
        kind: TileKind = .session,
        clusterSessions: [TerminalTileView] = []
    ) {
        self.session = session
        self.kind = kind
        self.clusterSessions = clusterSessions
        displayState = session.state
        displayTerminalText = session.terminalText
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = Metrics.cornerRadius
        layer?.masksToBounds = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        updateAccessibilityLabel()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func transition(to state: MockSession.State, terminalText: String) {
        displayState = state
        displayTerminalText = terminalText
        updateAccessibilityLabel()
        needsDisplay = true
    }

    func installTerminalView(_ terminalView: NSView) {
        embeddedTerminalView?.removeFromSuperview()
        embeddedTerminalView = terminalView
        addSubview(terminalView)
        needsLayout = true
        needsDisplay = true
    }

    @discardableResult
    func focusTerminal() -> Bool {
        guard let embeddedTerminalView else { return false }
        return window?.makeFirstResponder(embeddedTerminalView) ?? false
    }

    override func layout() {
        super.layout()
        embeddedTerminalView?.frame = terminalContentRect().integral
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        if embeddedTerminalView != nil, !isFocused {
            return bounds.contains(point) ? self : nil
        }
        return super.hitTest(point)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        drawBackground()
        drawHeader()
        drawTerminal()
        drawBorder()
    }

    override func mouseDown(with event: NSEvent) {
        onSelect?()
        if event.clickCount >= 2 {
            onActivate?()
        } else {
            onDragBegan?(event)
        }
    }

    override func mouseDragged(with event: NSEvent) {
        onDragChanged?(event)
    }

    override func mouseUp(with event: NSEvent) {
        onDragEnded?(event)
    }

    private func drawBackground() {
        NSColor(calibratedWhite: 0.105, alpha: 1).setFill()
        NSBezierPath(
            roundedRect: bounds,
            xRadius: cornerRadius,
            yRadius: cornerRadius
        ).fill()
    }

    private func drawHeader() {
        let header = NSRect(x: 0, y: 0, width: bounds.width, height: Metrics.headerHeight)
        NSColor(calibratedWhite: 0.135, alpha: 1).setFill()
        NSBezierPath(
            roundedRect: header,
            xRadius: cornerRadius,
            yRadius: cornerRadius
        ).fill()

        // Square the lower header corners while retaining the top radius.
        NSRect(
            x: 0,
            y: cornerRadius,
            width: bounds.width,
            height: Metrics.headerHeight - cornerRadius
        ).fill()

        NSColor(calibratedWhite: 0.25, alpha: 1).setStroke()
        let divider = NSBezierPath()
        divider.move(to: NSPoint(x: 0, y: Metrics.headerHeight - 0.5))
        divider.line(to: NSPoint(x: bounds.width, y: Metrics.headerHeight - 0.5))
        divider.lineWidth = 1
        divider.stroke()

        let badgeWidth = max(24, ceil(textSize(session.label, font: Fonts.badge).width) + 10)
        let badgeRect = NSRect(
            x: isFocused ? 82 : Metrics.horizontalInset,
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

        let stateText = kind == .workspace ? session.name : displayState.rawValue
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
        let title = switch kind {
        case .workspace:
            session.workspace
        case .session:
            isFocused || showsWorkspaceContext
                ? "\(session.workspace) / \(session.name)"
                : session.name
        }
        drawText(
            title,
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

        switch displayState {
        case .working:
            NSColor(calibratedWhite: 0.82, alpha: 1).setFill()
            path.fill()
            path.stroke()
        case .waiting:
            path.lineWidth = 2
            path.stroke()
        case .idle:
            NSColor(calibratedWhite: 0.48, alpha: 1).setFill()
            path.fill()
        case .starting:
            let context = NSGraphicsContext.current?.cgContext
            context?.saveGState()
            context?.setLineDash(phase: 0, lengths: [2, 2])
            path.stroke()
            context?.restoreGState()
        case .stopped:
            path.stroke()
            let line = NSBezierPath()
            line.move(to: NSPoint(x: rect.minX + 1.5, y: rect.midY))
            line.line(to: NSPoint(x: rect.maxX - 1.5, y: rect.midY))
            line.stroke()
        case .disconnected:
            path.stroke()
            let cross = NSBezierPath()
            cross.move(to: NSPoint(x: rect.minX + 1.5, y: rect.minY + 1.5))
            cross.line(to: NSPoint(x: rect.maxX - 1.5, y: rect.maxY - 1.5))
            cross.move(to: NSPoint(x: rect.maxX - 1.5, y: rect.minY + 1.5))
            cross.line(to: NSPoint(x: rect.minX + 1.5, y: rect.maxY - 1.5))
            cross.stroke()
        case .detached:
            NSColor(calibratedWhite: 0.32, alpha: 1).setFill()
            path.fill()
            path.stroke()
        }
    }

    func clusterFrames(in view: NSView) -> [NSRect] {
        clusterPreviewFrames().map { convert($0, to: view) }
    }

    private func drawTerminal() {
        guard embeddedTerminalView == nil else { return }
        let terminalRect = terminalContentRect()
        guard terminalRect.width > 0, terminalRect.height > 0 else { return }
        if kind == .workspace {
            drawCluster()
            return
        }

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
        let renderedText = displayTerminalText.replacingOccurrences(
            of: "{{tick}}",
            with: String(simulationTick)
        )
        NSAttributedString(string: renderedText, attributes: attributes)
            .draw(with: terminalRect, options: [.usesLineFragmentOrigin, .usesFontLeading])

        NSGraphicsContext.restoreGraphicsState()
    }

    private func terminalContentRect() -> NSRect {
        NSRect(
            x: 12,
            y: Metrics.headerHeight + 10,
            width: max(0, bounds.width - 24),
            height: max(0, bounds.height - Metrics.headerHeight - 18)
        )
    }

    private func clusterPreviewFrames() -> [NSRect] {
        let count = min(4, clusterSessions.count)
        guard count > 0 else { return [] }
        let content = terminalContentRect()
        let columns = count == 1 ? 1 : 2
        let rows = Int(ceil(Double(count) / Double(columns)))
        let gap: CGFloat = max(4, min(10, content.width * 0.02))
        let width = (content.width - gap * CGFloat(columns - 1)) / CGFloat(columns)
        let height = (content.height - gap * CGFloat(rows - 1)) / CGFloat(rows)

        return (0..<count).map { index in
            let column = index % columns
            let row = index / columns
            return NSRect(
                x: content.minX + CGFloat(column) * (width + gap),
                y: content.minY + CGFloat(row) * (height + gap),
                width: width,
                height: height
            )
        }
    }

    private func drawCluster() {
        for (index, frame) in clusterPreviewFrames().enumerated() {
            let sessionTile = clusterSessions[index]
            NSColor(calibratedWhite: 0.065, alpha: 1).setFill()
            NSColor(calibratedWhite: 0.34, alpha: 1).setStroke()
            let tilePath = NSBezierPath(roundedRect: frame, xRadius: 4, yRadius: 4)
            tilePath.fill()
            tilePath.lineWidth = 1
            tilePath.stroke()

            let headerHeight = max(13, min(21, frame.height * 0.22))
            let header = NSRect(x: frame.minX, y: frame.minY, width: frame.width, height: headerHeight)
            NSColor(calibratedWhite: 0.14, alpha: 1).setFill()
            NSBezierPath(roundedRect: header, xRadius: 4, yRadius: 4).fill()
            NSRect(
                x: header.minX,
                y: header.minY + 4,
                width: header.width,
                height: max(0, header.height - 4)
            ).fill()

            let headerFontSize = max(6, min(10, frame.width / 28))
            drawText(
                sessionTile.session.name,
                in: NSRect(x: header.minX + 6, y: header.minY, width: header.width - 12, height: header.height),
                font: .monospacedSystemFont(ofSize: headerFontSize, weight: .medium),
                color: NSColor(calibratedWhite: 0.83, alpha: 1),
                alignment: .left,
                verticalCenter: true
            )

            let body = NSRect(
                x: frame.minX + 6,
                y: header.maxY + 5,
                width: max(0, frame.width - 12),
                height: max(0, frame.maxY - header.maxY - 10)
            )
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(rect: body).addClip()
            let text = sessionTile.displayTerminalText.replacingOccurrences(
                of: "{{tick}}",
                with: String(sessionTile.simulationTick)
            )
            NSAttributedString(
                string: text,
                attributes: [
                    .font: NSFont.monospacedSystemFont(
                        ofSize: max(5, min(8, frame.width / 40)),
                        weight: .regular
                    ),
                    .foregroundColor: NSColor(calibratedWhite: 0.61, alpha: 1),
                ]
            ).draw(with: body, options: [.usesLineFragmentOrigin, .usesFontLeading])
            NSGraphicsContext.restoreGraphicsState()
        }
    }

    private func drawBorder() {
        guard !isFocused else { return }
        let inset: CGFloat = isSelected ? 1 : 0.5
        let path = NSBezierPath(
            roundedRect: bounds.insetBy(dx: inset, dy: inset),
            xRadius: cornerRadius,
            yRadius: cornerRadius
        )
        path.lineWidth = isActivated ? 4 : (isSelected ? 2 : 1)
        let white = isActivated ? 1 : (isSelected ? 0.92 : 0.31)
        NSColor(calibratedWhite: white, alpha: 1).setStroke()
        path.stroke()
    }

    private func updateAccessibilityLabel() {
        setAccessibilityLabel("\(session.workspace), \(session.name), \(displayState.rawValue)")
    }

    private var cornerRadius: CGFloat {
        isFocused ? 0 : Metrics.cornerRadius
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
