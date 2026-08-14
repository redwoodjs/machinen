import AppKit

struct PaletteCommand {
    enum Space: Equatable, Hashable {
        case workspaceOverview
        case workspace
        case terminal

        var title: String {
            switch self {
            case .workspaceOverview: "WORKSPACE OVERVIEW"
            case .workspace: "WORKSPACE"
            case .terminal: "TERMINAL"
            }
        }
    }

    enum ID: Equatable {
        case newWorkspace
        case registerTarget
        case browseTargetSessions
        case newTerminalInWorkspace
        case back
        case renameWorkspace
        case changeWorkspaceLocation
        case chooseLocalWorkspaceLocation
        case browseLocalWorkspaceLocation
        case chooseRemoteWorkspaceLocation
        case useWorkspaceLocation
        case openWorkspaceLocation
        case useSSHHost
        case toggleOverview
        case newTerminal
        case openSelectionWith
        case selectionOpener(String)
        case attachSession
        case reconnectSession
        case detachSession
        case disconnectSession
        case restartSession
        case stopSession
        case stopWorkspace
        case closeSession
        case closeWorkspace
        case reconnectAvailableSession
        case showDiagnostics
        case registeredCommandGroup(String, Space)
        case registeredCommand(String)
        case sharedWorkspaceBrowserAction(Int)
        case createShell
        case runCommand
        case chooseProject
    }

    let id: ID
    let title: String
    let shortcut: String
    let space: Space?
    let location: WorkspaceLocation?
    let workspaceID: String?
    let sshHost: String?
    let completion: String?

    init(
        id: ID,
        title: String,
        shortcut: String,
        space: Space? = nil,
        location: WorkspaceLocation? = nil,
        workspaceID: String? = nil,
        sshHost: String? = nil,
        completion: String? = nil
    ) {
        self.id = id
        self.title = title
        self.shortcut = shortcut
        self.space = space
        self.location = location
        self.workspaceID = workspaceID
        self.sshHost = sshHost
        self.completion = completion
    }
}

final class CommandPaletteView: NSView {
    private enum Metrics {
        static let panelWidth: CGFloat = 650
        static let panelHeight: CGFloat = 414
        static let headerHeight: CGFloat = 30
        static let searchHeight: CGFloat = 50
        static let sectionHeight: CGFloat = 22
        static let rowHeight: CGFloat = 34
        static let footerHeight: CGFloat = 28
        static let panelRadius: CGFloat = 8
    }

    private enum CommandListRowKind {
        case section(PaletteCommand.Space)
        case command(Int)
    }

    private struct CommandListRow {
        let kind: CommandListRowKind
        let minY: CGFloat
        let height: CGFloat

        var maxY: CGFloat { minY + height }
    }

    private let heading: String
    private let context: String
    private let placeholder: String
    private let defaultFooter: String
    private let acceptsFreeform: Bool
    private var commands: [PaletteCommand]
    private var query: String
    private var selectedIndex: Int
    private var replaceInitialQueryOnType: Bool
    private var selectionWasMoved = false
    private var statusMessage: String?

    var onDismiss: (() -> Void)?
    var onBack: (() -> Void)?
    var onRun: ((PaletteCommand) -> Void)?
    var onSubmit: ((String) -> Void)?
    var onQueryChange: ((String) -> Void)?

