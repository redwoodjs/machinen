import AppKit

struct SpatialMinimapPane {
    let id: String
    let frame: NSRect
    let isActive: Bool
    let activityState: TerminalSession.ActivityState
}

struct SpatialMinimapWorkspace {
    let id: String
    let frame: NSRect
    let isActive: Bool
    let panes: [SpatialMinimapPane]
}

final class SpatialMinimapView: NSView {
    enum Presentation {
        case overlay
        case statusBar
    }

    private let padding: CGFloat = 1.5
    private let cornerRadius: CGFloat = 6

    private(set) var representedWorldBounds = NSRect.zero
    private(set) var representedWorkspaces: [SpatialMinimapWorkspace] = []
    private(set) var representedCameraBounds = NSRect.zero

    var representedWorkspaceCount: Int { representedWorkspaces.count }
    var representedPaneCount: Int { representedWorkspaces.reduce(0) { $0 + $1.panes.count } }
    var representedActivityStates: [TerminalSession.ActivityState] {
        representedWorkspaces.flatMap(\.panes).map(\.activityState)
    }
    var outerCornerRadius: CGFloat { cornerRadius }
    var rendersPaneDetail: Bool { false }
    var rendersPaneBlocks: Bool { true }
    var usesPixelArtPresentation: Bool { true }
    var usesMonochromePixelPalette: Bool { true }
    var pixelArtWorkspaceGap: CGFloat { 1 }
    var pixelArtPaneGap: CGFloat { 1 }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    init(presentation: Presentation = .overlay) {
        super.init(frame: .zero)
        identifier = NSUserInterfaceItemIdentifier(
            presentation == .overlay ? "spatial-minimap" : "status-spatial-minimap"
        )
        wantsLayer = true
        layer?.masksToBounds = true
        layer?.cornerRadius = cornerRadius
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func updateScene(
        worldBounds: NSRect,
        workspaces: [SpatialMinimapWorkspace],
        cameraBounds: NSRect
    ) {
        representedWorldBounds = worldBounds
        representedWorkspaces = workspaces
        representedCameraBounds = cameraBounds
        needsDisplay = true
    }

    func updateCameraBounds(_ cameraBounds: NSRect) {
        representedCameraBounds = cameraBounds
        needsDisplay = true
    }

    func mappedRepresentation(of worldRect: NSRect) -> NSRect? {
        mapTransform(snapsToPixels: false)?.map(worldRect)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let context = NSGraphicsContext.current
        let previousAntialiasing = context?.shouldAntialias
        context?.shouldAntialias = true
        defer {
            if let previousAntialiasing { context?.shouldAntialias = previousAntialiasing }
        }

        NSColor(calibratedWhite: 0.035, alpha: 0.96).setFill()
        shape(for: bounds, radius: cornerRadius).fill()
        NSColor(calibratedWhite: 1, alpha: 0.24).setStroke()
        let border = shape(
            for: bounds.insetBy(dx: 0.5, dy: 0.5),
            radius: cornerRadius
        )
        border.lineWidth = 1
        border.stroke()

        context?.shouldAntialias = false
        guard let transform = mapTransform(snapsToPixels: true) else { return }

        for workspace in representedWorkspaces {
            let frame = insetForPixelGap(transform.map(workspace.frame))
            let workspacePath = shape(for: frame, radius: 0)
            NSColor(calibratedWhite: 1, alpha: workspace.isActive ? 0.62 : 0.24).setStroke()
            workspacePath.lineWidth = 1
            workspacePath.stroke()

            for pane in workspace.panes {
                let paneFrame = insetForPixelGap(
                    transform.map(pane.frame),
                    gap: pixelArtPaneGap
                )
                guard paneFrame.width > 0, paneFrame.height > 0 else { continue }
                let panePath = shape(for: paneFrame, radius: 0)
                NSColor(calibratedWhite: 1, alpha: paneStrokeAlpha(for: pane)).setStroke()
                panePath.lineWidth = 1
                if pane.activityState == .waiting {
                    panePath.setLineDash([2, 1], count: 2, phase: 0)
                }
                panePath.stroke()
            }
        }

        let cameraFrame = transform.map(representedCameraBounds)
        guard cameraFrame.width > 0, cameraFrame.height > 0 else { return }
        let cameraPath = shape(for: cameraFrame, radius: 0)
        NSColor(calibratedWhite: 1, alpha: 0.96).setStroke()
        cameraPath.lineWidth = 1
        cameraPath.stroke()
    }

    private func paneStrokeAlpha(for pane: SpatialMinimapPane) -> CGFloat {
        switch pane.activityState {
        case .working: 0.96
        case .waiting: 0.84
        case .idle: 0.58
        case .unknown: pane.isActive ? 0.48 : 0.28
        }
    }

    private func insetForPixelGap(_ rect: NSRect, gap: CGFloat? = nil) -> NSRect {
        let gap = gap ?? pixelArtWorkspaceGap
        guard gap > 0 else { return rect }
        let horizontalInset = min(gap, max(0, (rect.width - 1) / 2))
        let verticalInset = min(gap, max(0, (rect.height - 1) / 2))
        return rect.insetBy(dx: horizontalInset, dy: verticalInset)
    }

    private func shape(for rect: NSRect, radius: CGFloat) -> NSBezierPath {
        guard radius > 0 else { return NSBezierPath(rect: rect) }
        return NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    }

    private func mapTransform(snapsToPixels: Bool) -> MapTransform? {
        let world = representedWorldBounds
        let target = bounds.insetBy(dx: padding, dy: padding)
        guard !world.isNull, world.width > 0, world.height > 0,
              target.width > 0, target.height > 0
        else { return nil }

        let scale = min(target.width / world.width, target.height / world.height)
        let mappedSize = NSSize(width: world.width * scale, height: world.height * scale)
        return MapTransform(
            worldOrigin: world.origin,
            scale: scale,
            targetOrigin: NSPoint(
                x: target.midX - mappedSize.width / 2,
                y: target.midY - mappedSize.height / 2
            ),
            snapsToPixels: snapsToPixels
        )
    }
}

private struct MapTransform {
    let worldOrigin: NSPoint
    let scale: CGFloat
    let targetOrigin: NSPoint
    let snapsToPixels: Bool

    func map(_ rect: NSRect) -> NSRect {
        let mapped = NSRect(
            x: targetOrigin.x + (rect.minX - worldOrigin.x) * scale,
            y: targetOrigin.y + (rect.minY - worldOrigin.y) * scale,
            width: rect.width * scale,
            height: rect.height * scale
        )
        guard snapsToPixels else { return mapped }

        let minX = mapped.minX.rounded()
        let minY = mapped.minY.rounded()
        let maxX = mapped.maxX.rounded()
        let maxY = mapped.maxY.rounded()
        return NSRect(
            x: minX,
            y: minY,
            width: max(1, maxX - minX),
            height: max(1, maxY - minY)
        )
    }
}
