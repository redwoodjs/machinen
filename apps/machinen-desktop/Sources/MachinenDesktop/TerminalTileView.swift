import AppKit

enum TileKind {
    case workspace
    case session
}

final class TerminalTileView: NSView {
    private enum Metrics {
        static let cornerRadius: CGFloat = 7
        static let headerHeight: CGFloat = 26
        static let horizontalInset: CGFloat = 10
        static let badgeHeight: CGFloat = 18
    }

    let session: TerminalSession
    let kind: TileKind
    private let clusterSessions: [TerminalTileView]
    private var displayState: TerminalSession.State
    private var displayTerminalText: String
    private var embeddedTerminalView: MachinenTerminalView?
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

    var currentState: TerminalSession.State { displayState }
    var currentTerminalText: String { displayTerminalText }

    var isFocused = false {
        didSet {
            layer?.cornerRadius = isFocused ? 0 : Metrics.cornerRadius
            needsLayout = true
            needsDisplay = true
        }
    }

    override var isFlipped: Bool { true }

    init(
        session: TerminalSession,
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

    func transition(to state: TerminalSession.State, terminalText: String) {
        session.state = state
        displayState = state
        displayTerminalText = terminalText
        updateAccessibilityLabel()
        needsDisplay = true
    }

    func updateActivity(to state: TerminalSession.ActivityState) {
        session.activityState = state
        updateAccessibilityLabel()
        needsDisplay = true
    }

    func updateObservedCommand(_ command: String) {
        session.observedCommand = command
        updateAccessibilityLabel()
        needsDisplay = true
    }

    func installTerminalView(_ terminalView: MachinenTerminalView) {
        embeddedTerminalView?.removeFromSuperview()
        embeddedTerminalView = terminalView
        addSubview(terminalView)
        needsLayout = true
        needsDisplay = true
    }

    func attachTerminal() {
        embeddedTerminalView?.attach()
    }

    func detachTerminalForApplicationExit() {
        embeddedTerminalView?.detachForApplicationExit()
    }

    func detachTerminalViewer() {
        embeddedTerminalView?.detachViewer()
    }

    func stopTerminal() {
        embeddedTerminalView?.stopPersistentSession()
    }

    func restartTerminal() {
        embeddedTerminalView?.restartPersistentSession()
    }

    @discardableResult
    func sendTerminalInput(_ data: Data) -> Bool {
        embeddedTerminalView?.sendPersistentInput(data) ?? false
    }

    func signalTerminal(_ signal: String) {
        embeddedTerminalView?.signalPersistentSession(signal)
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
        guard !isFocused else { return }
        let badgeWidth = max(22, ceil(textSize(session.label, font: Fonts.badge).width) + 9)
        let badgeRect = NSRect(
            x: Metrics.horizontalInset,
            y: 4,
            width: badgeWidth,
            height: Metrics.badgeHeight
        )
        NSColor(calibratedWhite: 0.16, alpha: 0.9).setFill()
        let badge = NSBezierPath(roundedRect: badgeRect, xRadius: 3, yRadius: 3)
        badge.fill()
        drawText(
            session.label,
            in: badgeRect,
            font: Fonts.badge,
            color: NSColor(calibratedWhite: 0.72, alpha: 1),
            alignment: .center,
            verticalCenter: true
        )
        drawText(
            showsWorkspaceContext ? session.workspace : session.commandTitle,
            in: NSRect(
                x: badgeRect.maxX + 8,
                y: 0,
                width: max(0, bounds.width - badgeRect.maxX - Metrics.horizontalInset - 8),
                height: Metrics.headerHeight
            ),
            font: Fonts.metadata,
            color: NSColor(calibratedWhite: 0.72, alpha: 1),
            alignment: .left,
            verticalCenter: true
        )
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
        if isFocused { return bounds }
        return NSRect(
            x: 8,
            y: Metrics.headerHeight + 4,
            width: max(0, bounds.width - 16),
            height: max(0, bounds.height - Metrics.headerHeight - 12)
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
                sessionTile.session.commandTitle,
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
        setAccessibilityLabel(
            "\(session.workspace), \(session.commandTitle), \(displayState.rawValue), \(session.activityState.rawValue)"
        )
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