    var currentQuery: String { query }
    var displayedContext: String { context }
    var displayedSpaces: [PaletteCommand.Space] {
        filteredCommands.reduce(into: []) { spaces, command in
            guard let space = command.space, spaces.last != space else { return }
            spaces.append(space)
        }
    }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(
        frame: NSRect,
        heading: String = "MACHINEN COMMANDS",
        context: String,
        placeholder: String = "Type a command…",
        defaultFooter: String = "↑↓ select    return run    esc dismiss",
        commands: [PaletteCommand],
        acceptsFreeform: Bool = false,
        initialQuery: String = "",
        initialSelectedIndex: Int = 0
    ) {
        self.heading = heading
        self.context = context
        self.placeholder = placeholder
        self.defaultFooter = defaultFooter
        self.commands = commands
        self.acceptsFreeform = acceptsFreeform
        query = initialQuery
        selectedIndex = min(max(0, initialSelectedIndex), max(0, commands.count - 1))
        replaceInitialQueryOnType = !initialQuery.isEmpty
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
        case 48:
            completeSelectedCommand()
        case 51:
            if replaceInitialQueryOnType {
                query = ""
                queryChanged()
            } else if !query.isEmpty {
                query.removeLast()
                queryChanged()
            } else {
                onBack?()
            }
        default:
            if let characters = event.characters, !characters.isEmpty,
               characters.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
            {
                if replaceInitialQueryOnType { query = "" }
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

        let commands = filteredCommands
        let list = commandListRect(in: panel)
        guard list.contains(point) else { return }
        let rows = commandListRows(for: commands)
        let offset = commandListOffset(rows: rows, availableHeight: list.height)
        let listY = point.y - list.minY + offset
        guard let row = rows.first(where: { listY >= $0.minY && listY < $0.maxY }),
              case .command(let index) = row.kind,
              commands.indices.contains(index)
        else { return }
        selectedIndex = index
        needsDisplay = true
        onRun?(commands[index])
    }

    func showStatus(_ message: String) {
        statusMessage = message
        needsDisplay = true
    }

    func replaceCommands(_ commands: [PaletteCommand]) {
        self.commands = commands
        selectedIndex = 0
        selectionWasMoved = false
        needsDisplay = true
    }

    private var filteredCommands: [PaletteCommand] {
        // A seeded path such as `~/` establishes where browsing starts; it
        // should not hide recent choices until the user starts typing.
        let filterQuery = replaceInitialQueryOnType ? "" : query
        let needle = filterQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return commands }
        return commands.enumerated()
            .compactMap { index, command -> (PaletteCommand, Int, Int, Int)? in
                let searchable = "\(command.title) \(command.shortcut) \(command.space?.title ?? "")"
                    .lowercased()
                guard let score = fuzzyScore(needle: needle, in: searchable) else { return nil }
                let sectionIndex = commands.firstIndex { $0.space == command.space } ?? index
                return (command, score, index, sectionIndex)
            }
            .sorted { left, right in
                if left.3 != right.3 { return left.3 < right.3 }
                return left.1 == right.1 ? left.2 < right.2 : left.1 > right.1
            }
            .map(\.0)
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
            "\(heading)  ·  \(context)",
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

        let text = query.isEmpty ? placeholder : query
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
        let list = commandListRect(in: panel)
        if commands.isEmpty {
            drawText(
                acceptsFreeform ? "Type a value above, then press Return." : "No matching commands",
                in: NSRect(x: panel.minX + 14, y: list.minY + 16, width: panel.width - 28, height: 18),
                font: .monospacedSystemFont(ofSize: 12, weight: .regular),
                color: NSColor(calibratedWhite: 0.48, alpha: 1)
            )
            return
        }

        let rows = commandListRows(for: commands)
        let offset = commandListOffset(rows: rows, availableHeight: list.height)
        for listRow in rows {
            let row = NSRect(
                x: panel.minX + 7,
                y: list.minY + listRow.minY - offset,
                width: panel.width - 14,
                height: listRow.height
            )
            guard row.minY >= list.minY else { continue }
            guard row.maxY <= list.maxY else { break }

            switch listRow.kind {
            case .section(let space):
                drawText(
                    space.title,
                    in: NSRect(x: row.minX + 9, y: row.minY + 7, width: row.width - 18, height: 12),
                    font: .monospacedSystemFont(ofSize: 9, weight: .semibold),
                    color: NSColor(calibratedWhite: 0.48, alpha: 1)
                )
            case .command(let index):
                let command = commands[index]
                if index == selectedIndex {
                    NSColor(calibratedWhite: 0.20, alpha: 1).setFill()
                    NSBezierPath(roundedRect: row, xRadius: 4, yRadius: 4).fill()
                }
                drawText(
                    command.title,
                    in: NSRect(x: row.minX + 9, y: row.minY + 10, width: row.width - 150, height: 16),
                    font: .monospacedSystemFont(ofSize: 11, weight: .regular),
                    color: NSColor(
                        calibratedWhite: index == selectedIndex ? 0.96 : 0.76,
                        alpha: 1
                    )
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
    }

    private func commandListRect(in panel: NSRect) -> NSRect {
        NSRect(
            x: panel.minX,
            y: panel.minY + Metrics.headerHeight + Metrics.searchHeight,
            width: panel.width,
            height: panel.height - Metrics.headerHeight - Metrics.searchHeight - Metrics.footerHeight
        )
    }

    private func commandListRows(for commands: [PaletteCommand]) -> [CommandListRow] {
        var result: [CommandListRow] = []
        var y: CGFloat = 0
        var previousSpace: PaletteCommand.Space?
        for (index, command) in commands.enumerated() {
            if let space = command.space, space != previousSpace {
                result.append(CommandListRow(
                    kind: .section(space),
                    minY: y,
                    height: Metrics.sectionHeight
                ))
                y += Metrics.sectionHeight
            }
            result.append(CommandListRow(
                kind: .command(index),
                minY: y,
                height: Metrics.rowHeight
            ))
            y += Metrics.rowHeight
            previousSpace = command.space
        }
        return result
    }

    private func commandListOffset(rows: [CommandListRow], availableHeight: CGFloat) -> CGFloat {
        guard let selectedRowIndex = rows.firstIndex(where: {
            if case .command(let index) = $0.kind { return index == selectedIndex }
            return false
        }) else { return 0 }

        var startIndex = selectedRowIndex
        let selectedMaxY = rows[selectedRowIndex].maxY
        while startIndex > 0,
              selectedMaxY - rows[startIndex - 1].minY <= availableHeight
        {
            startIndex -= 1
        }
        return rows[startIndex].minY
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
            statusMessage ?? defaultFooter,
            in: NSRect(x: footer.minX + 13, y: footer.minY + 8, width: footer.width - 26, height: 14),
            font: .monospacedSystemFont(ofSize: 9, weight: .regular),
            color: NSColor(calibratedWhite: statusMessage == nil ? 0.43 : 0.72, alpha: 1)
        )
    }

    private func moveSelection(by delta: Int) {
        let commands = filteredCommands
        guard !commands.isEmpty else { return }
        selectedIndex = min(max(0, selectedIndex + delta), commands.count - 1)
        selectionWasMoved = true
        statusMessage = nil
        needsDisplay = true
    }

    private func runSelectedCommand() {
        let commands = filteredCommands
        if acceptsFreeform {
            if (selectionWasMoved || commands.count == 1),
               commands.indices.contains(selectedIndex)
            {
                onRun?(commands[selectedIndex])
                return
            }
            let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty {
                onSubmit?(value)
                return
            }
            if commands.indices.contains(selectedIndex) {
                onRun?(commands[selectedIndex])
                return
            }
            showStatus("Enter a value first")
            return
        }

        guard commands.indices.contains(selectedIndex) else { return }
        onRun?(commands[selectedIndex])
    }

    private func completeSelectedCommand() {
        let commands = filteredCommands
        guard commands.indices.contains(selectedIndex),
              let completion = commands[selectedIndex].completion
        else { return }
        query = completion
        queryChanged()
    }

    private func queryChanged() {
        selectedIndex = 0
        selectionWasMoved = false
        replaceInitialQueryOnType = false
        statusMessage = nil
        onQueryChange?(query)
        needsDisplay = true
    }

    private func fuzzyScore(needle: String, in haystack: String) -> Int? {
        let wanted = Array(needle)
        let available = Array(haystack)
        var cursor = 0
        var previousMatch = -2
        var firstMatch = -1
        var score = haystack.contains(needle) ? 1_000 : 0
        for character in wanted {
            while cursor < available.count, available[cursor] != character {
                cursor += 1
            }
            guard cursor < available.count else { return nil }
            if firstMatch < 0 { firstMatch = cursor }
            score += cursor == previousMatch + 1 ? 12 : 2
            if cursor == 0 || available[cursor - 1].isWhitespace
                || "-_/.:".contains(available[cursor - 1])
            {
                score += 6
            }
            previousMatch = cursor
            cursor += 1
        }
        return score - max(0, firstMatch)
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
