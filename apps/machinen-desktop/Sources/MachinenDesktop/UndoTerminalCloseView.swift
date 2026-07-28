import AppKit

final class UndoTerminalCloseView: NSView {
    var terminalName = "terminal" {
        didSet { needsDisplay = true }
    }
    var deadline = Date() {
        didSet { needsDisplay = true }
    }
    var onRestore: (() -> Void)?
    var onKill: (() -> Void)?

    private var countdownTimer: Timer?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.masksToBounds = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Terminal closed. Restore with Command-Z or kill with Command-W.")
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
        NSColor(calibratedWhite: 0.10, alpha: 0.98).setFill()
        bounds.fill()
        NSColor(calibratedWhite: 0.42, alpha: 1).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 8, yRadius: 8)
        border.lineWidth = 1
        border.stroke()

        drawText(
            "Closed \(terminalName)",
            in: NSRect(x: 14, y: 10, width: max(1, bounds.width - 246), height: 17),
            color: NSColor(calibratedWhite: 0.92, alpha: 1),
            weight: .semibold
        )
        drawText(
            "\(countdown()) left to restore",
            in: NSRect(x: 14, y: 29, width: max(1, bounds.width - 246), height: 15),
            color: NSColor(calibratedWhite: 0.56, alpha: 1),
            weight: .regular
        )
        drawButton(killRect(), title: "Kill ⌘W", emphasized: false)
        drawButton(restoreRect(), title: "Restore ⌘Z", emphasized: true)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if restoreRect().contains(point) {
            onRestore?()
        } else if killRect().contains(point) {
            onKill?()
        }
    }

    private func countdown() -> String {
        let seconds = max(0, Int(ceil(deadline.timeIntervalSinceNow)))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private func restoreRect() -> NSRect {
        NSRect(x: bounds.maxX - 122, y: 11, width: 110, height: 32)
    }

    private func killRect() -> NSRect {
        NSRect(x: bounds.maxX - 220, y: 11, width: 86, height: 32)
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
            in: NSRect(x: rect.minX + 5, y: rect.minY + 9, width: rect.width - 10, height: 15),
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
                .font: NSFont.monospacedSystemFont(ofSize: 10, weight: weight),
                .foregroundColor: color,
                .paragraphStyle: paragraph,
            ]
        ).draw(in: rect)
    }
}
