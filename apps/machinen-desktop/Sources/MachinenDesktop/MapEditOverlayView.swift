import AppKit

struct WorkspaceCreationSource {
    let title: String
    let detail: String
    let location: WorkspaceLocation
    let isDisabled: Bool

    init(
        title: String,
        detail: String,
        location: WorkspaceLocation,
        isDisabled: Bool = false
    ) {
        self.title = title
        self.detail = detail
        self.location = location
        self.isDisabled = isDisabled
    }
}

final class AddWorkspaceCardView: NSView {
    private enum Phase: Equatable { case ready, location, name }
    private var phase: Phase = .ready
    private var sources: [WorkspaceCreationSource] = []
    private var selectedLocationIndex = -1
    private var locationQuery = ""
    private var workspaceName = ""
    var onCancel: (() -> Void)?
    var onLeave: (() -> Void)?
    var onCreate: ((WorkspaceLocation, String) -> Void)?

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { true }

    var displayedSearchQuery: String { locationQuery }
    var displayedPanelFrame: NSRect { panelRect() }
    var isChoosingLocation: Bool { phase == .location }
    var selectedSourceTitle: String? {
        sources.indices.contains(selectedLocationIndex) ? sources[selectedLocationIndex].title : nil
    }
    var disabledSourceTitles: [String] { sources.filter(\.isDisabled).map(\.title) }

    func beginCreation(sources: [WorkspaceCreationSource]) {
        self.sources = sources
        locationQuery = ""
        selectedLocationIndex = filteredSourceIndexes.first ?? -1
        phase = .location
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemBlue.withAlphaComponent(0.10).setFill()
        bounds.fill()
        let tilePath = NSBezierPath(
            roundedRect: bounds.insetBy(dx: 2, dy: 2),
            xRadius: 16,
            yRadius: 16
        )
        tilePath.setLineDash([9, 7], count: 2, phase: 0)
        NSColor.systemBlue.withAlphaComponent(0.90).setStroke()
        tilePath.lineWidth = 3
        tilePath.stroke()

        let panel = panelRect()
        NSColor(calibratedWhite: 0.09, alpha: 0.96).setFill()
        NSColor.systemBlue.withAlphaComponent(0.86).setStroke()
        let panelPath = NSBezierPath(roundedRect: panel, xRadius: 8, yRadius: 8)
        panelPath.fill()
        panelPath.lineWidth = 2
        panelPath.stroke()

        drawText(
            phase == .name ? "NEW WORKSPACE  ·  NAME" : "NEW WORKSPACE  ·  LOCATION",
            in: NSRect(x: panel.minX + 13, y: panel.minY + 9, width: panel.width - 26, height: 14),
            size: 9,
            color: NSColor.systemBlue
        )

        let search = searchRect(in: panel)
        drawDivider(y: search.maxY - 0.5, panel: panel)
        let value = phase == .name ? workspaceName : locationQuery
        let placeholder = phase == .name ? "Name this workspace…" : "Search workspace locations…"
        drawText(
            ">  \(value.isEmpty ? placeholder : value)\(value.isEmpty ? "" : "_")",
            in: NSRect(x: search.minX + 14, y: search.minY + 14, width: search.width - 28, height: 22),
            size: 15,
            color: value.isEmpty
                ? NSColor(calibratedWhite: 0.42, alpha: 1)
                : NSColor(calibratedWhite: 0.93, alpha: 1)
        )

        if phase == .location {
            drawSources(in: panel)
        } else if sources.indices.contains(selectedLocationIndex) {
            drawText(
                sources[selectedLocationIndex].detail,
                in: NSRect(x: panel.minX + 14, y: search.maxY + 18, width: panel.width - 28, height: 20),
                size: 11,
                color: NSColor(calibratedWhite: 0.68, alpha: 1)
            )
        }

        let footer = footerRect(in: panel)
        drawDivider(y: footer.minY + 0.5, panel: panel)
        let help = phase == .name
            ? "return create    esc cancel"
            : "type to search    ↑↓ select    return continue    esc cancel"
        drawText(
            help,
            in: NSRect(x: footer.minX + 13, y: footer.minY + 8, width: footer.width - 26, height: 14),
            size: 9,
            color: NSColor(calibratedWhite: 0.43, alpha: 1)
        )
    }

    override func keyDown(with event: NSEvent) {
        switch phase {
        case .ready:
            if event.keyCode == 53 { onCancel?() }
        case .location:
            switch event.keyCode {
            case 53:
                onCancel?()
            case 125, 126:
                // The desktop shortcut monitor owns arrow input.
                return
            case 36, 76:
                continueToName()
            case 51:
                if !locationQuery.isEmpty {
                    locationQuery.removeLast()
                    sourceQueryChanged()
                }
            default:
                if let text = event.characters, !text.isEmpty,
                   text.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
                {
                    locationQuery += text
                    sourceQueryChanged()
                } else {
                    super.keyDown(with: event)
                }
            }
        case .name:
            switch event.keyCode {
            case 53: onCancel?()
            case 51: if !workspaceName.isEmpty { workspaceName.removeLast(); needsDisplay = true }
            case 36, 76:
                let name = workspaceName.trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty, sources.indices.contains(selectedLocationIndex) {
                    onCreate?(sources[selectedLocationIndex].location, name)
                }
            default:
                if let text = event.characters,
                   text.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
                {
                    workspaceName += text
                    needsDisplay = true
                }
            }
        }
    }

