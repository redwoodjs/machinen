import AppKit

/// A screen-space text popover for a compact status instrument. Graphs remain
/// graphical in the bar; their label and exact current values appear here on
/// hover without relying on macOS's delayed tooltip behavior.
final class MachinenStatusPopoverView: NSView {
    private enum Metrics {
        static let horizontalInset: CGFloat = 12
        static let verticalInset: CGFloat = 9
        static let titleHeight: CGFloat = 16
        static let lineGap: CGFloat = 3
        static let cornerRadius: CGFloat = 7
    }

    private var title = ""
    private var detail = ""
    private var tone: MachinenStatusWidget.Tone = .neutral

    var displayedText: (title: String, detail: String)? {
        isHidden ? nil : (title, detail)
    }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.075, alpha: 0.98).cgColor
        layer?.borderWidth = 1
        layer?.cornerRadius = Metrics.cornerRadius
        layer?.masksToBounds = true
        setAccessibilityElement(false)
        isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func present(
        title: String,
        detail: String,
        tone: MachinenStatusWidget.Tone,
        at anchor: NSRect,
        within bounds: NSRect
    ) {
        self.title = title
        self.detail = detail
        self.tone = tone
        layer?.borderColor = color(for: tone).withAlphaComponent(0.72).cgColor

        let maximumWidth = max(180, min(390, bounds.width - 32))
        let frameSize = preferredSize(maximumWidth: maximumWidth)
        let x = min(max(16, anchor.midX - frameSize.width / 2), bounds.maxX - frameSize.width - 16)
        let y = min(max(48, anchor.maxY + 8), bounds.maxY - frameSize.height - 16)
        frame = NSRect(x: x, y: y, width: frameSize.width, height: frameSize.height).integral
        isHidden = false
        needsDisplay = true
    }

    func dismiss() {
        guard !isHidden else { return }
        isHidden = true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let textWidth = max(0, bounds.width - Metrics.horizontalInset * 2)
        drawText(
            title,
            in: NSRect(
                x: Metrics.horizontalInset,
                y: Metrics.verticalInset,
                width: textWidth,
                height: Metrics.titleHeight
            ),
            font: .monospacedSystemFont(ofSize: 11, weight: .semibold),
            color: color(for: tone)
        )
        drawText(
            detail,
            in: NSRect(
                x: Metrics.horizontalInset,
                y: Metrics.verticalInset + Metrics.titleHeight + Metrics.lineGap,
                width: textWidth,
                height: max(0, bounds.height - Metrics.verticalInset * 2 - Metrics.titleHeight - Metrics.lineGap)
            ),
            font: .monospacedSystemFont(ofSize: 10, weight: .regular),
            color: NSColor(calibratedWhite: 0.76, alpha: 1)
        )
    }

    private func preferredSize(maximumWidth: CGFloat) -> NSSize {
        let titleFont = NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold)
        let detailFont = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        let titleWidth = (title as NSString).size(withAttributes: [.font: titleFont]).width
        let naturalDetailWidth = (detail as NSString).size(withAttributes: [.font: detailFont]).width
        let width = min(maximumWidth, max(180, max(titleWidth, naturalDetailWidth) + Metrics.horizontalInset * 2))
        let detailSize = NSAttributedString(string: detail, attributes: [.font: detailFont]).boundingRect(
            with: NSSize(width: width - Metrics.horizontalInset * 2, height: 44),
            options: [.usesLineFragmentOrigin, .usesFontLeading]
        )
        return NSSize(
            width: width,
            height: min(78, ceil(detailSize.height) + Metrics.verticalInset * 2 + Metrics.titleHeight + Metrics.lineGap)
        )
    }

    private func drawText(_ text: String, in rect: NSRect, font: NSFont, color: NSColor) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraph,
            ]
        ).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine])
    }

    private func color(for tone: MachinenStatusWidget.Tone) -> NSColor {
        switch tone {
        case .neutral: NSColor(calibratedWhite: 0.72, alpha: 1)
        case .good: .systemGreen
        case .busy: .systemBlue
        case .attention: .systemOrange
        case .error: .systemRed
        }
    }
}
