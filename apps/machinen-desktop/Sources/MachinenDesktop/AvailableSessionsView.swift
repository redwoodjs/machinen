import AppKit

struct AvailableSessionItem {
    enum AttachmentState {
        case attached
        case detached
    }

    let session: AvailableTerminalSession
    let attachmentState: AttachmentState
    let localClientID: UInt64?

    var displayName: String {
        guard let name = session.name, !name.isEmpty else { return session.id }
        return name
    }

    var isAttached: Bool { attachmentState == .attached }
    var localClient: AttachedTerminalClient? {
        guard let localClientID else { return nil }
        return session.clients.first { $0.id == localClientID }
    }
    var hasControl: Bool { localClient?.writer == true && localClient?.resize == true }
    var canTakeControl: Bool {
        isAttached && session.clientControlAvailable && localClient != nil && !hasControl
    }
    var attachmentDescription: String {
        if hasControl { return "CONTROL" }
        if isAttached { return session.clientControlAvailable ? "VIEWING" : "ATTACHED" }
        return "NOT ATTACHED"
    }
    var stateDescription: String {
        guard session.clientControlAvailable else { return session.state }
        let count = session.clients.count
        return "\(session.state) · \(count) \(count == 1 ? "client" : "clients")"
    }
    var clientsDescription: String? {
        guard session.clientControlAvailable else { return nil }
        if session.clients.isEmpty { return "No clients connected" }
        return session.clients.map { client in
            let role = client.writer && client.resize ? "CONTROL" : (client.readOnly ? "READ ONLY" : "VIEWING")
            let local = client.id == localClientID ? " · THIS DESKTOP" : ""
            return "\(role): \(client.name)\(local)"
        }.joined(separator: "    ")
    }
    var primaryActionTitle: String {
        if canTakeControl { return "Take Control" }
        return isAttached ? "Detach" : "Attach"
    }
}

final class AvailableSessionsView: NSView {
    private enum Metrics {
        static let panelWidth: CGFloat = 720
        static let headerHeight: CGFloat = 66
        static let rowHeight: CGFloat = 78
        static let footerHeight: CGFloat = 34
        static let maximumVisibleRows = 7
    }

    var workspaceName = "workspace" {
        didSet { needsDisplay = true }
    }
    var machineName = "this Mac" {
        didSet { needsDisplay = true }
    }
    var items: [AvailableSessionItem] = [] {
        didSet {
            selectedIndex = min(selectedIndex, max(0, items.count - 1))
            needsDisplay = true
        }
    }
    var isLoading = false {
        didSet { needsDisplay = true }
    }
    var errorMessage: String? {
        didSet { needsDisplay = true }
    }
    var onDismiss: (() -> Void)?
    var onReconnect: ((String) -> Void)?
    var onDisconnect: ((String) -> Void)?
    var onTakeControl: ((String) -> Void)?
    var onKill: ((String) -> Void)?
    var onRefresh: (() -> Void)?