    func performShortcut(_ action: DesktopShortcutAction) -> Bool {
        switch action {
        case .selectDown, .selectRight:
            if phase == .location { moveSourceSelection(by: 1) }
            return true
        case .selectUp, .selectLeft:
            if phase == .location { moveSourceSelection(by: -1) }
            return true
        case .enter:
            if phase == .location {
                continueToName()
            } else if phase == .name {
                let name = workspaceName.trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty, sources.indices.contains(selectedLocationIndex) {
                    onCreate?(sources[selectedLocationIndex].location, name)
                }
            }
            return true
        case .leave:
            onLeave?()
            return true
        default:
            return false
        }
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        guard phase == .location else { return }
        let point = convert(event.locationInWindow, from: nil)
        let visible = visibleSourceIndexes()
        for (rowIndex, sourceIndex) in visible.enumerated()
            where sourceRow(rowIndex, panel: panelRect()).contains(point)
        {
            guard !sources[sourceIndex].isDisabled else {
                NSSound.beep()
                return
            }
            selectedLocationIndex = sourceIndex
            needsDisplay = true
            if event.clickCount > 1 { continueToName() }
            return
        }
    }

    private var filteredSourceIndexes: [Int] {
        let needle = locationQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return Array(sources.indices) }
        return sources.indices.filter {
            "\(sources[$0].title) \(sources[$0].detail)".lowercased().contains(needle)
        }
    }

    private func sourceQueryChanged() {
        selectedLocationIndex = filteredSourceIndexes.first ?? -1
        needsDisplay = true
    }

    private func moveSourceSelection(by delta: Int) {
        let filtered = filteredSourceIndexes
        guard !filtered.isEmpty else { return }
        let current = filtered.firstIndex(of: selectedLocationIndex) ?? 0
        selectedLocationIndex = filtered[min(max(0, current + delta), filtered.count - 1)]
        needsDisplay = true
    }

    private func continueToName() {
        guard sources.indices.contains(selectedLocationIndex),
              !sources[selectedLocationIndex].isDisabled
        else {
            NSSound.beep()
            return
        }
        phase = .name
        needsDisplay = true
    }

    private func visibleSourceIndexes() -> [Int] {
        let filtered = filteredSourceIndexes
        guard filtered.count > 7 else { return filtered }
        let selected = filtered.firstIndex(of: selectedLocationIndex) ?? 0
        let start = min(max(0, selected - 3), filtered.count - 7)
        return Array(filtered[start..<start + 7])
    }

    private func panelRect() -> NSRect {
        let width = min(650, max(320, bounds.width - 48))
        let height = min(414, max(300, bounds.height - 48))
        return NSRect(
            x: bounds.midX - width / 2,
            y: bounds.midY - height / 2,
            width: width,
            height: height
        )
    }

    private func searchRect(in panel: NSRect) -> NSRect {
        NSRect(x: panel.minX, y: panel.minY + 30, width: panel.width, height: 50)
    }

    private func footerRect(in panel: NSRect) -> NSRect {
        NSRect(x: panel.minX, y: panel.maxY - 28, width: panel.width, height: 28)
    }

    private func sourceRow(_ index: Int, panel: NSRect) -> NSRect {
        NSRect(x: panel.minX + 7, y: panel.minY + 86 + CGFloat(index) * 40, width: panel.width - 14, height: 38)
    }

    private func drawSources(in panel: NSRect) {
        let visible = visibleSourceIndexes()
        if visible.isEmpty {
            drawText(
                "No matching workspace locations",
                in: NSRect(x: panel.minX + 14, y: panel.minY + 98, width: panel.width - 28, height: 18),
                size: 12,
                color: NSColor(calibratedWhite: 0.48, alpha: 1)
            )
            return
        }
        for (rowIndex, sourceIndex) in visible.enumerated() {
            let source = sources[sourceIndex]
            let selected = sourceIndex == selectedLocationIndex
            let row = sourceRow(rowIndex, panel: panel)
            if selected {
                NSColor.systemBlue.withAlphaComponent(0.18).setFill()
                NSBezierPath(roundedRect: row, xRadius: 4, yRadius: 4).fill()
            }
            let titleColor = source.isDisabled
                ? NSColor(calibratedWhite: 0.35, alpha: 1)
                : selected ? NSColor.systemBlue : NSColor(calibratedWhite: 0.76, alpha: 1)
            drawText(
                source.title,
                in: NSRect(x: row.minX + 9, y: row.minY + 5, width: row.width - 180, height: 16),
                size: 11,
                color: titleColor
            )
            drawText(
                source.detail,
                in: NSRect(x: row.minX + 9, y: row.minY + 20, width: row.width - 180, height: 14),
                size: 9,
                color: source.isDisabled
                    ? NSColor(calibratedWhite: 0.30, alpha: 1)
                    : NSColor(calibratedWhite: 0.48, alpha: 1)
            )
            if source.isDisabled {
                drawText(
                    "Already created",
                    in: NSRect(x: row.maxX - 160, y: row.minY + 12, width: 145, height: 16),
                    size: 10,
                    color: NSColor(calibratedWhite: 0.35, alpha: 1),
                    alignment: .right
                )
            }
        }
    }

    private func drawDivider(y: CGFloat, panel: NSRect) {
        NSColor.systemBlue.withAlphaComponent(0.32).setStroke()
        let divider = NSBezierPath()
        divider.move(to: NSPoint(x: panel.minX, y: y))
        divider.line(to: NSPoint(x: panel.maxX, y: y))
        divider.lineWidth = 1
        divider.stroke()
    }

    private func drawText(
        _ text: String,
        in rect: NSRect,
        size: CGFloat,
        color: NSColor,
        alignment: NSTextAlignment = .left
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        NSAttributedString(string: text, attributes: [
            .font: NSFont.monospacedSystemFont(ofSize: size, weight: .medium),
            .foregroundColor: color,
            .paragraphStyle: paragraph,
        ]).draw(in: rect)
    }
}

