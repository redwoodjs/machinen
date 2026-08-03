import AppKit

struct TargetSessionBrowserItem {
    enum Kind { case target, workspace, session }
    let kind: Kind
    let targetID: String
    let workspaceID: String?
    let sessionID: String?
    let title: String
    let detail: String
    let state: TargetDiscovery.State
}

/// App-wide, read-only discovery browser. Its only mutations are explicit
/// opening or attachment requests made by the user.
final class TargetSessionsView: NSView {
    var items: [TargetSessionBrowserItem] = [] { didSet { selectedIndex = min(selectedIndex, max(0, items.count - 1)); needsDisplay = true } }
    var onDismiss: (() -> Void)?
    var onActivate: ((TargetSessionBrowserItem) -> Void)?
    var onRemoveTarget: ((String) -> Void)?

    private var selectedIndex = 0
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Registered target sessions")
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.68).setFill(); bounds.fill()
        let panel = NSRect(x: max(24, bounds.midX - 340), y: max(28, bounds.height * 0.12), width: min(680, bounds.width - 48), height: min(bounds.height - 56, max(150, CGFloat(items.count) * 42 + 80)))
        NSColor(calibratedWhite: 0.09, alpha: 1).setFill(); NSBezierPath(roundedRect: panel, xRadius: 9, yRadius: 9).fill()
        text("ACTIVE SESSIONS · REGISTERED TARGETS", NSRect(x: panel.minX + 16, y: panel.minY + 13, width: panel.width - 32, height: 18), 12, .semibold, .white)
        text("return open/attach    delete remove SSH target    esc close", NSRect(x: panel.minX + 16, y: panel.maxY - 25, width: panel.width - 32, height: 14), 9, .regular, NSColor(calibratedWhite: 0.48, alpha: 1))
        if items.isEmpty { text("No registered SSH targets. Register one from Commands…", NSRect(x: panel.minX + 16, y: panel.minY + 54, width: panel.width - 32, height: 18), 11, .regular, NSColor(calibratedWhite: 0.62, alpha: 1)); return }
        let visible = Array(items.prefix(max(1, Int((panel.height - 75) / 42))))
        for (index, item) in visible.enumerated() {
            let row = NSRect(x: panel.minX + 8, y: panel.minY + 42 + CGFloat(index) * 42, width: panel.width - 16, height: 40)
            if index == selectedIndex { NSColor(calibratedWhite: 0.18, alpha: 1).setFill(); NSBezierPath(roundedRect: row, xRadius: 4, yRadius: 4).fill() }
            text(item.title, NSRect(x: row.minX + 8, y: row.minY + 6, width: row.width - 20, height: 15), 11, .medium, tone(item.state))
            text(item.detail, NSRect(x: row.minX + 8, y: row.minY + 22, width: row.width - 20, height: 13), 9, .regular, NSColor(calibratedWhite: 0.57, alpha: 1))
        }
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: onDismiss?()
        case 125: selectedIndex = min(max(0, items.count - 1), selectedIndex + 1); needsDisplay = true
        case 126: selectedIndex = max(0, selectedIndex - 1); needsDisplay = true
        case 36, 76: if items.indices.contains(selectedIndex) { onActivate?(items[selectedIndex]) }
        case 51, 117: if items.indices.contains(selectedIndex), items[selectedIndex].kind == .target { onRemoveTarget?(items[selectedIndex].targetID) }
        default: super.keyDown(with: event)
        }
    }
    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let panel = NSRect(x: max(24, bounds.midX - 340), y: max(28, bounds.height * 0.12), width: min(680, bounds.width - 48), height: min(bounds.height - 56, max(150, CGFloat(items.count) * 42 + 80)))
        guard panel.contains(p) else { onDismiss?(); return }
        let index = Int((p.y - panel.minY - 42) / 42)
        guard items.indices.contains(index) else { return }
        selectedIndex = index; needsDisplay = true; onActivate?(items[index])
    }
    private func tone(_ state: TargetDiscovery.State) -> NSColor { switch state { case .online: .systemGreen; case .unreachable: .systemOrange; case .inactive: NSColor(calibratedWhite: 0.68, alpha: 1) } }
    private func text(_ value: String, _ rect: NSRect, _ size: CGFloat, _ weight: NSFont.Weight, _ color: NSColor) { let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail; NSAttributedString(string: value, attributes: [.font: NSFont.monospacedSystemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: paragraph]).draw(in: rect) }
}