    private var selectedIndex = 0

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        autoresizingMask = [.width, .height]
        wantsLayer = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Terminal sessions")
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
            "SESSIONS · \(workspaceName)",
            in: NSRect(x: panel.minX + 18, y: panel.minY + 14, width: panel.width - 36, height: 18),
            font: .monospacedSystemFont(ofSize: 12, weight: .semibold),
            color: NSColor(calibratedWhite: 0.91, alpha: 1)
        )
        drawText(
            summary,
            in: NSRect(x: panel.minX + 18, y: panel.minY + 36, width: panel.width - 36, height: 16),
            font: .monospacedSystemFont(ofSize: 10, weight: .regular),
            color: NSColor(calibratedWhite: errorMessage == nil ? 0.52 : 0.74, alpha: 1)
        )

        let visible = visibleRange
        if items.isEmpty, !isLoading {
            drawText(
                errorMessage == nil
                    ? "No sessions were found in this workspace."
                    : "Press R to try again.",
                in: NSRect(
                    x: panel.minX + 18,
                    y: panel.minY + Metrics.headerHeight + 18,
                    width: panel.width - 36,
                    height: 18
                ),
                font: .monospacedSystemFont(ofSize: 11, weight: .regular),
                color: NSColor(calibratedWhite: 0.48, alpha: 1)
            )
        } else {
            for index in visible {
                drawRow(items[index], index: index, in: rowRect(index: index, panel: panel))
            }
        }

        drawText(
            "↑↓ select    return attach/detach/take control    delete/⌘W kill    R refresh    esc close",
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
            performPrimaryAction()
        case 51, 117:
            killSelected()
        case 15:
            onRefresh?()
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
        for index in visibleRange {
            let row = rowRect(index: index, panel: panel)
            guard row.contains(point) else { continue }
            selectedIndex = index
            needsDisplay = true
            if primaryActionRect(in: row).contains(point) {
                performPrimaryAction()
            } else if killRect(in: row).contains(point) {
                killSelected()
            }
            return
        }
    }

    private var summary: String {
        if isLoading { return "Looking for persistent sessions on \(machineName)…" }
        if let errorMessage { return errorMessage }
        let count = items.count
        let attachedCount = items.count(where: \.isAttached)
        let clientCount = items.reduce(0) { $0 + $1.session.clients.count }
        return "\(count) \(count == 1 ? "session" : "sessions") on \(machineName) · \(attachedCount) attached · \(clientCount) connected clients."
    }

    private var visibleCapacity: Int {
        let chrome = Metrics.headerHeight + Metrics.footerHeight + 96
        return max(
            1,
            min(Metrics.maximumVisibleRows, Int(floor((bounds.height - chrome) / Metrics.rowHeight)))
        )
    }

    private var visibleRange: Range<Int> {
        let capacity = visibleCapacity
        let count = min(capacity, items.count)
        let start = min(
            max(0, selectedIndex - capacity + 1),
            max(0, items.count - count)
        )
        return start..<(start + count)
    }

    private func performPrimaryAction() {
        guard items.indices.contains(selectedIndex) else { return }
        let item = items[selectedIndex]
        if item.canTakeControl {
            onTakeControl?(item.session.id)
        } else if item.isAttached {
            onDisconnect?(item.session.id)
        } else {
            onReconnect?(item.session.id)
        }
    }

    func killSelected() {
        guard items.indices.contains(selectedIndex) else { return }
        onKill?(items[selectedIndex].session.id)
    }

    private func panelRect() -> NSRect {
        let width = min(Metrics.panelWidth, max(440, bounds.width - 48))
        let rows = max(1, min(visibleCapacity, items.count))
        let height = Metrics.headerHeight + CGFloat(rows) * Metrics.rowHeight + Metrics.footerHeight
        return NSRect(
            x: bounds.midX - width / 2,
            y: max(28, bounds.height * 0.14),
            width: width,
            height: height
        )
    }

    private func rowRect(index: Int, panel: NSRect) -> NSRect {
        let visible = visibleRange
        return NSRect(
            x: panel.minX + 8,
            y: panel.minY + Metrics.headerHeight
                + CGFloat(index - visible.lowerBound) * Metrics.rowHeight,
            width: panel.width - 16,
            height: Metrics.rowHeight
        )
    }

    private func drawRow(_ item: AvailableSessionItem, index: Int, in row: NSRect) {
        if index == selectedIndex {
            NSColor(calibratedWhite: 0.18, alpha: 1).setFill()
            NSBezierPath(roundedRect: row, xRadius: 5, yRadius: 5).fill()
        }
        drawText(
            item.displayName,
            in: NSRect(x: row.minX + 10, y: row.minY + 10, width: row.width - 248, height: 18),
            font: .monospacedSystemFont(ofSize: 12, weight: .medium),
            color: NSColor(calibratedWhite: 0.91, alpha: 1)
        )
        drawAttachmentBadge(
            item,
            in: NSRect(x: row.minX + 10, y: row.minY + 32, width: 92, height: 17)
        )
        drawText(
            "\(item.stateDescription) · \(item.session.workingDirectory)",
            in: NSRect(x: row.minX + 112, y: row.minY + 32, width: row.width - 350, height: 16),
            font: .monospacedSystemFont(ofSize: 10, weight: .regular),
            color: NSColor(calibratedWhite: 0.53, alpha: 1)
        )
        if let clients = item.clientsDescription {
            drawText(
                clients,
                in: NSRect(x: row.minX + 10, y: row.minY + 58, width: row.width - 20, height: 15),
                font: .monospacedSystemFont(ofSize: 9, weight: .regular),
                color: NSColor(calibratedWhite: 0.67, alpha: 1)
            )
        }
        drawButton(killRect(in: row), title: "Kill", emphasized: false)
        drawButton(
            primaryActionRect(in: row),
            title: item.primaryActionTitle,
            emphasized: true
        )
    }

    private func primaryActionRect(in row: NSRect) -> NSRect {
        NSRect(x: row.maxX - 132, y: row.minY + 23, width: 120, height: 32)
    }

    private func killRect(in row: NSRect) -> NSRect {
        NSRect(x: row.maxX - 216, y: row.minY + 23, width: 72, height: 32)
    }

    private func drawAttachmentBadge(_ item: AvailableSessionItem, in rect: NSRect) {
        let fill = item.isAttached
            ? NSColor(calibratedRed: 0.13, green: 0.33, blue: 0.20, alpha: 1)
            : NSColor(calibratedRed: 0.36, green: 0.24, blue: 0.10, alpha: 1)
        let stroke = item.isAttached
            ? NSColor(calibratedRed: 0.28, green: 0.67, blue: 0.40, alpha: 1)
            : NSColor(calibratedRed: 0.73, green: 0.48, blue: 0.20, alpha: 1)
        fill.setFill()
        stroke.setStroke()
        let path = NSBezierPath(roundedRect: rect, xRadius: 4, yRadius: 4)
        path.fill()
        path.lineWidth = 1
        path.stroke()
        drawText(
            item.attachmentDescription,
            in: NSRect(x: rect.minX + 3, y: rect.minY + 3, width: rect.width - 6, height: 12),
            font: .monospacedSystemFont(ofSize: 8, weight: .semibold),
            color: NSColor(calibratedWhite: 0.92, alpha: 1),
            alignment: .center
        )
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
            color: emphasized
                ? NSColor(calibratedWhite: 0.08, alpha: 1)
                : NSColor(calibratedWhite: 0.80, alpha: 1),
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
