import AppKit

final class TerminalDeckView: NSView {
    private enum Metrics {
        static let topInset: CGFloat = 58
        static let bottomInset: CGFloat = 54
        static let sideInset: CGFloat = 28
        static let gap: CGFloat = 22
        static let tileAspectRatio: CGFloat = 1.58
    }

    private let terminalTiles: [TerminalTileView]

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }

    init(sessions: [MockSession]) {
        terminalTiles = sessions.map(TerminalTileView.init)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1).cgColor

        for tile in terminalTiles {
            addSubview(tile)
        }
        terminalTiles.first?.isSelected = true
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        let frames = gridFrames(count: terminalTiles.count, in: bounds)
        for (tile, frame) in zip(terminalTiles, frames) {
            tile.frame = frame.integral
            tile.needsDisplay = true
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.055, alpha: 1).setFill()
        bounds.fill()
        drawMetadata()
        drawKeyHints()
    }

    private func gridFrames(count: Int, in bounds: NSRect) -> [NSRect] {
        guard count > 0 else { return [] }

        let columns = Int(ceil(sqrt(Double(count))))
        let rows = Int(ceil(Double(count) / Double(columns)))
        let content = NSRect(
            x: Metrics.sideInset,
            y: Metrics.topInset,
            width: max(0, bounds.width - Metrics.sideInset * 2),
            height: max(0, bounds.height - Metrics.topInset - Metrics.bottomInset)
        )

        let availableWidth = (content.width - Metrics.gap * CGFloat(columns - 1)) / CGFloat(columns)
        let availableHeight = (content.height - Metrics.gap * CGFloat(rows - 1)) / CGFloat(rows)

        let tileWidth: CGFloat
        let tileHeight: CGFloat
        if availableWidth / availableHeight > Metrics.tileAspectRatio {
            tileHeight = availableHeight
            tileWidth = tileHeight * Metrics.tileAspectRatio
        } else {
            tileWidth = availableWidth
            tileHeight = tileWidth / Metrics.tileAspectRatio
        }

        let totalWidth = tileWidth * CGFloat(columns) + Metrics.gap * CGFloat(columns - 1)
        let totalHeight = tileHeight * CGFloat(rows) + Metrics.gap * CGFloat(rows - 1)
        let originX = content.minX + (content.width - totalWidth) / 2
        let originY = content.minY + (content.height - totalHeight) / 2

        return (0..<count).map { index in
            let column = index % columns
            let row = index / columns
            return NSRect(
                x: originX + CGFloat(column) * (tileWidth + Metrics.gap),
                y: originY + CGFloat(row) * (tileHeight + Metrics.gap),
                width: tileWidth,
                height: tileHeight
            )
        }
    }

    private func drawMetadata() {
        drawLabel(
            "MACHINEN · \(terminalTiles.count) LIVE SESSIONS",
            x: Metrics.sideInset,
            alignment: .left
        )
        drawLabel(
            "⌘K  commands     ⌘T  new terminal",
            x: bounds.width - Metrics.sideInset,
            alignment: .right
        )
    }

    private func drawLabel(_ text: String, x: CGFloat, alignment: NSTextAlignment) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        let width = min(360, max(0, bounds.width - Metrics.sideInset * 2))
        let rectX = alignment == .left ? x : x - width
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.56, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        NSAttributedString(string: text, attributes: attributes).draw(
            in: NSRect(x: rectX, y: 20, width: width, height: 18)
        )
    }

    private func drawKeyHints() {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.43, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        let text = "arrows  select     type label  focus     return  open     space  peek     ⌘F  search"
        NSAttributedString(string: text, attributes: attributes).draw(
            in: NSRect(x: Metrics.sideInset, y: bounds.height - 31, width: bounds.width - Metrics.sideInset * 2, height: 16)
        )
    }
}
