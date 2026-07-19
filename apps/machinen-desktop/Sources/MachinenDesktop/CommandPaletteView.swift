import AppKit

struct PaletteCommand {
    enum ID {
        case toggleOverview
        case newTerminal
        case focusSession
        case openPreview
        case reviewChanges
        case detachSession
        case restartSession
        case stopSession
        case inspectWorkspace
    }

    let id: ID
    let title: String
    let shortcut: String
}

final class CommandPaletteView: NSView {
    private enum Metrics {
        static let panelWidth: CGFloat = 650
        static let panelHeight: CGFloat = 414
        static let headerHeight: CGFloat = 30
        static let searchHeight: CGFloat = 50
        static let rowHeight: CGFloat = 34
        static let footerHeight: CGFloat = 28
        static let panelRadius: CGFloat = 8
    }

    private let context: String
    private let commands: [PaletteCommand]
    private var query = ""
    private var selectedIndex = 0
    private var statusMessage: String?

    var onDismiss: (() -> Void)?
    var onRun: ((PaletteCommand) -> Void)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(frame: NSRect, context: String, commands: [PaletteCommand]) {
        self.context = context
        self.commands = commands
        super.init(frame: frame)
        autoresizingMask = [.width, .height]
        wantsLayer = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Machinen commands")
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
        NSColor(calibratedWhite: 0.63, alpha: 1).setStroke()
        let panelPath = NSBezierPath(
            roundedRect: panel,
            xRadius: Metrics.panelRadius,
            yRadius: Metrics.panelRadius
        )
        panelPath.fill()
        panelPath.lineWidth = 1
        panelPath.stroke()

        drawHeader(in: panel)
        drawSearch(in: panel)
        drawCommands(in: panel)
        drawFooter(in: panel)
    }

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .control, .option])
        guard modifiers.isEmpty else {
            super.keyDown(with: event)
            return
        }

        switch event.keyCode {
        case 53:
            onDismiss?()
        case 125:
            moveSelection(by: 1)
        case 126:
            moveSelection(by: -1)
        case 36, 76:
            runSelectedCommand()
        case 51:
            if !query.isEmpty {
                query.removeLast()
                queryChanged()
            }
        default:
            if let characters = event.characters, !characters.isEmpty,
               characters.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
            {
                query += characters
                queryChanged()
            } else {
                super.keyDown(with: event)
            }
        }
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let panel = panelRect()
        guard panel.contains(point) else {
            onDismiss?()
            return
        }

        let rowsTop = panel.minY + Metrics.headerHeight + Metrics.searchHeight
        let row = Int(floor((point.y - rowsTop) / Metrics.rowHeight))
        let filtered = filteredCommands
        guard row >= 0, filtered.indices.contains(row) else { return }
        selectedIndex = row
        needsDisplay = true
        onRun?(filtered[row])
    }

    func showStatus(_ message: String) {
        statusMessage = message
        needsDisplay = true
    }

    private var filteredCommands: [PaletteCommand] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return commands }
        return commands.filter {
            $0.title.lowercased().contains(needle) || $0.shortcut.lowercased().contains(needle)
        }
    }

    private func panelRect() -> NSRect {
        let width = min(Metrics.panelWidth, max(320, bounds.width - 48))
        let height = min(Metrics.panelHeight, max(300, bounds.height - 48))
        return NSRect(
            x: bounds.midX - width / 2,
            y: max(24, bounds.height * 0.12),
            width: width,
            height: height
        )
    }

    private func drawHeader(in panel: NSRect) {
        drawText(
            "MACHINEN COMMANDS  ·  \(context)",
            in: NSRect(
                x: panel.minX + 13,
                y: panel.minY + 9,
                width: panel.width - 26,
                height: 14
            ),
            font: .monospacedSystemFont(ofSize: 9, weight: .medium),
            color: NSColor(calibratedWhite: 0.53, alpha: 1)
        )
    }

    private func drawSearch(in panel: NSRect) {
        let rect = NSRect(
            x: panel.minX,
            y: panel.minY + Metrics.headerHeight,
            width: panel.width,
            height: Metrics.searchHeight
        )
        NSColor(calibratedWhite: 0.25, alpha: 1).setStroke()
        let divider = NSBezierPath()
        divider.move(to: NSPoint(x: rect.minX, y: rect.maxY - 0.5))
        divider.line(to: NSPoint(x: rect.maxX, y: rect.maxY - 0.5))
        divider.lineWidth = 1
        divider.stroke()

        let text = query.isEmpty ? "Type a command…" : query
        let color = query.isEmpty
            ? NSColor(calibratedWhite: 0.42, alpha: 1)
            : NSColor(calibratedWhite: 0.93, alpha: 1)
        drawText(
            ">  \(text)\(query.isEmpty ? "" : "_")",
            in: NSRect(x: rect.minX + 14, y: rect.minY + 14, width: rect.width - 28, height: 22),
            font: .monospacedSystemFont(ofSize: 15, weight: .regular),
            color: color
        )
    }

    private func drawCommands(in panel: NSRect) {
        let commands = filteredCommands
        let rowsTop = panel.minY + Metrics.headerHeight + Metrics.searchHeight
        if commands.isEmpty {
            drawText(
                "No matching commands",
                in: NSRect(x: panel.minX + 14, y: rowsTop + 16, width: panel.width - 28, height: 18),
                font: .monospacedSystemFont(ofSize: 12, weight: .regular),
                color: NSColor(calibratedWhite: 0.48, alpha: 1)
            )
            return
        }

        for (index, command) in commands.enumerated() {
            let row = NSRect(
                x: panel.minX + 7,
                y: rowsTop + CGFloat(index) * Metrics.rowHeight,
                width: panel.width - 14,
                height: Metrics.rowHeight
            )
            guard row.maxY <= panel.maxY - Metrics.footerHeight else { break }

            if index == selectedIndex {
                NSColor(calibratedWhite: 0.20, alpha: 1).setFill()
                NSBezierPath(roundedRect: row, xRadius: 4, yRadius: 4).fill()
            }
            drawText(
                command.title,
                in: NSRect(x: row.minX + 9, y: row.minY + 10, width: row.width - 150, height: 16),
                font: .monospacedSystemFont(ofSize: 11, weight: .regular),
                color: NSColor(calibratedWhite: index == selectedIndex ? 0.96 : 0.76, alpha: 1)
            )
            drawText(
                command.shortcut,
                in: NSRect(x: row.maxX - 140, y: row.minY + 10, width: 130, height: 16),
                font: .monospacedSystemFont(ofSize: 10, weight: .regular),
                color: NSColor(calibratedWhite: 0.43, alpha: 1),
                alignment: .right
            )
        }
    }

    private func drawFooter(in panel: NSRect) {
        let footer = NSRect(
            x: panel.minX,
            y: panel.maxY - Metrics.footerHeight,
            width: panel.width,
            height: Metrics.footerHeight
        )
        NSColor(calibratedWhite: 0.25, alpha: 1).setStroke()
        let divider = NSBezierPath()
        divider.move(to: NSPoint(x: footer.minX, y: footer.minY + 0.5))
        divider.line(to: NSPoint(x: footer.maxX, y: footer.minY + 0.5))
        divider.lineWidth = 1
        divider.stroke()

        drawText(
            statusMessage ?? "↑↓ select    return run    esc dismiss",
            in: NSRect(x: footer.minX + 13, y: footer.minY + 8, width: footer.width - 26, height: 14),
            font: .monospacedSystemFont(ofSize: 9, weight: .regular),
            color: NSColor(calibratedWhite: statusMessage == nil ? 0.43 : 0.72, alpha: 1)
        )
    }

    private func moveSelection(by delta: Int) {
        let commands = filteredCommands
        guard !commands.isEmpty else { return }
        selectedIndex = min(max(0, selectedIndex + delta), commands.count - 1)
        statusMessage = nil
        needsDisplay = true
    }

    private func runSelectedCommand() {
        let commands = filteredCommands
        guard commands.indices.contains(selectedIndex) else { return }
        onRun?(commands[selectedIndex])
    }

    private func queryChanged() {
        selectedIndex = 0
        statusMessage = nil
        needsDisplay = true
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
