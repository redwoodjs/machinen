import AppKit

final class AddWorkspaceCardView: NSView {
    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), xRadius: 16, yRadius: 16)
        path.setLineDash([9, 7], count: 2, phase: 0)
        NSColor.systemBlue.withAlphaComponent(0.82).setStroke()
        path.lineWidth = 3
        path.stroke()
        let title = "+ Add workspace"
        title.draw(
            in: NSRect(x: 24, y: bounds.midY - 9, width: bounds.width - 48, height: 18),
            withAttributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 13, weight: .medium),
                .foregroundColor: NSColor.systemBlue,
            ]
        )
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
        case 124, 125:
            moveCardSelection(by: 1)
        case 36, 76:
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
            let path = NSBezierPath(roundedRect: card.frame, xRadius: 12, yRadius: 12)
            path.setLineDash([7, 5], count: 2, phase: 0)
            let color = card.style == .add ? NSColor.systemBlue : NSColor(calibratedWhite: 0.58, alpha: 1)
            color.setStroke()
            path.lineWidth = selected ? 4 : 2
            path.stroke()
            drawText(card.action.title, in: card.frame.insetBy(dx: 18, dy: card.frame.height / 2 - 16), color: color, size: 13)
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
