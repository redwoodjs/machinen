import AppKit

final class WorkspaceClusterView: NSView {
    private enum Metrics {
        static let padding: CGFloat = 24
        static let headerHeight: CGFloat = 62
        static let gap: CGFloat = 30
        static let cornerRadius: CGFloat = 18
    }

    let workspace: String
    let label: String
    private(set) var sessions: [TerminalTileView] = []
    private(set) var sessionColumns = 1

    var onSelect: (() -> Void)?
    var onActivate: (() -> Void)?

    var isSelected = false {
        didSet { needsDisplay = true }
    }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { false }

    init(workspace: String, label: String) {
        self.workspace = workspace
        self.label = label
        super.init(frame: .zero)
        wantsLayer = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Workspace \(workspace)")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @discardableResult
    func arrange(sessions: [TerminalTileView], terminalSize: NSSize) -> NSSize {
        self.sessions = sessions
        let content = NSRect(
            x: Metrics.padding,
            y: Metrics.headerHeight,
            width: max(1, terminalSize.width - Metrics.padding * 2),
            height: max(1, terminalSize.height - Metrics.headerHeight - Metrics.padding)
        )
        sessionColumns = bestColumnCount(
            itemCount: sessions.count,
            contentSize: content.size,
            terminalSize: terminalSize
        )
        let rows = max(1, Int(ceil(Double(sessions.count) / Double(sessionColumns))))
        let cellWidth = (content.width - Metrics.gap * CGFloat(max(0, sessionColumns - 1)))
            / CGFloat(sessionColumns)
        let cellHeight = (content.height - Metrics.gap * CGFloat(max(0, rows - 1)))
            / CGFloat(rows)
        let tileScale = min(cellWidth / terminalSize.width, cellHeight / terminalSize.height)
        let tileSize = NSSize(
            width: terminalSize.width * tileScale,
            height: terminalSize.height * tileScale
        )

        for subview in subviews where !sessions.contains(where: { $0 === subview }) {
            subview.removeFromSuperview()
        }
        for (index, tile) in sessions.enumerated() {
            if tile.superview !== self {
                addSubview(tile)
            }
            let column = index % sessionColumns
            let row = index / sessionColumns
            let cell = NSRect(
                x: content.minX + CGFloat(column) * (cellWidth + Metrics.gap),
                y: content.minY + CGFloat(row) * (cellHeight + Metrics.gap),
                width: cellWidth,
                height: cellHeight
            )
            tile.frame = NSRect(
                x: cell.midX - tileSize.width / 2,
                y: cell.midY - tileSize.height / 2,
                width: tileSize.width,
                height: tileSize.height
            ).integral
            // Every terminal keeps one full-screen intrinsic surface. Its frame
            // is merely the scaled slot inside this uniform workspace screen.
            tile.bounds = NSRect(origin: .zero, size: terminalSize)
            tile.isHidden = false
            tile.alphaValue = 1
        }
        return terminalSize
    }

    private func bestColumnCount(
        itemCount: Int,
        contentSize: NSSize,
        terminalSize: NSSize
    ) -> Int {
        guard itemCount > 1 else { return 1 }
        var bestColumns = 1
        var bestScale: CGFloat = 0
        for columns in 1...itemCount {
            let rows = Int(ceil(Double(itemCount) / Double(columns)))
            let width = (contentSize.width - Metrics.gap * CGFloat(columns - 1)) / CGFloat(columns)
            let height = (contentSize.height - Metrics.gap * CGFloat(rows - 1)) / CGFloat(rows)
            let scale = min(width / terminalSize.width, height / terminalSize.height)
            if scale > bestScale {
                bestScale = scale
                bestColumns = columns
            }
        }
        return bestColumns
    }

    func frameForSession(_ tile: TerminalTileView, in view: NSView) -> NSRect? {
        guard tile.superview === self else { return nil }
        return tile.convert(tile.bounds, to: view)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        NSColor(calibratedWhite: 0.075, alpha: 0.96).setFill()
        let background = NSBezierPath(
            roundedRect: bounds,
            xRadius: Metrics.cornerRadius,
            yRadius: Metrics.cornerRadius
        )
        background.fill()

        let border = NSBezierPath(
            roundedRect: bounds.insetBy(dx: 2, dy: 2),
            xRadius: Metrics.cornerRadius - 2,
            yRadius: Metrics.cornerRadius - 2
        )
        border.lineWidth = isSelected ? 6 : 2
        NSColor(calibratedWhite: isSelected ? 0.94 : 0.28, alpha: 1).setStroke()
        border.stroke()

        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        let titleAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 22, weight: .semibold),
            .foregroundColor: NSColor(calibratedWhite: 0.88, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        NSAttributedString(string: workspace, attributes: titleAttributes).draw(
            in: NSRect(x: Metrics.padding, y: 17, width: bounds.width * 0.58, height: 30)
        )

        paragraph.alignment = .right
        let count = sessions.count
        let detail = "\(label)  ·  \(count) \(count == 1 ? "terminal" : "terminals")"
        let detailAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 15, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.55, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        NSAttributedString(string: detail, attributes: detailAttributes).draw(
            in: NSRect(x: bounds.width * 0.5, y: 21, width: bounds.width * 0.5 - Metrics.padding, height: 24)
        )
    }

    override func mouseDown(with event: NSEvent) {
        onSelect?()
        if event.clickCount >= 2 {
            onActivate?()
        }
    }
}
