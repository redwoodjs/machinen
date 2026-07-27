import AppKit

final class DiagnosticsView: NSView {
    private let heading: String
    private let scrollView = NSScrollView()
    private let textView = DiagnosticTextView()

    var onDismiss: (() -> Void)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(frame: NSRect, heading: String, text: String) {
        self.heading = heading
        super.init(frame: frame)
        autoresizingMask = [.width, .height]
        wantsLayer = true

        textView.string = text
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = true
        textView.backgroundColor = NSColor(calibratedWhite: 0.065, alpha: 1)
        textView.textColor = NSColor(calibratedWhite: 0.78, alpha: 1)
        textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        textView.textContainerInset = NSSize(width: 14, height: 14)
        textView.isRichText = false
        textView.onEscape = { [weak self] in self?.onDismiss?() }

        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        addSubview(scrollView)

        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel(heading)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        let panel = panelRect()
        scrollView.frame = NSRect(
            x: panel.minX + 18,
            y: panel.minY + 52,
            width: panel.width - 36,
            height: panel.height - 88
        )
        textView.minSize = NSSize(width: 0, height: scrollView.contentSize.height)
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.containerSize = NSSize(
            width: scrollView.contentSize.width,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainer?.widthTracksTextView = true
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.72).setFill()
        bounds.fill()
        let panel = panelRect()
        NSColor(calibratedWhite: 0.09, alpha: 1).setFill()
        NSColor(calibratedWhite: 0.55, alpha: 1).setStroke()
        let path = NSBezierPath(roundedRect: panel, xRadius: 9, yRadius: 9)
        path.fill()
        path.lineWidth = 1
        path.stroke()

        drawText(
            heading,
            in: NSRect(x: panel.minX + 18, y: panel.minY + 18, width: panel.width - 36, height: 22),
            font: .monospacedSystemFont(ofSize: 14, weight: .semibold),
            color: NSColor(calibratedWhite: 0.90, alpha: 1)
        )
        drawText(
            "select text · ⌘C copy · esc close",
            in: NSRect(x: panel.minX + 18, y: panel.maxY - 25, width: panel.width - 36, height: 15),
            font: .monospacedSystemFont(ofSize: 9, weight: .regular),
            color: NSColor(calibratedWhite: 0.45, alpha: 1)
        )
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            onDismiss?()
        } else {
            super.keyDown(with: event)
        }
    }

    override func mouseDown(with event: NSEvent) {
        if !panelRect().contains(convert(event.locationInWindow, from: nil)) {
            onDismiss?()
        }
    }

    private func panelRect() -> NSRect {
        let width = min(760, max(460, bounds.width - 48))
        let height = min(560, max(360, bounds.height - 48))
        return NSRect(x: bounds.midX - width / 2, y: bounds.midY - height / 2, width: width, height: height)
    }

    private func drawText(_ text: String, in rect: NSRect, font: NSFont, color: NSColor) {
        NSAttributedString(
            string: text,
            attributes: [.font: font, .foregroundColor: color]
        ).draw(in: rect)
    }
}

private final class DiagnosticTextView: NSTextView {
    var onEscape: (() -> Void)?

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            onEscape?()
        } else {
            super.keyDown(with: event)
        }
    }
}