struct MapEditAction {
    let id: String
    let title: String
    let detail: String
}

struct MapEditCardAction {
    let frame: NSRect
    let action: MapEditAction
}

/// An action layer above the spatial map. It keeps every card visible.
final class MapEditOverlayView: NSView {
    private let actions: [MapEditAction]
    private let cardActions: [MapEditCardAction]
    var onAction: ((MapEditAction) -> Void)?
    var onDismiss: (() -> Void)?
    var onShortcut: ((DesktopShortcutAction) -> Bool)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(frame: NSRect, actions: [MapEditAction], cardActions: [MapEditCardAction] = []) {
        self.actions = actions
        self.cardActions = cardActions
        super.init(frame: frame)
        autoresizingMask = [.width, .height]
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Map edit actions")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ dirtyRect: NSRect) {
        for card in cardActions { drawCardAction(card) }
        guard !actions.isEmpty else { return }
        let panel = NSRect(x: bounds.maxX - 240, y: 54, width: 224, height: 44 + CGFloat(actions.count) * 42)
        NSColor(calibratedWhite: 0.10, alpha: 0.96).setFill()
        NSBezierPath(roundedRect: panel, xRadius: 7, yRadius: 7).fill()
        for (index, action) in actions.enumerated() {
            let row = NSRect(x: panel.minX + 7, y: panel.minY + 7 + CGFloat(index) * 42, width: panel.width - 14, height: 36)
            NSColor(calibratedWhite: 0.16, alpha: 1).setFill()
            NSBezierPath(roundedRect: row, xRadius: 4, yRadius: 4).fill()
            drawText(action.title, in: row.insetBy(dx: 9, dy: 7), color: .white, size: 11)
        }
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53:
            onDismiss?()
        case 123:
            _ = onShortcut?(.selectLeft)
        case 124:
            _ = onShortcut?(.selectRight)
        case 125:
            _ = onShortcut?(.selectDown)
        case 126:
            _ = onShortcut?(.selectUp)
        case 36, 76:
            _ = onShortcut?(.enter)
        default:
            super.keyDown(with: event)
        }
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        if cardActions.contains(where: { $0.frame.contains(point) }) {
            return self
        }
        return panelRect().contains(point) ? self : nil
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if let index = cardActions.indices.reversed().first(where: {
            cardActions[$0].frame.contains(point)
        }) {
            onAction?(cardActions[index].action)
            return
        }
        let panel = panelRect()
        for (index, action) in actions.enumerated() {
            let row = NSRect(x: panel.minX + 7, y: panel.minY + 7 + CGFloat(index) * 42, width: panel.width - 14, height: 36)
            if row.contains(point) { onAction?(action); return }
        }
        if !panel.contains(point) { onDismiss?() }
    }

    private func drawCardAction(_ card: MapEditCardAction) {
        NSColor.systemRed.withAlphaComponent(0.94).setFill()
        NSBezierPath(roundedRect: card.frame, xRadius: card.frame.height / 2, yRadius: card.frame.height / 2).fill()
        drawText("×", in: card.frame.insetBy(dx: 7, dy: 4), color: .white, size: 13)
    }

    private func panelRect() -> NSRect {
        NSRect(
            x: bounds.maxX - 240,
            y: 54,
            width: 224,
            height: 44 + CGFloat(actions.count) * 42
        )
    }

    private func drawText(_ text: String, in rect: NSRect, color: NSColor, size: CGFloat) {
        text.draw(in: rect, withAttributes: [
            .font: NSFont.monospacedSystemFont(ofSize: size, weight: .medium),
            .foregroundColor: color,
        ])
    }
}
