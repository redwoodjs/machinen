import AppKit

struct SpatialMinimapPane {
    let id: String
    let frame: NSRect
    let isActive: Bool
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

    private let presentation: Presentation

    private var padding: CGFloat {
        presentation == .overlay ? 9 : 1.5
    }

    private var cornerRadius: CGFloat {
        presentation == .overlay ? 10 : 0
    }

    private(set) var representedWorldBounds = NSRect.zero
    private(set) var representedWorkspaces: [SpatialMinimapWorkspace] = []
    private(set) var representedCameraBounds = NSRect.zero

    var representedWorkspaceCount: Int { representedWorkspaces.count }
    var representedPaneCount: Int { representedWorkspaces.reduce(0) { $0 + $1.panes.count } }
    var rendersPaneDetail: Bool { presentation == .overlay }
    var rendersPaneBlocks: Bool { true }
    var usesPixelArtPresentation: Bool { presentation == .statusBar }
    var pixelArtWorkspaceGap: CGFloat { presentation == .statusBar ? 1 : 0 }
    var pixelArtPaneGap: CGFloat { presentation == .statusBar ? 1 : 0 }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    init(presentation: Presentation = .overlay) {
        self.presentation = presentation
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
        mapTransform()?.map(worldRect)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let context = NSGraphicsContext.current
        let previousAntialiasing = context?.shouldAntialias
        if presentation == .statusBar { context?.shouldAntialias = false }
        defer {
            if let previousAntialiasing { context?.shouldAntialias = previousAntialiasing }
        }

        let backgroundColor = presentation == .overlay
            ? NSColor(calibratedWhite: 0.035, alpha: 0.9)
            : NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.075, alpha: 0.96)
        backgroundColor.setFill()
        shape(for: bounds, radius: cornerRadius).fill()
        NSColor(calibratedWhite: 1, alpha: presentation == .overlay ? 0.14 : 0.24).setStroke()
        let border = shape(
            for: bounds.insetBy(dx: 0.5, dy: 0.5),
            radius: cornerRadius
        )
        border.lineWidth = 1
        border.stroke()

        guard let transform = mapTransform() else { return }

        for workspace in representedWorkspaces {
            let frame = insetForPixelGap(transform.map(workspace.frame))
            let workspacePath = shape(
                for: frame,
                radius: presentation == .overlay ? min(4, frame.width / 8) : 0
            )
            let activeWorkspace = presentation == .overlay
                ? NSColor(calibratedRed: 0.18, green: 0.22, blue: 0.27, alpha: 0.96)
                : NSColor(calibratedRed: 0.12, green: 0.52, blue: 0.72, alpha: 1)
            let inactiveWorkspace = presentation == .overlay
                ? NSColor(calibratedRed: 0.12, green: 0.13, blue: 0.15, alpha: 0.96)
                : NSColor(calibratedRed: 0.28, green: 0.34, blue: 0.4, alpha: 1)
            (workspace.isActive ? activeWorkspace : inactiveWorkspace).setFill()
            workspacePath.fill()
            NSColor(calibratedWhite: 1, alpha: workspace.isActive ? 0.36 : 0.2).setStroke()
            workspacePath.lineWidth = 1
            workspacePath.stroke()

            for pane in workspace.panes {
                let mappedPaneFrame = transform.map(pane.frame)
                let paneFrame = presentation == .overlay
                    ? mappedPaneFrame.insetBy(dx: 0.5, dy: 0.5)
                    : insetForPixelGap(mappedPaneFrame, gap: pixelArtPaneGap)
                guard paneFrame.width > 0, paneFrame.height > 0 else { continue }
                let panePath = shape(
                    for: paneFrame,
                    radius: presentation == .overlay ? min(2.5, paneFrame.width / 8) : 0
                )
                if presentation == .overlay {
                    if pane.isActive {
                        NSColor(calibratedRed: 0.42, green: 0.72, blue: 1, alpha: 0.72).setFill()
                    } else {
                        NSColor(calibratedWhite: 0.72, alpha: 0.32).setFill()
                    }
                } else if pane.isActive {
                    NSColor(calibratedRed: 0.7, green: 0.9, blue: 1, alpha: 1).setFill()
                } else {
                    NSColor(calibratedRed: 0.58, green: 0.66, blue: 0.72, alpha: 1).setFill()
                }
                panePath.fill()
            }
        }

        let cameraFrame = transform.map(representedCameraBounds)
        guard cameraFrame.width > 0, cameraFrame.height > 0 else { return }
        let cameraPath = shape(
            for: cameraFrame,
            radius: presentation == .overlay ? min(3, cameraFrame.width / 8) : 0
        )
        let cameraFill = presentation == .overlay
            ? NSColor(calibratedRed: 0.34, green: 0.78, blue: 1, alpha: 0.12)
            : NSColor(calibratedWhite: 1, alpha: 0.16)
        let cameraStroke = presentation == .overlay
            ? NSColor(calibratedRed: 0.45, green: 0.84, blue: 1, alpha: 0.96)
            : NSColor(calibratedWhite: 1, alpha: 0.96)
        cameraFill.setFill()
        cameraPath.fill()
        cameraStroke.setStroke()
        cameraPath.lineWidth = presentation == .overlay ? 1.5 : 1
        cameraPath.stroke()
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

    private func mapTransform() -> MapTransform? {
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
            snapsToPixels: presentation == .statusBar
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
