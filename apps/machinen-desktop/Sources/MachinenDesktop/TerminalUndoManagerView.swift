import AppKit

struct TerminalUndoItem {
    let terminalID: String
    let name: String
    let deadline: Date
}

final class TerminalUndoManagerView: NSView {
    private enum Metrics {
        static let panelWidth: CGFloat = 680
        static let headerHeight: CGFloat = 58
        static let rowHeight: CGFloat = 58
        static let footerHeight: CGFloat = 34
    }

    var workspaceName = "workspace" {
        didSet { needsDisplay = true }
    }
    var items: [TerminalUndoItem] = [] {
        didSet {
            selectedIndex = min(selectedIndex, max(0, items.count - 1))
            needsDisplay = true
        }
    }
    var onDismiss: (() -> Void)?
    var onRestore: ((String) -> Void)?
    var onKill: ((String) -> Void)?

    private var selectedIndex = 0
    private var countdownTimer: Timer?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        autoresizingMask = [.width, .height]
        wantsLayer = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Recently closed terminals")
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        countdownTimer?.invalidate()
        countdownTimer = nil
        guard window != nil else { return }
        let timer = Timer(
            timeInterval: 1,
            target: self,
            selector: #selector(refreshCountdown(_:)),
            userInfo: nil,
            repeats: true
        )
        countdownTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    @objc private func refreshCountdown(_ timer: Timer) {
        guard window != nil else {
            timer.invalidate()
            countdownTimer = nil
            return
        }
        needsDisplay = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.68).setFill()
        bounds.fill()

        let panel = panelRect()
        NSColor(calibratedWhite: 0.09, alpha: 1).setFill()
        NSColor(calibratedWhite: 0.58, alpha: 1).setStroke()
        let path = NSBezierPath(roundedRect: panel, xRadius: 9, yRadius: 9)
        path.fill()
        path.lineWidth = 1
        path.stroke()

        drawText(
            "UNDO · \(workspaceName)",
            in: NSRect(x: panel.minX + 18, y: panel.minY + 15, width: panel.width - 36, height: 18),
            font: .monospacedSystemFont(ofSize: 12, weight: .semibold),
            color: NSColor(calibratedWhite: 0.91, alpha: 1)
        )
        drawText(
            items.isEmpty ? "No terminals are waiting for undo." : "Closed terminals stay alive until their countdown ends.",
            in: NSRect(x: panel.minX + 18, y: panel.minY + 34, width: panel.width - 36, height: 15),
            font: .monospacedSystemFont(ofSize: 10, weight: .regular),
            color: NSColor(calibratedWhite: 0.52, alpha: 1)
        )

        for (index, item) in items.enumerated() {
            drawRow(item, index: index, in: rowRect(index: index, panel: panel))
        }

        drawText(
            "↑↓ select    return restore    delete kill    esc close",
            in: NSRect(
                x: panel.minX + 18,
                y: panel.maxY - Metrics.footerHeight + 10,
                width: panel.width - 36,
                height: 14
            ),
            font: .monospacedSystemFont(ofSize: 9, weight: .regular),
            color: NSColor(calibratedWhite: 0.45, alpha: 1),
            alignment: .right
        )
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53:
            onDismiss?()
        case 125:
            guard !items.isEmpty else { return }
            selectedIndex = min(items.count - 1, selectedIndex + 1)
            needsDisplay = true
        case 126:
            guard !items.isEmpty else { return }
            selectedIndex = max(0, selectedIndex - 1)
            needsDisplay = true
        case 36, 76:
            guard items.indices.contains(selectedIndex) else { return }
            onRestore?(items[selectedIndex].terminalID)
        case 51, 117:
            guard items.indices.contains(selectedIndex) else { return }
            onKill?(items[selectedIndex].terminalID)
        default:
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
        for index in items.indices {
            let row = rowRect(index: index, panel: panel)
            guard row.contains(point) else { continue }
            selectedIndex = index
            needsDisplay = true
            if killRect(in: row).contains(point) {
                onKill?(items[index].terminalID)
            } else if restoreRect(in: row).contains(point) {
                onRestore?(items[index].terminalID)
            }
            return
        }
    }

    private func panelRect() -> NSRect {
        let width = min(Metrics.panelWidth, max(420, bounds.width - 48))
        let height = Metrics.headerHeight
            + CGFloat(max(1, items.count)) * Metrics.rowHeight
            + Metrics.footerHeight
        return NSRect(
            x: bounds.midX - width / 2,
            y: max(28, bounds.height * 0.14),
            width: width,
            height: height
        )
    }

    private func rowRect(index: Int, panel: NSRect) -> NSRect {
        NSRect(
            x: panel.minX + 8,
            y: panel.minY + Metrics.headerHeight + CGFloat(index) * Metrics.rowHeight,
            width: panel.width - 16,
            height: Metrics.rowHeight
        )
    }

    private func drawRow(_ item: TerminalUndoItem, index: Int, in row: NSRect) {
        if index == selectedIndex {
            NSColor(calibratedWhite: 0.18, alpha: 1).setFill()
            NSBezierPath(roundedRect: row, xRadius: 5, yRadius: 5).fill()
        }
        drawText(
            item.name,
            in: NSRect(x: row.minX + 10, y: row.minY + 11, width: row.width - 300, height: 17),
            font: .monospacedSystemFont(ofSize: 12, weight: .medium),
            color: NSColor(calibratedWhite: 0.91, alpha: 1)
        )
        drawText(
            countdown(item.deadline),
            in: NSRect(x: row.minX + 10, y: row.minY + 31, width: row.width - 300, height: 15),
            font: .monospacedSystemFont(ofSize: 10, weight: .regular),
            color: NSColor(calibratedWhite: 0.53, alpha: 1)
        )
        drawButton(killRect(in: row), title: "Kill", emphasized: false)
        drawButton(restoreRect(in: row), title: "Restore", emphasized: true)
    }

    private func countdown(_ deadline: Date) -> String {
        let seconds = max(0, Int(ceil(deadline.timeIntervalSinceNow)))
        return String(format: "%d:%02d remaining", seconds / 60, seconds % 60)
    }

    private func restoreRect(in row: NSRect) -> NSRect {
        NSRect(x: row.maxX - 108, y: row.minY + 12, width: 96, height: 32)
    }

    private func killRect(in row: NSRect) -> NSRect {
        NSRect(x: row.maxX - 196, y: row.minY + 12, width: 76, height: 32)
    }

    private func drawButton(_ rect: NSRect, title: String, emphasized: Bool) {
        NSColor(calibratedWhite: emphasized ? 0.84 : 0.18, alpha: 1).setFill()
        NSColor(calibratedWhite: emphasized ? 0.94 : 0.43, alpha: 1).setStroke()
        let path = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
        path.fill()
        path.lineWidth = 1
        path.stroke()
        drawText(
            title,
            in: NSRect(x: rect.minX + 5, y: rect.minY + 9, width: rect.width - 10, height: 15),
            font: .monospacedSystemFont(ofSize: 10, weight: .medium),
            color: emphasized ? NSColor(calibratedWhite: 0.08, alpha: 1) : NSColor(calibratedWhite: 0.80, alpha: 1),
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
        paragraph.lineBreakMode = .byTruncatingTail
        NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraph,
            ]
        ).draw(in: rect)
    }
}
