import AppKit

struct WorkspaceCreationSource {
    let title: String
    let detail: String
    let location: WorkspaceLocation
}

final class AddWorkspaceCardView: NSView {
    private enum Phase: Equatable { case ready, location, name }
    private var phase: Phase = .ready
    private var sources: [WorkspaceCreationSource] = []
    private var selectedLocationIndex = 0
    private var workspaceName = ""
    var onCancel: (() -> Void)?
    var onCreate: ((WorkspaceLocation, String) -> Void)?

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { true }

    func beginCreation(sources: [WorkspaceCreationSource]) {
        self.sources = sources
        selectedLocationIndex = 0
        phase = .location
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), xRadius: 16, yRadius: 16)
        path.setLineDash([9, 7], count: 2, phase: 0)
        NSColor.systemBlue.withAlphaComponent(0.82).setStroke()
        path.lineWidth = 3
        path.stroke()

        switch phase {
        case .ready:
            drawText("+ Add workspace", y: bounds.midY - 9, size: 13, color: .systemBlue)
        case .location:
            drawText("SELECT A LOCATION", y: 28, size: 11, color: .systemBlue)
            let visibleRange = sourceVisibleRange()
            for (rowIndex, sourceIndex) in visibleRange.enumerated() {
                let source = sources[sourceIndex]
                let selected = sourceIndex == selectedLocationIndex
                let row = sourceRow(rowIndex)
                if selected {
                    NSColor.systemBlue.withAlphaComponent(0.18).setFill()
                    NSBezierPath(roundedRect: row, xRadius: 4, yRadius: 4).fill()
                }
                drawText("\(selected ? "›" : " ") \(source.title)", y: row.minY + 4, size: 11, color: selected ? .systemBlue : .labelColor)
                drawText(source.detail, y: row.minY + 18, size: 9, color: .secondaryLabelColor)
            }
            drawText("↑↓ select   return continue   esc cancel", y: bounds.maxY - 34, size: 9, color: .secondaryLabelColor)
        case .name:
            drawText("NAME THIS WORKSPACE", y: 32, size: 11, color: .systemBlue)
            let field = NSRect(x: 22, y: 68, width: bounds.width - 44, height: 38)
            NSColor.systemBlue.withAlphaComponent(0.12).setFill()
            NSBezierPath(roundedRect: field, xRadius: 5, yRadius: 5).fill()
            drawText(workspaceName.isEmpty ? "Type a name…" : workspaceName + "_", y: 80, size: 14, color: workspaceName.isEmpty ? .tertiaryLabelColor : .labelColor)
            if sources.indices.contains(selectedLocationIndex) {
                drawText(sources[selectedLocationIndex].detail, y: 126, size: 10, color: .secondaryLabelColor)
            }
            drawText("return create   esc cancel", y: bounds.maxY - 34, size: 9, color: .secondaryLabelColor)
        }
    }

    override func keyDown(with event: NSEvent) {
        switch phase {
        case .ready:
            if event.keyCode == 53 { onCancel?() }
        case .location:
            switch event.keyCode {
            case 53: onCancel?()
            case 125: selectedLocationIndex = min(sources.count - 1, selectedLocationIndex + 1); needsDisplay = true
            case 126: selectedLocationIndex = max(0, selectedLocationIndex - 1); needsDisplay = true
            case 36, 76: if !sources.isEmpty { phase = .name; needsDisplay = true }
            default: super.keyDown(with: event)
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

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        guard phase == .location else { return }
        let point = convert(event.locationInWindow, from: nil)
        let visibleRange = sourceVisibleRange()
        for (rowIndex, sourceIndex) in visibleRange.enumerated()
            where sourceRow(rowIndex).contains(point)
        {
            selectedLocationIndex = sourceIndex
            needsDisplay = true
            if event.clickCount > 1 { phase = .name }
            return
        }
    }

    private func sourceVisibleRange() -> [Int] {
        guard !sources.isEmpty else { return [] }
        let start = min(max(0, selectedLocationIndex - 3), max(0, sources.count - 7))
        return Array(start..<min(sources.count, start + 7))
    }

    private func sourceRow(_ index: Int) -> NSRect {
        NSRect(x: 22, y: 58 + CGFloat(index) * 38, width: bounds.width - 44, height: 34)
    }

    private func drawText(_ text: String, y: CGFloat, size: CGFloat, color: NSColor) {
        text.draw(in: NSRect(x: 24, y: y, width: bounds.width - 48, height: 20), withAttributes: [
            .font: NSFont.monospacedSystemFont(ofSize: size, weight: .medium),
            .foregroundColor: color,
        ])
    }
}

struct MapEditAction {
    let id: String
    let title: String
    let detail: String
}

enum MapEditCardStyle: Equatable { case control, add, ghost }

struct MapEditCardAction {
    let frame: NSRect
    let action: MapEditAction
    let style: MapEditCardStyle
}

/// An action layer above the spatial map. It keeps every card visible.
final class MapEditOverlayView: NSView {
    private let actions: [MapEditAction]
    private let cardActions: [MapEditCardAction]
    private var selectedCardIndex: Int?
    var onAction: ((MapEditAction) -> Void)?
    var onDismiss: (() -> Void)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(frame: NSRect, actions: [MapEditAction], cardActions: [MapEditCardAction] = []) {
        self.actions = actions
        self.cardActions = cardActions
        selectedCardIndex = cardActions.firstIndex { $0.style == .add }
            ?? (cardActions.isEmpty ? nil : 0)
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
        case 123, 126:
            moveCardSelection(by: -1)
        case 48, 124, 125:
            moveCardSelection(by: 1)
        case 36, 49, 76:
            if let selectedCardIndex, cardActions.indices.contains(selectedCardIndex) {
                onAction?(cardActions[selectedCardIndex].action)
            }
        default:
            super.keyDown(with: event)
        }
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if let index = cardActions.firstIndex(where: { $0.frame.contains(point) }) {
            selectedCardIndex = index
            needsDisplay = true
            onAction?(cardActions[index].action)
            return
        }
        let panel = NSRect(x: bounds.maxX - 240, y: 54, width: 224, height: 44 + CGFloat(actions.count) * 42)
        for (index, action) in actions.enumerated() {
            let row = NSRect(x: panel.minX + 7, y: panel.minY + 7 + CGFloat(index) * 42, width: panel.width - 14, height: 36)
            if row.contains(point) { onAction?(action); return }
        }
        if !panel.contains(point) { onDismiss?() }
    }

    private func drawCardAction(_ card: MapEditCardAction) {
        let selected = selectedCardIndex.flatMap { cardActions.indices.contains($0) ? cardActions[$0].action.id : nil }
            == card.action.id
        switch card.style {
        case .add, .ghost:
            if selected {
                let fill = NSBezierPath(roundedRect: card.frame, xRadius: 12, yRadius: 12)
                (card.style == .add ? NSColor.systemBlue : NSColor.secondaryLabelColor)
                    .withAlphaComponent(0.16).setFill()
                fill.fill()
            }
            let path = NSBezierPath(roundedRect: card.frame, xRadius: 12, yRadius: 12)
            path.setLineDash([7, 5], count: 2, phase: 0)
            let color = card.style == .add ? NSColor.systemBlue : NSColor(calibratedWhite: 0.58, alpha: 1)
            color.setStroke()
            path.lineWidth = selected ? 4 : 2
            path.stroke()
            let title = selected ? "› \(card.action.title)" : card.action.title
            drawText(title, in: card.frame.insetBy(dx: 18, dy: card.frame.height / 2 - 16), color: color, size: 13)
            if card.style == .ghost {
                drawText(card.action.detail, in: card.frame.insetBy(dx: 18, dy: card.frame.height / 2 + 4), color: color, size: 10)
            }
            return
        case .control:
            break
        }
        (selected ? NSColor.white : NSColor.systemRed).withAlphaComponent(0.94).setFill()
        NSBezierPath(roundedRect: card.frame, xRadius: card.frame.height / 2, yRadius: card.frame.height / 2).fill()
        drawText("×", in: card.frame.insetBy(dx: 7, dy: 4), color: .white, size: 13)
    }

    private func moveCardSelection(by delta: Int) {
        guard !cardActions.isEmpty else { return }
        let current = selectedCardIndex ?? 0
        selectedCardIndex = (current + delta % cardActions.count + cardActions.count)
            % cardActions.count
        needsDisplay = true
    }

    private func drawText(_ text: String, in rect: NSRect, color: NSColor, size: CGFloat) {
        text.draw(in: rect, withAttributes: [
            .font: NSFont.monospacedSystemFont(ofSize: size, weight: .medium),
            .foregroundColor: color,
        ])
    }
}
