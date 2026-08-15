import AppKit

final class TerminalDeckView: NSView {
    private struct CameraAnimation {
        let start: NSRect
        let target: NSRect
        let startedAt: TimeInterval
        let duration: TimeInterval
        let startAlpha: CGFloat
        let targetAlpha: CGFloat
        let completion: (@MainActor () -> Void)?
    }

    private struct SpatialMinimapAnimation {
        let start: NSRect
        let target: NSRect
        let startedAt: TimeInterval
        let duration: TimeInterval
    }

    private enum SpatialDragItem {
        case workspace(String)
        case terminal(String)
    }

    private struct SpatialDrag {
        let item: SpatialDragItem
        let startWindowPoint: NSPoint
        var didMove = false
    }

    private struct RecentlyClosedTerminal {
        let tile: TerminalTileView
        let position: Int
        let disconnectedAt: Date
    }

    private struct PendingWorkspaceTile {
        let tile: TerminalTileView
        let position: Int
        let state: TerminalSession.State
        let wasAttached: Bool
    }

    private struct PendingWorkspaceClose {
        let targetID: String
        let location: WorkspaceLocation
        let nativeRecord: NativeWorkspaceRecord
        let discoveredSessions: [AvailableTerminalSession]
        let discoveryState: TargetDiscovery.State
        let discoveryError: String?
        let sceneRecord: WorkspaceRecord?
        let scenePosition: Int?
        let sceneTiles: [PendingWorkspaceTile]
    }

    private struct TerminalSelectionContext {
        let text: String
        let tile: TerminalTileView
        let anchor: NSPoint
    }

    private final class SelectionOpenerMenuPayload: NSObject {
        let openerID: String
        let selection: TerminalSelectionContext

        init(openerID: String, selection: TerminalSelectionContext) {
            self.openerID = openerID
            self.selection = selection
        }
    }

    private enum PaletteKind {
        case commands
        case contextCommandGroup
        case selectionOpeners
        case newTerminal
        case runCommand
        case newItem
        case newWorkspace
        case newWorkspaceLocation
        case renameWorkspace
        case workspaceLocation
        case remoteWorkspaceLocation
    }

    private enum NewWorkspaceEntry {
        case newItem
        case commands
        case sharedWorkspaces
    }

    private enum NewWorkspaceNameReturn {
        case locations
        case localBrowser(String)
        case sshBrowser(host: String, path: String)
    }

    private enum Motion {
        // Match cmdcmd's quick, symmetric window motion.
        static let cameraDuration: TimeInterval = 0.20
        static let magnificationDuration: TimeInterval = 0.08
        static let terminalSwitchDuration: TimeInterval = 0.24
        static let workspaceSwitchExitDuration: TimeInterval = 0.08
        static let workspaceSwitchEntryDuration: TimeInterval = 0.11
        static let workspaceSwitchMinimumAlpha: CGFloat = 0.2
        static let workspaceSwitchNudge: CGFloat = 44
        static let minimapHoldDuration: TimeInterval = 1.25
        static let minimapFadeOutDuration: TimeInterval = 0.34
        static let peekDuration: TimeInterval = 0.12
        static let paneCloseDuration: TimeInterval = 0.18
        static let paneCloseScale: CGFloat = 0.92
        static let firstControlX: CGFloat = 0.42
        static let secondControlX: CGFloat = 0.58
    }

    private enum CameraMagnification {
        static let increment: CGFloat = 0.2
        static let minimum: CGFloat = 0.4
        static let maximum: CGFloat = 2
    }

    enum CameraSwipeDirection {
        case left
        case right
        case up
        case down
    }

    private struct TwoFingerCameraSwipe {
        var horizontal: CGFloat = 0
        var vertical: CGFloat = 0
    }

    private struct DirectTrackpadSwipe {
        let fingerCount: Int
        let start: NSPoint
        var direction: CameraSwipeDirection? = nil
        var sourceCameraBounds: NSRect? = nil
        var targetCameraBounds: NSRect? = nil
        var pointerLocation: NSPoint? = nil
        var sourceSelectedIndex = 0
        var progress: CGFloat = 0
        var didTrigger = false
    }

    private enum CameraSwipe {
        static let twoFingerThreshold: CGFloat = 42
        static let directTouchThreshold: CGFloat = 0.045
        static let directTouchTravel: CGFloat = 0.22
        static let releaseThreshold: CGFloat = 0.35
        static let cancelDuration: TimeInterval = 0.12
        static let duplicateSuppressionDuration: TimeInterval = 0.30
    }

    private struct MapEditReturnState {
        let workspaceID: String?
        let overviewWorkspaceID: String?
        let selectedTileID: String?
        let focusedTileID: String?
    }

    private enum Metrics {
        static let topInset: CGFloat = 18
        static let bottomInset: CGFloat = 18
        static let sideInset: CGFloat = 18
        static let windowControlsInset: CGFloat = 92
        static let worldMargin: CGFloat = 48
        static let workspaceGap: CGFloat = 64
    }

    private let sceneView = CameraSceneView()
    private let statusBarView = MachinenStatusBarView(frame: .zero)
    private let statusPopoverView = MachinenStatusPopoverView()
    private let spatialMinimapView = SpatialMinimapView()
    private let sessionStore: TerminalSessionStore
    private let sessionBackend: any TerminalSessionBackend
    private let interactionIntentEngine: InteractionIntentEngine
    private var interactionPolicySession: InteractionIntentPolicy?
    private var workspaces: [WorkspaceRecord]
    private var workspaceLocationHistory: [WorkspaceLocation]
    private var targetMachines: [TargetMachine]
    private var targetDiscoveries: [String: TargetDiscovery] = [:]
    private var targetDiscoveryInFlight: Set<String> = []
    private var targetDiscoveryGeneration: [String: UInt64] = [:]
    private var targetDiscoveryFailureCount: [String: Int] = [:]
    private var targetDiscoveryRetryAfter: [String: Date] = [:]

    private var allSessionTiles: [TerminalTileView]
    private var workspaceClusters: [WorkspaceClusterView] = []
    private var workspaceUnion = NSRect.zero
    private var currentWorkspace: String?
    private var selectedIndex = 0
    private var focusedIndex: Int?
    private var activeTerminalByWorkspace: [String: String] = [:]
    private var isTransitioning = false
    private var isPeeking = false
    private var peekCameraBounds: NSRect?
    private var labelBuffer = ""
    private var isShuttingDown = false
    private var commandPalette: CommandPaletteView?
    private var paletteKind: PaletteKind?
    private var newWorkspaceEntry: NewWorkspaceEntry?
    private var registersSharedWorkspaceOnly = false
    private var locationValidationProcess: Process?
    private let remotePathCompleter = RemoteWorkspacePathCompleter()
    private var presentedOverlay: NSView?
    private var mapEditOverlay: MapEditOverlayView?
    private var mapEditReturnState: MapEditReturnState?
    private var addWorkspaceClusterView: WorkspaceClusterView?
    private var addWorkspaceCardView: AddWorkspaceCardView?
    private var addTerminalTileView: TerminalTileView?
    private var addTerminalCardView: AddTerminalCardView?
    private var inlineConfirmationView: ActionConfirmationView?
    private var localizedActionCameraBounds: NSRect?
    private var ghostWorkspaceTargets: [String: (String, NativeWorkspaceRecord)] = [:]
    private var lastViewportSize = NSSize.zero
    private var cameraAnimation: CameraAnimation?
    private var cameraAnimationTimer: Timer?
    private var spatialMinimapAnimation: SpatialMinimapAnimation?
    private var spatialMinimapFadeGeneration = 0
    private var spatialMinimapHoldUntil: TimeInterval?
    private var isSpatialMinimapPreviewed = false
    private var cameraMagnification: CGFloat = 1
    private var twoFingerCameraSwipe: TwoFingerCameraSwipe?
    private var directTrackpadSwipe: DirectTrackpadSwipe?
    private var gestureEventMonitor: Any?
    private var suppressGestureEventsUntil: TimeInterval = 0
    private var statusWidgets: [String: MachinenStatusWidget] = [:]
    private var effectiveStatusWidgets: [MachinenStatusWidget] = []
    private var selectionOpeners: [String: MachinenSelectionOpener] = [:]
    private var contextCommands: [String: MachinenContextCommand] = [:]
    private var spatialDrag: SpatialDrag?
    private var dragGhost: NSImageView?
    private weak var dragTargetTile: TerminalTileView?
    private weak var dragTargetWorkspace: WorkspaceClusterView?
    private var recentlyClosedTerminals: [String: RecentlyClosedTerminal]
    private var pendingWorkspaceCloses: [String: PendingWorkspaceClose] = [:]
    private var pendingWorkspaceCloseTasks: [String: DispatchWorkItem] = [:]
    private var finalizingWorkspaceIDsByTarget: [String: Set<String>] = [:]
    private var undoCloseView: UndoTerminalCloseView?
    private var undoToastTerminalID: String?
    private var undoToastWorkspaceID: String?
    private var undoToastDismissTask: DispatchWorkItem?
    private var availableSessionsView: AvailableSessionsView?
    private var targetSessionsView: TargetSessionsView?
    private var availableSessionsWorkspaceID: String?
    private var availableSessionsReturnsToCommands = false
    private var availableSessionsPendingSelectionID: String?
    private var availableSessionsByMachine: [String: [AvailableTerminalSession]] = [:]
    private var availableSessionsErrors: [String: String] = [:]
    private var availableSessionsLastRefresh: [String: Date] = [:]
    private var availableSessionsRefreshTimer: Timer?
    private let undoToastDuration: TimeInterval = 3
    private let availableSessionsRefreshInterval: TimeInterval = 10
    private let maximumTargetDiscoveryBackoff: TimeInterval = 120

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    var onAPIEvent: ((String, [String: Any]) -> Void)?
    var shouldPublishTerminalOutput: ((JSONObject) -> Bool)?

    init(
        state: MachinenStoredState,
        sessionStore: TerminalSessionStore,
        interactionIntentEngine: InteractionIntentEngine,
        sessionBackend: (any TerminalSessionBackend)? = nil
    ) {
        self.sessionStore = sessionStore
        self.sessionBackend = sessionBackend ?? TerminalSessionBackendFactory.backend
        self.interactionIntentEngine = interactionIntentEngine
        workspaces = state.workspaces
        workspaceLocationHistory = state.workspaceLocationHistory
        targetMachines = state.targetMachines
        let initialTiles = state.sessions.map { TerminalTileView(session: $0) }
        allSessionTiles = initialTiles.filter { $0.session.disconnectedAt == nil }
        recentlyClosedTerminals = Dictionary(uniqueKeysWithValues: initialTiles.compactMap { tile in
            guard let disconnectedAt = tile.session.disconnectedAt else { return nil }
            tile.session.state = .detached
            return (
                tile.session.id,
                RecentlyClosedTerminal(
                    tile: tile,
                    position: tile.session.disconnectedPosition ?? state.sessions.count,
                    disconnectedAt: disconnectedAt
                )
            )
        })
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1).cgColor
        layer?.masksToBounds = true
        sceneView.wantsLayer = true
        sceneView.layer?.masksToBounds = true

        addSubview(sceneView)
        let persistedTiles = allSessionTiles + recentlyClosedTerminals.values.map(\.tile)
        for tile in persistedTiles {
            installTile(tile)
            installPersistentTerminal(in: tile)
        }
        rebuildWorkspaceClusters()
        addSubview(statusBarView, positioned: .above, relativeTo: sceneView)
        addSubview(statusPopoverView, positioned: .above, relativeTo: statusBarView)
        spatialMinimapView.isHidden = true
        addSubview(spatialMinimapView, positioned: .above, relativeTo: statusPopoverView)
        statusBarView.onHoverChange = { [weak self] widget, anchor, detail in
            self?.updateStatusPopover(widget: widget, anchor: anchor, detail: detail)
        }
        statusBarView.onWidgetClick = { [weak self] widget, widgetFrame in
            guard let self else { return false }
            switch widget.id {
            case "machinen.targetSessions":
                self.toggleTargetSessions(
                    anchor: self.convert(widgetFrame, from: self.statusBarView)
                )
                return true
            case "machinen.availableSessions":
                self.toggleTargetSessions(
                    anchor: self.convert(widgetFrame, from: self.statusBarView)
                )
                return true
            case "machinen.sessionControl":
                self.toggleTargetSessions(
                    anchor: self.convert(widgetFrame, from: self.statusBarView),
                    selecting: self.selectedSession()?.id
                )
                return true
            default:
                return false
            }
        }
        statusBarView.onSpatialMinimapHoverChange = { [weak self] isHovered in
            self?.setSpatialMinimapPreviewed(isHovered)
        }
        statusBarView.onOverviewSelect = { [weak self] in
            self?.showOverviewFromStatusBar()
        }
        statusBarView.onWorkspaceSelect = { [weak self] workspaceID in
            self?.selectWorkspaceFromStatusBar(workspaceID)
        }
        statusBarView.onTerminalSelect = { [weak self] terminalID in
            self?.selectTerminalFromStatusBar(terminalID)
        }
        statusBarView.onMouseDown = { [weak self] in
            self?.restoreInputFocus()
        }
        allowedTouchTypes = [.indirect]
        wantsRestingTouches = true
        enterSoleTerminalIfNeeded()
        updateSelection()
        refreshRegisteredTargets(force: true)
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        removeGestureEventMonitor()
        if window != nil {
            installGestureEventMonitor()
            if availableSessionsRefreshTimer == nil { startAvailableSessionsPolling() }
            refreshRegisteredTargets(force: true)
        } else {
            availableSessionsRefreshTimer?.invalidate()
            availableSessionsRefreshTimer = nil
        }
    }

    private func installGestureEventMonitor() {
        gestureEventMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.scrollWheel, .swipe]
        ) { [weak self] event in
            guard let self, event.window === self.window else { return event }
            switch event.type {
            case .scrollWheel:
                return self.processTwoFingerScroll(event) ? nil : event
            case .swipe:
                return self.processThreeFingerSwipe(event) ? nil : event
            default:
                return event
            }
        }
    }

    private func removeGestureEventMonitor() {
        guard let gestureEventMonitor else { return }
        NSEvent.removeMonitor(gestureEventMonitor)
        self.gestureEventMonitor = nil
    }

    private var activeSessionTiles: [TerminalTileView] {
        guard let currentWorkspace else { return [] }
        return activeSessionTiles(for: currentWorkspace)
    }

    private func activeSessionTiles(for workspaceID: String) -> [TerminalTileView] {
        var result = allSessionTiles.filter { $0.session.workspaceID == workspaceID }
        if let addTerminalTileView,
           addTerminalTileView.session.workspaceID == workspaceID
        {
            result.append(addTerminalTileView)
        }
        return result
    }

    private var activeCount: Int {
        currentWorkspace == nil ? workspaceClusters.count : activeSessionTiles.count
    }

    private var activeColumns: Int {
        if currentWorkspace == nil {
            return min(2, max(1, workspaceClusters.count))
        }
        return workspaceCluster(named: currentWorkspace)?.sessionColumns ?? 1
    }

    private func workspaceCluster(named workspaceID: String?) -> WorkspaceClusterView? {
        guard let workspaceID else { return nil }
        return workspaceClusters.first { $0.workspaceID == workspaceID }
    }

    private func selectedWorkspaceID() -> String? {
        if let currentWorkspace { return currentWorkspace }
        guard workspaceClusters.indices.contains(selectedIndex) else { return nil }
        return workspaceClusters[selectedIndex].workspaceID
    }

    private func selectedWorkspaceRecord() -> WorkspaceRecord? {
        guard let workspaceID = selectedWorkspaceID() else { return nil }
        return workspaces.first { $0.id == workspaceID }
    }

    private func selectedWorkspace() -> String? {
        selectedWorkspaceRecord()?.name
    }

    private func selectedSessionTile() -> TerminalTileView? {
        let sessions = activeSessionTiles
        let index = focusedIndex ?? selectedIndex
        if sessions.indices.contains(index) {
            return sessions[index]
        }
        if let workspace = selectedWorkspace() {
            return allSessionTiles.first { $0.session.workspace == workspace }
        }
        return nil
    }

    private func selectedSession() -> TerminalSession? {
        selectedSessionTile()?.session
    }

    private func enterSoleTerminalIfNeeded() {
        guard allSessionTiles.count == 1, let tile = allSessionTiles.first else { return }
        currentWorkspace = tile.session.workspaceID
        selectedIndex = 0
        focusedIndex = 0
    }

    private func installTile(_ tile: TerminalTileView) {
        if mapEditOverlay != nil {
            dismissMapEditOverlay(restorePreviousView: false)
        }
        tile.onSelect = { [weak self, weak tile] event in
            guard let self, let tile else { return }
            if self.mapEditOverlay != nil {
                self.dismissMapEditOverlay(restorePreviousView: false)
            }
            self.window?.makeFirstResponder(self)
            self.focusClickedTile(at: event.locationInWindow, fallback: tile)
        }
        tile.onActivate = { [weak self, weak tile] event in
            guard let self, let tile else { return }
            if self.mapEditOverlay != nil {
                self.dismissMapEditOverlay(restorePreviousView: false)
            }
            self.focusClickedTile(at: event.locationInWindow, fallback: tile)
        }
        tile.terminalInputTarget = { [weak self, weak tile] event in
            // Unfocused previews reorder only inside their workspace. Only
            // the focused terminal's viewport owns terminal input.
            guard let self, self.currentWorkspace != nil, self.focusedIndex != nil, let fallback = tile,
                  let target = self.terminalTile(at: event.locationInWindow),
                  let terminal = target.terminalResponder
            else {
                InputRoutingLog.log("deck cannot resolve terminal input target")
                return nil
            }
            let localPoint = target.convert(event.locationInWindow, from: nil)
            guard target.terminalViewportRect.contains(localPoint) else {
                InputRoutingLog.log("deck pointer is outside terminal viewport target=\(target.session.tileID)")
                return nil
            }
            InputRoutingLog.log("deck routes terminal interaction receiver=\(fallback.session.tileID) target=\(target.session.tileID)")
            // Do not move the camera underneath an in-progress selection drag.
            self.focusClickedTile(at: event.locationInWindow, fallback: target, animate: false)
            return terminal
        }
        tile.onTerminalInteractionEnded = { [weak self, weak tile] in
            InputRoutingLog.log("deck ends terminal interaction receiver=\(tile?.session.tileID ?? "none")")
            self?.moveCamera()
        }
        tile.onDragBegan = { [weak self, weak tile] event in
            guard let self, let tile else { return }
            let source = self.terminalTile(at: event.locationInWindow) ?? tile
            self.beginSpatialDrag(for: source, event: event)
        }
        tile.onDragChanged = { [weak self] event in
            self?.updateSpatialDrag(with: event)
        }
        tile.onDragEnded = { [weak self] event in
            self?.endSpatialDrag(with: event) ?? false
        }
    }

    private func installPersistentTerminal(in tile: TerminalTileView) {
        let terminalView = MachinenTerminalView(
            session: tile.session,
            terminalBackend: sessionBackend
        )
        terminalView.onStateChange = { [weak self, weak tile] state in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.transition(to: state, terminalText: tile.session.terminalText)
            self.saveSessions()
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.stateChanged", data: self.terminalJSON(tile))
        }
        terminalView.onActivityChange = { [weak self, weak tile] state in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateActivity(to: state)
            self.workspaceCluster(named: tile.session.workspaceID)?.needsDisplay = true
            self.refreshStatusBar()
            self.refreshSpatialMinimapActivityStates()
            self.emitAPIEvent("terminal.activityChanged", data: self.terminalJSON(tile))
        }
        terminalView.onCommandChange = { [weak self, weak tile] command in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateObservedCommand(command)
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.commandChanged", data: self.terminalJSON(tile))
        }
        terminalView.onShellNameChange = { [weak self, weak tile] shellName in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateInferredShellName(shellName)
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.shellNameChanged", data: self.terminalJSON(tile))
        }
        terminalView.onProcessInfoChange = { [weak self, weak tile] info in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateProcessInfo(info)
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.processChanged", data: self.terminalJSON(tile))
        }
        terminalView.onGeometryChange = { [weak self, weak tile] _ in
            guard let self, let tile, !self.isShuttingDown else { return }
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.geometryChanged", data: self.terminalJSON(tile))
        }
        terminalView.onRuntimeLabelChange = { [weak self, weak tile] label in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateRuntimeLabel(label)
            self.refreshStatusBar()
            self.saveSessions()
            self.emitAPIEvent("terminal.labelChanged", data: self.terminalJSON(tile))
        }
        terminalView.onWorkingDirectoryChange = { [weak self, weak tile] directory in
            guard let self, let tile, !self.isShuttingDown,
                  tile.session.currentWorkingDirectory != directory
            else { return }
            tile.session.currentWorkingDirectory = directory
            self.refreshStatusBar()
            self.saveSessions()
            self.emitAPIEvent("terminal.workingDirectoryChanged", data: self.terminalJSON(tile))
        }
        terminalView.onOutput = { [weak self, weak tile] data in
            guard let self, let tile else { return }
            var eventData: JSONObject = [
                "terminalId": tile.session.id,
                "tileId": tile.session.tileID,
                "workspaceId": tile.session.workspaceID,
            ]
            guard self.shouldPublishTerminalOutput?(eventData) ?? false else { return }
            eventData["dataBase64"] = data.base64EncodedString()
            self.emitAPIEvent("terminal.output", data: eventData)
        }
        terminalView.onContextMenuRequested = { [weak self, weak tile] terminal, selection in
            guard let self, let tile else { return nil }
            return self.terminalContextMenu(for: terminal, tile: tile, selection: selection)
        }
        tile.installTerminalView(terminalView)
    }

    private var persistedSessionTiles: [TerminalTileView] {
        allSessionTiles
            + recentlyClosedTerminals.values.sorted { $0.position < $1.position }.map(\.tile)
            + pendingWorkspaceCloses.values.flatMap { pending in
                pending.sceneTiles.sorted { $0.position < $1.position }.map(\.tile)
            }
    }

    private var persistedWorkspaces: [WorkspaceRecord] {
        let pending = pendingWorkspaceCloses.values.compactMap { close -> (WorkspaceRecord, Int)? in
            guard let record = close.sceneRecord, let position = close.scenePosition else { return nil }
            return (record, position)
        }.sorted { $0.1 < $1.1 }
        var result = workspaces
        for (record, position) in pending {
            result.insert(record, at: min(max(0, position), result.count))
        }
        return result
    }

    private func saveSessions() {
        sessionStore.save(MachinenStoredState(
            workspaces: persistedWorkspaces,
            sessions: persistedSessionTiles.map(\.session),
            workspaceLocationHistory: workspaceLocationHistory,
            targetMachines: targetMachines
        ))
    }

    private typealias RegisteredTargetLocation = (
        id: String,
        location: WorkspaceLocation,
        name: String
    )

    private func registeredTargetLocations() -> [RegisteredTargetLocation] {
        [("local", .local(FileManager.default.homeDirectoryForCurrentUser.path), "this Mac")]
            + targetMachines.map { ($0.id, $0.location, $0.displayName) }
    }

    private func registeredTargetLocation(id: String) -> WorkspaceLocation? {
        if id == "local" {
            return .local(FileManager.default.homeDirectoryForCurrentUser.path)
        }
        return targetMachines.first { $0.id == id }?.location
    }

    private func targetID(for location: WorkspaceLocation) -> String? {
        guard let host = location.sshHost else { return "local" }
        return targetMachines.first {
            TargetMachine.normalizedHost($0.sshHost) == TargetMachine.normalizedHost(host)
        }?.id
    }

    private func registerTargetIfNeeded(for location: WorkspaceLocation) {
        guard let host = location.sshHost, targetID(for: location) == nil else { return }
        targetMachines.append(TargetMachine(sshHost: host))
    }

    /// Polling is deliberately discovery-only. It updates this Desktop's
    /// browser cache and never creates a workspace, tile, or viewer.
    private func refreshRegisteredTargets(force: Bool = false) {
        for target in registeredTargetLocations() {
            refreshRegisteredTarget(target.id, at: target.location, force: force)
        }
    }

    private func refreshRegisteredTarget(
        _ targetID: String,
        at location: WorkspaceLocation,
        force: Bool
    ) {
        guard registeredTargetLocation(id: targetID) == location,
              !targetDiscoveryInFlight.contains(targetID)
        else { return }
        let now = Date()
        if !force {
            if let retryAfter = targetDiscoveryRetryAfter[targetID], retryAfter > now { return }
            if let discovery = targetDiscoveries[targetID],
               now.timeIntervalSince(discovery.checkedAt) < availableSessionsRefreshInterval
            {
                return
            }
        }

        let generation = (targetDiscoveryGeneration[targetID] ?? 0) + 1
        targetDiscoveryGeneration[targetID] = generation
        targetDiscoveryInFlight.insert(targetID)
        sessionBackend.listSessions(at: location) { [weak self] sessionsResult in
            guard let self,
                  self.targetDiscoveryRequestIsCurrent(
                      targetID: targetID,
                      location: location,
                      generation: generation
                  )
            else { return }
            switch sessionsResult {
            case let .success(sessions):
                self.sessionBackend.listWorkspaces(at: location) { [weak self] workspacesResult in
                    guard let self,
                          self.targetDiscoveryRequestIsCurrent(
                              targetID: targetID,
                              location: location,
                              generation: generation
                          )
                    else { return }
                    switch workspacesResult {
                    case let .success(workspaces):
                        self.finishTargetDiscovery(
                            targetID: targetID,
                            location: location,
                            generation: generation,
                            sessions: sessions,
                            workspaces: workspaces
                        )
                    case let .failure(error):
                        self.failTargetDiscovery(
                            targetID: targetID,
                            location: location,
                            generation: generation,
                            error: error
                        )
                    }
                }
            case let .failure(error):
                self.failTargetDiscovery(
                    targetID: targetID,
                    location: location,
                    generation: generation,
                    error: error
                )
            }
        }
    }

    private func targetDiscoveryRequestIsCurrent(
        targetID: String,
        location: WorkspaceLocation,
        generation: UInt64
    ) -> Bool {
        targetDiscoveryGeneration[targetID] == generation
            && registeredTargetLocation(id: targetID) == location
    }

    private func finishTargetDiscovery(
        targetID: String,
        location: WorkspaceLocation,
        generation: UInt64,
        sessions: [AvailableTerminalSession],
        workspaces: [NativeWorkspaceRecord]
    ) {
        guard targetDiscoveryRequestIsCurrent(
            targetID: targetID,
            location: location,
            generation: generation
        ) else { return }
        var pendingWorkspaceIDs = Set(pendingWorkspaceCloses.values.lazy
            .filter { $0.targetID == targetID }
            .map { $0.nativeRecord.id })
        pendingWorkspaceIDs.formUnion(finalizingWorkspaceIDsByTarget[targetID] ?? [])
        let activeSessions = sessions.filter {
            ($0.state == "running" || $0.state == "created")
                && !($0.workspaceId.map(pendingWorkspaceIDs.contains) ?? false)
        }
        let visibleWorkspaces = workspaces.filter { !pendingWorkspaceIDs.contains($0.id) }
        let now = Date()
        targetDiscoveryInFlight.remove(targetID)
        targetDiscoveryFailureCount.removeValue(forKey: targetID)
        targetDiscoveryRetryAfter.removeValue(forKey: targetID)
        targetDiscoveries[targetID] = TargetDiscovery(
            state: activeSessions.isEmpty ? .inactive : .online,
            sessions: activeSessions,
            workspaces: visibleWorkspaces,
            checkedAt: now,
            error: nil
        )
        availableSessionsByMachine[location.machineID] = activeSessions
        availableSessionsErrors.removeValue(forKey: location.machineID)
        availableSessionsLastRefresh[location.machineID] = now
        targetDiscoveryDidChange()
    }

    private func failTargetDiscovery(
        targetID: String,
        location: WorkspaceLocation,
        generation: UInt64,
        error: Error
    ) {
        guard targetDiscoveryRequestIsCurrent(
            targetID: targetID,
            location: location,
            generation: generation
        ) else { return }
        let now = Date()
        let failures = (targetDiscoveryFailureCount[targetID] ?? 0) + 1
        let backoff = min(
            maximumTargetDiscoveryBackoff,
            availableSessionsRefreshInterval * pow(2, Double(min(4, failures - 1)))
        )
        targetDiscoveryInFlight.remove(targetID)
        targetDiscoveryFailureCount[targetID] = failures
        targetDiscoveryRetryAfter[targetID] = now.addingTimeInterval(backoff)
        let prior = targetDiscoveries[targetID]
        targetDiscoveries[targetID] = TargetDiscovery(
            state: .unreachable,
            sessions: prior?.sessions ?? [],
            workspaces: prior?.workspaces ?? [],
            checkedAt: now,
            error: error.localizedDescription
        )
        availableSessionsErrors[location.machineID] = error.localizedDescription
        targetDiscoveryDidChange()
    }

    private func targetDiscoveryDidChange() {
        refreshAvailableSessionsPanel()
        refreshTargetSessionsView()
        refreshStatusBar()
    }

    private func persistNativeWorkspace(_ workspace: WorkspaceRecord) {
        var locationsByMachine = [workspace.location.machineID: workspace.location]
        let sessions = persistedSessionTiles.map(\.session).filter {
            $0.workspaceID == workspace.id
        }
        for session in sessions where locationsByMachine[session.location.machineID] == nil {
            var anchor = session.location
            anchor.path = session.workspaceRoot
            locationsByMachine[anchor.machineID] = anchor
        }
        for location in locationsByMachine.values {
            let sessionIDs = sessions.filter {
                $0.location.machineID == location.machineID
            }.map(\.id)
            sessionBackend.saveWorkspace(
                id: workspace.id,
                name: workspace.name,
                at: location,
                sessionIDs: sessionIDs
            ) { result in
                if case let .failure(error) = result {
                    NSLog("Machinen could not save native workspace: %@", String(describing: error))
                }
            }
        }
    }

    private func deleteNativeWorkspace(_ workspace: WorkspaceRecord) {
        var locationsByMachine = [workspace.location.machineID: workspace.location]
        for session in persistedSessionTiles.map(\.session) where session.workspaceID == workspace.id {
            if locationsByMachine[session.location.machineID] == nil {
                var anchor = session.location
                anchor.path = session.workspaceRoot
                locationsByMachine[anchor.machineID] = anchor
            }
        }
        for location in locationsByMachine.values {
            sessionBackend.deleteWorkspace(id: workspace.id, at: location) { result in
                if case let .failure(error) = result {
                    NSLog("Machinen could not delete native workspace: %@", String(describing: error))
                }
            }
        }
    }

    private func rebuildWorkspaceClusters() {
        let existing = Dictionary(uniqueKeysWithValues: workspaceClusters.map { ($0.workspaceID, $0) })
        var usedLabels = Set(existing.values.map(\.label))
        workspaceClusters = workspaces.map { workspace in
            let cluster: WorkspaceClusterView
            if let current = existing[workspace.id] {
                current.workspace = workspace.name
                cluster = current
            } else {
                let base = String(workspace.name.lowercased().prefix(2)).padding(
                    toLength: 2,
                    withPad: "w",
                    startingAt: 0
                )
                var label = base
                var suffix = 2
                while usedLabels.contains(label) {
                    label = String(base.prefix(1)) + String(suffix)
                    suffix += 1
                }
                usedLabels.insert(label)
                cluster = WorkspaceClusterView(
                    workspaceID: workspace.id,
                    workspace: workspace.name,
                    label: label
                )
                cluster.onSelect = { [weak self, weak cluster] in
                    guard let self, let cluster,
                          let index = self.workspaceClusters.firstIndex(where: { $0 === cluster })
                    else { return }
                    if self.mapEditOverlay != nil {
                        self.dismissMapEditOverlay(restorePreviousView: false)
                    }
                    self.window?.makeFirstResponder(self)
                    if self.currentWorkspace == nil {
                        self.activate(index)
                    }
                }
                cluster.onActivate = { [weak self, weak cluster] in
                    guard let self, let cluster,
                          let index = self.workspaceClusters.firstIndex(where: { $0 === cluster })
                    else { return }
                    if self.mapEditOverlay != nil {
                        self.dismissMapEditOverlay(restorePreviousView: false)
                    }
                    guard self.currentWorkspace == nil else { return }
                    self.activate(index)
                }
                cluster.onDragBegan = { [weak self, weak cluster] event in
                    guard let self, let cluster else { return }
                    self.beginSpatialDrag(for: cluster, event: event)
                }
                cluster.onDragChanged = { [weak self] event in
                    self?.updateSpatialDrag(with: event)
                }
                cluster.onDragEnded = { [weak self] event in
                    self?.endSpatialDrag(with: event) ?? false
                }
                sceneView.addSubview(cluster)
            }
            return cluster
        }

        let retainedIDs = Set(workspaces.map(\.id))
        for (id, cluster) in existing where !retainedIDs.contains(id) {
            cluster.removeFromSuperview()
        }
    }

    private var sceneViewportFrame: NSRect {
        let statusHeight = min(bounds.height, MachinenStatusBarView.preferredHeight)
        return NSRect(
            x: 0,
            y: statusHeight,
            width: bounds.width,
            height: max(0, bounds.height - statusHeight)
        )
    }

    private var sceneViewportBounds: NSRect {
        NSRect(origin: .zero, size: sceneViewportFrame.size)
    }

    override func layout() {
        super.layout()
        commandPalette?.frame = bounds
        statusBarView.frame = NSRect(
            x: 0,
            y: 0,
            width: bounds.width,
            height: MachinenStatusBarView.preferredHeight
        )
        sceneView.frame = sceneViewportFrame
        layoutSpatialMinimap()
        if let undoCloseView {
            let width = min(460, max(360, bounds.width - 32))
            undoCloseView.frame = NSRect(
                x: bounds.maxX - width - 16,
                y: statusBarView.frame.maxY + 12,
                width: width,
                height: 54
            ).integral
        }
        let viewportSize = sceneViewportFrame.size
        guard viewportSize.width > 0, viewportSize.height > 0 else { return }
        if lastViewportSize != viewportSize {
            lastViewportSize = viewportSize
            updateWorldGeometry()
            setCameraImmediately()
        }
    }

    private func layoutSpatialMinimap() {
        let representedWorld = spatialMinimapView.representedWorldBounds
        let world = representedWorld.width > 0 && representedWorld.height > 0
            ? representedWorld
            : spatialMinimapWorldBounds()
        let viewport = sceneViewportFrame
        guard !world.isNull, world.width > 0, world.height > 0,
              viewport.width > 36, viewport.height > 36
        else {
            spatialMinimapView.frame = .zero
            return
        }

        let maxWidth = min(260, viewport.width - 36)
        let maxHeight = min(160, viewport.height - 36)
        let aspectRatio = world.width / world.height
        var width = maxWidth
        var height = width / aspectRatio
        if height > maxHeight {
            height = maxHeight
            width = height * aspectRatio
        }
        width = min(maxWidth, max(120, width))
        height = min(maxHeight, max(68, height))
        spatialMinimapView.frame = NSRect(
            x: viewport.maxX - width - 18,
            y: viewport.minY + 12,
            width: width,
            height: height
        ).integral
    }

    private func spatialMinimapWorldBounds() -> NSRect {
        guard !workspaceUnion.isNull, workspaceUnion.width > 0, workspaceUnion.height > 0
        else { return .zero }
        return workspaceUnion.insetBy(
            dx: -Metrics.worldMargin / 2,
            dy: -Metrics.worldMargin / 2
        )
    }

    private func updateWorldGeometry() {
        let viewport = sceneViewportBounds
        let terminalSize = NSSize(width: max(1, viewport.width), height: max(1, viewport.height))
        let layoutViews: [NSView] = workspaceClusters
        let sizes = workspaceClusters.map { cluster in
            cluster.arrange(
                sessions: activeSessionTiles(for: cluster.workspaceID),
                terminalSize: terminalSize
            )
        }
        guard !layoutViews.isEmpty else {
            workspaceUnion = .zero
            return
        }

        let columns = min(2, layoutViews.count)
        let rows = Int(ceil(Double(layoutViews.count) / Double(columns)))
        var columnWidths = Array(repeating: CGFloat.zero, count: columns)
        var rowHeights = Array(repeating: CGFloat.zero, count: rows)
        for (index, size) in sizes.enumerated() {
            columnWidths[index % columns] = max(columnWidths[index % columns], size.width)
            rowHeights[index / columns] = max(rowHeights[index / columns], size.height)
        }

        var xOffsets = Array(repeating: Metrics.worldMargin, count: columns)
        for column in 1..<columns {
            xOffsets[column] = xOffsets[column - 1] + columnWidths[column - 1] + Metrics.workspaceGap
        }
        var yOffsets = Array(repeating: Metrics.worldMargin, count: rows)
        for row in 1..<rows {
            yOffsets[row] = yOffsets[row - 1] + rowHeights[row - 1] + Metrics.workspaceGap
        }

        workspaceUnion = .null
        for (index, view) in layoutViews.enumerated() {
            let column = index % columns
            let row = index / columns
            let size = sizes[index]
            view.frame = NSRect(
                x: xOffsets[column] + (columnWidths[column] - size.width) / 2,
                y: yOffsets[row] + (rowHeights[row] - size.height) / 2,
                width: size.width,
                height: size.height
            ).integral
            workspaceUnion = workspaceUnion.union(view.frame)
        }
    }

    private func cameraBounds(
        for target: NSRect,
        viewport: NSRect,
        alignTargetToTop: Bool = false
    ) -> NSRect {
        let fullViewport = sceneViewportBounds
        guard !target.isNull, target.width > 0, target.height > 0,
              viewport.width > 0, viewport.height > 0,
              fullViewport.width > 0, fullViewport.height > 0
        else { return fullViewport }
        let scale = min(viewport.width / target.width, viewport.height / target.height)
        let originY = alignTargetToTop
            ? target.minY - viewport.minY / scale
            : target.midY - viewport.midY / scale
        return NSRect(
            x: target.midX - viewport.midX / scale,
            y: originY,
            width: fullViewport.width / scale,
            height: fullViewport.height / scale
        )
    }

    private func overviewViewport() -> NSRect {
        let viewport = sceneViewportBounds
        return NSRect(
            x: Metrics.sideInset,
            y: Metrics.topInset,
            width: max(1, viewport.width - Metrics.sideInset * 2),
            height: max(1, viewport.height - Metrics.topInset - Metrics.bottomInset)
        )
    }

    private func currentCameraBounds() -> NSRect {
        if let focusedIndex {
            let sessions = activeSessionTiles
            if sessions.indices.contains(focusedIndex),
               let cluster = workspaceCluster(named: currentWorkspace),
               let terminalFrame = cluster.frameForTerminalViewport(sessions[focusedIndex], in: sceneView)
            {
                return applyingCameraMagnification(to: cameraBounds(
                    for: terminalFrame,
                    viewport: sceneViewportBounds
                ))
            }
        }
        if let cluster = workspaceCluster(named: currentWorkspace) {
            return applyingCameraMagnification(to: cameraBounds(
                for: cluster.frame,
                viewport: sceneViewportBounds
            ))
        }
        return overviewCameraBounds()
    }

    private func applyingCameraMagnification(to cameraBounds: NSRect) -> NSRect {
        guard cameraBounds.width > 0, cameraBounds.height > 0 else { return cameraBounds }
        let width = cameraBounds.width / cameraMagnification
        let height = cameraBounds.height / cameraMagnification
        return NSRect(
            x: cameraBounds.midX - width / 2,
            y: cameraBounds.midY - height / 2,
            width: width,
            height: height
        )
    }

    private func cameraBounds(
        for workspaceID: String,
        tileID: String?,
        focusTerminal: Bool
    ) -> NSRect? {
        guard let cluster = workspaceCluster(named: workspaceID) else { return nil }
        if focusTerminal,
           let tileID,
           let tile = activeSessionTiles(for: workspaceID).first(where: {
               $0.session.tileID == tileID
           }),
           let terminalFrame = cluster.frameForTerminalViewport(tile, in: sceneView)
        {
            return applyingCameraMagnification(to: cameraBounds(
                for: terminalFrame,
                viewport: sceneViewportBounds
            ))
        }
        return applyingCameraMagnification(to: cameraBounds(
            for: cluster.frame,
            viewport: sceneViewportBounds
        ))
    }

    private func refreshSpatialMinimap(
        cameraBounds: NSRect,
        worldBounds: NSRect? = nil
    ) {
        let focusedTileID = focusedIndex.flatMap { index in
            let sessions = activeSessionTiles
            return sessions.indices.contains(index) ? sessions[index].session.tileID : nil
        }
        let models = workspaceClusters.map { cluster in
            let panes = activeSessionTiles(for: cluster.workspaceID).compactMap { tile in
                cluster.frameForSession(tile, in: sceneView).map { frame in
                    SpatialMinimapPane(
                        id: tile.session.tileID,
                        frame: frame,
                        isActive: tile.session.tileID == focusedTileID,
                        activityState: tile.session.activityState
                    )
                }
            }
            return SpatialMinimapWorkspace(
                id: cluster.workspaceID,
                frame: cluster.frame,
                isActive: cluster.workspaceID == currentWorkspace,
                panes: panes
            )
        }
        let sceneWorldBounds = spatialMinimapWorldBounds()
        spatialMinimapView.updateScene(
            worldBounds: worldBounds ?? sceneWorldBounds,
            workspaces: models,
            cameraBounds: cameraBounds
        )
        statusBarView.updateSpatialMinimap(
            worldBounds: sceneWorldBounds,
            workspaces: models,
            cameraBounds: cameraBounds
        )
        layoutSpatialMinimap()
    }

    private func refreshSpatialMinimapActivityStates() {
        if spatialMinimapAnimation != nil {
            refreshSpatialMinimap(
                cameraBounds: spatialMinimapView.representedCameraBounds,
                worldBounds: spatialMinimapView.representedWorldBounds
            )
        } else {
            refreshSpatialMinimap(cameraBounds: sceneView.bounds)
        }
    }

    private func beginSpatialMinimapAnimation(to target: NSRect, duration: TimeInterval) {
        let start = sceneView.bounds
        let world = spatialMinimapWorldBounds()
        guard duration > 0, !world.isNull, world.width > 0, world.height > 0,
              start.width > 0, start.height > 0,
              target.width > 0, target.height > 0
        else {
            endSpatialMinimapAnimation()
            return
        }

        spatialMinimapFadeGeneration += 1
        spatialMinimapHoldUntil = nil
        spatialMinimapView.layer?.removeAllAnimations()
        spatialMinimapAnimation = SpatialMinimapAnimation(
            start: start,
            target: target,
            startedAt: ProcessInfo.processInfo.systemUptime,
            duration: duration
        )
        refreshSpatialMinimap(
            cameraBounds: start,
            worldBounds: world.union(start).union(target)
        )
        spatialMinimapView.alphaValue = isSpatialMinimapPreviewed ? 1 : 0
        spatialMinimapView.isHidden = false
    }

    private func updateSpatialMinimapAnimation(at now: TimeInterval) {
        guard let animation = spatialMinimapAnimation else { return }
        let linearProgress = min(1, max(0, (now - animation.startedAt) / animation.duration))
        let progress = cameraAnimationProgress(CGFloat(linearProgress))
        let width = animation.start.width
            + (animation.target.width - animation.start.width) * progress
        let height = animation.start.height
            + (animation.target.height - animation.start.height) * progress
        let centerX = animation.start.midX
            + (animation.target.midX - animation.start.midX) * progress
        let centerY = animation.start.midY
            + (animation.target.midY - animation.start.midY) * progress
        let cameraBounds = NSRect(
            x: centerX - width / 2,
            y: centerY - height / 2,
            width: width,
            height: height
        )
        spatialMinimapView.updateCameraBounds(cameraBounds)
        statusBarView.updateSpatialMinimapCamera(cameraBounds)

        if !isSpatialMinimapPreviewed {
            spatialMinimapView.alphaValue = min(1, linearProgress / 0.12)
        }
        if linearProgress >= 1 { finishSpatialMinimapAnimation() }
    }

    private func finishSpatialMinimapAnimation() {
        spatialMinimapAnimation = nil
        spatialMinimapView.alphaValue = 1
        let holdUntil = ProcessInfo.processInfo.systemUptime + Motion.minimapHoldDuration
        spatialMinimapHoldUntil = holdUntil
        scheduleSpatialMinimapFade(after: Motion.minimapHoldDuration)
    }

    private func setSpatialMinimapPreviewed(_ isPreviewed: Bool) {
        guard isSpatialMinimapPreviewed != isPreviewed else { return }
        isSpatialMinimapPreviewed = isPreviewed
        if isPreviewed {
            spatialMinimapFadeGeneration += 1
            spatialMinimapView.layer?.removeAllAnimations()
            refreshSpatialMinimapActivityStates()
            spatialMinimapView.alphaValue = 1
            spatialMinimapView.isHidden = false
            return
        }

        guard spatialMinimapAnimation == nil, !spatialMinimapView.isHidden else { return }
        let remainingHold = max(
            0,
            (spatialMinimapHoldUntil ?? ProcessInfo.processInfo.systemUptime)
                - ProcessInfo.processInfo.systemUptime
        )
        scheduleSpatialMinimapFade(after: remainingHold)
    }

    private func scheduleSpatialMinimapFade(after delay: TimeInterval) {
        spatialMinimapFadeGeneration += 1
        let generation = spatialMinimapFadeGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.spatialMinimapFadeGeneration == generation,
                  self.spatialMinimapAnimation == nil,
                  !self.isSpatialMinimapPreviewed
            else { return }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = Motion.minimapFadeOutDuration
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                self.spatialMinimapView.animator().alphaValue = 0
            } completionHandler: { [weak self] in
                Task { @MainActor in
                    guard let self, self.spatialMinimapFadeGeneration == generation,
                          self.spatialMinimapAnimation == nil,
                          !self.isSpatialMinimapPreviewed
                    else { return }
                    self.spatialMinimapHoldUntil = nil
                    self.spatialMinimapView.isHidden = true
                }
            }
        }
    }

    private func endSpatialMinimapAnimation() {
        spatialMinimapFadeGeneration += 1
        spatialMinimapHoldUntil = nil
        spatialMinimapAnimation = nil
        spatialMinimapView.layer?.removeAllAnimations()
        spatialMinimapView.alphaValue = isSpatialMinimapPreviewed ? 1 : 0
        spatialMinimapView.isHidden = !isSpatialMinimapPreviewed
    }

    private func setCameraImmediately() {
        cameraAnimationTimer?.invalidate()
        cameraAnimationTimer = nil
        cameraAnimation = nil
        isTransitioning = false
        endSpatialMinimapAnimation()

        // The scene stays viewport-sized. Changing its world-space bounds moves
        // a camera over stable terminal surfaces instead of resizing the scene.
        sceneView.frame = sceneViewportFrame
        sceneView.bounds = currentCameraBounds()
        sceneView.alphaValue = 1
        refreshSpatialMinimap(cameraBounds: sceneView.bounds)
        needsDisplay = true
    }

    private func moveCamera(
        to destination: NSRect? = nil,
        duration: TimeInterval = Motion.cameraDuration,
        targetAlpha requestedTargetAlpha: CGFloat? = nil,
        completion: (@MainActor () -> Void)? = nil
    ) {
        statusPopoverView.dismiss()
        cameraAnimationTimer?.invalidate()
        let target = destination ?? currentCameraBounds()
        let start = sceneView.bounds
        let targetAlpha = requestedTargetAlpha ?? sceneView.alphaValue
        guard duration > 0, start.width > 0, start.height > 0,
              target.width > 0, target.height > 0
        else {
            sceneView.bounds = target
            sceneView.alphaValue = targetAlpha
            isTransitioning = false
            refreshSpatialMinimap(cameraBounds: sceneView.bounds)
            restoreInputFocus()
            completion?()
            return
        }

        isTransitioning = true
        needsDisplay = true
        sceneView.frame = sceneViewportFrame
        cameraAnimation = CameraAnimation(
            start: start,
            target: target,
            startedAt: ProcessInfo.processInfo.systemUptime,
            duration: duration,
            startAlpha: sceneView.alphaValue,
            targetAlpha: targetAlpha,
            completion: completion
        )
        let timer = Timer(
            timeInterval: 1 / 120,
            target: self,
            selector: #selector(stepCameraAnimation(_:)),
            userInfo: nil,
            repeats: true
        )
        cameraAnimationTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    @objc private func stepCameraAnimation(_ timer: Timer) {
        guard let animation = cameraAnimation else {
            timer.invalidate()
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        let elapsed = now - animation.startedAt
        let linearProgress = min(1, max(0, elapsed / animation.duration))
        let progress = cameraAnimationProgress(CGFloat(linearProgress))
        let hasSpatialMinimapAnimation = spatialMinimapAnimation != nil
        updateSpatialMinimapAnimation(at: now)

        let widthRatio = animation.target.width / animation.start.width
        let heightRatio = animation.target.height / animation.start.height
        let width = animation.start.width * pow(widthRatio, progress)
        let height = animation.start.height * pow(heightRatio, progress)
        let centerX = animation.start.midX + (animation.target.midX - animation.start.midX) * progress
        let centerY = animation.start.midY + (animation.target.midY - animation.start.midY) * progress
        sceneView.bounds = NSRect(
            x: centerX - width / 2,
            y: centerY - height / 2,
            width: width,
            height: height
        )
        sceneView.alphaValue = animation.startAlpha
            + (animation.targetAlpha - animation.startAlpha) * progress
        if !hasSpatialMinimapAnimation {
            statusBarView.updateSpatialMinimapCamera(sceneView.bounds)
        }

        guard linearProgress >= 1 else { return }
        timer.invalidate()
        cameraAnimationTimer = nil
        cameraAnimation = nil
        sceneView.bounds = animation.target
        sceneView.alphaValue = animation.targetAlpha
        isTransitioning = false
        restoreInputFocus()
        needsDisplay = true
        animation.completion?()
    }

    private func prepareForInteractionIntent() -> Bool {
        guard !isPeeking else { return false }
        if isTransitioning {
            cameraAnimationTimer?.invalidate()
            cameraAnimationTimer = nil
            if let cameraAnimation {
                sceneView.bounds = cameraAnimation.target
                sceneView.alphaValue = cameraAnimation.targetAlpha
            }
            cameraAnimation = nil
            isTransitioning = false
            sceneView.alphaValue = 1
            endSpatialMinimapAnimation()
        }
        return true
    }

    private func moveCameraForPolicy(
        _ policy: InteractionIntentPolicy.Camera,
        to destination: NSRect,
        completion: (@MainActor () -> Void)? = nil
    ) {
        if policy == .none || cameraBoundsMatch(sceneView.bounds, destination) {
            completion?()
            return
        }
        let intentPolicy = interactionPolicySession ?? interactionIntentEngine.snapshot()
        moveCamera(
            to: destination,
            duration: TimeInterval(intentPolicy.cameraDurationMilliseconds) / 1_000,
            completion: completion
        )
    }

    private func cameraDestination(
        for policy: InteractionIntentPolicy.Camera,
        direct destination: NSRect
    ) -> NSRect {
        policy == .parentLevel ? currentCameraBounds() : destination
    }

    private func cameraBoundsMatch(_ left: NSRect, _ right: NSRect) -> Bool {
        abs(left.minX - right.minX) < 0.5
            && abs(left.minY - right.minY) < 0.5
            && abs(left.width - right.width) < 0.5
            && abs(left.height - right.height) < 0.5
    }

    private func cameraAnimationProgress(_ linearProgress: CGFloat) -> CGFloat {
        var lower: CGFloat = 0
        var upper: CGFloat = 1
        for _ in 0..<10 {
            let parameter = (lower + upper) / 2
            let x = cubicBezierCoordinate(
                parameter,
                firstControl: Motion.firstControlX,
                secondControl: Motion.secondControlX
            )
            if x < linearProgress {
                lower = parameter
            } else {
                upper = parameter
            }
        }
        let parameter = (lower + upper) / 2
        return cubicBezierCoordinate(parameter, firstControl: 0, secondControl: 1)
    }

    private func cubicBezierCoordinate(
        _ parameter: CGFloat,
        firstControl: CGFloat,
        secondControl: CGFloat
    ) -> CGFloat {
        let inverse = 1 - parameter
        return 3 * inverse * inverse * parameter * firstControl
            + 3 * inverse * parameter * parameter * secondControl
            + parameter * parameter * parameter
    }

    override func scrollWheel(with event: NSEvent) {
        if !processTwoFingerScroll(event) {
            super.scrollWheel(with: event)
        }
    }

    override func swipe(with event: NSEvent) {
        if !processThreeFingerSwipe(event) {
            super.swipe(with: event)
        }
    }

    override func touchesBegan(with event: NSEvent) {
        updateDirectTrackpadSwipe(with: event)
        super.touchesBegan(with: event)
    }

    override func touchesMoved(with event: NSEvent) {
        updateDirectTrackpadSwipe(with: event)
        super.touchesMoved(with: event)
    }

    override func touchesEnded(with event: NSEvent) {
        let remainingTouchCount = indirectTouches(in: event).count
        if directTrackpadSwipe?.fingerCount == 3, remainingTouchCount < 3 {
            finishInteractiveTrackpadSwipe()
        } else if remainingTouchCount < 2 {
            directTrackpadSwipe = nil
        }
        super.touchesEnded(with: event)
    }

    override func touchesCancelled(with event: NSEvent) {
        cancelInteractiveTrackpadSwipe()
        super.touchesCancelled(with: event)
    }

    private func processTwoFingerScroll(_ event: NSEvent) -> Bool {
        let activeTouchCount = indirectTouches(in: event).count
        if activeTouchCount >= 3
            || directTrackpadSwipe?.fingerCount == 3
            || ProcessInfo.processInfo.systemUptime < suppressGestureEventsUntil
        {
            twoFingerCameraSwipe = nil
            return true
        }
        guard focusedIndex == nil,
              event.hasPreciseScrollingDeltas,
              event.phase != [],
              presentedOverlay == nil,
              commandPalette == nil,
              mapEditOverlay == nil,
              !isPeeking
        else { return false }
        if event.momentumPhase != [] { return true }

        if event.phase.contains(.mayBegin) || event.phase.contains(.began) {
            twoFingerCameraSwipe = TwoFingerCameraSwipe()
        }
        if event.phase.contains(.changed) || event.phase.contains(.ended) {
            if twoFingerCameraSwipe == nil {
                twoFingerCameraSwipe = TwoFingerCameraSwipe()
            }
            let deviceDirection: CGFloat = event.isDirectionInvertedFromDevice ? -1 : 1
            twoFingerCameraSwipe?.horizontal += event.scrollingDeltaX * deviceDirection
            twoFingerCameraSwipe?.vertical += event.scrollingDeltaY * deviceDirection
        }
        if event.phase.contains(.cancelled) {
            twoFingerCameraSwipe = nil
            return true
        }
        guard event.phase.contains(.ended), let swipe = twoFingerCameraSwipe else {
            return true
        }
        twoFingerCameraSwipe = nil
        guard let direction = cameraSwipeDirection(
            horizontal: swipe.horizontal,
            vertical: swipe.vertical,
            threshold: CameraSwipe.twoFingerThreshold
        ) else { return true }
        _ = performCameraSwipe(direction, fingerCount: 2)
        return true
    }

    private func processThreeFingerSwipe(_ event: NSEvent) -> Bool {
        if ProcessInfo.processInfo.systemUptime < suppressGestureEventsUntil {
            return true
        }
        guard let direction = cameraSwipeDirection(
            horizontal: event.deltaX,
            vertical: event.deltaY,
            threshold: 0.1
        ) else { return false }
        return performCameraSwipe(direction, fingerCount: 3)
    }

    private func updateDirectTrackpadSwipe(with event: NSEvent) {
        let touches = indirectTouches(in: event)
        guard touches.count == 2 || touches.count == 3 else {
            if touches.count < 2 {
                if directTrackpadSwipe?.fingerCount == 3 {
                    finishInteractiveTrackpadSwipe()
                } else {
                    directTrackpadSwipe = nil
                }
            }
            return
        }
        if directTrackpadSwipe?.fingerCount == 3, touches.count < 3 {
            finishInteractiveTrackpadSwipe()
            return
        }
        let center = touchCenter(touches)
        if directTrackpadSwipe?.fingerCount != touches.count {
            directTrackpadSwipe = DirectTrackpadSwipe(
                fingerCount: touches.count,
                start: center,
                sourceSelectedIndex: selectedIndex
            )
            return
        }
        guard var swipe = directTrackpadSwipe, !swipe.didTrigger else { return }
        let horizontal = center.x - swipe.start.x
        let vertical = -(center.y - swipe.start.y)
        guard let direction = swipe.direction ?? cameraSwipeDirection(
            horizontal: horizontal,
            vertical: vertical,
            threshold: CameraSwipe.directTouchThreshold
        ) else { return }

        if swipe.fingerCount == 3 {
            if swipe.direction == nil {
                guard prepareForCameraSwipePreview() else { return }
                swipe.direction = direction
                swipe.sourceCameraBounds = sceneView.bounds
                swipe.sourceSelectedIndex = selectedIndex
                swipe.pointerLocation = window?.mouseLocationOutsideOfEventStream
                swipe.targetCameraBounds = interactiveCameraTarget(
                    for: direction,
                    pointerLocation: swipe.pointerLocation
                )
            }
            guard let source = swipe.sourceCameraBounds,
                  let target = swipe.targetCameraBounds
            else { return }
            let travel = abs(horizontal) > abs(vertical) ? abs(horizontal) : abs(vertical)
            swipe.progress = min(1, max(0, travel / CameraSwipe.directTouchTravel))
            sceneView.bounds = interpolatedCameraBounds(
                from: source,
                to: target,
                progress: swipe.progress
            )
            statusBarView.updateSpatialMinimapCamera(sceneView.bounds)
            spatialMinimapView.updateCameraBounds(sceneView.bounds)
            directTrackpadSwipe = swipe
            return
        }

        guard performCameraSwipe(direction, fingerCount: 2) else { return }
        swipe.didTrigger = true
        directTrackpadSwipe = swipe
        suppressGestureEventsUntil = ProcessInfo.processInfo.systemUptime
            + CameraSwipe.duplicateSuppressionDuration
    }

    private func prepareForCameraSwipePreview() -> Bool {
        guard presentedOverlay == nil,
              commandPalette == nil,
              mapEditOverlay == nil,
              spatialDrag == nil
        else { return false }
        return prepareForInteractionIntent()
    }

    private func finishInteractiveTrackpadSwipe() {
        guard let swipe = directTrackpadSwipe else { return }
        directTrackpadSwipe = nil
        suppressGestureEventsUntil = ProcessInfo.processInfo.systemUptime
            + CameraSwipe.duplicateSuppressionDuration
        guard swipe.progress >= CameraSwipe.releaseThreshold,
              let direction = swipe.direction,
              commitInteractiveTrackpadSwipe(direction)
        else {
            restoreInteractiveTrackpadSwipe(swipe)
            return
        }
    }

    private func commitInteractiveTrackpadSwipe(
        _ direction: CameraSwipeDirection
    ) -> Bool {
        if direction == .down {
            guard prepareForCameraSwipePreview() else { return false }
            return zoomInOneLevel()
        }
        return performCameraSwipe(direction, fingerCount: 3)
    }

    private func cancelInteractiveTrackpadSwipe() {
        guard let swipe = directTrackpadSwipe else { return }
        directTrackpadSwipe = nil
        restoreInteractiveTrackpadSwipe(swipe)
    }

    private func restoreInteractiveTrackpadSwipe(_ swipe: DirectTrackpadSwipe) {
        if selectedIndex != swipe.sourceSelectedIndex {
            selectedIndex = swipe.sourceSelectedIndex
            updateSelection()
        }
        guard let source = swipe.sourceCameraBounds else { return }
        moveCamera(to: source, duration: CameraSwipe.cancelDuration)
    }

    private func interactiveCameraTarget(
        for direction: CameraSwipeDirection,
        pointerLocation: NSPoint?
    ) -> NSRect? {
        switch direction {
        case .up:
            if focusedIndex != nil, let currentWorkspace {
                return cameraBounds(
                    for: currentWorkspace,
                    tileID: nil,
                    focusTerminal: false
                )
            }
            if currentWorkspace != nil { return overviewCameraBounds() }
            return nil
        case .down:
            selectMapTileUnderPointer(at: pointerLocation)
            if currentWorkspace == nil,
               workspaceClusters.indices.contains(selectedIndex)
            {
                return cameraBounds(
                    for: workspaceClusters[selectedIndex].workspaceID,
                    tileID: nil,
                    focusTerminal: false
                )
            }
            let sessions = activeSessionTiles
            guard let currentWorkspace, sessions.indices.contains(selectedIndex) else {
                return nil
            }
            return cameraBounds(
                for: currentWorkspace,
                tileID: sessions[selectedIndex].session.tileID,
                focusTerminal: true
            )
        case .left, .right:
            let offset = direction == .left ? 1 : -1
            if let focusedIndex {
                let sessions = activeSessionTiles
                guard sessions.count > 1 else { return nil }
                let targetIndex = (focusedIndex + offset + sessions.count) % sessions.count
                return currentWorkspace.flatMap { workspaceID in
                    cameraBounds(
                        for: workspaceID,
                        tileID: sessions[targetIndex].session.tileID,
                        focusTerminal: true
                    )
                }
            }
            if let currentWorkspace,
               workspaces.count > 1,
               let workspaceIndex = workspaces.firstIndex(where: { $0.id == currentWorkspace })
            {
                let targetIndex = (workspaceIndex + offset + workspaces.count) % workspaces.count
                return cameraBounds(
                    for: workspaces[targetIndex].id,
                    tileID: nil,
                    focusTerminal: false
                )
            }
            guard let targetIndex = mapSelectionTargetIndex(for: direction),
                  let targetFrame = mapTileFrame(at: targetIndex)
            else { return nil }
            let size = sceneView.bounds.size
            return NSRect(
                x: targetFrame.midX - size.width / 2,
                y: targetFrame.midY - size.height / 2,
                width: size.width,
                height: size.height
            )
        }
    }

    private func mapSelectionTargetIndex(
        for direction: CameraSwipeDirection
    ) -> Int? {
        let horizontal: Int
        let vertical: Int
        switch direction {
        case .left: (horizontal, vertical) = (1, 0)
        case .right: (horizontal, vertical) = (-1, 0)
        case .up: (horizontal, vertical) = (0, -1)
        case .down: (horizontal, vertical) = (0, 1)
        }
        let columns = activeColumns
        let row = selectedIndex / columns + vertical
        let column = selectedIndex % columns + horizontal
        guard row >= 0, column >= 0, column < columns else { return nil }
        let target = row * columns + column
        return target < activeCount ? target : nil
    }

    private func mapTileFrame(at index: Int) -> NSRect? {
        if currentWorkspace == nil {
            guard workspaceClusters.indices.contains(index) else { return nil }
            return workspaceClusters[index].frame
        }
        let sessions = activeSessionTiles
        guard sessions.indices.contains(index) else { return nil }
        return sessions[index].convert(sessions[index].bounds, to: sceneView)
    }

    private func overviewCameraBounds() -> NSRect {
        applyingCameraMagnification(to: cameraBounds(
            for: workspaceUnion.insetBy(dx: -Metrics.worldMargin / 2, dy: 0),
            viewport: overviewViewport(),
            alignTargetToTop: true
        ))
    }

    private func interpolatedCameraBounds(
        from source: NSRect,
        to target: NSRect,
        progress: CGFloat
    ) -> NSRect {
        let width = source.width * pow(target.width / source.width, progress)
        let height = source.height * pow(target.height / source.height, progress)
        let centerX = source.midX + (target.midX - source.midX) * progress
        let centerY = source.midY + (target.midY - source.midY) * progress
        return NSRect(
            x: centerX - width / 2,
            y: centerY - height / 2,
            width: width,
            height: height
        )
    }

    private func indirectTouches(in event: NSEvent) -> [NSTouch] {
        event.touches(matching: .touching, in: self).filter {
            $0.type == .indirect
        }
    }

    private func touchCenter(_ touches: [NSTouch]) -> NSPoint {
        let total = touches.reduce(NSPoint.zero) { partial, touch in
            NSPoint(
                x: partial.x + touch.normalizedPosition.x,
                y: partial.y + touch.normalizedPosition.y
            )
        }
        let count = CGFloat(touches.count)
        return NSPoint(x: total.x / count, y: total.y / count)
    }

    private func cameraSwipeDirection(
        horizontal: CGFloat,
        vertical: CGFloat,
        threshold: CGFloat
    ) -> CameraSwipeDirection? {
        guard max(abs(horizontal), abs(vertical)) >= threshold else { return nil }
        if abs(horizontal) > abs(vertical) {
            return horizontal > 0 ? .right : .left
        }
        return vertical > 0 ? .down : .up
    }

    @discardableResult
    func performCameraSwipe(
        _ direction: CameraSwipeDirection,
        fingerCount: Int,
        pointerLocation: NSPoint? = nil
    ) -> Bool {
        guard fingerCount == 2 || fingerCount == 3,
              presentedOverlay == nil,
              commandPalette == nil,
              mapEditOverlay == nil,
              spatialDrag == nil
        else { return false }
        if fingerCount == 2, focusedIndex != nil { return false }
        guard prepareForInteractionIntent() else { return false }

        if fingerCount == 2 {
            return moveMapSelectionForSwipe(direction)
        }

        switch direction {
        case .up:
            return zoomOutOneLevel()
        case .down:
            selectMapTileUnderPointer(at: pointerLocation)
            return zoomInOneLevel()
        case .left:
            if focusedIndex != nil { return cycleFocusedTerminal(by: 1) }
            if currentWorkspace != nil { return cycleFocusedWorkspace(by: 1) }
            return moveMapSelectionForSwipe(.left)
        case .right:
            if focusedIndex != nil { return cycleFocusedTerminal(by: -1) }
            if currentWorkspace != nil { return cycleFocusedWorkspace(by: -1) }
            return moveMapSelectionForSwipe(.right)
        }
    }

    private func selectMapTileUnderPointer(at suppliedLocation: NSPoint?) {
        guard focusedIndex == nil,
              let point = suppliedLocation ?? window?.mouseLocationOutsideOfEventStream
        else { return }
        if currentWorkspace == nil {
            guard let index = workspaceClusters.firstIndex(where: { cluster in
                cluster.convert(cluster.bounds, to: nil).contains(point)
            }), index != selectedIndex
            else { return }
            selectedIndex = index
            updateSelection()
            return
        }
        let sessions = activeSessionTiles
        guard let index = sessions.firstIndex(where: { tile in
            tile.convert(tile.bounds, to: nil).contains(point)
        }), index != selectedIndex
        else { return }
        selectedIndex = index
        updateSelection()
    }

    private func moveMapSelectionForSwipe(_ direction: CameraSwipeDirection) -> Bool {
        let priorIndex = selectedIndex
        let moved: Bool
        switch direction {
        case .left:
            moved = moveSelection(horizontal: 1, vertical: 0)
        case .right:
            moved = moveSelection(horizontal: -1, vertical: 0)
        case .up:
            moved = moveSelection(horizontal: 0, vertical: -1)
        case .down:
            moved = moveSelection(horizontal: 0, vertical: 1)
        }
        guard moved else { return false }
        guard selectedIndex != priorIndex,
              let targetFrame = selectedMapTileFrame()
        else { return true }
        let cameraSize = sceneView.bounds.size
        let target = NSRect(
            x: targetFrame.midX - cameraSize.width / 2,
            y: targetFrame.midY - cameraSize.height / 2,
            width: cameraSize.width,
            height: cameraSize.height
        )
        beginSpatialMinimapAnimation(to: target, duration: Motion.terminalSwitchDuration)
        moveCamera(to: target, duration: Motion.terminalSwitchDuration)
        return true
    }

    private func selectedMapTileFrame() -> NSRect? {
        if currentWorkspace == nil {
            guard workspaceClusters.indices.contains(selectedIndex) else { return nil }
            return workspaceClusters[selectedIndex].frame
        }
        let sessions = activeSessionTiles
        guard sessions.indices.contains(selectedIndex) else { return nil }
        return sessions[selectedIndex].convert(sessions[selectedIndex].bounds, to: sceneView)
    }

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
        if event.keyCode == 53, modifiers.isEmpty, mapEditOverlay != nil {
            dismissMapEditOverlay()
            return
        }
        if focusedIndex != nil { return }
        guard !isTransitioning else { return }

        if modifiers.isEmpty {
            switch event.keyCode {
            case 36, 76:
                activate(selectedIndex)
                return
            case 49:
                if !event.isARepeat { beginPeek() }
                return
            case 53:
                if currentWorkspace != nil { showWorkspaceDeck() }
                return
            case 51:
                removeLastLabelCharacter()
                return
            default:
                break
            }

            if let characters = event.charactersIgnoringModifiers?.lowercased(),
               characters.count == 1,
               let scalar = characters.unicodeScalars.first,
               CharacterSet.alphanumerics.contains(scalar)
            {
                appendLabelCharacter(characters)
                return
            }
        }
        super.keyDown(with: event)
    }

    override func keyUp(with event: NSEvent) {
        if event.keyCode == 49, isPeeking {
            endPeek()
            return
        }
        super.keyUp(with: event)
    }

    private func showOverviewFromStatusBar() {
        guard presentedOverlay == nil, commandPalette == nil,
              !isPeeking, prepareForInteractionIntent()
        else { return }
        let workspaceID = currentWorkspace
        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = workspaceID.flatMap { id in
            workspaceClusters.firstIndex(where: { $0.workspaceID == id })
        } ?? min(selectedIndex, max(0, workspaceClusters.count - 1))
        updateSelection()
        moveCamera()
    }

    private func selectWorkspaceFromStatusBar(_ workspaceID: String) {
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking,
              workspaceClusters.contains(where: { $0.workspaceID == workspaceID })
        else { return }

        if workspaceID == selectedWorkspaceID() {
            zoomOutOneLevel()
            return
        }

        let sessions = activeSessionTiles(for: workspaceID)
        clearLabelBuffer()
        beginWorkspaceTransition(
            to: workspaceID,
            tileID: sessions.first?.session.tileID,
            focusTerminal: sessions.count == 1,
            direction: workspaceTransitionDirection(to: workspaceID)
        )
    }

    private func selectTerminalFromStatusBar(_ terminalID: String) {
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking,
              let tile = allSessionTiles.first(where: { $0.session.id == terminalID })
        else { return }

        let workspaceID = tile.session.workspaceID
        if workspaceID != currentWorkspace {
            clearLabelBuffer()
            beginWorkspaceTransition(
                to: workspaceID,
                tileID: tile.session.tileID,
                focusTerminal: true,
                direction: workspaceTransitionDirection(to: workspaceID)
            )
            return
        }

        guard let index = activeSessionTiles.firstIndex(where: { $0 === tile }) else { return }
        let wasFocused = focusedIndex != nil
        selectedIndex = index
        focusedIndex = index
        clearLabelBuffer()
        updateSelection()
        if wasFocused {
            panCameraToCurrentTarget(duration: Motion.terminalSwitchDuration)
        } else {
            moveCamera()
        }
    }

    private func updateStatusPopover(
        widget: MachinenStatusWidget?,
        anchor: NSRect,
        detail: String?
    ) {
        guard let detail, !detail.isEmpty else {
            statusPopoverView.dismiss()
            return
        }
        let title: String
        let tone: MachinenStatusWidget.Tone
        if let widget {
            title = widget.label ?? widget.id
            tone = widget.tone
        } else {
            title = statusBarView.title
            tone = .neutral
        }
        statusPopoverView.present(
            title: title,
            detail: detail,
            tone: tone,
            at: statusBarView.convert(anchor, to: self),
            within: bounds
        )
    }

    private func select(_ index: Int) {
        guard (0..<activeCount).contains(index) else { return }
        selectedIndex = index
        updateSelection()
    }

    private func beginSpatialDrag(for tile: TerminalTileView, event: NSEvent) {
        guard currentWorkspace != nil,
              focusedIndex == nil,
              !isTransitioning,
              !isPeeking,
              presentedOverlay == nil,
              commandPalette == nil
        else { return }
        // A workspace is an execution location, so terminals only reorder
        // inside their existing workspace. Workspace cards remain reorderable.
        spatialDrag = SpatialDrag(
            item: .terminal(tile.session.id),
            startWindowPoint: event.locationInWindow
        )
    }

    private func beginSpatialDrag(for cluster: WorkspaceClusterView, event: NSEvent) {
        guard currentWorkspace == nil,
              focusedIndex == nil,
              !isTransitioning,
              !isPeeking,
              presentedOverlay == nil,
              commandPalette == nil
        else { return }
        spatialDrag = SpatialDrag(
            item: .workspace(cluster.workspaceID),
            startWindowPoint: event.locationInWindow
        )
    }

    private func updateSpatialDrag(with event: NSEvent) {
        guard var spatialDrag else { return }
        let deltaX = event.locationInWindow.x - spatialDrag.startWindowPoint.x
        let deltaY = event.locationInWindow.y - spatialDrag.startWindowPoint.y
        guard spatialDrag.didMove || hypot(deltaX, deltaY) >= 5 else { return }
        let scenePoint = pointInScene(for: event)
        if !spatialDrag.didMove {
            spatialDrag.didMove = true
            self.spatialDrag = spatialDrag
            beginDragGhost(for: spatialDrag.item)
            setDraggedItemAlpha(spatialDrag.item, alpha: 0.26)
        }
        moveDragGhost(to: scenePoint)
        updateDragTarget(at: scenePoint, for: spatialDrag.item)
    }

    @discardableResult
    private func endSpatialDrag(with event: NSEvent) -> Bool {
        guard let spatialDrag else { return false }
        self.spatialDrag = nil
        defer {
            setDraggedItemAlpha(spatialDrag.item, alpha: 1)
            clearDragTarget()
            discardDragGhost()
        }
        guard spatialDrag.didMove else { return false }
        let point = pointInScene(for: event)
        switch spatialDrag.item {
        case let .workspace(workspaceID):
            guard currentWorkspace == nil,
                  let source = workspaceClusters.firstIndex(where: { $0.workspaceID == workspaceID }),
                  let target = nearestWorkspaceIndex(to: point)
            else { return true }
            reorderWorkspace(from: source, to: target)
        case let .terminal(terminalID):
            guard let tile = allSessionTiles.first(where: { $0.session.id == terminalID }),
                  let workspaceID = currentWorkspace,
                  let source = activeSessionTiles.firstIndex(where: { $0 === tile }),
                  let target = nearestTerminalIndex(to: point, in: workspaceID)
            else { return true }
            reorderTerminal(in: workspaceID, from: source, to: target)
        }
        return true
    }

    private func pointInScene(for event: NSEvent) -> NSPoint {
        let deckPoint = convert(event.locationInWindow, from: nil)
        return sceneView.convert(deckPoint, from: self)
    }

    private func updateDragTarget(at point: NSPoint, for item: SpatialDragItem) {
        switch item {
        case .workspace:
            let target = nearestWorkspaceIndex(to: point).flatMap { workspaceClusters[$0] }
            setDragTarget(workspace: target)
        case .terminal:
            setDragTarget(workspace: nil)
            let target = currentWorkspace.flatMap { workspaceID in
                nearestTerminalIndex(to: point, in: workspaceID).map { activeSessionTiles[$0] }
            }
            setDragTarget(tile: target)
        }
    }

    private func nearestWorkspaceIndex(to point: NSPoint) -> Int? {
        workspaceClusters.indices.min { lhs, rhs in
            squaredDistance(point, from: center(of: workspaceClusters[lhs].frame))
                < squaredDistance(point, from: center(of: workspaceClusters[rhs].frame))
        }
    }

    private func nearestTerminalIndex(to point: NSPoint, in workspaceID: String) -> Int? {
        guard let cluster = workspaceCluster(named: workspaceID) else { return nil }
        let sessions = activeSessionTiles
        return sessions.indices.min { lhs, rhs in
            let left = cluster.frameForSession(sessions[lhs], in: sceneView).map(center(of:)) ?? .zero
            let right = cluster.frameForSession(sessions[rhs], in: sceneView).map(center(of:)) ?? .zero
            return squaredDistance(point, from: left) < squaredDistance(point, from: right)
        }
    }

    private func center(of rect: NSRect) -> NSPoint {
        NSPoint(x: rect.midX, y: rect.midY)
    }

    private func squaredDistance(_ point: NSPoint, from center: NSPoint) -> CGFloat {
        let deltaX = point.x - center.x
        let deltaY = point.y - center.y
        return deltaX * deltaX + deltaY * deltaY
    }

    private func beginDragGhost(for item: SpatialDragItem) {
        guard case let .terminal(terminalID) = item,
              let tile = allSessionTiles.first(where: { $0.session.id == terminalID }),
              let image = terminalSnapshot(of: tile)
        else { return }

        let ghost = NSImageView(frame: tile.convert(tile.bounds, to: sceneView))
        ghost.image = image
        ghost.imageScaling = .scaleAxesIndependently
        ghost.alphaValue = 0.94
        ghost.wantsLayer = true
        ghost.layer?.cornerRadius = 7
        ghost.layer?.masksToBounds = true
        sceneView.addSubview(ghost, positioned: .above, relativeTo: nil)
        dragGhost = ghost
    }

    private func moveDragGhost(to point: NSPoint) {
        guard let dragGhost else { return }
        var frame = dragGhost.frame
        frame.origin = NSPoint(x: point.x - frame.width / 2, y: point.y - frame.height / 2)
        dragGhost.frame = frame.integral
    }

    private func finishDragGhost(at destination: NSRect) {
        guard let dragGhost else { return }
        self.dragGhost = nil
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            dragGhost.animator().frame = destination
            dragGhost.animator().alphaValue = 0
        } completionHandler: {
            Task { @MainActor in
                dragGhost.removeFromSuperview()
            }
        }
    }

    private func discardDragGhost() {
        dragGhost?.removeFromSuperview()
        dragGhost = nil
    }

    private func setDraggedItemAlpha(_ item: SpatialDragItem, alpha: CGFloat) {
        switch item {
        case let .workspace(workspaceID):
            workspaceCluster(named: workspaceID)?.alphaValue = alpha
        case let .terminal(terminalID):
            allSessionTiles.first(where: { $0.session.id == terminalID })?.alphaValue = alpha
        }
    }

    private func setDragTarget(tile: TerminalTileView?) {
        guard dragTargetTile !== tile else { return }
        dragTargetTile?.isActivated = false
        dragTargetTile = tile
        dragTargetTile?.isActivated = true
    }

    private func setDragTarget(workspace: WorkspaceClusterView?) {
        guard dragTargetWorkspace !== workspace else { return }
        dragTargetWorkspace?.isDragTarget = false
        dragTargetWorkspace = workspace
        dragTargetWorkspace?.isDragTarget = true
    }

    private func clearDragTarget() {
        dragTargetTile?.isActivated = false
        dragTargetTile = nil
        dragTargetWorkspace?.isDragTarget = false
        dragTargetWorkspace = nil
    }

    private func reorderWorkspace(from source: Int, to target: Int) {
        guard source != target,
              workspaceClusters.indices.contains(source),
              workspaces.indices.contains(source)
        else { return }
        let workspace = workspaces.remove(at: source)
        workspaces.insert(workspace, at: target)
        rebuildWorkspaceClusters()
        selectedIndex = target
        updateWorldGeometry()
        setCameraImmediately()
        updateSelection()
        saveSessions()
        emitAPIEvent("workspace.moved", data: workspaceJSON(workspace))
    }

    private func terminalSnapshot(of tile: TerminalTileView) -> NSImage? {
        viewSnapshot(of: tile)
    }

    private func viewSnapshot(of view: NSView) -> NSImage? {
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        let image = NSImage(size: bitmap.size)
        image.addRepresentation(bitmap)
        return image
    }

    private func paneRemovalSnapshot(of view: NSView) -> NSImageView? {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
              !view.bounds.isEmpty,
              let image = viewSnapshot(of: view)
        else { return nil }

        let snapshot = NSImageView(frame: view.convert(view.bounds, to: self).integral)
        snapshot.identifier = NSUserInterfaceItemIdentifier("pane-close-animation")
        snapshot.image = image
        snapshot.imageScaling = .scaleAxesIndependently
        snapshot.wantsLayer = true
        snapshot.layer?.cornerRadius = 7
        snapshot.layer?.masksToBounds = true
        addSubview(snapshot, positioned: .below, relativeTo: statusBarView)
        return snapshot
    }

    private func finishPaneRemoval(
        snapshot: NSImageView?,
        previousFrames: [(tile: TerminalTileView, frame: NSRect)] = []
    ) {
        let cameraTarget = currentCameraBounds()
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        guard !reduceMotion else {
            snapshot?.removeFromSuperview()
            moveCamera(to: cameraTarget, duration: 0)
            return
        }

        let reflows = previousFrames.compactMap { previous -> (TerminalTileView, NSRect)? in
            guard previous.tile.superview != nil else { return nil }
            let destination = previous.tile.frame
            previous.tile.frame = previous.frame
            return (previous.tile, destination)
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = Motion.paneCloseDuration
            context.allowsImplicitAnimation = true
            if let snapshot {
                let horizontalInset = snapshot.frame.width * (1 - Motion.paneCloseScale) / 2
                let verticalInset = snapshot.frame.height * (1 - Motion.paneCloseScale) / 2
                snapshot.animator().frame = snapshot.frame.insetBy(
                    dx: horizontalInset,
                    dy: verticalInset
                )
                snapshot.animator().alphaValue = 0
            }
            for (tile, destination) in reflows {
                tile.animator().frame = destination
            }
        } completionHandler: {
            Task { @MainActor in
                snapshot?.removeFromSuperview()
            }
        }
        moveCamera(to: cameraTarget, duration: Motion.paneCloseDuration)
    }

    private func reorderTerminal(in workspaceID: String, from source: Int, to target: Int) {
        var sessions = activeSessionTiles
        guard source != target, sessions.indices.contains(source), sessions.indices.contains(target) else {
            return
        }
        let moved = sessions.remove(at: source)
        sessions.insert(moved, at: target)
        let unaffected = allSessionTiles
        allSessionTiles = workspaces.flatMap { workspace in
            workspace.id == workspaceID
                ? sessions
                : unaffected.filter { $0.session.workspaceID == workspace.id }
        }
        selectedIndex = target
        updateWorldGeometry()
        setCameraImmediately()
        if let destinationFrame = workspaceCluster(named: workspaceID)?.frameForSession(moved, in: sceneView) {
            finishDragGhost(at: destinationFrame)
        }
        updateSelection()
        saveSessions()
        emitAPIEvent("tile.moved", data: tileJSON(moved))
    }

    private func updateSelection() {
        for (index, cluster) in workspaceClusters.enumerated() {
            cluster.isSelected = currentWorkspace == nil && index == selectedIndex
            cluster.isEntered = cluster.workspaceID == currentWorkspace
        }
        let sessions = activeSessionTiles
        let focusedTile = focusedIndex.flatMap { index in
            sessions.indices.contains(index) ? sessions[index] : nil
        }
        if let currentWorkspace, let focusedTile {
            activeTerminalByWorkspace[currentWorkspace] = focusedTile.session.tileID
        }
        for tile in allSessionTiles {
            tile.isSelected = false
            tile.isFocused = tile === focusedTile
        }
        addTerminalTileView?.isSelected = false
        addTerminalTileView?.isFocused = false
        if currentWorkspace != nil, sessions.indices.contains(selectedIndex) {
            sessions[selectedIndex].isSelected = true
        }
        needsDisplay = true
        refreshSpatialMinimap(cameraBounds: sceneView.bounds)
        refreshStatusBar()
        if !isShuttingDown, let workspace = selectedWorkspaceRecord(),
           let targetID = targetID(for: workspace.location),
           let targetLocation = registeredTargetLocation(id: targetID)
        {
            refreshRegisteredTarget(targetID, at: targetLocation, force: false)
        }
        // Camera motion is cosmetic. Keep AppKit's responder chain in lockstep
        // with the logical focused tile before, during, and after a zoom.
        restoreInputFocus()
        emitAPIEvent("ui.changed", data: uiJSON())
    }

    private func moveSelection(horizontal: Int, vertical: Int) -> Bool {
        guard presentedOverlay == nil, commandPalette == nil,
              focusedIndex == nil, !isTransitioning, !isPeeking,
              activeCount > 0
        else { return false }
        clearLabelBuffer()
        let columns = activeColumns
        let row = selectedIndex / columns + vertical
        let column = selectedIndex % columns + horizontal
        guard row >= 0, column >= 0, column < columns else { return true }
        let target = row * columns + column
        guard target < activeCount else { return true }
        select(target)
        return true
    }

    private func reorderSelection(horizontal: Int, vertical: Int) -> Bool {
        guard presentedOverlay == nil, commandPalette == nil,
              focusedIndex == nil, !isTransitioning, !isPeeking,
              activeCount > 0
        else { return false }
        guard activeCount > 1 else { return true }
        let columns = activeColumns
        let row = selectedIndex / columns + vertical
        let column = selectedIndex % columns + horizontal
        guard row >= 0, column >= 0, column < columns else { return true }
        let target = row * columns + column
        guard target < activeCount else { return true }

        if currentWorkspace == nil {
            workspaceClusters.swapAt(selectedIndex, target)
            workspaces.swapAt(selectedIndex, target)
            let workspaceOrder = workspaceClusters.map(\.workspaceID)
            allSessionTiles = workspaceOrder.flatMap { workspaceID in
                allSessionTiles.filter { $0.session.workspaceID == workspaceID }
            }
        } else {
            let workspaceIndexes = allSessionTiles.indices.filter {
                allSessionTiles[$0].session.workspaceID == currentWorkspace
            }
            guard workspaceIndexes.indices.contains(selectedIndex), workspaceIndexes.indices.contains(target) else {
                return true
            }
            allSessionTiles.swapAt(workspaceIndexes[selectedIndex], workspaceIndexes[target])
        }
        selectedIndex = target
        updateWorldGeometry()
        setCameraImmediately()
        updateSelection()
        saveSessions()
        if currentWorkspace == nil,
           workspaceClusters.indices.contains(selectedIndex),
           let workspace = workspaces.first(where: {
               $0.id == workspaceClusters[selectedIndex].workspaceID
           })
        {
            emitAPIEvent("workspace.moved", data: workspaceJSON(workspace))
        } else if activeSessionTiles.indices.contains(selectedIndex) {
            emitAPIEvent("tile.moved", data: tileJSON(activeSessionTiles[selectedIndex]))
        }
        return true
    }

    private func beginPeek() {
        guard !isTransitioning, !isPeeking, focusedIndex == nil else { return }
        let target: NSRect?
        if currentWorkspace == nil, workspaceClusters.indices.contains(selectedIndex) {
            target = workspaceClusters[selectedIndex].frame.insetBy(dx: -12, dy: -12)
        } else {
            let sessions = activeSessionTiles
            if sessions.indices.contains(selectedIndex),
               let cluster = workspaceCluster(named: currentWorkspace)
            {
                target = cluster.frameForSession(sessions[selectedIndex], in: sceneView)
            } else {
                target = nil
            }
        }
        guard let target else { return }
        clearLabelBuffer()
        isPeeking = true
        peekCameraBounds = sceneView.bounds
        moveCamera(
            to: cameraBounds(for: target, viewport: sceneViewportBounds),
            duration: Motion.peekDuration
        )
    }

    private func endPeek() {
        guard isPeeking, let cameraBounds = peekCameraBounds else { return }
        isPeeking = false
        peekCameraBounds = nil
        moveCamera(to: cameraBounds, duration: Motion.peekDuration)
    }

    /// A terminal card is an identity-bearing live surface even in an overview
    /// preview. Resolve it from the rendered pointer location instead of only
    /// trusting the child hit target, which can be stale while a transformed
    /// scene is settling after a camera move.
    private func focusClickedTile(
        at windowPoint: NSPoint,
        fallback: TerminalTileView,
        animate: Bool = true
    ) {
        guard focusedIndex == nil,
              commandPalette == nil,
              !isPeeking
        else {
            InputRoutingLog.log("deck ignores tile focus focusedIndex=\(String(describing: focusedIndex)) palette=\(commandPalette != nil) peeking=\(isPeeking)")
            return
        }
        let tile = terminalTile(at: windowPoint) ?? fallback
        currentWorkspace = tile.session.workspaceID
        let sessions = activeSessionTiles
        guard let index = sessions.firstIndex(where: { $0 === tile }) else {
            InputRoutingLog.log("deck cannot find clicked tile=\(tile.session.tileID) in active workspace")
            return
        }
        InputRoutingLog.log("deck focuses tile=\(tile.session.tileID) index=\(index) animate=\(animate)")
        selectedIndex = index
        focusedIndex = index
        clearLabelBuffer()
        updateSelection()
        if animate { moveCamera() }
    }

    private func terminalTile(at windowPoint: NSPoint) -> TerminalTileView? {
        let deckPoint = convert(windowPoint, from: nil)
        let candidates = currentWorkspace == nil ? allSessionTiles : activeSessionTiles
        return candidates.first { tile in
            tile.convert(tile.bounds, to: self).contains(deckPoint)
        }
    }

    private func activate(_ index: Int) {
        guard (0..<activeCount).contains(index), focusedIndex == nil,
              commandPalette == nil, !isTransitioning
        else { return }
        if mapEditOverlay != nil, currentWorkspace == nil,
           workspaceClusters.indices.contains(index),
           workspaceClusters[index].renderingMode == .workspace
        {
            _ = enterWorkspaceDuringMapEdit(at: index)
            return
        }
        select(index)
        clearLabelBuffer()

        if currentWorkspace == nil {
            let cluster = workspaceClusters[index]
            switch cluster.renderingMode {
            case .newWorkspace:
                beginInlineWorkspaceCreation(in: cluster)
                return
            case .ghost:
                guard let (targetID, record) = ghostWorkspaceTargets[cluster.workspaceID],
                      let location = registeredTargetLocation(id: targetID)
                else { return }
                dismissMapEditOverlay(restorePreviousView: false)
                restoreNativeWorkspace(record, at: location)
                return
            case .workspace:
                break
            }
            currentWorkspace = cluster.workspaceID
            selectedIndex = 0
            if cluster.sessions.count == 1 {
                focusedIndex = 0
            }
            updateSelection()
            moveCamera()
        } else {
            let tile = activeSessionTiles[index]
            if tile.renderingMode == .newTerminal {
                beginInlineTerminalCreation(in: tile)
                return
            }
            focusedIndex = index
            updateSelection()
            moveCamera()
        }
    }

    private func showWorkspaceDeck(completion: (@MainActor () -> Void)? = nil) {
        guard let workspace = currentWorkspace, focusedIndex == nil, !isTransitioning else { return }
        selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == workspace } ?? 0
        currentWorkspace = nil
        updateSelection()
        moveCamera(completion: completion)
    }

    private func leaveFocusedSession() {
        guard focusedIndex != nil, !isTransitioning else { return }
        let wasSingleton = activeSessionTiles.count == 1
        focusedIndex = nil
        if wasSingleton, let workspace = currentWorkspace {
            selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == workspace } ?? 0
            currentWorkspace = nil
        }
        updateSelection()
        moveCamera()
    }

    func toggleOverview() {
        if commandPalette != nil {
            dismissCommandPalette()
            if focusedIndex != nil { leaveFocusedSession() }
            return
        }
        guard !isTransitioning, !isPeeking else { return }
        if focusedIndex != nil {
            leaveFocusedSession()
        } else {
            activate(selectedIndex)
        }
    }

    private func appendLabelCharacter(_ character: String) {
        NSObject.cancelPreviousPerformRequests(
            withTarget: self,
            selector: #selector(clearLabelBufferAfterDelay),
            object: nil
        )
        labelBuffer += character
        applyLabelBuffer()
        perform(#selector(clearLabelBufferAfterDelay), with: nil, afterDelay: 1.2)
    }

    private func removeLastLabelCharacter() {
        guard !labelBuffer.isEmpty else { return }
        labelBuffer.removeLast()
        applyLabelBuffer()
    }

    private func applyLabelBuffer() {
        guard !labelBuffer.isEmpty else {
            clearLabelBuffer()
            return
        }
        if currentWorkspace == nil {
            let matches = workspaceClusters.indices.filter {
                workspaceClusters[$0].label.hasPrefix(labelBuffer)
            }
            for (index, cluster) in workspaceClusters.enumerated() {
                cluster.alphaValue = matches.contains(index) ? 1 : 0.28
            }
            if let first = matches.first { select(first) }
            if let exact = matches.first(where: { workspaceClusters[$0].label == labelBuffer }) {
                activate(exact)
            }
        } else {
            let sessions = activeSessionTiles
            let matches = sessions.indices.filter { sessions[$0].session.label.hasPrefix(labelBuffer) }
            for (index, tile) in sessions.enumerated() {
                tile.alphaValue = matches.contains(index) ? 1 : 0.28
            }
            if let first = matches.first { select(first) }
            if let exact = matches.first(where: { sessions[$0].session.label == labelBuffer }) {
                activate(exact)
            }
        }
        needsDisplay = true
    }

    private func clearLabelBuffer() {
        labelBuffer = ""
        for cluster in workspaceClusters { cluster.alphaValue = 1 }
        for tile in allSessionTiles { tile.alphaValue = 1 }
        needsDisplay = true
    }

    @objc private func clearLabelBufferAfterDelay() {
        clearLabelBuffer()
    }

    func toggleTargetSessions(anchor: NSRect? = nil, selecting sessionID: String? = nil) {
        guard presentedOverlay == nil, !isTransitioning, !isPeeking else { return }
        if targetSessionsView != nil {
            dismissTargetSessions()
            return
        }
        if commandPalette != nil { dismissCommandPalette() }
        let view = TargetSessionsView(frame: bounds)
        view.anchorRect = anchor
        view.onDismiss = { [weak self] in self?.dismissTargetSessions() }
        view.onActivate = { [weak self] item in self?.activateTargetSessionBrowserItem(item) }
        view.onCloseWorkspace = { [weak self] item in self?.closeTargetWorkspace(item) }
        view.onKillSession = { [weak self] item in self?.killTargetSession(item) }
        view.onAddWorkspace = { [weak self] in self?.beginSharedWorkspaceRegistration() }
        view.onUseComputer = { [weak self] in self?.beginUseAnotherComputer() }
        view.onRemoveTarget = { [weak self] id in self?.confirmRemoveTargetMachine(id) }
        targetSessionsView = view
        addSubview(view, positioned: .above, relativeTo: statusBarView)
        refreshTargetSessionsView()
        if let sessionID { view.selectSession(sessionID) }
        window?.makeFirstResponder(view)
    }

    private func dismissTargetSessions() {
        targetSessionsView?.removeFromSuperview()
        targetSessionsView = nil
        restoreInputFocus()
    }

    private func refreshTargetSessionsView() {
        guard let view = targetSessionsView else { return }
        var items: [TargetSessionBrowserItem] = []
        for target in registeredTargetLocations() {
            let discovery = targetDiscoveries[target.id] ?? TargetDiscovery(
                state: .inactive, sessions: [], workspaces: [], checkedAt: .distantPast, error: nil
            )
            let detail: String
            if let error = discovery.error {
                detail = "Showing the last result · \(error)"
            } else if target.id == "local" {
                detail = "Local computer"
            } else {
                detail = "Connected over SSH"
            }
            items.append(TargetSessionBrowserItem(
                kind: .target,
                targetID: target.id,
                workspaceID: nil,
                sessionID: nil,
                title: target.id == "local" ? "This Mac" : target.name,
                detail: detail,
                state: discovery.state
            ))
            let activeSessions = discovery.sessions
                .filter { $0.state == "running" || $0.state == "created" }
                .sorted { $0.updatedAtMs > $1.updatedAtMs }
            let knownWorkspaceIDs = Set(discovery.workspaces.map(\.id))
            for workspace in discovery.workspaces.sorted(by: {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }) {
                items.append(TargetSessionBrowserItem(
                    kind: .workspace,
                    targetID: target.id,
                    workspaceID: workspace.id,
                    sessionID: nil,
                    title: workspace.name,
                    detail: workspace.rootDirectory,
                    state: discovery.state
                ))
                for session in activeSessions where session.workspaceId == workspace.id {
                    items.append(targetSessionBrowserItem(
                        session,
                        targetID: target.id,
                        parentWorkspaceID: workspace.id,
                        state: discovery.state
                    ))
                }
            }
            let unassigned = activeSessions.filter {
                $0.workspaceId.map { !knownWorkspaceIDs.contains($0) } ?? true
            }
            if !unassigned.isEmpty {
                items.append(TargetSessionBrowserItem(
                    kind: .workspace,
                    targetID: target.id,
                    workspaceID: nil,
                    sessionID: nil,
                    title: "Unassigned",
                    detail: "Sessions without a discovered workspace",
                    state: discovery.state
                ))
                items += unassigned.map {
                    targetSessionBrowserItem(
                        $0,
                        targetID: target.id,
                        parentWorkspaceID: nil,
                        state: discovery.state
                    )
                }
            }
        }
        view.items = items
    }

    private func targetSessionBrowserItem(
        _ session: AvailableTerminalSession,
        targetID: String,
        parentWorkspaceID: String?,
        state: TargetDiscovery.State
    ) -> TargetSessionBrowserItem {
        let targetLocation = registeredTargetLocation(id: targetID)
        let tile = allSessionTiles.first {
            $0.session.id == session.id
                && $0.session.workspaceID == session.workspaceId
                && $0.session.location.machineID == targetLocation?.machineID
        }
        let available = AvailableSessionItem(
            session: session,
            attachmentState: tile.map {
                terminalViewerIsAttached($0.session) ? .attached : .detached
            } ?? .detached,
            localClientID: tile?.session.viewerClientID
        )
        let action: TargetSessionBrowserItem.SessionAction
        let connection: String
        if available.canTakeControl {
            action = .takeControl
            connection = "Viewing · \(session.clients.count) connected"
        } else if available.isAttached {
            action = .detach
            connection = available.hasControl ? "You control" : "Attached"
        } else {
            action = .attach
            connection = "Not attached"
        }
        return TargetSessionBrowserItem(
            kind: .session,
            targetID: targetID,
            workspaceID: session.workspaceId,
            sessionID: session.id,
            title: session.name ?? session.id,
            detail: "\(connection) · \(session.workingDirectory)",
            state: state,
            sessionAction: action,
            parentWorkspaceID: parentWorkspaceID
        )
    }

    private func activateTargetSessionBrowserItem(_ item: TargetSessionBrowserItem) {
        guard let target = registeredTargetLocations().first(where: { $0.id == item.targetID }),
              let discovery = targetDiscoveries[item.targetID]
        else { return }
        switch item.kind {
        case .target:
            refreshRegisteredTarget(target.id, at: target.location, force: true)
        case .workspace:
            guard let id = item.workspaceID,
                  let record = discovery.workspaces.first(where: { $0.id == id }) else { return }
            dismissTargetSessions()
            restoreNativeWorkspace(record, at: target.location, opensSessions: false)
        case .session:
            guard let sessionID = item.sessionID else { return }
            let workspaceID = item.workspaceID
            if let workspace = workspaceID.flatMap({ id in workspaces.first(where: { $0.id == id }) }) {
                dismissTargetSessions()
                switch item.sessionAction {
                case .takeControl:
                    takeControlOfAvailableSession(sessionID, in: workspace.id)
                case .detach:
                    disconnectAvailableSession(sessionID, in: workspace.id)
                case .attach, nil:
                    reconnectAvailableSession(sessionID, to: workspace.id)
                }
            } else if let workspaceID,
                      let record = discovery.workspaces.first(where: { $0.id == workspaceID })
            {
                // Attaching is explicit; opening its native workspace is the
                // required preceding scene action, never a discovery side effect.
                dismissTargetSessions()
                restoreNativeWorkspace(record, at: target.location, opensSessions: false)
                reconnectAvailableSession(sessionID, to: record.id)
            }
        }
    }

    private func beginSharedWorkspaceRegistration() {
        dismissTargetSessions()
        registersSharedWorkspaceOnly = true
        beginNewWorkspaceFlow(from: .sharedWorkspaces)
    }

    private func beginUseAnotherComputer() {
        dismissTargetSessions()
        showRegisterTargetPalette(returnToSharedWorkspaces: true)
    }

    private func closeTargetWorkspace(_ item: TargetSessionBrowserItem) {
        guard item.kind == .workspace,
              let workspaceID = item.workspaceID,
              let target = registeredTargetLocations().first(where: { $0.id == item.targetID }),
              let discovery = targetDiscoveries[item.targetID],
              let nativeRecord = discovery.workspaces.first(where: { $0.id == workspaceID })
        else { return }
        let sessions = discovery.sessions.filter { $0.workspaceId == workspaceID }
        dismissTargetSessions()
        bufferCloseWorkspace(
            nativeRecord,
            targetID: target.id,
            location: target.location,
            discoveredSessions: sessions
        )
    }

    private func killTargetSession(_ item: TargetSessionBrowserItem) {
        guard item.kind == .session,
              let sessionID = item.sessionID,
              let target = registeredTargetLocations().first(where: { $0.id == item.targetID }),
              let discovery = targetDiscoveries[item.targetID],
              let discovered = discovery.sessions.first(where: { $0.id == sessionID })
        else { return }
        dismissTargetSessions()
        if let workspaceID = item.workspaceID,
           let workspace = workspaces.first(where: { $0.id == workspaceID })
        {
            killAvailableSession(sessionID, in: workspace.id)
            return
        }
        let nativeRecord = item.workspaceID.flatMap { workspaceID in
            discovery.workspaces.first { $0.id == workspaceID }
        }
        let session = TerminalSession(
            id: discovered.id,
            label: "session",
            workspaceID: item.workspaceID ?? "unassigned",
            workspace: nativeRecord?.name ?? "Unassigned",
            name: discovered.name ?? "session",
            launch: .loginShell,
            workingDirectory: discovered.workingDirectory,
            workspaceRoot: nativeRecord?.rootDirectory ?? discovered.workingDirectory,
            sshHost: target.location.sshHost,
            startsSessionIfMissing: false,
            state: .detached
        )
        sessionBackend.remove(session)
        let sessions = discovery.sessions.filter { $0.id != sessionID }
        targetDiscoveries[item.targetID] = TargetDiscovery(
            state: discovery.state == .unreachable
                ? .unreachable
                : (sessions.isEmpty ? .inactive : .online),
            sessions: sessions,
            workspaces: discovery.workspaces,
            checkedAt: discovery.checkedAt,
            error: discovery.error
        )
        availableSessionsByMachine[target.location.machineID]?.removeAll { $0.id == sessionID }
        targetDiscoveryDidChange()
    }

    private func confirmRemoveTargetMachine(_ id: String) {
        guard let target = targetMachines.first(where: { $0.id == id }) else { return }
        dismissTargetSessions()
        presentConfirmation(
            heading: "Stop using \(target.displayName)?",
            message: "This computer will disappear from Sessions and will no longer be checked for sessions.",
            consequence: "Its workspaces and sessions keep running. You can use the computer again later.",
            confirmTitle: "Stop using computer"
        ) { [weak self] in
            self?.removeTargetMachine(id)
        }
    }

    func toggleAvailableSessions(
        returnToCommands: Bool = false,
        selecting sessionID: String? = nil
    ) {
        guard presentedOverlay == nil, !isTransitioning, !isPeeking else { return }
        if availableSessionsView != nil {
            dismissAvailableSessions()
            return
        }
        if commandPalette != nil { dismissCommandPalette() }
        hideUndoToast()
        guard let workspace = selectedWorkspaceRecord() else { return }

        let view = AvailableSessionsView(frame: bounds)
        view.workspaceName = workspace.name
        view.machineName = workspace.location.sshHost ?? "this Mac"
        view.onDismiss = { [weak self] in
            self?.dismissAvailableSessions(navigateBack: true)
        }
        view.onReconnect = { [weak self] sessionID in
            self?.reconnectAvailableSession(sessionID, to: workspace.id)
        }
        view.onDisconnect = { [weak self] sessionID in
            self?.disconnectAvailableSession(sessionID, in: workspace.id)
        }
        view.onTakeControl = { [weak self] sessionID in
            self?.takeControlOfAvailableSession(sessionID, in: workspace.id)
        }
        view.onKill = { [weak self] sessionID in
            self?.killAvailableSession(sessionID, in: workspace.id)
        }
        view.onRefresh = { [weak self] in
            self?.refreshAvailableSessions(for: workspace, force: true)
        }
        availableSessionsWorkspaceID = workspace.id
        availableSessionsReturnsToCommands = returnToCommands
        availableSessionsPendingSelectionID = sessionID
        availableSessionsView = view
        addSubview(view, positioned: .above, relativeTo: statusBarView)
        refreshAvailableSessionsPanel()
        refreshAvailableSessions(for: workspace, force: true)
        window?.makeFirstResponder(view)
    }

    private func dismissAvailableSessions(navigateBack: Bool = false) {
        let shouldReturnToCommands = navigateBack && availableSessionsReturnsToCommands
        availableSessionsView?.removeFromSuperview()
        availableSessionsView = nil
        availableSessionsWorkspaceID = nil
        availableSessionsReturnsToCommands = false
        availableSessionsPendingSelectionID = nil
        if shouldReturnToCommands {
            toggleCommandPalette()
        } else {
            restoreInputFocus()
        }
    }

    private func refreshAvailableSessionsPanel() {
        guard let view = availableSessionsView,
              let workspaceID = availableSessionsWorkspaceID,
              let workspace = workspaces.first(where: { $0.id == workspaceID })
        else { return }
        let machineID = workspace.location.machineID
        view.items = availableSessionItems(for: workspace)
        if let sessionID = availableSessionsPendingSelectionID {
            view.selectSession(sessionID)
            availableSessionsPendingSelectionID = nil
        }
        view.isLoading = targetID(for: workspace.location).map {
            targetDiscoveryInFlight.contains($0)
        } ?? false
        view.errorMessage = availableSessionsErrors[machineID]
    }

    private func availableSessionItems(for workspace: WorkspaceRecord) -> [AvailableSessionItem] {
        let discovered: [AvailableTerminalSession]
        if let targetID = targetID(for: workspace.location) {
            discovered = targetDiscoveries[targetID]?.sessions
                ?? availableSessionsByMachine[workspace.location.machineID]
                ?? []
        } else {
            discovered = []
        }
        let matchingDiscovered = discovered.filter {
                ($0.state == "running" || $0.state == "created")
                    && ($0.workspaceId == workspace.id
                        || ($0.workspaceId == nil
                            && sessionDirectory(
                                $0.workingDirectory,
                                belongsTo: workspace.workingDirectory
                            )))
            }
        var discoveredByID: [String: AvailableTerminalSession] = [:]
        for session in matchingDiscovered { discoveredByID[session.id] = session }

        let represented = allSessionTiles.compactMap { tile -> AvailableSessionItem? in
            guard tile.session.workspaceID == workspace.id else { return nil }
            let session = discoveredByID[tile.session.id] ?? AvailableTerminalSession(
                id: tile.session.id,
                name: tile.session.name,
                state: processState(tile.session.state),
                workspaceId: tile.session.workspaceID,
                workingDirectory: tile.session.workingDirectory,
                createdAtMs: 0,
                updatedAtMs: 0
            )
            return AvailableSessionItem(
                session: session,
                attachmentState: terminalViewerIsAttached(tile.session) ? .attached : .detached,
                localClientID: tile.session.viewerClientID
            )
        }

        let disconnectedTiles = recentlyClosedTerminals.values.compactMap {
            disconnected -> AvailableSessionItem? in
            let session = disconnected.tile.session
            guard session.workspaceID == workspace.id else { return nil }
            let timestamp = Int64(disconnected.disconnectedAt.timeIntervalSince1970 * 1_000)
            return AvailableSessionItem(
                session: AvailableTerminalSession(
                    id: session.id,
                    name: session.name,
                    state: session.state == .detached ? "running" : processState(session.state),
                    workspaceId: session.workspaceID,
                    workingDirectory: session.workingDirectory,
                    createdAtMs: timestamp,
                    updatedAtMs: timestamp
                ),
                attachmentState: .detached,
                localClientID: nil
            )
        }
        let representedIDs = Set(represented.map { $0.session.id })
            .union(disconnectedTiles.map { $0.session.id })
        let unrepresented = matchingDiscovered.compactMap { session -> AvailableSessionItem? in
            guard !representedIDs.contains(session.id) else { return nil }
            return AvailableSessionItem(
                session: session,
                attachmentState: .detached,
                localClientID: nil
            )
        }
        let detached = (disconnectedTiles + unrepresented
            + represented.filter { !$0.isAttached }).sorted {
            if $0.session.updatedAtMs == $1.session.updatedAtMs {
                return ($0.session.name ?? $0.session.id).localizedCaseInsensitiveCompare(
                    $1.session.name ?? $1.session.id
                ) == .orderedAscending
            }
            return $0.session.updatedAtMs > $1.session.updatedAtMs
        }
        return detached + represented.filter(\.isAttached)
    }

    private func sessionDirectory(_ directory: String, belongsTo root: String) -> Bool {
        let candidate = normalizedSessionPath(directory)
        let workspaceRoot = normalizedSessionPath(root)
        guard !candidate.isEmpty, !workspaceRoot.isEmpty else { return false }
        if candidate == workspaceRoot { return true }
        return candidate.hasPrefix(workspaceRoot == "/" ? "/" : workspaceRoot + "/")
    }

    private func normalizedSessionPath(_ path: String) -> String {
        var value = path.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.count > 1, value.hasSuffix("/") { value.removeLast() }
        guard value.hasPrefix("/") else { return value }
        return URL(fileURLWithPath: value).standardizedFileURL.path
    }

    private func startAvailableSessionsPolling() {
        let timer = Timer(timeInterval: availableSessionsRefreshInterval, repeats: true) {
            [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.refreshRegisteredTargets()
            }
        }
        availableSessionsRefreshTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func refreshAvailableSessions(for workspace: WorkspaceRecord, force: Bool) {
        // A removed SSH profile may still back a persisted scene workspace, but
        // it is no longer eligible for discovery.
        guard let targetID = targetID(for: workspace.location),
              let targetLocation = registeredTargetLocation(id: targetID)
        else { return }
        refreshRegisteredTarget(targetID, at: targetLocation, force: force)
        refreshAvailableSessionsPanel()
    }

    private func reconnectAvailableSession(_ sessionID: String, to workspaceID: String) {
        if let tile = allSessionTiles.first(where: {
            $0.session.id == sessionID && $0.session.workspaceID == workspaceID
        }) {
            dismissAvailableSessions()
            tile.transition(to: .starting, terminalText: tile.session.terminalText)
            tile.attachTerminal()
            currentWorkspace = workspaceID
            selectedIndex = activeSessionTiles.firstIndex(where: { $0 === tile }) ?? 0
            focusedIndex = selectedIndex
            updateSelection()
            moveCamera()
            saveSessions()
            emitAPIEvent("tile.viewerChanged", data: tileJSON(tile))
            return
        }
        if recentlyClosedTerminals[sessionID]?.tile.session.workspaceID == workspaceID {
            dismissAvailableSessions()
            reopenClosedTerminal(terminalID: sessionID)
            return
        }
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }),
              let discovered = availableSessionItems(for: workspace)
                .first(where: { $0.session.id == sessionID })?.session
        else {
            refreshAvailableSessionsPanel()
            return
        }

        dismissAvailableSessions()
        let requestedName = discovered.name.flatMap { $0.isEmpty ? nil : $0 } ?? "session"
        let name = nextAvailableSessionName(base: requestedName, workspace: workspace.name)
        let session = TerminalSession(
            id: discovered.id,
            label: nextAvailableLabel(workspace: workspace.name, session: name),
            workspaceID: workspace.id,
            workspace: workspace.name,
            name: name,
            launch: .loginShell,
            workingDirectory: discovered.workingDirectory,
            workspaceRoot: workspace.workingDirectory,
            sshHost: workspace.location.sshHost,
            startsSessionIfMissing: false,
            state: .starting
        )
        let tile = TerminalTileView(session: session)
        installTile(tile)
        installPersistentTerminal(in: tile)
        allSessionTiles.append(tile)
        rebuildWorkspaceClusters()
        currentWorkspace = workspace.id
        selectedIndex = max(0, activeSessionTiles.count - 1)
        focusedIndex = selectedIndex
        updateWorldGeometry()
        updateSelection()
        moveCamera()
        saveSessions()
        emitAPIEvent("tile.created", data: tileJSON(tile))
        emitAPIEvent("terminal.stateChanged", data: terminalJSON(tile))
    }

    private func takeControlOfAvailableSession(_ sessionID: String, in workspaceID: String) {
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }),
              let tile = allSessionTiles.first(where: {
                  $0.session.id == sessionID && $0.session.workspaceID == workspaceID
                      && terminalViewerIsAttached($0.session)
              })
        else {
            refreshAvailableSessionsPanel()
            return
        }
        sessionBackend.takeControl(of: tile.session) { [weak self] result in
            guard let self else { return }
            if case let .failure(error) = result {
                self.availableSessionsErrors[workspace.location.machineID] = error.localizedDescription
            }
            self.refreshAvailableSessions(for: workspace, force: true)
        }
    }

    private func disconnectAvailableSession(_ sessionID: String, in workspaceID: String) {
        guard let tile = allSessionTiles.first(where: {
            $0.session.id == sessionID && $0.session.workspaceID == workspaceID
        }) else {
            refreshAvailableSessionsPanel()
            return
        }
        bufferCloseSession(tile)
        refreshStatusBar()
    }

    private func killAvailableSession(_ sessionID: String, in workspaceID: String) {
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }) else { return }
        let selectedSession = availableSessionItems(for: workspace)
            .first(where: { $0.session.id == sessionID })?.session
        availableSessionsByMachine[workspace.location.machineID]?.removeAll {
            $0.id == sessionID
        }
        if recentlyClosedTerminals[sessionID]?.tile.session.workspaceID == workspaceID {
            finalizePendingClose(terminalID: sessionID)
            refreshAvailableSessionsPanel()
            return
        }
        if let tile = allSessionTiles.first(where: {
            $0.session.id == sessionID && $0.session.workspaceID == workspaceID
        }) {
            bufferCloseSession(tile)
            finalizePendingClose(terminalID: sessionID)
            refreshAvailableSessionsPanel()
            return
        }
        guard let discovered = selectedSession else {
            refreshAvailableSessionsPanel()
            return
        }
        let session = TerminalSession(
            id: discovered.id,
            label: "session",
            workspaceID: workspace.id,
            workspace: workspace.name,
            name: discovered.name ?? "session",
            launch: .loginShell,
            workingDirectory: discovered.workingDirectory,
            workspaceRoot: workspace.workingDirectory,
            sshHost: workspace.location.sshHost,
            startsSessionIfMissing: false,
            state: .detached
        )
        sessionBackend.remove(session)
        refreshAvailableSessionsPanel()
        refreshStatusBar()
    }

    private var currentCommandSpace: PaletteCommand.Space {
        if focusedIndex != nil { return .terminal }
        if currentWorkspace != nil { return .workspace }
        return .workspaceOverview
    }

    private var activeCommandSpaces: [PaletteCommand.Space] {
        switch currentCommandSpace {
        case .workspaceOverview: [.workspaceOverview]
        case .workspace: [.workspace, .workspaceOverview]
        case .terminal: [.terminal, .workspace, .workspaceOverview]
        }
    }

    private var currentInteractionLevel: InteractionIntentPolicy.Level {
        if focusedIndex != nil { return .terminal }
        if currentWorkspace != nil { return .workspace }
        return .overview
    }

    private func interactionRule(
        for intent: InteractionIntentPolicy.Intent,
        at level: InteractionIntentPolicy.Level? = nil
    ) -> InteractionIntentPolicy.Rule? {
        let policy = interactionPolicySession ?? interactionIntentEngine.snapshot()
        return policy.rule(for: intent, at: level ?? currentInteractionLevel)
    }

    private var commandPaletteContext: String {
        switch currentCommandSpace {
        case .workspaceOverview:
            "workspace overview"
        case .workspace:
            "workspace · \(selectedWorkspace() ?? "unknown")"
        case .terminal:
            "terminal · \(selectedSession()?.name ?? "unknown") · \(selectedWorkspace() ?? "workspace")"
        }
    }

    func toggleMapEditOverlay() {
        if mapEditOverlay != nil {
            dismissMapEditOverlay()
            return
        }
        guard prepareForInteractionIntent(),
              let rule = interactionRule(for: .edit),
              rule.panel == .none, rule.effect == .none
        else { return }
        presentMapEditOverlay(cameraPolicy: rule.camera)
    }

    @discardableResult
    private func presentMapEditOverlay(
        cameraPolicy: InteractionIntentPolicy.Camera,
        onPresented: (@MainActor () -> Void)? = nil,
        onReady: (@MainActor () -> Void)? = nil
    ) -> Bool {
        guard !isTransitioning, !isPeeking,
              presentedOverlay == nil, commandPalette == nil, targetSessionsView == nil,
              availableSessionsView == nil
        else { return false }

        if interactionPolicySession == nil {
            interactionPolicySession = interactionIntentEngine.snapshot()
        }
        if mapEditReturnState == nil {
            mapEditReturnState = currentMapEditReturnState()
        }
        if focusedIndex != nil {
            focusedIndex = nil
            updateSelection()
        }

        let actions: [MapEditAction]
        var cardActions: [MapEditCardAction] = []
        let movesToWorkspaceMap = currentWorkspace != nil && selectedWorkspaceID() != nil
        if movesToWorkspaceMap {
            actions = [
                MapEditAction(id: "rename", title: "✎ Rename workspace", detail: "change its label"),
                MapEditAction(id: "close", title: "× Close workspace", detail: "confirm before stop"),
            ]
            installEditTerminalTile()
            updateWorldGeometry()
        } else {
            actions = []
            let attachedWorkspaceIDs = Set(workspaces.map(\.id))
            let ghosts = targetDiscoveries.flatMap { targetID, discovery in
                discovery.workspaces.filter { !attachedWorkspaceIDs.contains($0.id) }.map {
                    (targetID, $0)
                }
            }
            for ghost in ghosts {
                let id = "__ghost__\(ghost.0)__\(ghost.1.id)"
                let cluster = WorkspaceClusterView(
                    workspaceID: id,
                    workspace: ghost.1.name,
                    label: "gh",
                    renderingMode: .ghost
                )
                ghostWorkspaceTargets[id] = ghost
                installEditWorkspaceCluster(cluster)
            }
            let addCluster = WorkspaceClusterView(
                workspaceID: "__new_workspace__",
                workspace: "New workspace",
                label: "+",
                renderingMode: .newWorkspace
            )
            addWorkspaceClusterView = addCluster
            installEditWorkspaceCluster(addCluster)
            updateWorldGeometry()

            for cluster in workspaceClusters where cluster.renderingMode == .workspace {
                let frame = cluster.convert(cluster.bounds, to: self)
                cardActions.append(MapEditCardAction(
                    frame: NSRect(x: frame.maxX - 30, y: frame.minY + 10, width: 22, height: 22),
                    action: MapEditAction(
                        id: "closeWorkspace:\(cluster.workspaceID)",
                        title: "Close workspace",
                        detail: "confirm before stop"
                    )
                ))
            }
        }

        let overlay = MapEditOverlayView(frame: bounds, actions: actions, cardActions: cardActions)
        overlay.layer?.zPosition = 1_500
        overlay.onDismiss = { [weak self] in self?.dismissMapEditOverlay() }
        overlay.onAction = { [weak self] action in self?.runMapEditAction(action) }
        overlay.onShortcut = { [weak self] action in self?.performShortcut(action) ?? false }
        mapEditOverlay = overlay
        addSubview(overlay, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(overlay)
        onPresented?()
        if cameraPolicy != .none {
            moveCameraForPolicy(cameraPolicy, to: currentCameraBounds()) {
                [weak self, weak overlay] in
                guard let self, let overlay, self.mapEditOverlay === overlay else { return }
                onReady?()
            }
        } else {
            onReady?()
        }
        return true
    }

    private func selectMapEditTarget(_ target: InteractionIntentPolicy.Target) {
        let index: Int?
        switch target {
        case .addWorkspace:
            index = workspaceClusters.firstIndex { $0.renderingMode == .newWorkspace }
        case .addTerminal:
            index = activeSessionTiles.firstIndex { $0.renderingMode == .newTerminal }
        case .currentWorkspace, .currentTerminal:
            return
        }
        guard let index else { return }
        select(index)
    }

    private func activateMapEditCreationTarget(
        _ target: InteractionIntentPolicy.Target,
        cameraPolicy: InteractionIntentPolicy.Camera
    ) {
        guard mapEditOverlay != nil, addWorkspaceCardView == nil,
              addTerminalCardView == nil
        else { return }
        switch target {
        case .addWorkspace:
            guard let cluster = workspaceClusters.first(where: {
                $0.renderingMode == .newWorkspace
            }) else { return }
            selectMapEditTarget(target)
            beginInlineWorkspaceCreation(in: cluster, cameraPolicy: cameraPolicy)
        case .addTerminal:
            guard let tile = activeSessionTiles.first(where: {
                $0.renderingMode == .newTerminal
            }) else { return }
            selectMapEditTarget(target)
            beginInlineTerminalCreation(in: tile, cameraPolicy: cameraPolicy)
        case .currentWorkspace, .currentTerminal:
            return
        }
    }

    private func installEditTerminalTile() {
        guard addTerminalTileView == nil,
              let workspace = selectedWorkspaceRecord()
        else { return }
        let session = TerminalSession(
            id: "__new_terminal__",
            tileID: "__new_terminal_tile__",
            label: "+",
            workspaceID: workspace.id,
            workspace: workspace.name,
            name: "New terminal",
            launch: .loginShell,
            workingDirectory: workspace.workingDirectory,
            state: .stopped
        )
        let tile = TerminalTileView(session: session, renderingMode: .newTerminal)
        tile.onSelect = { [weak self, weak tile] _ in
            guard let self, let tile,
                  let index = self.activeSessionTiles.firstIndex(where: { $0 === tile })
            else { return }
            self.activate(index)
        }
        tile.onActivate = { [weak self, weak tile] _ in
            guard let self, let tile,
                  let index = self.activeSessionTiles.firstIndex(where: { $0 === tile })
            else { return }
            self.activate(index)
        }
        addTerminalTileView = tile
    }

    private func installEditWorkspaceCluster(_ cluster: WorkspaceClusterView) {
        cluster.onSelect = { [weak self, weak cluster] in
            guard let self, let cluster,
                  let index = self.workspaceClusters.firstIndex(where: { $0 === cluster })
            else { return }
            self.activate(index)
        }
        cluster.onActivate = { [weak self, weak cluster] in
            guard let self, let cluster,
                  let index = self.workspaceClusters.firstIndex(where: { $0 === cluster })
            else { return }
            self.activate(index)
        }
        workspaceClusters.append(cluster)
        sceneView.addSubview(cluster)
    }

    private func currentMapEditReturnState() -> MapEditReturnState {
        let sessions = activeSessionTiles
        let selectedTileID = sessions.indices.contains(selectedIndex)
            ? sessions[selectedIndex].session.tileID
            : nil
        let focusedTileID = focusedIndex.flatMap { index in
            sessions.indices.contains(index) ? sessions[index].session.tileID : nil
        }
        return MapEditReturnState(
            workspaceID: currentWorkspace,
            overviewWorkspaceID: currentWorkspace == nil ? selectedWorkspaceID() : nil,
            selectedTileID: selectedTileID,
            focusedTileID: focusedTileID
        )
    }

    private func dismissMapEditOverlay(restorePreviousView: Bool = true) {
        let returnState = mapEditReturnState
        mapEditReturnState = nil
        interactionPolicySession = nil
        localizedActionCameraBounds = nil
        removeMapEditPresentation()
        if restorePreviousView, let returnState {
            restoreMapEditReturnState(returnState)
        } else {
            restoreInputFocus()
        }
    }

    private func removeMapEditPresentation() {
        mapEditOverlay?.removeFromSuperview()
        mapEditOverlay = nil
        addTerminalCardView?.removeFromSuperview()
        addTerminalCardView = nil
        if presentedOverlay === inlineConfirmationView { presentedOverlay = nil }
        inlineConfirmationView?.removeFromSuperview()
        inlineConfirmationView = nil
        addTerminalTileView?.removeFromSuperview()
        addTerminalTileView = nil
        removeEditWorkspaceClusters()
    }

    private func enterWorkspaceDuringMapEdit(at index: Int) -> Bool {
        guard mapEditOverlay != nil, currentWorkspace == nil,
              workspaceClusters.indices.contains(index)
        else { return false }
        let cluster = workspaceClusters[index]
        guard cluster.renderingMode == .workspace else { return false }
        let workspaceID = cluster.workspaceID
        removeMapEditPresentation()
        currentWorkspace = workspaceID
        focusedIndex = nil
        selectedIndex = activeTerminalIndex(in: workspaceID)
        updateSelection()
        return presentMapEditOverlay(cameraPolicy: .directIfNeeded)
    }

    private func leaveWorkspaceDuringMapEdit() -> Bool {
        guard mapEditOverlay != nil, let workspaceID = currentWorkspace else { return false }
        removeMapEditPresentation()
        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = workspaceClusters.firstIndex(where: {
            $0.workspaceID == workspaceID
        }) ?? 0
        updateSelection()
        return presentMapEditOverlay(cameraPolicy: .directIfNeeded)
    }

    private func restoreMapEditReturnState(_ state: MapEditReturnState) {
        if let workspaceID = state.workspaceID,
           workspaces.contains(where: { $0.id == workspaceID })
        {
            currentWorkspace = workspaceID
            let sessions = activeSessionTiles
            selectedIndex = state.selectedTileID.flatMap { tileID in
                sessions.firstIndex(where: { $0.session.tileID == tileID })
            } ?? 0
            focusedIndex = state.focusedTileID.flatMap { tileID in
                sessions.firstIndex(where: { $0.session.tileID == tileID })
            }
        } else {
            currentWorkspace = nil
            focusedIndex = nil
            selectedIndex = state.overviewWorkspaceID.flatMap { workspaceID in
                workspaceClusters.firstIndex(where: { $0.workspaceID == workspaceID })
            } ?? 0
        }
        updateSelection()
        moveCamera()
    }

    private func removeEditWorkspaceClusters() {
        let temporary = workspaceClusters.filter { $0.renderingMode != .workspace }
        for cluster in temporary { cluster.removeFromSuperview() }
        workspaceClusters.removeAll { $0.renderingMode != .workspace }
        addWorkspaceClusterView = nil
        addWorkspaceCardView = nil
        ghostWorkspaceTargets.removeAll()
        let remainingCount = currentWorkspace == nil
            ? workspaceClusters.count
            : activeSessionTiles.count
        selectedIndex = min(selectedIndex, max(0, remainingCount - 1))
        updateWorldGeometry()
    }

    private func runMapEditAction(_ action: MapEditAction) {
        dismissMapEditOverlay(restorePreviousView: false)
        switch action.id {
        case "rename":
            showRenameWorkspacePalette()
        case "close":
            confirmCloseSelectedWorkspace()
        case let id where id.hasPrefix("openWorkspace:"):
            let workspaceID = String(id.dropFirst("openWorkspace:".count))
            guard let index = workspaceClusters.firstIndex(where: { $0.workspaceID == workspaceID })
            else { return }
            selectedIndex = index
            updateSelection()
            activate(index)
        case let id where id.hasPrefix("closeWorkspace:"):
            let workspaceID = String(id.dropFirst("closeWorkspace:".count))
            guard workspaces.contains(where: { $0.id == workspaceID }) else { return }
            currentWorkspace = workspaceID
            selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == workspaceID } ?? 0
            updateSelection()
            confirmCloseSelectedWorkspace()
        case let id where id.hasPrefix("attachWorkspace:"):
            let parts = id.split(separator: ":", maxSplits: 2).map(String.init)
            guard parts.count == 3,
                  let record = targetDiscoveries[parts[1]]?.workspaces.first(where: { $0.id == parts[2] }),
                  let location = registeredTargetLocation(id: parts[1])
            else { return }
            restoreNativeWorkspace(record, at: location)
        default:
            break
        }
    }

    private func beginInlineWorkspaceCreation(
        in cluster: WorkspaceClusterView,
        cameraPolicy: InteractionIntentPolicy.Camera = .directIfNeeded
    ) {
        mapEditOverlay?.isHidden = true
        let addCard = AddWorkspaceCardView(frame: cluster.bounds)
        addCard.autoresizingMask = [.width, .height]
        addWorkspaceCardView = addCard
        cluster.addSubview(addCard)

        var sources: [WorkspaceCreationSource] = []
        var seen = Set<String>()
        for workspace in workspaces {
            seen.insert(canonicalLocationKey(workspace.location))
            sources.append(WorkspaceCreationSource(
                title: workspace.name,
                detail: workspace.location.displayName,
                location: workspace.location,
                isDisabled: true
            ))
        }
        for location in workspaceLocationHistory {
            if seen.insert(canonicalLocationKey(location)).inserted {
                sources.append(WorkspaceCreationSource(
                    title: "Recent location",
                    detail: location.displayName,
                    location: location
                ))
            }
        }
        let home = WorkspaceLocation.local(FileManager.default.homeDirectoryForCurrentUser.path)
        if seen.insert(canonicalLocationKey(home)).inserted {
            sources.append(WorkspaceCreationSource(
                title: "Home",
                detail: home.displayName,
                location: home
            ))
        }

        addCard.onCancel = { [weak self] in self?.cancelInlineWorkspaceCreation() }
        addCard.onLeave = { [weak self] in self?.leaveInlineWorkspaceCreation() }
        addCard.onCreate = { [weak self] location, name in
            guard let self else { return }
            do {
                try self.createNewWorkspace(name: name, location: location)
                self.dismissMapEditOverlay(restorePreviousView: false)
            } catch {
                NSSound.beep()
            }
        }
        addCard.beginCreation(sources: sources)
        // Route immediate arrow input to the in-card form before camera motion.
        // Without this, fast input changes the selected overview workspace.
        window?.makeFirstResponder(addCard)
        let directDestination = cameraBounds(for: cluster.frame, viewport: sceneViewportBounds)
        let destination = cameraDestination(for: cameraPolicy, direct: directDestination)
        moveCameraForPolicy(cameraPolicy, to: destination) { [weak self, weak addCard] in
            guard let self, let addCard else { return }
            self.window?.makeFirstResponder(addCard)
        }
    }

    private func cancelInlineWorkspaceCreation() {
        dismissMapEditOverlay()
    }

    private func leaveInlineWorkspaceCreation() {
        addWorkspaceCardView?.removeFromSuperview()
        addWorkspaceCardView = nil
        mapEditOverlay?.isHidden = false
        if let addWorkspaceClusterView,
           let index = workspaceClusters.firstIndex(where: { $0 === addWorkspaceClusterView })
        {
            selectedIndex = index
            updateSelection()
        }
        moveCamera { [weak self] in
            guard let self, let overlay = self.mapEditOverlay else { return }
            self.window?.makeFirstResponder(overlay)
        }
    }

    private func beginInlineTerminalCreation(
        in tile: TerminalTileView,
        cameraPolicy: InteractionIntentPolicy.Camera = .directIfNeeded
    ) {
        guard addTerminalCardView == nil,
              let workspace = selectedWorkspaceRecord()
        else { return }
        mapEditOverlay?.isHidden = true
        let addCard = AddTerminalCardView(frame: tile.bounds)
        addCard.autoresizingMask = [.width, .height]
        addTerminalCardView = addCard
        tile.addSubview(addCard)

        addCard.onCancel = { [weak self] in self?.dismissMapEditOverlay() }
        addCard.onLeave = { [weak self] in self?.leaveInlineTerminalCreation() }
        addCard.onCreateShell = { [weak self] in
            guard let self else { return }
            self.dismissMapEditOverlay(restorePreviousView: false)
            self.createPersistentSession(
                workspace: workspace.name,
                name: self.nextAvailableSessionName(base: "shell", workspace: workspace.name),
                command: nil,
                workingDirectory: workspace.workingDirectory
            )
        }
        addCard.onRunCommand = { [weak self] command in
            guard let self else { return }
            self.dismissMapEditOverlay(restorePreviousView: false)
            let executable = command.split(separator: " ").first.map(String.init) ?? "command"
            self.createPersistentSession(
                workspace: workspace.name,
                name: self.nextAvailableSessionName(base: executable, workspace: workspace.name),
                command: command,
                workingDirectory: workspace.workingDirectory
            )
        }

        window?.makeFirstResponder(addCard)
        let tileFrame = tile.convert(tile.bounds, to: sceneView)
        let directDestination = cameraBounds(for: tileFrame, viewport: sceneViewportBounds)
        let destination = cameraDestination(for: cameraPolicy, direct: directDestination)
        moveCameraForPolicy(cameraPolicy, to: destination) { [weak self, weak addCard] in
            guard let self, let addCard else { return }
            self.window?.makeFirstResponder(addCard)
        }
    }

    private func leaveInlineTerminalCreation() {
        addTerminalCardView?.removeFromSuperview()
        addTerminalCardView = nil
        mapEditOverlay?.isHidden = false
        if let addTerminalTileView,
           let index = activeSessionTiles.firstIndex(where: { $0 === addTerminalTileView })
        {
            selectedIndex = index
            updateSelection()
        }
        moveCamera { [weak self] in
            guard let self, let overlay = self.mapEditOverlay else { return }
            self.window?.makeFirstResponder(overlay)
        }
    }

    private func selectInlineRemovalTarget(
        _ target: InteractionIntentPolicy.Target,
        workspaceID: String?,
        tileID: String?
    ) {
        if target == .currentWorkspace, currentWorkspace == nil, let workspaceID,
           let index = workspaceClusters.firstIndex(where: {
               $0.workspaceID == workspaceID && $0.renderingMode == .workspace
           })
        {
            select(index)
        } else if target == .currentTerminal, currentWorkspace != nil {
            let index = tileID.flatMap { tileID in
                activeSessionTiles.firstIndex(where: {
                    $0.session.tileID == tileID && $0.renderingMode == .terminal
                })
            } ?? activeSessionTiles.firstIndex(where: { $0.renderingMode == .terminal })
            if let index { select(index) }
        }
    }

    private func beginInlineRemoval(
        cameraPolicy: InteractionIntentPolicy.Camera = .directIfNeeded
    ) {
        if currentWorkspace == nil {
            guard workspaceClusters.indices.contains(selectedIndex) else { return }
            let cluster = workspaceClusters[selectedIndex]
            guard cluster.renderingMode == .workspace,
                  let workspace = workspaces.first(where: { $0.id == cluster.workspaceID })
            else { return }
            let count = persistedSessionTiles.count { $0.session.workspaceID == workspace.id }
            presentInlineConfirmation(
                in: cluster,
                cameraPolicy: cameraPolicy,
                heading: "Close workspace \(workspace.name)?",
                message: "This terminates \(count) terminal \(count == 1 ? "process" : "processes") and removes the workspace from Machinen.",
                consequence: "Files in the terminals' working directories are not deleted.",
                confirmTitle: "Close workspace"
            ) { [weak self] in
                self?.closeWorkspace(workspace.name)
            }
            return
        }

        let sessions = activeSessionTiles
        guard sessions.indices.contains(selectedIndex) else { return }
        let tile = sessions[selectedIndex]
        guard tile.renderingMode == .terminal else { return }
        presentInlineConfirmation(
            in: tile,
            cameraPolicy: cameraPolicy,
            heading: "Disconnect terminal \(tile.session.name)?",
            message: "This removes the terminal tile and disconnects its viewer.",
            consequence: "The native session, PTY, and process continue running and remain available for reconnection.",
            confirmTitle: "Disconnect terminal"
        ) { [weak self, weak tile] in
            guard let self, let tile else { return }
            self.bufferCloseSession(tile)
        }
    }

    private func presentInlineConfirmation(
        in host: NSView,
        cameraPolicy: InteractionIntentPolicy.Camera,
        heading: String,
        message: String,
        consequence: String,
        confirmTitle: String,
        action: @escaping @MainActor () -> Void
    ) {
        guard inlineConfirmationView == nil else { return }
        mapEditOverlay?.isHidden = true
        let confirmation = ActionConfirmationView(
            frame: host.bounds,
            heading: heading,
            message: message,
            consequence: consequence,
            confirmTitle: confirmTitle
        )
        confirmation.autoresizingMask = [.width, .height]
        confirmation.layer?.zPosition = 2_000
        confirmation.onCancel = { [weak self] in
            guard let self else { return }
            if self.mapEditOverlay != nil {
                self.dismissMapEditOverlay()
            } else {
                self.cancelLocalizedAction()
            }
        }
        confirmation.onConfirm = { [weak self] in
            guard let self else { return }
            if self.mapEditOverlay != nil {
                self.dismissMapEditOverlay(restorePreviousView: false)
            } else {
                self.finishLocalizedAction()
            }
            action()
        }
        inlineConfirmationView = confirmation
        presentedOverlay = confirmation
        host.addSubview(confirmation)
        window?.makeFirstResponder(confirmation)
        let hostFrame = host.convert(host.bounds, to: sceneView)
        let directDestination = cameraBounds(for: hostFrame, viewport: sceneViewportBounds)
        let destination = cameraDestination(for: cameraPolicy, direct: directDestination)
        moveCameraForPolicy(cameraPolicy, to: destination) { [weak self, weak confirmation] in
            guard let self, let confirmation else { return }
            self.window?.makeFirstResponder(confirmation)
        }
    }

    private func cancelLocalizedAction() {
        let cameraBounds = localizedActionCameraBounds
        finishLocalizedAction(clearPolicy: false)
        guard let cameraBounds else {
            interactionPolicySession = nil
            restoreInputFocus()
            return
        }
        moveCameraForPolicy(.directIfNeeded, to: cameraBounds) { [weak self] in
            self?.interactionPolicySession = nil
            self?.restoreInputFocus()
        }
    }

    private func finishLocalizedAction(clearPolicy: Bool = true) {
        if presentedOverlay === inlineConfirmationView { presentedOverlay = nil }
        inlineConfirmationView?.removeFromSuperview()
        inlineConfirmationView = nil
        localizedActionCameraBounds = nil
        if clearPolicy { interactionPolicySession = nil }
    }

    private func leaveInlineRemoval() {
        guard let confirmation = inlineConfirmationView else { return }
        confirmation.removeFromSuperview()
        if presentedOverlay === confirmation { presentedOverlay = nil }
        inlineConfirmationView = nil
        mapEditOverlay?.isHidden = false
        moveCamera { [weak self] in
            guard let self, let overlay = self.mapEditOverlay else { return }
            self.window?.makeFirstResponder(overlay)
        }
    }

    private func clearInlineMapPanelForIntent() {
        addWorkspaceCardView?.removeFromSuperview()
        addWorkspaceCardView = nil
        addTerminalCardView?.removeFromSuperview()
        addTerminalCardView = nil
        if presentedOverlay === inlineConfirmationView { presentedOverlay = nil }
        inlineConfirmationView?.removeFromSuperview()
        inlineConfirmationView = nil
        mapEditOverlay?.isHidden = false
    }

    func toggleCommandPalette() {
        InputRoutingLog.log("command palette requested kind=\(String(describing: paletteKind))")
        guard presentedOverlay == nil else { return }
        if availableSessionsView != nil { dismissAvailableSessions() }
        if commandPalette != nil {
            let wasTopLevel = paletteKind == .commands
            dismissCommandPalette()
            if wasTopLevel { return }
        }
        guard !isTransitioning, !isPeeking else { return }

        let palette = CommandPaletteView(
            frame: bounds,
            context: commandPaletteContext,
            commands: workspacePaletteCommands()
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            self?.runPaletteCommand(command, from: palette)
        }
        commandPalette = palette
        paletteKind = .commands
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func terminalSelectionContext(
        tile: TerminalTileView,
        terminal: MachinenTerminalView,
        text: String? = nil
    ) -> TerminalSelectionContext? {
        guard let text = text ?? terminal.selectedText() else {
            InputRoutingLog.log("selection openers skipped: terminal has no selection")
            return nil
        }
        InputRoutingLog.log("selection openers selection bytes=\(text.utf8.count)")
        return TerminalSelectionContext(
            text: text,
            tile: tile,
            anchor: terminal.contextMenuAnchor(in: terminal)
        )
    }

    private func focusedTerminalSelectionContext() -> TerminalSelectionContext? {
        guard focusedIndex != nil,
              let tile = selectedSessionTile(),
              let terminal = tile.terminalResponder
        else { return nil }
        return terminalSelectionContext(tile: tile, terminal: terminal)
    }

    private func activeSelectionOpeners() -> [MachinenSelectionOpener] {
        let now = Date().timeIntervalSince1970
        selectionOpeners = selectionOpeners.filter { $0.value.expiresAt.map { $0 > now } ?? true }
        return selectionOpeners.values.sorted {
            $0.priority == $1.priority
                ? $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
                : $0.priority > $1.priority
        }
    }

    private func matchingSelectionOpeners(
        selection: String,
        location: WorkspaceLocation
    ) -> [MachinenSelectionOpener] {
        activeSelectionOpeners().filter { $0.matches(selection: selection, location: location) }
    }

    func terminalContextMenu(
        for terminal: MachinenTerminalView,
        tile: TerminalTileView,
        selection: String?
    ) -> NSMenu {
        let menu = NSMenu(title: "Terminal")
        let openItem = NSMenuItem(title: "Open Selection With", action: nil, keyEquivalent: "")
        if let selectionContext = terminalSelectionContext(
            tile: tile,
            terminal: terminal,
            text: selection
        ) {
            let submenu = selectionOpenerMenu(for: selectionContext)
            openItem.submenu = submenu
            openItem.isEnabled = !submenu.items.isEmpty
        } else {
            openItem.isEnabled = false
        }
        menu.addItem(openItem)
        menu.addItem(.separator())

        let copyItem = NSMenuItem(
            title: "Copy",
            action: #selector(MachinenTerminalView.copy(_:)),
            keyEquivalent: ""
        )
        copyItem.target = terminal
        copyItem.isEnabled = selection != nil
        menu.addItem(copyItem)

        let pasteItem = NSMenuItem(
            title: "Paste",
            action: #selector(MachinenTerminalView.paste(_:)),
            keyEquivalent: ""
        )
        pasteItem.target = terminal
        menu.addItem(pasteItem)

        let selectAllItem = NSMenuItem(
            title: "Select All",
            action: #selector(MachinenTerminalView.selectAll(_:)),
            keyEquivalent: ""
        )
        selectAllItem.target = terminal
        menu.addItem(selectAllItem)
        return menu
    }

    func showTerminalContextMenu() {
        guard focusedIndex != nil,
              let tile = selectedSessionTile(),
              let terminal = tile.terminalResponder
        else {
            NSSound.beep()
            return
        }
        let menu = terminalContextMenu(
            for: terminal,
            tile: tile,
            selection: terminal.selectedText()
        )
        InputRoutingLog.log("terminal context menu requested by shortcut")
        menu.popUp(
            positioning: nil,
            at: terminal.contextMenuAnchor(in: terminal),
            in: terminal
        )
    }

    private func selectionOpenerMenu(for selection: TerminalSelectionContext) -> NSMenu {
        let menu = NSMenu(title: "Open Selection With")
        for opener in matchingSelectionOpeners(
            selection: selection.text,
            location: selection.tile.session.location
        ) {
            let item = NSMenuItem(
                title: opener.title,
                action: #selector(invokeSelectionOpenerMenuItem(_:)),
                keyEquivalent: ""
            )
            let payload = SelectionOpenerMenuPayload(openerID: opener.id, selection: selection)
            item.target = self
            item.representedObject = payload
            menu.addItem(item)
        }
        return menu
    }

    @objc private func invokeSelectionOpenerMenuItem(_ sender: NSMenuItem) {
        guard let payload = sender.representedObject as? SelectionOpenerMenuPayload else { return }
        invokeSelectionOpener(payload.openerID, selection: payload.selection)
    }

    private func invokeSelectionOpener(
        _ openerID: String,
        selection: TerminalSelectionContext
    ) {
        InputRoutingLog.log("selection opener invoked id=\(openerID)")
        let session = selection.tile.session
        emitAPIEvent("selectionOpener.invoked", data: [
            "invocationId": "inv_" + UUID().uuidString.lowercased(),
            "openerId": openerID,
            "selection": selection.text,
            "workspaceId": session.workspaceID,
            "tileId": session.tileID,
            "terminalId": session.id,
            "workingDirectory": session.effectiveWorkingDirectory,
            "location": session.effectiveLocation.json,
        ])
    }

    private func showSelectionOpenerPalette(_ selection: TerminalSelectionContext) {
        let openers = matchingSelectionOpeners(
            selection: selection.text,
            location: selection.tile.session.location
        )
        guard !openers.isEmpty else { return }
        dismissCommandPalette()

        let palette = CommandPaletteView(
            frame: bounds,
            heading: "OPEN SELECTION WITH",
            context: "terminal · \(selection.tile.session.name) · \(selection.tile.session.workspace)",
            placeholder: "Choose an app or action…",
            defaultFooter: "return open    esc back",
            commands: openers.map { opener in
                PaletteCommand(
                    id: .selectionOpener(opener.id),
                    title: opener.title,
                    shortcut: opener.subtitle ?? ""
                )
            }
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.toggleCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self,
                  case .selectionOpener(let openerID) = command.id,
                  self.matchingSelectionOpeners(
                    selection: selection.text,
                    location: selection.tile.session.location
                  ).contains(where: { $0.id == openerID })
            else {
                palette?.showStatus("That opener is no longer available")
                return
            }
            self.dismissCommandPalette()
            self.invokeSelectionOpener(openerID, selection: selection)
        }
        commandPalette = palette
        paletteKind = .selectionOpeners
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    func showSelectionOpenerPalette(
        for terminal: MachinenTerminalView,
        tile: TerminalTileView,
        selection text: String
    ) {
        guard let selection = terminalSelectionContext(
            tile: tile,
            terminal: terminal,
            text: text
        ) else { return }
        showSelectionOpenerPalette(selection)
    }

    private func showNewItemPalette() {
        guard presentedOverlay == nil, !isTransitioning, !isPeeking else { return }
        if availableSessionsView != nil { dismissAvailableSessions() }
        if commandPalette != nil { dismissCommandPalette() }

        let suggestedWorkspaceID = selectedWorkspaceID()
        var commands = [
            PaletteCommand(id: .newWorkspace, title: "New workspace…", shortcut: "name, then location"),
        ]
        commands.append(contentsOf: workspaces.map { workspace in
            PaletteCommand(
                id: .newTerminalInWorkspace,
                title: "New terminal in \(workspace.name)",
                shortcut: workspace.id == suggestedWorkspaceID
                    ? "current · \(workspace.location.displayName)"
                    : workspace.location.displayName,
                workspaceID: workspace.id
            )
        })
        let suggestedIndex = suggestedWorkspaceID.flatMap { workspaceID in
            commands.firstIndex(where: { $0.workspaceID == workspaceID })
        } ?? 0
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW",
            context: "choose what and where",
            placeholder: "Create a workspace or choose an existing workspace…",
            defaultFooter: "Nothing is created until you choose an action",
            commands: commands,
            initialSelectedIndex: suggestedIndex
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .newWorkspace:
                self.beginNewWorkspaceFlow(from: .newItem)
            case .newTerminalInWorkspace:
                guard let workspaceID = command.workspaceID,
                      let workspace = self.workspaces.first(where: { $0.id == workspaceID })
                else {
                    palette?.showStatus("That workspace no longer exists")
                    return
                }
                self.dismissCommandPalette()
                self.createPersistentSession(
                    workspace: workspace.name,
                    name: self.nextAvailableSessionName(base: "shell", workspace: workspace.name),
                    command: nil,
                    workingDirectory: workspace.workingDirectory
                )
            default:
                palette?.showStatus("That action is not available")
            }
        }
        commandPalette = palette
        paletteKind = .newItem
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func showNewTerminalPalette(
        workspace: String,
        workingDirectory: String,
        returnToCommands: Bool
    ) {
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW TERMINAL",
            context: "workspace: \(workspace)",
            placeholder: "What should this terminal run?",
            defaultFooter: "New sessions use the selected workspace by default",
            commands: [
                PaletteCommand(id: .createShell, title: "New login shell", shortcut: "$SHELL -l"),
                PaletteCommand(id: .runCommand, title: "Run command…", shortcut: ">"),
                PaletteCommand(id: .chooseProject, title: "New workspace from folder…", shortcut: "⇧⌘O"),
            ]
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in
            if returnToCommands {
                self?.toggleCommandPalette()
            } else {
                self?.dismissCommandPalette()
            }
        }
        palette.onRun = { [weak self, weak palette] command in
            self?.runNewTerminalCommand(
                command,
                workspace: workspace,
                workingDirectory: workingDirectory,
                returnToCommands: returnToCommands,
                from: palette
            )
        }
        commandPalette = palette
        paletteKind = .newTerminal
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func runNewTerminalCommand(
        _ command: PaletteCommand,
        workspace: String,
        workingDirectory: String,
        returnToCommands: Bool,
        from palette: CommandPaletteView?
    ) {
        switch command.id {
        case .createShell:
            dismissCommandPalette()
            createPersistentSession(
                workspace: workspace,
                name: nextAvailableSessionName(base: "shell", workspace: workspace),
                command: nil,
                workingDirectory: workingDirectory
            )
        case .runCommand:
            showRunCommandPalette(
                workspace: workspace,
                workingDirectory: workingDirectory,
                returnToCommands: returnToCommands
            )
        case .chooseProject:
            chooseAnotherProject(
                workspace: workspace,
                workingDirectory: workingDirectory,
                returnToCommands: returnToCommands
            )
        default:
            palette?.showStatus("That command is not available in this palette")
        }
    }

    private func showRunCommandPalette(
        workspace: String,
        workingDirectory: String,
        returnToCommands: Bool
    ) {
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "RUN COMMAND",
            context: "workspace: \(workspace)",
            placeholder: "Enter a command…",
            defaultFooter: "return start    esc back",
            commands: [],
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in
            self?.showNewTerminalPalette(
                workspace: workspace,
                workingDirectory: workingDirectory,
                returnToCommands: returnToCommands
            )
        }
        palette.onSubmit = { [weak self] command in
            guard let self else { return }
            self.dismissCommandPalette()
            let executable = command.split(separator: " ").first.map(String.init) ?? "command"
            self.createPersistentSession(
                workspace: workspace,
                name: self.nextAvailableSessionName(base: executable, workspace: workspace),
                command: command,
                workingDirectory: workingDirectory
            )
        }
        commandPalette = palette
        paletteKind = .runCommand
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func chooseAnotherProject(
        workspace: String,
        workingDirectory: String,
        returnToCommands: Bool
    ) {
        dismissCommandPalette()
        guard let window else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose a project"
        panel.prompt = "Choose Project"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser
        panel.beginSheetModal(for: window) { [weak self] response in
            Task { @MainActor in
                guard response == .OK, let selectedWorkspace = panel.url?.lastPathComponent,
                      !selectedWorkspace.isEmpty
                else {
                    self?.showNewTerminalPalette(
                        workspace: workspace,
                        workingDirectory: workingDirectory,
                        returnToCommands: returnToCommands
                    )
                    return
                }
                self?.showNewTerminalPalette(
                    workspace: selectedWorkspace,
                    workingDirectory: panel.url?.path ?? FileManager.default.homeDirectoryForCurrentUser.path,
                    returnToCommands: returnToCommands
                )
            }
        }
    }

    private func dismissCommandPalette() {
        locationValidationProcess?.terminate()
        locationValidationProcess = nil
        remotePathCompleter.cancel()
        commandPalette?.removeFromSuperview()
        commandPalette = nil
        paletteKind = nil
        restoreInputFocus()
    }

    func focusCurrentContent() {
        restoreInputFocus()
    }

    private func restoreInputFocus() {
        let sessions = activeSessionTiles
        if let focusedIndex,
           sessions.indices.contains(focusedIndex),
           sessions[focusedIndex].focusTerminal()
        {
            InputRoutingLog.log("deck restores terminal focus tile=\(sessions[focusedIndex].session.tileID)")
            return
        }
        InputRoutingLog.log("deck restores deck focus focusedIndex=\(String(describing: focusedIndex))")
        window?.makeFirstResponder(self)
    }

    private func activeContextCommands() -> [MachinenContextCommand] {
        let now = Date().timeIntervalSince1970
        contextCommands = contextCommands.filter { $0.value.expiresAt.map { $0 > now } ?? true }
        return contextCommands.values.sorted {
            $0.priority == $1.priority
                ? $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
                : $0.priority > $1.priority
        }
    }

    private func contextCommandTarget(
        for command: MachinenContextCommand
    ) -> (workspace: WorkspaceRecord, tile: TerminalTileView?, location: WorkspaceLocation)? {
        switch command.context {
        case .workspace:
            guard let workspace = selectedWorkspaceRecord(),
                  command.matches(context: .workspace, location: workspace.location)
            else { return nil }
            return (workspace, nil, workspace.location)
        case .terminal:
            guard focusedIndex != nil,
                  let tile = selectedSessionTile(),
                  let workspace = workspaces.first(where: { $0.id == tile.session.workspaceID }),
                  command.matches(context: .terminal, location: tile.session.effectiveLocation)
            else { return nil }
            return (workspace, tile, tile.session.effectiveLocation)
        }
    }

    private func workspacePaletteCommands() -> [PaletteCommand] {
        let registeredCommands = activeContextCommands()
        return activeCommandSpaces.flatMap { space in
            switch space {
            case .terminal:
                terminalCommands(registeredCommands: registeredCommands)
            case .workspace:
                workspaceCommands()
                    + registeredPaletteCommands(registeredCommands, in: .workspace)
            case .workspaceOverview:
                [
                    PaletteCommand(
                        id: .newWorkspace,
                        title: "New workspace…",
                        shortcut: "",
                        space: .workspaceOverview
                    ),
                    PaletteCommand(
                        id: .registerTarget,
                        title: "Use another computer…",
                        shortcut: "",
                        space: .workspaceOverview
                    ),
                    PaletteCommand(
                        id: .browseTargetSessions,
                        title: "Sessions…",
                        shortcut: "",
                        space: .workspaceOverview
                    ),
                ]
            }
        }
    }

    private func terminalCommands(
        registeredCommands: [MachinenContextCommand]
    ) -> [PaletteCommand] {
        var commands: [PaletteCommand] = []
        if let selection = focusedTerminalSelectionContext() {
            let openerCount = matchingSelectionOpeners(
                selection: selection.text,
                location: selection.tile.session.location
            ).count
            if openerCount > 0 {
                commands.append(PaletteCommand(
                    id: .openSelectionWith,
                    title: "Open Selection With…",
                    shortcut: "\(openerCount) \(openerCount == 1 ? "opener" : "openers")",
                    space: .terminal
                ))
            }
        }
        commands.append(
            contentsOf: registeredPaletteCommands(registeredCommands, in: .terminal)
        )
        commands.append(PaletteCommand(
            id: .disconnectSession,
            title: "Disconnect terminal",
            shortcut: "⌘W",
            space: .terminal
        ))
        return commands
    }

    private func workspaceCommands() -> [PaletteCommand] {
        guard let selectedWorkspace = selectedWorkspaceRecord() else { return [] }
        let sessionCount = availableSessionItems(for: selectedWorkspace).count
        return [
            PaletteCommand(
                id: .newTerminal,
                title: "New terminal…",
                shortcut: "",
                space: .workspace
            ),
            PaletteCommand(
                id: .renameWorkspace,
                title: "Rename workspace…",
                shortcut: "",
                space: .workspace
            ),
            PaletteCommand(
                id: .changeWorkspaceLocation,
                title: "Change workspace location…",
                shortcut: "",
                space: .workspace
            ),
            PaletteCommand(
                id: .reconnectAvailableSession,
                title: "Sessions…",
                shortcut: "\(sessionCount) \(sessionCount == 1 ? "session" : "sessions")",
                space: .workspace
            ),
            PaletteCommand(
                id: .closeWorkspace,
                title: "Close workspace…",
                shortcut: "",
                space: .workspace
            ),
        ]
    }

    private func registeredPaletteCommands(
        _ commands: [MachinenContextCommand],
        in space: PaletteCommand.Space
    ) -> [PaletteCommand] {
        let available = commands.compactMap { command -> (MachinenContextCommand, PaletteCommand)? in
            guard let paletteCommand = registeredPaletteCommand(command, in: space) else {
                return nil
            }
            return (command, paletteCommand)
        }
        var emittedGroups = Set<String>()
        return available.compactMap { command, paletteCommand in
            guard let group = command.group else { return paletteCommand }
            guard emittedGroups.insert(group).inserted else { return nil }
            let count = available.count { candidate, _ in candidate.group == group }
            return PaletteCommand(
                id: .registeredCommandGroup(group, space),
                title: group,
                shortcut: "\(count) \(count == 1 ? "option" : "options")",
                space: space
            )
        }
    }

    private func registeredPaletteCommand(
        _ command: MachinenContextCommand,
        in space: PaletteCommand.Space
    ) -> PaletteCommand? {
        let expectedContext: MachinenContextCommand.Context
        switch space {
        case .workspace:
            expectedContext = .workspace
        case .terminal:
            expectedContext = .terminal
        case .workspaceOverview:
            return nil
        }
        guard command.context == expectedContext,
              contextCommandTarget(for: command) != nil
        else { return nil }
        return PaletteCommand(
            id: .registeredCommand(command.id),
            title: command.title,
            shortcut: command.subtitle ?? command.context.rawValue,
            space: space
        )
    }

    private func showContextCommandGroupPalette(
        _ group: String,
        in space: PaletteCommand.Space,
        from parentPalette: CommandPaletteView?
    ) {
        let commands = activeContextCommands().filter { command in
            command.group == group && registeredPaletteCommand(command, in: space) != nil
        }
        guard !commands.isEmpty else {
            parentPalette?.showStatus("That command group is no longer available")
            return
        }
        let context: String
        switch space {
        case .terminal:
            context = "current directory · \(selectedSession()?.name ?? "terminal")"
                + " · \(selectedWorkspace() ?? "workspace")"
        case .workspace:
            context = "workspace root · \(selectedWorkspace() ?? "workspace")"
        case .workspaceOverview:
            parentPalette?.showStatus("That command group is not available here")
            return
        }
        dismissCommandPalette()

        let heading = group.trimmingCharacters(in: CharacterSet(charactersIn: ".… ")).uppercased()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: heading,
            context: context,
            placeholder: "Choose an app or action…",
            defaultFooter: "return open    esc back",
            commands: commands.map { command in
                PaletteCommand(
                    id: .registeredCommand(command.id),
                    title: command.title,
                    shortcut: command.subtitle ?? ""
                )
            }
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.toggleCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self,
                  case .registeredCommand(let id) = command.id,
                  self.activeContextCommands().contains(where: {
                      $0.id == id && $0.group == group
                          && self.registeredPaletteCommand($0, in: space) != nil
                  })
            else {
                palette?.showStatus("That command is no longer available")
                return
            }
            self.invokeContextCommand(id, from: palette)
        }
        commandPalette = palette
        paletteKind = .contextCommandGroup
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func runPaletteCommand(_ command: PaletteCommand, from palette: CommandPaletteView?) {
        switch command.id {
        case .newWorkspace:
            beginNewWorkspaceFlow(from: .commands)
        case .registerTarget:
            showRegisterTargetPalette()
        case .browseTargetSessions:
            dismissCommandPalette()
            toggleTargetSessions()
        case .renameWorkspace:
            showRenameWorkspacePalette()
        case .changeWorkspaceLocation:
            chooseWorkspaceLocation()
        case .toggleOverview:
            dismissCommandPalette()
            toggleOverview()
        case .newTerminal:
            guard let workspace = selectedWorkspaceRecord() else {
                palette?.showStatus("Select a workspace first")
                return
            }
            dismissCommandPalette()
            showNewTerminalPalette(
                workspace: workspace.name,
                workingDirectory: workspace.workingDirectory,
                returnToCommands: true
            )
        case .openSelectionWith:
            guard let selection = focusedTerminalSelectionContext(),
                  !matchingSelectionOpeners(
                    selection: selection.text,
                    location: selection.tile.session.location
                  ).isEmpty
            else {
                palette?.showStatus("Select text with a matching opener first")
                return
            }
            showSelectionOpenerPalette(selection)
        case .selectionOpener:
            palette?.showStatus("Choose an opener from Open Selection With…")
        case .attachSession, .reconnectSession:
            dismissCommandPalette()
            reconnectSelectedSession()
        case .detachSession:
            dismissCommandPalette()
            detachSelectedSession()
        case .disconnectSession:
            guard let tile = selectedSessionTile() else {
                palette?.showStatus("Select a terminal first")
                return
            }
            dismissCommandPalette()
            bufferCloseSession(tile)
        case .restartSession:
            dismissCommandPalette()
            restartSelectedSession()
        case .stopSession:
            dismissCommandPalette()
            confirmStopSelectedSession()
        case .stopWorkspace:
            dismissCommandPalette()
            confirmStopSelectedWorkspace()
        case .closeSession:
            dismissCommandPalette()
            confirmCloseSelectedSession()
        case .closeWorkspace:
            dismissCommandPalette()
            confirmCloseSelectedWorkspace(returnToCommands: true)
        case .reconnectAvailableSession:
            dismissCommandPalette()
            toggleTargetSessions(selecting: selectedSession()?.id)
        case let .registeredCommandGroup(group, space):
            showContextCommandGroupPalette(group, in: space, from: palette)
        case let .registeredCommand(id):
            invokeContextCommand(id, from: palette)
        case .showDiagnostics:
            dismissCommandPalette()
            showDiagnostics()
        default:
            palette?.showStatus("Prototype only · \(command.title)")
        }
    }

    private func invokeContextCommand(_ id: String, from palette: CommandPaletteView?) {
        guard let command = activeContextCommands().first(where: { $0.id == id }) else {
            palette?.showStatus("That command is no longer available")
            return
        }
        guard let target = contextCommandTarget(for: command) else {
            palette?.showStatus("That command is not available in this context")
            return
        }

        var data: JSONObject = [
            "invocationId": "inv_" + UUID().uuidString.lowercased(),
            "commandId": command.id,
            "context": command.context.rawValue,
            "workspaceId": target.workspace.id,
            "workingDirectory": target.location.path,
            "location": target.location.json,
        ]
        if let tile = target.tile {
            data["tileId"] = tile.session.tileID
            data["terminalId"] = tile.session.id
        }
        dismissCommandPalette()
        emitAPIEvent("command.invoked", data: data)
    }

    private func showRegisterTargetPalette(returnToSharedWorkspaces: Bool = false) {
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "USE ANOTHER COMPUTER",
            context: "connect using your existing SSH setup",
            placeholder: "Computer name or user@host…",
            defaultFooter: "return use computer · esc back",
            commands: [],
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in
            guard let self else { return }
            if returnToSharedWorkspaces {
                self.dismissCommandPalette()
                self.toggleTargetSessions()
            } else {
                self.toggleCommandPalette()
            }
        }
        palette.onSubmit = { [weak self, weak palette] host in
            guard let self else { return }
            do {
                _ = try self.apiRegisterTarget(["host": host])
                self.dismissCommandPalette()
                self.toggleTargetSessions()
            } catch {
                palette?.showStatus((error as? MachinenAPIError)?.message ?? error.localizedDescription)
            }
        }
        commandPalette = palette
        paletteKind = .newWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func beginNewWorkspaceFlow(from entry: NewWorkspaceEntry) {
        newWorkspaceEntry = entry
        showNewWorkspaceLocationPalette()
    }

    private func returnToNewWorkspaceEntry() {
        let entry = newWorkspaceEntry
        newWorkspaceEntry = nil
        registersSharedWorkspaceOnly = false
        switch entry {
        case .newItem:
            showNewItemPalette()
        case .commands:
            toggleCommandPalette()
        case .sharedWorkspaces:
            dismissCommandPalette()
            toggleTargetSessions()
        case nil:
            dismissCommandPalette()
        }
    }

    private func showNewWorkspaceLocationPalette() {
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: registersSharedWorkspaceOnly
                ? "ADD WORKSPACE · 1 OF 2"
                : "NEW WORKSPACE · 1 OF 2",
            context: "choose a location",
            placeholder: "Filter previous locations or choose Browse…",
            defaultFooter: "Previous locations open directly · esc back",
            commands: newWorkspaceLocationCommands()
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.returnToNewWorkspaceEntry() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .useWorkspaceLocation:
                guard let location = command.location else { return }
                self.choosePreviousWorkspaceLocation(location, from: palette)
            case .browseLocalWorkspaceLocation:
                self.showNewWorkspaceLocalBrowser(
                    path: FileManager.default.homeDirectoryForCurrentUser.path
                )
            case .chooseRemoteWorkspaceLocation:
                self.showNewWorkspaceSSHHostPalette()
            case .back:
                self.returnToNewWorkspaceEntry()
            default:
                palette?.showStatus("Choose a previous location or Browse…")
            }
        }
        commandPalette = palette
        paletteKind = .newWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func choosePreviousWorkspaceLocation(
        _ location: WorkspaceLocation,
        from palette: CommandPaletteView?
    ) {
        switch location.kind {
        case .local:
            do {
                showNewWorkspaceNamePalette(
                    location: .local(try validatedWorkingDirectory(location.path))
                )
            } catch {
                palette?.showStatus((error as? MachinenAPIError)?.message ?? error.localizedDescription)
            }
        case .ssh:
            guard let host = location.sshHost, let palette else { return }
            palette.showStatus("Checking \(location.displayName)…")
            validateRemoteWorkspaceLocation(location) { [weak self, weak palette] result in
                guard let self, let palette, self.commandPalette === palette else { return }
                switch result {
                case let .success(canonicalPath):
                    self.showNewWorkspaceNamePalette(
                        location: .ssh(host: host, path: canonicalPath)
                    )
                case let .failure(error):
                    palette.showStatus(error.message)
                }
            }
        }
    }

    private func newWorkspaceLocationCommands() -> [PaletteCommand] {
        var commands: [PaletteCommand] = []
        var seen = Set<String>()
        for location in workspaceLocationHistory + workspaces.map(\.location) {
            let key = canonicalLocationKey(location)
            guard seen.insert(key).inserted else { continue }
            let users = workspaces.filter { canonicalLocationKey($0.location) == key }.map(\.name)
            let title = location.kind == .local
                ? WorkspacePathSuggestions.displayLocalPath(location.path, prefersTilde: true)
                : location.displayName
            commands.append(PaletteCommand(
                id: .useWorkspaceLocation,
                title: title,
                shortcut: users.isEmpty
                    ? "previously selected"
                    : "used by \(users.joined(separator: ", "))",
                location: location
            ))
        }
        commands.append(PaletteCommand(
            id: .browseLocalWorkspaceLocation,
            title: "Browse local…",
            shortcut: "starts in $HOME"
        ))
        commands.append(PaletteCommand(
            id: .chooseRemoteWorkspaceLocation,
            title: "Browse over SSH…",
            shortcut: "starts in remote $HOME"
        ))
        commands.append(PaletteCommand(
            id: .back,
            title: "Back…",
            shortcut: ""
        ))
        return commands
    }

    private func showNewWorkspaceLocalBrowser(path: String) {
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW WORKSPACE · LOCAL FOLDER",
            context: WorkspacePathSuggestions.displayLocalPath(path, prefersTilde: true),
            placeholder: "Filter folders…",
            defaultFooter: "return open · esc parent · choose Use this folder to continue",
            commands: newWorkspaceLocalBrowserCommands(path: path)
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in
            guard let self else { return }
            if let parent = self.localBrowserParentPath(for: path) {
                self.showNewWorkspaceLocalBrowser(path: parent)
            } else {
                self.showNewWorkspaceLocationPalette()
            }
        }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .useWorkspaceLocation:
                guard let location = command.location else { return }
                self.showNewWorkspaceNamePalette(
                    location: location,
                    returnTo: .localBrowser(path)
                )
            case .openWorkspaceLocation:
                guard let child = command.location?.path else { return }
                self.showNewWorkspaceLocalBrowser(path: child)
            case .back:
                if let parent = self.localBrowserParentPath(for: path) {
                    self.showNewWorkspaceLocalBrowser(path: parent)
                } else {
                    self.showNewWorkspaceLocationPalette()
                }
            default:
                palette?.showStatus("Choose Use this folder or open a child folder")
            }
        }
        commandPalette = palette
        paletteKind = .newWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func newWorkspaceLocalBrowserCommands(path: String) -> [PaletteCommand] {
        var commands = [PaletteCommand(
            id: .useWorkspaceLocation,
            title: "Use this folder",
            shortcut: WorkspacePathSuggestions.displayLocalPath(path, prefersTilde: true),
            location: .local(path)
        )]
        commands.append(contentsOf: WorkspacePathSuggestions.localChildDirectories(at: path).map { child in
            PaletteCommand(
                id: .openWorkspaceLocation,
                title: URL(fileURLWithPath: child).lastPathComponent + "/",
                shortcut: "open",
                location: .local(child)
            )
        })
        commands.append(PaletteCommand(
            id: .back,
            title: localBrowserParentPath(for: path) == nil ? "Back to locations…" : "Parent folder…",
            shortcut: "esc"
        ))
        return commands
    }

    private func localBrowserParentPath(for path: String) -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        guard canonicalLocationKey(.local(path)) != canonicalLocationKey(.local(home)) else {
            return nil
        }
        let parent = URL(fileURLWithPath: path, isDirectory: true).deletingLastPathComponent().path
        return parent == path ? nil : parent
    }

    private func showNewWorkspaceNamePalette(
        location: WorkspaceLocation,
        initialName: String? = nil,
        returnTo: NewWorkspaceNameReturn = .locations,
        checksNativeStore: Bool = true
    ) {
        dismissCommandPalette()
        if checksNativeStore {
            sessionBackend.listWorkspaces(at: location) { [weak self] result in
                guard let self else { return }
                let matching = (try? result.get().filter { record in
                    var savedLocation = location
                    savedLocation.path = record.rootDirectory
                    return self.canonicalLocationKey(savedLocation)
                        == self.canonicalLocationKey(location)
                }) ?? []
                if let first = matching.first {
                    if self.registersSharedWorkspaceOnly {
                        self.registersSharedWorkspaceOnly = false
                        self.newWorkspaceEntry = nil
                        self.dismissCommandPalette()
                        if let targetID = self.targetID(for: location),
                           let targetLocation = self.registeredTargetLocation(id: targetID)
                        {
                            self.refreshRegisteredTarget(targetID, at: targetLocation, force: true)
                        }
                        self.toggleTargetSessions()
                    } else {
                        for record in matching.dropFirst() {
                            self.restoreNativeWorkspace(record, at: location, opensSessions: false)
                        }
                        self.restoreNativeWorkspace(first, at: location)
                    }
                } else {
                    self.showNewWorkspaceNamePalette(
                        location: location,
                        initialName: initialName,
                        returnTo: returnTo,
                        checksNativeStore: false
                    )
                }
            }
            return
        }
        let suggestedName = initialName ?? suggestedWorkspaceName(for: location)
        let palette = CommandPaletteView(
            frame: bounds,
            heading: registersSharedWorkspaceOnly
                ? "ADD WORKSPACE · 2 OF 2"
                : "NEW WORKSPACE · 2 OF 2",
            context: location.displayName,
            placeholder: "Name this workspace…",
            defaultFooter: registersSharedWorkspaceOnly
                ? "return add · esc back to locations"
                : "return create · esc back to locations",
            commands: [],
            acceptsFreeform: true,
            initialQuery: suggestedName
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.returnFromNewWorkspaceName(to: returnTo) }
        palette.onSubmit = { [weak self, weak palette] value in
            guard let self else { return }
            guard let name = WorkspaceName.validated(value) else {
                palette?.showStatus("Enter a non-empty workspace name")
                return
            }
            guard !self.workspaceNameExists(name) else {
                palette?.showStatus("That workspace name is already in use")
                return
            }
            self.continueNewWorkspaceFlow(name: name, with: location, from: palette)
        }
        commandPalette = palette
        paletteKind = .newWorkspace
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func restoreNativeWorkspace(
        _ record: NativeWorkspaceRecord,
        at requestedLocation: WorkspaceLocation,
        opensSessions: Bool = false
    ) {
        let workspace: WorkspaceRecord
        if let existing = workspaces.first(where: { $0.id == record.id }) {
            var usedNames = Set(workspaces.filter { $0.id != existing.id }.map {
                WorkspaceName.key($0.name)
            })
            existing.name = WorkspaceName.unique(record.name, reserving: &usedNames)
            existing.location.path = record.rootDirectory
            for tile in persistedSessionTiles where tile.session.workspaceID == existing.id {
                tile.session.workspace = existing.name
            }
            workspace = existing
            rebuildWorkspaceClusters()
            saveSessions()
        } else {
            var usedNames = Set(workspaces.map { WorkspaceName.key($0.name) })
            var location = requestedLocation
            location.path = record.rootDirectory
            workspace = WorkspaceRecord(
                id: record.id,
                name: WorkspaceName.unique(record.name, reserving: &usedNames),
                workingDirectory: location.path,
                sshHost: location.sshHost
            )
            workspaces.append(workspace)
            rememberWorkspaceLocation(workspace.location)
            registerTargetIfNeeded(for: workspace.location)
            rebuildWorkspaceClusters()
            saveSessions()
            emitAPIEvent("workspace.restored", data: workspaceJSON(workspace))
        }
        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = workspaces.firstIndex(where: { $0.id == workspace.id }) ?? 0
        updateWorldGeometry()
        updateSelection()
        moveCamera()
        refreshAvailableSessions(for: workspace, force: true)
        if opensSessions { toggleAvailableSessions() }
    }

    private func returnFromNewWorkspaceName(to destination: NewWorkspaceNameReturn) {
        switch destination {
        case .locations:
            showNewWorkspaceLocationPalette()
        case let .localBrowser(path):
            showNewWorkspaceLocalBrowser(path: path)
        case let .sshBrowser(host, path):
            showNewWorkspaceSSHBrowser(host: host, path: path)
        }
    }

    private func suggestedWorkspaceName(for location: WorkspaceLocation) -> String {
        let base: String
        if location.path == "~" || location.path == FileManager.default.homeDirectoryForCurrentUser.path {
            base = location.sshHost ?? "home"
        } else {
            base = URL(fileURLWithPath: location.path).lastPathComponent
        }
        return nextAvailableWorkspaceName(base: base.isEmpty ? "workspace" : base)
    }

    private func showNewWorkspaceSSHHostPalette() {
        dismissCommandPalette()
        let hosts = knownSSHHosts()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW WORKSPACE · SSH HOST",
            context: "browse remotely",
            placeholder: "Choose an alias or type user@host…",
            defaultFooter: "Hosts come from ~/.ssh/config and previous locations · esc back",
            commands: hosts.map {
                PaletteCommand(
                    id: .useSSHHost,
                    title: $0,
                    shortcut: "SSH",
                    sshHost: $0,
                    completion: $0
                )
            },
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.showNewWorkspaceLocationPalette() }
        palette.onRun = { [weak self] command in
            guard let host = command.sshHost else { return }
            self?.showNewWorkspaceSSHBrowser(host: host, path: "~")
        }
        palette.onSubmit = { [weak self, weak palette] value in
            guard let self, let host = self.validSSHHost(value) else {
                palette?.showStatus("Enter an OpenSSH alias, host, or user@host")
                return
            }
            self.showNewWorkspaceSSHBrowser(host: host, path: "~")
        }
        commandPalette = palette
        paletteKind = .remoteWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func showNewWorkspaceSSHBrowser(host: String, path: String) {
        dismissCommandPalette()
        let location = WorkspaceLocation.ssh(host: host, path: path)
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW WORKSPACE · SSH FOLDER",
            context: location.displayName,
            placeholder: "Filter folders…",
            defaultFooter: "return open · esc parent · choose Use this folder to continue",
            commands: newWorkspaceSSHBrowserCommands(host: host, path: path, children: [])
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in
            guard let self else { return }
            if let parent = self.remoteParentPath(for: path) {
                self.showNewWorkspaceSSHBrowser(host: host, path: parent)
            } else {
                self.showNewWorkspaceSSHHostPalette()
            }
        }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .useWorkspaceLocation:
                guard let location = command.location, let palette else { return }
                palette.showStatus("Checking \(location.displayName)…")
                self.validateRemoteWorkspaceLocation(location) { [weak self, weak palette] result in
                    guard let self, let palette, self.commandPalette === palette else { return }
                    switch result {
                    case let .success(canonicalPath):
                        self.showNewWorkspaceNamePalette(
                            location: .ssh(host: host, path: canonicalPath),
                            returnTo: .sshBrowser(host: host, path: path)
                        )
                    case let .failure(error):
                        palette.showStatus(error.message)
                    }
                }
            case .openWorkspaceLocation:
                guard let child = command.location?.path else { return }
                self.showNewWorkspaceSSHBrowser(host: host, path: child)
            case .back:
                if let parent = self.remoteParentPath(for: path) {
                    self.showNewWorkspaceSSHBrowser(host: host, path: parent)
                } else {
                    self.showNewWorkspaceSSHHostPalette()
                }
            default:
                palette?.showStatus("Choose Use this folder or open a child folder")
            }
        }
        commandPalette = palette
        paletteKind = .remoteWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
        let query = remoteBrowseQuery(for: path)
        remotePathCompleter.complete(host: host, query: query) { [weak self, weak palette] children in
            guard let self, let palette, self.commandPalette === palette else { return }
            palette.replaceCommands(self.newWorkspaceSSHBrowserCommands(
                host: host,
                path: path,
                children: children
            ))
        }
    }

    private func newWorkspaceSSHBrowserCommands(
        host: String,
        path: String,
        children: [String]
    ) -> [PaletteCommand] {
        var commands = [PaletteCommand(
            id: .useWorkspaceLocation,
            title: "Use this folder",
            shortcut: path,
            location: .ssh(host: host, path: path)
        )]
        commands.append(contentsOf: children.map { child in
            PaletteCommand(
                id: .openWorkspaceLocation,
                title: URL(fileURLWithPath: child).lastPathComponent + "/",
                shortcut: "open",
                location: .ssh(host: host, path: child)
            )
        })
        commands.append(PaletteCommand(
            id: .back,
            title: remoteParentPath(for: path) == nil ? "Back to SSH hosts…" : "Parent folder…",
            shortcut: "esc"
        ))
        return commands
    }

    private func remoteParentPath(for path: String) -> String? {
        if path == "~" || path == "/" { return nil }
        guard let slash = path.lastIndex(of: "/") else { return "~" }
        let parent = String(path[..<slash])
        return parent.isEmpty ? "/" : parent
    }

    private func localWorkspacePathCommands(query: String, name: String) -> [PaletteCommand] {
        let prefersTilde = query.isEmpty || query.hasPrefix("~") || !query.hasPrefix("/")
        var result: [PaletteCommand] = []
        var seen = Set<String>()
        let home = WorkspaceLocation.local(FileManager.default.homeDirectoryForCurrentUser.path)
        let expandedQuery = WorkspacePathSuggestions.expandedLocalPath(query)
        var isDirectory: ObjCBool = false
        if query.hasSuffix("/"), FileManager.default.fileExists(
            atPath: expandedQuery,
            isDirectory: &isDirectory
        ), isDirectory.boolValue {
            let current = WorkspaceLocation.local(expandedQuery)
            let displayPath = WorkspacePathSuggestions.displayLocalPath(
                current.path,
                prefersTilde: prefersTilde
            )
            seen.insert(canonicalLocationKey(current))
            result.append(PaletteCommand(
                id: .useWorkspaceLocation,
                title: "Use \(displayPath)",
                shortcut: "choose this folder",
                location: current,
                completion: displayPath
            ))
        }
        let previousLocations = workspaceLocationHistory.filter { $0.kind == .local }
        for location in [home] + previousLocations + workspaces.map(\.location).filter({ $0.kind == .local }) {
            let key = canonicalLocationKey(location)
            guard seen.insert(key).inserted else { continue }
            let users = workspaces.filter { canonicalLocationKey($0.location) == key }.map(\.name)
            let displayPath = WorkspacePathSuggestions.displayLocalPath(
                location.path,
                prefersTilde: prefersTilde
            )
            let shortcut: String
            if key == canonicalLocationKey(home) {
                shortcut = "$HOME · open"
            } else if users.isEmpty {
                shortcut = "previously chosen · open"
            } else {
                shortcut = "used by \(users.joined(separator: ", ")) · open"
            }
            result.append(PaletteCommand(
                id: .openWorkspaceLocation,
                title: displayPath,
                shortcut: shortcut,
                location: location,
                completion: localBrowseQuery(for: location.path)
            ))
        }
        for path in WorkspacePathSuggestions.localDirectories(matching: query) {
            let location = WorkspaceLocation.local(path)
            guard seen.insert(canonicalLocationKey(location)).inserted else { continue }
            let displayPath = WorkspacePathSuggestions.displayLocalPath(
                path,
                prefersTilde: prefersTilde
            )
            result.append(PaletteCommand(
                id: .openWorkspaceLocation,
                title: displayPath,
                shortcut: "open folder",
                location: location,
                completion: localBrowseQuery(for: path)
            ))
        }
        result.append(PaletteCommand(
            id: .browseLocalWorkspaceLocation,
            title: "Browse with Finder…",
            shortcut: "dialog"
        ))
        result.append(PaletteCommand(
            id: .back,
            title: "Back to Local or SSH…",
            shortcut: name
        ))
        return result
    }

    private func localBrowseQuery(for path: String) -> String {
        let displayPath = WorkspacePathSuggestions.displayLocalPath(path, prefersTilde: true)
        return displayPath.hasSuffix("/") ? displayPath : displayPath + "/"
    }

    private func localParentBrowseQuery(for query: String) -> String? {
        let path = WorkspacePathSuggestions.expandedLocalPath(query)
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        guard canonicalLocationKey(.local(path)) != canonicalLocationKey(.local(home)) else {
            return nil
        }
        let parent = URL(fileURLWithPath: path, isDirectory: true).deletingLastPathComponent().path
        guard parent != path else { return nil }
        return localBrowseQuery(for: parent)
    }

    // Kept for the existing path-entry location editor.
    private func showNewWorkspaceLocationPalette(name _: String) {
        showNewWorkspaceLocationPalette()
    }

    private func showNewRemoteWorkspaceLocationPalette(name: String) {
        dismissCommandPalette()
        let hosts = knownSSHHosts()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW WORKSPACE · SSH HOST",
            context: name,
            placeholder: "Choose an alias or type user@host…",
            defaultFooter: hosts.isEmpty
                ? "Type a host understood by OpenSSH"
                : "Known aliases come from ~/.ssh/config and existing workspaces",
            commands: [PaletteCommand(
                id: .back,
                title: "Back to locations…",
                shortcut: name
            )] + hosts.map {
                PaletteCommand(
                    id: .useSSHHost,
                    title: $0,
                    shortcut: "SSH",
                    sshHost: $0,
                    completion: $0
                )
            },
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.showNewWorkspaceLocationPalette(name: name) }
        palette.onRun = { [weak self] command in
            if command.id == .back {
                self?.showNewWorkspaceLocationPalette(name: name)
                return
            }
            guard let host = command.sshHost else { return }
            self?.showNewRemoteWorkspacePathPalette(name: name, host: host)
        }
        palette.onSubmit = { [weak self, weak palette] value in
            guard let self, let host = self.validSSHHost(value) else {
                palette?.showStatus("Enter an OpenSSH alias, host, or user@host")
                return
            }
            self.showNewRemoteWorkspacePathPalette(name: name, host: host)
        }
        commandPalette = palette
        paletteKind = .remoteWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func showNewRemoteWorkspacePathPalette(
        name: String,
        host: String,
        initialPath: String = "~/"
    ) {
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW WORKSPACE · SSH FOLDER",
            context: "\(name) · \(host)",
            placeholder: "Type a path or fuzzy-search used folders…",
            defaultFooter: "Starts in $HOME · return opens a folder or uses the current one",
            commands: remoteWorkspacePathCommands(
                host: host,
                query: initialPath,
                suggestions: [],
                name: name
            ),
            acceptsFreeform: true,
            initialQuery: initialPath
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in
            guard let self else { return }
            if let parent = self.remoteParentBrowseQuery(for: initialPath) {
                self.showNewRemoteWorkspacePathPalette(
                    name: name,
                    host: host,
                    initialPath: parent
                )
            } else {
                self.showNewRemoteWorkspaceLocationPalette(name: name)
            }
        }
        palette.onQueryChange = { [weak self, weak palette] query in
            guard let self, let palette else { return }
            self.updateRemotePathSuggestions(
                host: host,
                query: query,
                name: name,
                palette: palette
            )
        }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .useWorkspaceLocation:
                guard let path = command.location?.path, let palette else { return }
                self.chooseRemoteWorkspacePath(name: name, host: host, path: path, palette: palette)
            case .openWorkspaceLocation:
                guard let path = command.location?.path else { return }
                self.showNewRemoteWorkspacePathPalette(
                    name: name,
                    host: host,
                    initialPath: self.remoteBrowseQuery(for: path)
                )
            case .back:
                self.showNewRemoteWorkspaceLocationPalette(name: name)
            default:
                palette?.showStatus("Choose or type a remote folder")
            }
        }
        palette.onSubmit = { [weak self, weak palette] path in
            guard let self, let palette else { return }
            self.chooseRemoteWorkspacePath(name: name, host: host, path: path, palette: palette)
        }
        commandPalette = palette
        paletteKind = .remoteWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
        updateRemotePathSuggestions(host: host, query: initialPath, name: name, palette: palette)
    }

    private func chooseRemoteWorkspacePath(
        name: String,
        host: String,
        path: String,
        palette: CommandPaletteView
    ) {
        guard let location = WorkspaceLocation.parseSSHReference("\(host):\(path)") else {
            palette.showStatus("Use ~/path or an absolute /path")
            return
        }
        palette.showStatus("Checking \(location.displayName)…")
        validateRemoteWorkspaceLocation(location) { [weak self, weak palette] result in
            guard let self, let palette, self.commandPalette === palette else { return }
            switch result {
            case let .success(canonicalPath):
                self.continueNewWorkspaceFlow(
                    name: name,
                    with: .ssh(host: host, path: canonicalPath),
                    from: palette
                )
            case let .failure(error):
                palette.showStatus(error.message)
            }
        }
    }

    private func remoteWorkspacePathCommands(
        host: String,
        query: String,
        suggestions: [String],
        name: String
    ) -> [PaletteCommand] {
        var result: [PaletteCommand] = []
        var seen = Set<String>()
        let remoteHome = WorkspaceLocation.ssh(host: host, path: "~")
        if query.hasSuffix("/") {
            let currentPath = String(query.dropLast())
            let normalizedPath = currentPath.isEmpty ? "/" : currentPath
            if let current = WorkspaceLocation.parseSSHReference("\(host):\(normalizedPath)") {
                seen.insert(canonicalLocationKey(current))
                result.append(PaletteCommand(
                    id: .useWorkspaceLocation,
                    title: "Use \(current.path)",
                    shortcut: "choose this folder",
                    location: current,
                    completion: current.path
                ))
            }
        }
        let previousLocations = workspaceLocationHistory.filter {
            $0.kind == .ssh && $0.sshHost?.caseInsensitiveCompare(host) == .orderedSame
        }
        let activeLocations = workspaces.map(\.location).filter {
            $0.kind == .ssh && $0.sshHost?.caseInsensitiveCompare(host) == .orderedSame
        }
        for location in [remoteHome] + previousLocations + activeLocations {
            let key = canonicalLocationKey(location)
            guard seen.insert(key).inserted else { continue }
            let users = workspaces.filter { canonicalLocationKey($0.location) == key }.map(\.name)
            let shortcut: String
            if location.path == "~" {
                shortcut = "$HOME"
            } else if users.isEmpty {
                shortcut = "previously chosen"
            } else {
                shortcut = "used by \(users.joined(separator: ", "))"
            }
            result.append(PaletteCommand(
                id: .openWorkspaceLocation,
                title: location.path,
                shortcut: shortcut + " · open",
                location: location,
                completion: remoteBrowseQuery(for: location.path)
            ))
        }
        for path in suggestions {
            let location = WorkspaceLocation.ssh(host: host, path: path)
            guard seen.insert(canonicalLocationKey(location)).inserted else { continue }
            result.append(PaletteCommand(
                id: .openWorkspaceLocation,
                title: path,
                shortcut: "open folder",
                location: location,
                completion: remoteBrowseQuery(for: path)
            ))
        }
        result.append(PaletteCommand(
            id: .back,
            title: "Back to SSH host…",
            shortcut: name
        ))
        return result
    }

    private func remoteBrowseQuery(for path: String) -> String {
        if path == "~" { return "~/" }
        return path.hasSuffix("/") ? path : path + "/"
    }

    private func remoteParentBrowseQuery(for query: String) -> String? {
        let path = query.count > 1 && query.hasSuffix("/") ? String(query.dropLast()) : query
        if path == "~" || path == "/" { return nil }
        guard let slash = path.lastIndex(of: "/") else { return "~/" }
        let parent = String(path[..<slash])
        if parent.isEmpty { return "/" }
        return remoteBrowseQuery(for: parent)
    }

    private func updateRemotePathSuggestions(
        host: String,
        query: String,
        name: String,
        palette: CommandPaletteView
    ) {
        palette.replaceCommands(remoteWorkspacePathCommands(
            host: host,
            query: query,
            suggestions: [],
            name: name
        ))
        remotePathCompleter.complete(host: host, query: query) { [weak self, weak palette] paths in
            guard let self, let palette, self.commandPalette === palette,
                  palette.currentQuery == query
            else { return }
            palette.replaceCommands(self.remoteWorkspacePathCommands(
                host: host,
                query: query,
                suggestions: paths,
                name: name
            ))
        }
    }

    private func validSSHHost(_ value: String) -> String? {
        WorkspaceLocation.parseSSHReference(
            "\(value.trimmingCharacters(in: .whitespacesAndNewlines)):/"
        )?.sshHost
    }

    private func knownSSHHosts() -> [String] {
        var result: [String] = []
        var seen = Set<String>()
        func append(_ host: String) {
            if seen.insert(host).inserted { result.append(host) }
        }
        for location in workspaceLocationHistory {
            if let host = location.sshHost { append(host) }
        }
        for workspace in workspaces {
            if let host = workspace.location.sshHost { append(host) }
        }
        let configURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".ssh/config")
        if let config = try? String(contentsOf: configURL, encoding: .utf8) {
            for rawLine in config.split(whereSeparator: { $0.isNewline }) {
                let line = rawLine.prefix(while: { $0 != "#" })
                let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
                guard fields.first?.lowercased() == "host" else { continue }
                for field in fields.dropFirst() {
                    let host = String(field)
                    if !host.contains(where: { "*?!".contains($0) }) { append(host) }
                }
            }
        }
        return result
    }

    private func canonicalLocationKey(_ location: WorkspaceLocation) -> String {
        switch location.kind {
        case .local:
            let path = URL(fileURLWithPath: location.path)
                .standardizedFileURL
                .resolvingSymlinksInPath()
                .path
            return "local|\(path)"
        case .ssh:
            return "ssh|\(location.sshHost?.lowercased() ?? "")|\(location.path)"
        }
    }

    private func rememberWorkspaceLocation(_ location: WorkspaceLocation) {
        let key = canonicalLocationKey(location)
        workspaceLocationHistory.removeAll { canonicalLocationKey($0) == key }
        workspaceLocationHistory.insert(location, at: 0)
        if workspaceLocationHistory.count > 40 {
            workspaceLocationHistory.removeLast(workspaceLocationHistory.count - 40)
        }
    }

    private func continueNewWorkspaceFlow(
        name: String,
        with requestedLocation: WorkspaceLocation,
        from palette: CommandPaletteView? = nil
    ) {
        do {
            if registersSharedWorkspaceOnly {
                try registerSharedWorkspace(name: name, location: requestedLocation, from: palette)
            } else {
                try createNewWorkspace(name: name, location: requestedLocation)
            }
        } catch {
            if let palette {
                palette.showStatus((error as? MachinenAPIError)?.message ?? error.localizedDescription)
            } else {
                presentWorkspaceLocationError(error)
            }
        }
    }

    private func registerSharedWorkspace(
        name requestedName: String,
        location requestedLocation: WorkspaceLocation,
        from palette: CommandPaletteView?
    ) throws {
        guard let name = WorkspaceName.validated(requestedName) else {
            throw MachinenAPIError("invalid_params", "Workspace name must not be empty")
        }
        let location = try validatedWorkspaceLocation(requestedLocation)
        let workspaceID = "ws_" + UUID().uuidString.lowercased()
        palette?.showStatus("Adding workspace \(name)…")
        sessionBackend.saveWorkspace(
            id: workspaceID,
            name: name,
            at: location,
            sessionIDs: []
        ) { [weak self, weak palette] result in
            guard let self else { return }
            switch result {
            case .success:
                self.registersSharedWorkspaceOnly = false
                self.newWorkspaceEntry = nil
                self.rememberWorkspaceLocation(location)
                self.registerTargetIfNeeded(for: location)
                self.saveSessions()
                self.dismissCommandPalette()
                if let targetID = self.targetID(for: location),
                   let targetLocation = self.registeredTargetLocation(id: targetID)
                {
                    self.refreshRegisteredTarget(targetID, at: targetLocation, force: true)
                }
                self.toggleTargetSessions()
            case let .failure(error):
                palette?.showStatus(error.localizedDescription)
            }
        }
    }

    private func createNewWorkspace(name requestedName: String, location: WorkspaceLocation) throws {
        guard let name = WorkspaceName.validated(requestedName) else {
            throw MachinenAPIError("invalid_params", "Workspace name must not be empty")
        }
        guard !workspaceNameExists(name) else {
            throw MachinenAPIError("workspace_name_conflict", "That workspace name is already in use")
        }
        let location = try validatedWorkspaceLocation(location)
        newWorkspaceEntry = nil
        dismissCommandPalette()
        createPersistentSession(
            workspace: name,
            name: "shell",
            command: nil,
            workingDirectory: location.path,
            location: location
        )
    }

    private func showRenameWorkspacePalette() {
        guard let workspaceID = selectedWorkspaceID(),
              let workspace = workspaces.first(where: { $0.id == workspaceID })
        else { return }
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "RENAME WORKSPACE",
            context: "unique name",
            placeholder: "Enter a new name…",
            defaultFooter: "The current name is selected · type to replace it",
            commands: [],
            acceptsFreeform: true,
            initialQuery: workspace.name
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.toggleCommandPalette() }
        palette.onSubmit = { [weak self, weak palette] value in
            guard let self,
                  let workspace = self.workspaces.first(where: { $0.id == workspaceID })
            else { return }
            guard let name = WorkspaceName.validated(value) else {
                palette?.showStatus("Enter a non-empty workspace name")
                return
            }
            guard !self.workspaceNameExists(name, excluding: workspaceID) else {
                palette?.showStatus("That workspace name is already in use")
                return
            }
            workspace.name = name
            for tile in self.allSessionTiles where tile.session.workspaceID == workspaceID {
                tile.session.workspace = name
            }
            self.dismissCommandPalette()
            self.rebuildWorkspaceClusters()
            self.updateSelection()
            self.saveSessions()
            self.persistNativeWorkspace(workspace)
            self.emitAPIEvent("workspace.updated", data: self.workspaceJSON(workspace))
        }
        commandPalette = palette
        paletteKind = .renameWorkspace
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func chooseWorkspaceLocation() {
        guard let workspaceID = selectedWorkspaceID(),
              let workspace = workspaces.first(where: { $0.id == workspaceID })
        else { return }
        dismissCommandPalette()

        let palette = CommandPaletteView(
            frame: bounds,
            heading: "WORKSPACE LOCATION",
            context: workspace.location.displayName,
            placeholder: "Choose where this workspace runs…",
            defaultFooter: "This is a default, not an identity · locations may be shared",
            commands: [
                PaletteCommand(
                    id: .chooseLocalWorkspaceLocation,
                    title: "Local folder…",
                    shortcut: workspace.location.kind == .local ? "current" : ""
                ),
                PaletteCommand(
                    id: .chooseRemoteWorkspaceLocation,
                    title: "Remote folder over SSH…",
                    shortcut: workspace.location.sshHost ?? "host:path"
                ),
            ]
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.toggleCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .chooseLocalWorkspaceLocation:
                self.chooseLocalWorkspaceLocation(workspaceID: workspaceID)
            case .chooseRemoteWorkspaceLocation:
                self.showRemoteWorkspaceLocationPalette(workspaceID: workspaceID)
            default:
                palette?.showStatus("That location type is not available")
            }
        }
        commandPalette = palette
        paletteKind = .workspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func chooseLocalWorkspaceLocation(
        workspaceID: String,
        initialPath: String = "~/"
    ) {
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }) else { return }
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "WORKSPACE LOCATION · LOCAL FOLDER",
            context: workspace.name,
            placeholder: "Type a path or fuzzy-search used folders…",
            defaultFooter: "Starts in $HOME · return opens a folder or uses the current one",
            commands: localWorkspacePathCommands(query: initialPath, name: workspace.name),
            acceptsFreeform: true,
            initialQuery: initialPath
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in
            guard let self else { return }
            if let parent = self.localParentBrowseQuery(for: initialPath) {
                self.chooseLocalWorkspaceLocation(
                    workspaceID: workspaceID,
                    initialPath: parent
                )
            } else {
                self.chooseWorkspaceLocation()
            }
        }
        palette.onQueryChange = { [weak self, weak palette] query in
            guard let self, let palette else { return }
            palette.replaceCommands(self.localWorkspacePathCommands(
                query: query,
                name: workspace.name
            ))
        }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .useWorkspaceLocation:
                guard let location = command.location else { return }
                self.applyChosenWorkspaceLocation(
                    workspaceID: workspaceID,
                    location: location,
                    palette: palette
                )
            case .openWorkspaceLocation:
                guard let location = command.location else { return }
                self.chooseLocalWorkspaceLocation(
                    workspaceID: workspaceID,
                    initialPath: self.localBrowseQuery(for: location.path)
                )
            case .browseLocalWorkspaceLocation:
                self.browseLocalWorkspaceLocation(
                    workspaceID: workspaceID,
                    returnPath: palette?.currentQuery ?? "~/"
                )
            case .back:
                self.chooseWorkspaceLocation()
            default:
                palette?.showStatus("Choose or type a local folder")
            }
        }
        palette.onSubmit = { [weak self, weak palette] value in
            guard let self else { return }
            self.applyChosenWorkspaceLocation(
                workspaceID: workspaceID,
                location: .local(WorkspacePathSuggestions.expandedLocalPath(value)),
                palette: palette
            )
        }
        commandPalette = palette
        paletteKind = .workspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func applyChosenWorkspaceLocation(
        workspaceID: String,
        location: WorkspaceLocation,
        palette: CommandPaletteView?
    ) {
        do {
            try applyWorkspaceLocation(workspaceID: workspaceID, location: location)
            dismissCommandPalette()
        } catch {
            palette?.showStatus((error as? MachinenAPIError)?.message ?? error.localizedDescription)
        }
    }

    private func browseLocalWorkspaceLocation(workspaceID: String, returnPath: String) {
        guard workspaces.contains(where: { $0.id == workspaceID }), let window else { return }
        dismissCommandPalette()
        let panel = NSOpenPanel()
        panel.title = "Choose Local Workspace Folder"
        panel.message = "New terminals will use this folder. Existing terminals stay at their current locations. Other workspaces may use it too."
        panel.prompt = "Use Folder"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser
        panel.beginSheetModal(for: window) { [weak self] response in
            Task { @MainActor in
                guard let self else { return }
                guard response == .OK, let path = panel.url?.path else {
                    self.chooseLocalWorkspaceLocation(
                        workspaceID: workspaceID,
                        initialPath: returnPath
                    )
                    return
                }
                do {
                    try self.applyWorkspaceLocation(
                        workspaceID: workspaceID,
                        location: .local(path)
                    )
                } catch {
                    self.presentWorkspaceLocationError(error)
                    self.chooseLocalWorkspaceLocation(
                        workspaceID: workspaceID,
                        initialPath: returnPath
                    )
                }
            }
        }
    }

    private func showRemoteWorkspaceLocationPalette(workspaceID: String) {
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }) else { return }
        dismissCommandPalette()
        let initialHost = workspace.location.sshHost ?? knownSSHHosts().first
        let initialReference = initialHost.map { "\($0):~/" } ?? ""
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "REMOTE WORKSPACE",
            context: workspace.name,
            placeholder: "mini:~/project or user@host:/project",
            defaultFooter: "Starts in remote $HOME · previously chosen folders stay listed",
            commands: remoteWorkspaceReferenceCommands(workspaceName: workspace.name),
            acceptsFreeform: true,
            initialQuery: initialReference
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.chooseWorkspaceLocation() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            if command.id == .back {
                self.chooseWorkspaceLocation()
                return
            }
            guard let location = command.location else { return }
            self.applyRemoteWorkspaceLocation(
                workspaceID: workspaceID,
                location: location,
                palette: palette
            )
        }
        palette.onSubmit = { [weak self, weak palette] value in
            guard let self, let palette,
                  let location = WorkspaceLocation.parseSSHReference(value)
            else {
                palette?.showStatus("Use alias:/absolute/path, alias:~/path, or ssh://user@host/path")
                return
            }
            self.applyRemoteWorkspaceLocation(
                workspaceID: workspaceID,
                location: location,
                palette: palette
            )
        }
        commandPalette = palette
        paletteKind = .remoteWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func remoteWorkspaceReferenceCommands(workspaceName: String) -> [PaletteCommand] {
        var commands: [PaletteCommand] = []
        var seen = Set<String>()
        let locations = workspaceLocationHistory.filter { $0.kind == .ssh }
            + workspaces.map(\.location).filter { $0.kind == .ssh }
        for location in locations {
            let key = canonicalLocationKey(location)
            guard seen.insert(key).inserted else { continue }
            let users = workspaces.filter { canonicalLocationKey($0.location) == key }.map(\.name)
            commands.append(PaletteCommand(
                id: .useWorkspaceLocation,
                title: location.displayName,
                shortcut: users.isEmpty
                    ? "previously chosen"
                    : "used by \(users.joined(separator: ", "))",
                location: location,
                completion: location.displayName
            ))
        }
        commands.append(PaletteCommand(
            id: .back,
            title: "Back to location type…",
            shortcut: workspaceName
        ))
        return commands
    }

    private func applyRemoteWorkspaceLocation(
        workspaceID: String,
        location: WorkspaceLocation,
        palette: CommandPaletteView?
    ) {
        guard let palette, let host = location.sshHost else {
            palette?.showStatus("Use an OpenSSH host and remote folder")
            return
        }
        palette.showStatus("Checking \(location.displayName)…")
        validateRemoteWorkspaceLocation(location) { [weak self, weak palette] result in
            guard let self, let palette, self.commandPalette === palette else { return }
            switch result {
            case let .success(canonicalPath):
                do {
                    try self.applyWorkspaceLocation(
                        workspaceID: workspaceID,
                        location: .ssh(host: host, path: canonicalPath)
                    )
                    self.dismissCommandPalette()
                } catch {
                    palette.showStatus((error as? MachinenAPIError)?.message ?? error.localizedDescription)
                }
            case let .failure(error):
                palette.showStatus(error.message)
            }
        }
    }

    private func validateRemoteWorkspaceLocation(
        _ location: WorkspaceLocation,
        completion: @escaping @MainActor (Result<String, MachinenAPIError>) -> Void
    ) {
        guard let host = location.sshHost else {
            completion(.failure(MachinenAPIError("invalid_params", "An SSH host is required")))
            return
        }
        locationValidationProcess?.terminate()
        let output = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        process.arguments = [
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=8",
            host,
            "cd -- \(location.remoteShellPath) && /bin/pwd -P",
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = output
        process.terminationHandler = { process in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let text = String(decoding: data, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            Task { @MainActor in
                if process.terminationStatus == 0, let path = text.split(separator: "\n").last {
                    completion(.success(String(path)))
                } else {
                    completion(.failure(MachinenAPIError(
                        "ssh_unavailable",
                        text.isEmpty ? "SSH could not access that folder" : text
                    )))
                }
            }
        }
        do {
            try process.run()
            locationValidationProcess = process
        } catch {
            completion(.failure(MachinenAPIError("ssh_unavailable", error.localizedDescription)))
        }
    }

    private func applyWorkspaceLocation(
        workspaceID: String,
        location: WorkspaceLocation
    ) throws {
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }) else {
            throw MachinenAPIError("workspace_not_found", "Workspace does not exist")
        }
        try updateWorkspaceLocation(workspace, to: location)
        updateSelection()
        saveSessions()
        persistNativeWorkspace(workspace)
        emitAPIEvent("workspace.updated", data: workspaceJSON(workspace))
    }

    private func presentWorkspaceLocationError(_ error: Error) {
        guard let window else { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Could Not Use Workspace Location"
        alert.informativeText = (error as? MachinenAPIError)?.message ?? error.localizedDescription
        alert.beginSheetModal(for: window)
    }

    private func workspaceNameExists(_ name: String, excluding workspaceID: String? = nil) -> Bool {
        let key = WorkspaceName.key(name)
        return workspaces.contains {
            $0.id != workspaceID && WorkspaceName.key($0.name) == key
        }
    }

    private func presentConfirmation(
        heading: String,
        message: String,
        consequence: String,
        confirmTitle: String,
        cancelAction: (@MainActor () -> Void)? = nil,
        action: @escaping @MainActor () -> Void
    ) {
        let confirmation = ActionConfirmationView(
            frame: bounds,
            heading: heading,
            message: message,
            consequence: consequence,
            confirmTitle: confirmTitle
        )
        confirmation.layer?.zPosition = 2_000
        confirmation.onCancel = { [weak self] in
            self?.dismissPresentedOverlay()
            cancelAction?()
        }
        confirmation.onConfirm = { [weak self] in
            self?.dismissPresentedOverlay()
            action()
        }
        presentedOverlay = confirmation
        addSubview(confirmation, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(confirmation)
    }

    private func dismissPresentedOverlay() {
        presentedOverlay?.removeFromSuperview()
        presentedOverlay = nil
        restoreInputFocus()
    }

    private func confirmStopSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        presentConfirmation(
            heading: "Stop session \(tile.session.name)?",
            message: "This terminates the process in this terminal. The workspace and its other sessions keep running.",
            consequence: "Unsaved input in the process may be lost. The stopped session remains visible and can be restarted.",
            confirmTitle: "Stop session"
        ) { [weak self, weak tile] in
            guard let self, let tile else { return }
            self.stopSession(tile)
        }
    }

    private func confirmStopSelectedWorkspace() {
        guard let workspace = selectedWorkspace() else { return }
        let count = persistedSessionTiles.count { $0.session.workspace == workspace }
        presentConfirmation(
            heading: "Stop workspace \(workspace)?",
            message: "This stops all \(count) terminal \(count == 1 ? "process" : "processes") grouped in this workspace.",
            consequence: "The workspace and terminal definitions remain. Each terminal can be restarted later.",
            confirmTitle: "Stop workspace"
        ) { [weak self] in
            self?.stopWorkspace(workspace)
        }
    }

    private func confirmCloseSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        presentConfirmation(
            heading: "Close terminal \(tile.session.name)?",
            message: "This terminates its process and removes the terminal from \(tile.session.workspace).",
            consequence: "Files in its working directory are not deleted.",
            confirmTitle: "Close terminal"
        ) { [weak self, weak tile] in
            guard let self, let tile else { return }
            self.closeSession(tile)
        }
    }

    private func confirmCloseSelectedWorkspace(returnToCommands: Bool = false) {
        guard let workspace = selectedWorkspace() else { return }
        let count = persistedSessionTiles.count { $0.session.workspace == workspace }
        let cancelAction: (@MainActor () -> Void)?
        if returnToCommands {
            cancelAction = { [weak self] in
                guard let self else { return }
                self.toggleCommandPalette()
            }
        } else {
            cancelAction = nil
        }
        presentConfirmation(
            heading: "Close workspace \(workspace)?",
            message: "This terminates \(count) terminal \(count == 1 ? "process" : "processes") and removes the workspace from Machinen.",
            consequence: "Files in the terminals' working directories are not deleted.",
            confirmTitle: "Close workspace",
            cancelAction: cancelAction
        ) { [weak self] in
            self?.closeWorkspace(workspace)
        }
    }

    private func detachSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        tile.transition(to: .detached, terminalText: tile.session.terminalText)
        tile.detachTerminalViewer()
        saveSessions()
        emitAPIEvent("tile.viewerChanged", data: tileJSON(tile))
        if focusedIndex != nil {
            leaveFocusedSession()
        }
    }

    private func reconnectSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        tile.transition(to: .starting, terminalText: tile.session.terminalText)
        tile.attachTerminal()
        saveSessions()
        emitAPIEvent("tile.viewerChanged", data: tileJSON(tile))
    }

    private func restartSelectedSession() {
        guard let tile = selectedSessionTile(), tile.session.startsSessionIfMissing else {
            NSSound.beep()
            return
        }
        tile.transition(to: .starting, terminalText: tile.session.terminalText)
        tile.restartTerminal()
        saveSessions()
    }

    private func stopSession(_ tile: TerminalTileView) {
        tile.stopTerminal()
        tile.transition(to: .stopped, terminalText: tile.session.terminalText)
        saveSessions()
    }

    private func stopWorkspace(_ workspace: String) {
        for tile in persistedSessionTiles where tile.session.workspace == workspace {
            tile.stopTerminal()
            tile.transition(to: .stopped, terminalText: tile.session.terminalText)
        }
        saveSessions()
    }

    private func bufferCloseSession(_ tile: TerminalTileView) {
        guard let position = allSessionTiles.firstIndex(where: { $0 === tile }) else { return }
        let workspaceID = tile.session.workspaceID
        let disconnectedAt = Date()
        tile.session.disconnectedAt = disconnectedAt
        tile.session.disconnectedPosition = position
        tile.transition(to: .detached, terminalText: tile.session.terminalText)
        tile.detachTerminalViewer()
        recentlyClosedTerminals[tile.session.id] = RecentlyClosedTerminal(
            tile: tile,
            position: position,
            disconnectedAt: disconnectedAt
        )

        tile.removeFromSuperview()
        allSessionTiles.remove(at: position)
        rebuildWorkspaceClusters()
        if currentWorkspace == workspaceID {
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
            focusedIndex = nil
        }
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        showUndoToast(terminalID: tile.session.id)
        refreshAvailableSessionsPanel()
        emitAPIEvent("tile.disconnected", data: tileJSON(tile))
    }

    private func pendingWorkspaceCloseKey(targetID: String, workspaceID: String) -> String {
        "\(targetID):\(workspaceID)"
    }

    private func bufferCloseWorkspace(
        _ nativeRecord: NativeWorkspaceRecord,
        targetID: String,
        location: WorkspaceLocation,
        discoveredSessions: [AvailableTerminalSession]
    ) {
        let closeKey = pendingWorkspaceCloseKey(targetID: targetID, workspaceID: nativeRecord.id)
        guard pendingWorkspaceCloses[closeKey] == nil else { return }
        let discovery = targetDiscoveries[targetID]
        let scenePosition = workspaces.firstIndex { $0.id == nativeRecord.id }
        let sceneRecord = scenePosition.map { workspaces[$0] }
        let visibleTiles = allSessionTiles.enumerated().compactMap { index, tile in
            tile.session.workspaceID == nativeRecord.id
                ? PendingWorkspaceTile(
                    tile: tile,
                    position: index,
                    state: tile.session.state,
                    wasAttached: terminalViewerIsAttached(tile.session)
                )
                : nil
        }
        let disconnectedTerminalIDs = recentlyClosedTerminals.values.compactMap { closed in
            closed.tile.session.workspaceID == nativeRecord.id ? closed.tile.session.id : nil
        }
        for terminalID in disconnectedTerminalIDs {
            finalizePendingClose(terminalID: terminalID)
        }
        for pending in visibleTiles where pending.wasAttached {
            pending.tile.transition(to: .detached, terminalText: pending.tile.session.terminalText)
            pending.tile.detachTerminalViewer()
        }
        for pending in visibleTiles { pending.tile.removeFromSuperview() }
        allSessionTiles.removeAll { $0.session.workspaceID == nativeRecord.id }
        if let scenePosition { workspaces.remove(at: scenePosition) }

        pendingWorkspaceCloses[closeKey] = PendingWorkspaceClose(
            targetID: targetID,
            location: location,
            nativeRecord: nativeRecord,
            discoveredSessions: discoveredSessions,
            discoveryState: discovery?.state ?? .inactive,
            discoveryError: discovery?.error,
            sceneRecord: sceneRecord,
            scenePosition: scenePosition,
            sceneTiles: visibleTiles
        )
        hideWorkspaceFromDiscovery(workspaceID: nativeRecord.id, targetID: targetID, location: location)

        if currentWorkspace == nativeRecord.id {
            currentWorkspace = nil
            focusedIndex = nil
        }
        selectedIndex = min(selectedIndex, max(0, workspaces.count - 1))
        rebuildWorkspaceClusters()
        enterSoleTerminalIfNeeded()
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        showWorkspaceUndoToast(closeKey: closeKey, name: nativeRecord.name)

        let task = DispatchWorkItem { [weak self] in
            self?.finalizePendingWorkspaceClose(closeKey: closeKey)
        }
        pendingWorkspaceCloseTasks[closeKey]?.cancel()
        pendingWorkspaceCloseTasks[closeKey] = task
        DispatchQueue.main.asyncAfter(deadline: .now() + undoToastDuration, execute: task)
    }

    private func hideWorkspaceFromDiscovery(
        workspaceID: String,
        targetID: String,
        location: WorkspaceLocation
    ) {
        if let discovery = targetDiscoveries[targetID] {
            let sessions = discovery.sessions.filter { $0.workspaceId != workspaceID }
            let state: TargetDiscovery.State = if discovery.state == .unreachable {
                .unreachable
            } else {
                sessions.isEmpty ? .inactive : .online
            }
            targetDiscoveries[targetID] = TargetDiscovery(
                state: state,
                sessions: sessions,
                workspaces: discovery.workspaces.filter { $0.id != workspaceID },
                checkedAt: discovery.checkedAt,
                error: discovery.error
            )
        }
        availableSessionsByMachine[location.machineID]?.removeAll { $0.workspaceId == workspaceID }
        targetDiscoveryDidChange()
    }

    private func restorePendingWorkspaceClose(closeKey: String) {
        guard let pending = pendingWorkspaceCloses.removeValue(forKey: closeKey) else { return }
        pendingWorkspaceCloseTasks.removeValue(forKey: closeKey)?.cancel()
        hideWorkspaceUndoToast(ifMatching: closeKey)

        if let sceneRecord = pending.sceneRecord {
            let insertion = min(max(0, pending.scenePosition ?? workspaces.count), workspaces.count)
            workspaces.insert(sceneRecord, at: insertion)
            for pendingTile in pending.sceneTiles.sorted(by: { $0.position < $1.position }) {
                let tile = pendingTile.tile
                let tileInsertion = min(max(0, pendingTile.position), allSessionTiles.count)
                allSessionTiles.insert(tile, at: tileInsertion)
                installTile(tile)
                if pendingTile.wasAttached, terminalIsRunning(tile.session) {
                    tile.transition(to: .starting, terminalText: tile.session.terminalText)
                    tile.attachTerminal()
                } else {
                    tile.transition(to: pendingTile.state, terminalText: tile.session.terminalText)
                }
            }
            rebuildWorkspaceClusters()
            selectedIndex = min(insertion, max(0, workspaceClusters.count - 1))
            currentWorkspace = nil
            focusedIndex = nil
            updateWorldGeometry()
            updateSelection()
            setCameraImmediately()
        }

        if registeredTargetLocation(id: pending.targetID) == pending.location {
            let current = targetDiscoveries[pending.targetID]
            let sessions = (current?.sessions ?? []) + pending.discoveredSessions.filter { session in
                !(current?.sessions.contains(where: { $0.id == session.id }) ?? false)
            }
            let workspaces = (current?.workspaces ?? []) + [pending.nativeRecord].filter { record in
                !(current?.workspaces.contains(where: { $0.id == record.id }) ?? false)
            }
            let state: TargetDiscovery.State = if pending.discoveryState == .unreachable {
                .unreachable
            } else {
                sessions.isEmpty ? .inactive : .online
            }
            targetDiscoveries[pending.targetID] = TargetDiscovery(
                state: state,
                sessions: sessions,
                workspaces: workspaces,
                checkedAt: current?.checkedAt ?? Date(),
                error: pending.discoveryError
            )
            availableSessionsByMachine[pending.location.machineID] = sessions
        }
        saveSessions()
        targetDiscoveryDidChange()
    }

    private func finalizePendingWorkspaceClose(closeKey: String) {
        guard let pending = pendingWorkspaceCloses.removeValue(forKey: closeKey) else { return }
        let workspaceID = pending.nativeRecord.id
        finalizingWorkspaceIDsByTarget[pending.targetID, default: []].insert(workspaceID)
        pendingWorkspaceCloseTasks.removeValue(forKey: closeKey)?.cancel()
        hideWorkspaceUndoToast(ifMatching: closeKey)

        let representedSessionIDs = Set(pending.sceneTiles.map { $0.tile.session.id })
        for pendingTile in pending.sceneTiles {
            pendingTile.tile.removeTerminal()
            emitAPIEvent("tile.deleted", data: tileJSON(pendingTile.tile))
        }
        for discovered in pending.discoveredSessions where !representedSessionIDs.contains(discovered.id) {
            let session = TerminalSession(
                id: discovered.id,
                label: "session",
                workspaceID: workspaceID,
                workspace: pending.nativeRecord.name,
                name: discovered.name ?? "session",
                launch: .loginShell,
                workingDirectory: discovered.workingDirectory,
                workspaceRoot: pending.nativeRecord.rootDirectory,
                sshHost: pending.location.sshHost,
                startsSessionIfMissing: false,
                state: .detached
            )
            sessionBackend.remove(session)
        }
        sessionBackend.deleteWorkspace(id: workspaceID, at: pending.location) { [weak self] result in
            guard let self else { return }
            self.finalizingWorkspaceIDsByTarget[pending.targetID]?.remove(workspaceID)
            if self.finalizingWorkspaceIDsByTarget[pending.targetID]?.isEmpty == true {
                self.finalizingWorkspaceIDsByTarget.removeValue(forKey: pending.targetID)
            }
            self.saveSessions()
            if case let .failure(error) = result {
                NSLog("Machinen could not close native workspace: %@", String(describing: error))
            }
            if self.registeredTargetLocation(id: pending.targetID) == pending.location {
                self.refreshRegisteredTarget(pending.targetID, at: pending.location, force: true)
            }
        }
        emitAPIEvent("workspace.deleted", data: [
            "id": workspaceID,
            "name": pending.nativeRecord.name,
        ])
        saveSessions()
        refreshStatusBar()
    }

    var canReopenClosedTerminal: Bool { !recentlyClosedTerminals.isEmpty }
    var canRestoreUndoToast: Bool {
        if let closeKey = undoToastWorkspaceID {
            return pendingWorkspaceCloses[closeKey] != nil
        }
        guard let terminalID = undoToastTerminalID else { return false }
        return recentlyClosedTerminals[terminalID] != nil
    }

    func restoreUndoToastTerminal() {
        if let closeKey = undoToastWorkspaceID {
            restorePendingWorkspaceClose(closeKey: closeKey)
            return
        }
        guard let terminalID = undoToastTerminalID else { return }
        reopenClosedTerminal(terminalID: terminalID)
    }

    func reopenLastClosedTerminal() {
        let workspaceID = selectedWorkspaceID()
        let candidates = recentlyClosedTerminals.values.filter {
            workspaceID == nil || $0.tile.session.workspaceID == workspaceID
        }
        guard let closed = candidates.max(by: { $0.disconnectedAt < $1.disconnectedAt })
            ?? recentlyClosedTerminals.values.max(by: {
                $0.disconnectedAt < $1.disconnectedAt
            })
        else { return }
        reopenClosedTerminal(terminalID: closed.tile.session.id)
    }

    private func reopenClosedTerminal(terminalID: String) {
        guard let closed = recentlyClosedTerminals[terminalID] else { return }
        guard workspaces.contains(where: { $0.id == closed.tile.session.workspaceID }) else {
            finalizePendingClose(terminalID: terminalID)
            return
        }
        recentlyClosedTerminals.removeValue(forKey: terminalID)
        closed.tile.session.disconnectedAt = nil
        closed.tile.session.disconnectedPosition = nil
        let insertion = min(max(0, closed.position), allSessionTiles.count)
        allSessionTiles.insert(closed.tile, at: insertion)
        rebuildWorkspaceClusters()
        currentWorkspace = closed.tile.session.workspaceID
        let workspaceTiles = activeSessionTiles
        selectedIndex = workspaceTiles.firstIndex(where: { $0 === closed.tile }) ?? 0
        focusedIndex = selectedIndex
        if terminalIsRunning(closed.tile.session) {
            closed.tile.transition(to: .starting, terminalText: closed.tile.session.terminalText)
            closed.tile.attachTerminal()
        } else {
            closed.tile.transition(
                to: closed.tile.session.state,
                terminalText: closed.tile.session.terminalText
            )
        }
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        hideUndoToast(ifMatching: terminalID)
        refreshAvailableSessionsPanel()
        emitAPIEvent("tile.reconnected", data: tileJSON(closed.tile))
    }

    func terminateLastClosedTerminalNow() {
        if let closeKey = undoToastWorkspaceID {
            finalizePendingWorkspaceClose(closeKey: closeKey)
            return
        }
        let workspaceID = selectedWorkspaceID()
        let candidates = recentlyClosedTerminals.values.filter {
            workspaceID == nil || $0.tile.session.workspaceID == workspaceID
        }
        guard let closed = candidates.max(by: { $0.disconnectedAt < $1.disconnectedAt })
            ?? recentlyClosedTerminals.values.max(by: {
                $0.disconnectedAt < $1.disconnectedAt
            })
        else { return }
        finalizePendingClose(terminalID: closed.tile.session.id)
    }

    private func finalizePendingClose(terminalID: String) {
        guard let closed = recentlyClosedTerminals.removeValue(forKey: terminalID) else { return }
        hideUndoToast(ifMatching: terminalID)
        refreshAvailableSessionsPanel()
        refreshStatusBar()
        saveSessions()
        emitAPIEvent("tile.killed", data: tileJSON(closed.tile))
        // The tile is already absent from the scene. Defer renderer teardown so
        // the visible close commits before Ghostty and worker cleanup begin.
        DispatchQueue.main.async {
            closed.tile.removeTerminal()
        }
    }

    private func showUndoToast(terminalID: String) {
        guard let closed = recentlyClosedTerminals[terminalID] else { return }
        undoToastDismissTask?.cancel()
        undoCloseView?.removeFromSuperview()

        let view = UndoTerminalCloseView(frame: .zero)
        view.terminalName = closed.tile.session.name
        view.onRestore = { [weak self] in
            self?.reopenClosedTerminal(terminalID: terminalID)
        }
        view.onKill = { [weak self] in
            self?.finalizePendingClose(terminalID: terminalID)
        }
        undoCloseView = view
        undoToastTerminalID = terminalID
        undoToastWorkspaceID = nil
        addSubview(view, positioned: .above, relativeTo: statusBarView)
        needsLayout = true

        let task = DispatchWorkItem { [weak self] in
            self?.hideUndoToast(ifMatching: terminalID)
        }
        undoToastDismissTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + undoToastDuration, execute: task)
    }

    private func showWorkspaceUndoToast(closeKey: String, name: String) {
        undoToastDismissTask?.cancel()
        undoCloseView?.removeFromSuperview()

        let view = UndoTerminalCloseView(frame: .zero)
        view.headline = "Closed \(name)"
        view.detail = "Sessions keep running until the close is committed"
        view.commitTitle = "Close now"
        view.restoreTitle = "Undo ⌘Z"
        view.onRestore = { [weak self] in
            self?.restorePendingWorkspaceClose(closeKey: closeKey)
        }
        view.onKill = { [weak self] in
            self?.finalizePendingWorkspaceClose(closeKey: closeKey)
        }
        undoCloseView = view
        undoToastTerminalID = nil
        undoToastWorkspaceID = closeKey
        addSubview(view, positioned: .above, relativeTo: statusBarView)
        needsLayout = true
    }

    private func hideWorkspaceUndoToast(ifMatching closeKey: String) {
        guard undoToastWorkspaceID == closeKey else { return }
        hideUndoToast()
    }

    private func hideUndoToast(ifMatching terminalID: String? = nil) {
        if let terminalID, undoToastTerminalID != terminalID { return }
        undoToastDismissTask?.cancel()
        undoToastDismissTask = nil
        undoCloseView?.removeFromSuperview()
        undoCloseView = nil
        undoToastTerminalID = nil
        undoToastWorkspaceID = nil
    }

    private func closeSession(_ tile: TerminalTileView) {
        let workspaceID = tile.session.workspaceID
        let removalSnapshot = paneRemovalSnapshot(of: tile)
        let previousFrames = allSessionTiles.compactMap { sibling in
            sibling !== tile && sibling.session.workspaceID == workspaceID
                ? (tile: sibling, frame: sibling.frame)
                : nil
        }
        tile.removeTerminal()
        tile.removeFromSuperview()
        allSessionTiles.removeAll { $0 === tile }
        emitAPIEvent("tile.deleted", data: tileJSON(tile))
        rebuildWorkspaceClusters()
        if currentWorkspace == workspaceID {
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
            focusedIndex = nil
        }
        updateWorldGeometry()
        updateSelection()
        finishPaneRemoval(snapshot: removalSnapshot, previousFrames: previousFrames)
        saveSessions()
    }

    private func closeWorkspace(_ workspace: String) {
        let workspaceRecord = workspaces.first { $0.name == workspace }
        if let workspaceRecord { deleteNativeWorkspace(workspaceRecord) }
        let pendingTerminalIDs = recentlyClosedTerminals.values
            .filter { $0.tile.session.workspace == workspace }
            .map { $0.tile.session.id }
        for terminalID in pendingTerminalIDs {
            finalizePendingClose(terminalID: terminalID)
        }
        let removedTiles = allSessionTiles.filter { $0.session.workspace == workspace }
        let removalView: NSView? = if currentWorkspace == workspaceRecord?.id {
            selectedSessionTile() ?? workspaceCluster(named: workspaceRecord?.id)
        } else {
            workspaceCluster(named: workspaceRecord?.id)
        }
        let removalSnapshot = removalView.flatMap(paneRemovalSnapshot)
        for tile in removedTiles {
            tile.removeTerminal()
            tile.removeFromSuperview()
            emitAPIEvent("tile.deleted", data: tileJSON(tile))
        }
        allSessionTiles.removeAll { $0.session.workspace == workspace }
        if let workspaceID = workspaceRecord?.id {
            workspaceCluster(named: workspaceID)?.removeFromSuperview()
            workspaces.removeAll { $0.id == workspaceID }
        }
        workspaceClusters.removeAll { $0.workspace == workspace }
        rebuildWorkspaceClusters()
        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = min(selectedIndex, max(0, workspaceClusters.count - 1))
        enterSoleTerminalIfNeeded()
        updateWorldGeometry()
        updateSelection()
        finishPaneRemoval(snapshot: removalSnapshot)
        saveSessions()
        if let workspaceRecord {
            emitAPIEvent("workspace.deleted", data: [
                "id": workspaceRecord.id,
                "name": workspaceRecord.name,
            ])
        }
    }

    func showDebugInformation() {
        guard presentedOverlay == nil else { return }
        showDiagnostics()
    }

    private func showDiagnostics() {
        guard let workspace = selectedWorkspace() else { return }
        let text: String
        let heading: String
        if currentWorkspace == nil {
            let sessions = allSessionTiles.filter { $0.session.workspace == workspace }
            heading = "WORKSPACE DIAGNOSTICS · \(workspace)"
            let sessionLines = sessions.map {
                "  \($0.session.label)  \($0.session.name.padding(toLength: 12, withPad: " ", startingAt: 0)) \($0.currentState.rawValue)"
            }.joined(separator: "\n")
            text = """
            workspace       \(workspace)
            kind            visual terminal group
            location        \(selectedWorkspaceRecord()?.location.displayName ?? "unknown")
            sessions        \(sessions.count)
            state file      \(sessionStore.manifestURL.path)

            SESSION STATE
            \(sessionLines)

            PERSISTENCE
            Native session workers own terminal commands and journal output in
            SQLite. Machinen restores the scene from the state file above.
            """
        } else if let tile = selectedSessionTile() {
            heading = "SESSION DIAGNOSTICS · \(workspace) / \(tile.session.name)"
            let backendDetail = "The native worker owns this PTY and checkpoints recovery data on \(tile.session.location.sshHost ?? "this Mac")."
            text = """
            workspace       \(workspace)
            session         \(tile.session.name)
            session id      \(tile.session.id)
            backend         \(TerminalSession.backendName)
            state            \(tile.currentState.rawValue)
            viewer           \(terminalViewerIsAttached(tile.session) ? "attached" : "detached")
            command          \(launchDescription(tile.session.launch))
            location         \(tile.session.location.displayName)
            state file       \(sessionStore.manifestURL.path)

            PERSISTENCE
            \(backendDetail)
            """
        } else {
            return
        }

        let diagnostics = DiagnosticsView(frame: bounds, heading: heading, text: text)
        diagnostics.layer?.zPosition = 2_000
        diagnostics.onDismiss = { [weak self] in self?.dismissPresentedOverlay() }
        presentedOverlay = diagnostics
        addSubview(diagnostics, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(diagnostics)
    }

    func prepareForTermination() {
        isShuttingDown = true
        removeGestureEventMonitor()
        availableSessionsRefreshTimer?.invalidate()
        availableSessionsRefreshTimer = nil
        for tile in persistedSessionTiles where tile.session.state == .running || tile.session.state == .starting {
            tile.detachTerminalForApplicationExit()
            tile.session.state = .running
        }
        saveSessions()
    }

    func magnifyCamera() {
        changeCameraMagnification(to: cameraMagnification + CameraMagnification.increment)
    }

    func demagnifyCamera() {
        changeCameraMagnification(to: cameraMagnification - CameraMagnification.increment)
    }

    func resetCameraMagnification() {
        changeCameraMagnification(to: 1)
    }

    private func changeCameraMagnification(to requestedMagnification: CGFloat) {
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking
        else { return }
        let clampedMagnification = min(
            CameraMagnification.maximum,
            max(CameraMagnification.minimum, requestedMagnification)
        )
        let magnification = (clampedMagnification * 1_000).rounded() / 1_000
        guard magnification != cameraMagnification else { return }
        cameraMagnification = magnification
        moveCamera(duration: Motion.magnificationDuration)
    }

    @discardableResult
    func zoomInOneLevel() -> Bool {
        guard presentedOverlay == nil, commandPalette == nil,
              focusedIndex == nil, !isTransitioning, !isPeeking,
              activeCount > 0
        else { return false }
        activate(selectedIndex)
        return true
    }

    @discardableResult
    func zoomOutOneLevel() -> Bool {
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking
        else { return false }
        if focusedIndex != nil {
            leaveFocusedSession()
            return true
        }
        if currentWorkspace != nil {
            showWorkspaceDeck()
            return true
        }
        return false
    }

    func performShortcut(_ action: DesktopShortcutAction) -> Bool {
        if let addWorkspaceCardView,
           addWorkspaceCardView.window?.firstResponder === addWorkspaceCardView
        {
            return addWorkspaceCardView.performShortcut(action)
        }
        if let addTerminalCardView,
           addTerminalCardView.window?.firstResponder === addTerminalCardView
        {
            return addTerminalCardView.performShortcut(action)
        }
        if let inlineConfirmationView,
           inlineConfirmationView.window?.firstResponder === inlineConfirmationView
        {
            if action == .leave {
                leaveInlineRemoval()
                return true
            }
            return inlineConfirmationView.performShortcut(action)
        }
        if mapEditOverlay != nil, action == .leave, currentWorkspace != nil {
            return leaveWorkspaceDuringMapEdit()
        }
        switch action {
        case .enter:
            return zoomInOneLevel()
        case .leave:
            return zoomOutOneLevel()
        case .selectLeft:
            return moveSelection(horizontal: -1, vertical: 0)
        case .selectRight:
            return moveSelection(horizontal: 1, vertical: 0)
        case .selectDown:
            return moveSelection(horizontal: 0, vertical: 1)
        case .selectUp:
            return moveSelection(horizontal: 0, vertical: -1)
        case .moveLeft:
            return reorderSelection(horizontal: -1, vertical: 0)
        case .moveRight:
            return reorderSelection(horizontal: 1, vertical: 0)
        case .moveDown:
            return reorderSelection(horizontal: 0, vertical: 1)
        case .moveUp:
            return reorderSelection(horizontal: 0, vertical: -1)
        case .previousPane:
            return cycleFocusedTerminal(by: -1)
        case .nextPane:
            return cycleFocusedTerminal(by: 1)
        case .previousWorkspace:
            return cycleFocusedWorkspace(by: -1)
        case .nextWorkspace:
            return cycleFocusedWorkspace(by: 1)
        }
    }

    /// `previousPane` and `nextPane` pan directly between terminals in the
    /// current workspace without leaving Terminal mode or changing zoom.
    @discardableResult
    func cycleFocusedTerminal(by offset: Int) -> Bool {
        let sessions = activeSessionTiles
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking,
              let focusedIndex, sessions.indices.contains(focusedIndex),
              sessions.count > 1, offset != 0
        else { return false }

        let targetIndex = (focusedIndex + offset % sessions.count + sessions.count)
            % sessions.count
        let sourceTileID = sessions[focusedIndex].session.tileID
        let targetTileID = sessions[targetIndex].session.tileID
        InputRoutingLog.log("cycles focused terminal tile=\(sourceTileID)→\(targetTileID)")
        selectedIndex = targetIndex
        self.focusedIndex = targetIndex
        updateSelection()
        panCameraToCurrentTarget(duration: Motion.terminalSwitchDuration)
        return true
    }

    private func panCameraToCurrentTarget(duration: TimeInterval) {
        let target = fixedScaleCameraTarget()
        beginSpatialMinimapAnimation(to: target, duration: duration)
        moveCamera(to: target, duration: duration)
    }

    private func fixedScaleCameraTarget() -> NSRect {
        let destination = currentCameraBounds()
        let cameraSize = sceneView.bounds.size
        return NSRect(
            x: destination.midX - cameraSize.width / 2,
            y: destination.midY - cameraSize.height / 2,
            width: cameraSize.width,
            height: cameraSize.height
        )
    }

    private func workspaceSwitchNudge(for cameraBounds: NSRect) -> CGFloat {
        Motion.workspaceSwitchNudge * cameraBounds.width
            / max(1, sceneViewportBounds.width)
    }

    /// `previousWorkspace` and `nextWorkspace` use a short directional slide
    /// and fade to reveal an adjacent workspace at the same hierarchy level.
    @discardableResult
    func cycleFocusedWorkspace(by offset: Int) -> Bool {
        let sourceSessions = activeSessionTiles
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking,
              offset != 0,
              let sourceWorkspaceID = currentWorkspace
        else { return false }

        let keepsTerminalFocus = focusedIndex != nil
        if keepsTerminalFocus {
            guard let focusedIndex, sourceSessions.indices.contains(focusedIndex) else {
                return false
            }
        }
        let destinations = keepsTerminalFocus
            ? workspaces.filter { workspace in
                allSessionTiles.contains { $0.session.workspaceID == workspace.id }
            }
            : workspaces
        guard destinations.count > 1,
              let sourceIndex = destinations.firstIndex(where: { $0.id == sourceWorkspaceID })
        else { return false }

        let targetWorkspaceIndex = (
            sourceIndex + offset % destinations.count + destinations.count
        ) % destinations.count
        let targetWorkspace = destinations[targetWorkspaceIndex]
        if !keepsTerminalFocus, mapEditOverlay != nil {
            moveEditTerminalTile(to: targetWorkspace)
        }
        let targetSessions = activeSessionTiles(for: targetWorkspace.id)
        guard !keepsTerminalFocus || !targetSessions.isEmpty else { return false }

        let targetTerminalIndex = targetSessions.isEmpty
            ? nil
            : activeTerminalIndex(in: targetWorkspace.id)
        let targetTileID = targetTerminalIndex.map {
            targetSessions[$0].session.tileID
        }
        InputRoutingLog.log(
            "cycles workspace level=\(keepsTerminalFocus ? "terminal" : "workspace") "
                + "workspace=\(sourceWorkspaceID)→\(targetWorkspace.id)"
        )

        beginWorkspaceTransition(
            to: targetWorkspace.id,
            tileID: targetTileID,
            focusTerminal: keepsTerminalFocus,
            direction: offset > 0 ? 1 : -1
        )
        return true
    }

    private func moveEditTerminalTile(to workspace: WorkspaceRecord) {
        guard let addTerminalTileView else { return }
        addTerminalTileView.removeFromSuperview()
        addTerminalTileView.session.workspaceID = workspace.id
        addTerminalTileView.session.workspace = workspace.name
        addTerminalTileView.session.workspaceRoot = workspace.workingDirectory
        addTerminalTileView.session.location = workspace.location
        addTerminalTileView.transition(to: .stopped, terminalText: "")
        updateWorldGeometry()
    }

    private func workspaceTransitionDirection(to workspaceID: String) -> CGFloat {
        guard let sourceWorkspaceID = selectedWorkspaceID(),
              let sourceIndex = workspaces.firstIndex(where: { $0.id == sourceWorkspaceID }),
              let targetIndex = workspaces.firstIndex(where: { $0.id == workspaceID })
        else { return 1 }
        return targetIndex >= sourceIndex ? 1 : -1
    }

    private func beginWorkspaceTransition(
        to workspaceID: String,
        tileID: String?,
        focusTerminal: Bool,
        direction: CGFloat
    ) {
        if let target = cameraBounds(
            for: workspaceID,
            tileID: tileID,
            focusTerminal: focusTerminal
        ) {
            beginSpatialMinimapAnimation(
                to: target,
                duration: Motion.workspaceSwitchExitDuration
                    + Motion.workspaceSwitchEntryDuration
            )
        }

        if let sourceWorkspaceID = currentWorkspace,
           let focusedIndex,
           activeSessionTiles.indices.contains(focusedIndex)
        {
            activeTerminalByWorkspace[sourceWorkspaceID]
                = activeSessionTiles[focusedIndex].session.tileID
        }

        let exitTarget = sceneView.bounds.offsetBy(
            dx: direction * workspaceSwitchNudge(for: sceneView.bounds),
            dy: 0
        )
        moveCamera(
            to: exitTarget,
            duration: Motion.workspaceSwitchExitDuration,
            targetAlpha: Motion.workspaceSwitchMinimumAlpha
        ) { [weak self] in
            self?.revealWorkspaceTransition(
                workspaceID,
                tileID: tileID,
                focusTerminal: focusTerminal,
                direction: direction
            )
        }
    }

    private func revealWorkspaceTransition(
        _ workspaceID: String,
        tileID: String?,
        focusTerminal: Bool,
        direction: CGFloat
    ) {
        let sessions = activeSessionTiles(for: workspaceID)
        guard !focusTerminal || !sessions.isEmpty else {
            sceneView.alphaValue = 1
            endSpatialMinimapAnimation()
            return
        }

        let fallbackIndex = focusTerminal ? activeTerminalIndex(in: workspaceID) : 0
        let targetIndex = tileID.flatMap { tileID in
            sessions.firstIndex(where: { $0.session.tileID == tileID })
        } ?? fallbackIndex
        currentWorkspace = workspaceID
        selectedIndex = targetIndex
        focusedIndex = focusTerminal && sessions.indices.contains(targetIndex)
            ? targetIndex
            : nil
        updateSelection()
        if spatialMinimapAnimation != nil {
            refreshSpatialMinimap(
                cameraBounds: spatialMinimapView.representedCameraBounds,
                worldBounds: spatialMinimapView.representedWorldBounds
            )
        }

        // Adopt the destination's normal fitted size while the scene is faded.
        // The visible entry slide then translates without zooming.
        let destination = currentCameraBounds()
        sceneView.bounds = destination.offsetBy(
            dx: -direction * workspaceSwitchNudge(for: destination),
            dy: 0
        )
        sceneView.alphaValue = Motion.workspaceSwitchMinimumAlpha
        moveCamera(
            to: destination,
            duration: Motion.workspaceSwitchEntryDuration,
            targetAlpha: 1
        )
    }

    private func activeTerminalIndex(in workspaceID: String) -> Int {
        let sessions = activeSessionTiles(for: workspaceID)
        guard let tileID = activeTerminalByWorkspace[workspaceID],
              let index = sessions.firstIndex(where: { $0.session.tileID == tileID })
        else { return 0 }
        return index
    }

    func createNewWorkspaceOrTerminal() {
        guard prepareForInteractionIntent() else { return }
        clearInlineMapPanelForIntent()
        guard let rule = interactionRule(for: .new),
              (rule.panel == .newWorkspace && rule.effect == .createWorkspace)
                || (rule.panel == .newTerminal && rule.effect == .createTerminal)
        else { return }
        if mapEditOverlay != nil {
            selectMapEditTarget(rule.target)
            activateMapEditCreationTarget(rule.target, cameraPolicy: rule.camera)
            return
        }
        presentMapEditOverlay(
            cameraPolicy: .none,
            onPresented: { [weak self] in self?.selectMapEditTarget(rule.target) },
            onReady: { [weak self] in
                self?.activateMapEditCreationTarget(rule.target, cameraPolicy: rule.camera)
            }
        )
    }

    func handleCommandW() {
        if let closeKey = undoToastWorkspaceID {
            finalizePendingWorkspaceClose(closeKey: closeKey)
            return
        }
        if let terminalID = undoToastTerminalID {
            finalizePendingClose(terminalID: terminalID)
            return
        }
        if let availableSessionsView {
            availableSessionsView.killSelected()
            return
        }
        if inlineConfirmationView != nil { return }
        if presentedOverlay != nil { return }
        if commandPalette != nil {
            dismissCommandPalette()
            return
        }
        guard prepareForInteractionIntent() else { return }
        clearInlineMapPanelForIntent()
        guard let rule = interactionRule(for: .close),
              (rule.panel == .closeWorkspace && rule.effect == .closeWorkspace)
                || (rule.panel == .disconnectTerminal && rule.effect == .disconnectTerminal)
        else { return }
        let workspaceID = currentWorkspace == nil ? selectedWorkspaceID() : currentWorkspace
        let tileID = currentWorkspace == nil
            ? nil
            : selectedSessionTile().flatMap { tile in
                tile.renderingMode == .terminal ? tile.session.tileID : nil
            }
        if mapEditOverlay != nil {
            selectInlineRemovalTarget(rule.target, workspaceID: workspaceID, tileID: tileID)
            beginInlineRemoval(cameraPolicy: rule.camera)
            return
        }
        interactionPolicySession = interactionIntentEngine.snapshot()
        localizedActionCameraBounds = sceneView.bounds
        beginInlineRemoval(cameraPolicy: rule.camera)
    }

    private func nextAvailableWorkspaceName(base requestedBase: String = "workspace") -> String {
        var keys = Set(workspaces.map { WorkspaceName.key($0.name) })
        return WorkspaceName.unique(requestedBase, reserving: &keys)
    }

    private func createPersistentSession(
        workspace: String,
        name: String,
        command: String?,
        workingDirectory: String,
        location requestedLocation: WorkspaceLocation? = nil
    ) {
        let workspaceRecord: WorkspaceRecord
        let createdWorkspace: Bool
        if let existing = workspaces.first(where: {
            WorkspaceName.key($0.name) == WorkspaceName.key(workspace)
        }) {
            workspaceRecord = existing
            createdWorkspace = false
        } else {
            let location = requestedLocation ?? .local(workingDirectory)
            workspaceRecord = WorkspaceRecord(
                name: workspace,
                workingDirectory: location.path,
                sshHost: location.sshHost
            )
            workspaces.append(workspaceRecord)
            createdWorkspace = true
        }
        let session = TerminalSession(
            label: nextAvailableLabel(workspace: workspace, session: name),
            workspaceID: workspaceRecord.id,
            workspace: workspace,
            name: name,
            launch: command.map(TerminalLaunch.shellCommand) ?? .loginShell,
            workingDirectory: workspaceRecord.workingDirectory,
            workspaceRoot: workspaceRecord.workingDirectory,
            sshHost: workspaceRecord.location.sshHost,
            state: .starting
        )
        let tile = TerminalTileView(session: session)
        installTile(tile)
        installPersistentTerminal(in: tile)
        allSessionTiles.append(tile)
        if createdWorkspace {
            rememberWorkspaceLocation(workspaceRecord.location)
        }
        saveSessions()
        if createdWorkspace { persistNativeWorkspace(workspaceRecord) }
        rebuildWorkspaceClusters()
        currentWorkspace = workspaceRecord.id
        updateWorldGeometry()
        selectedIndex = max(0, activeSessionTiles.count - 1)
        focusedIndex = selectedIndex
        updateSelection()
        moveCamera()
        if createdWorkspace {
            emitAPIEvent("workspace.created", data: workspaceJSON(workspaceRecord))
        }
        emitAPIEvent("tile.created", data: tileJSON(tile))
    }

    private func nextAvailableSessionName(base: String, workspace: String) -> String {
        let names = Set(allSessionTiles.compactMap {
            $0.session.workspace == workspace ? $0.session.name : nil
        })
        if !names.contains(base) { return base }
        var suffix = 2
        while names.contains("\(base) \(suffix)") {
            suffix += 1
        }
        return "\(base) \(suffix)"
    }

    private func nextAvailableLabel(workspace: String, session: String) -> String {
        let workspacePrefix = workspace.lowercased().first.map(String.init) ?? "w"
        let sessionPrefix = session.lowercased().first.map(String.init) ?? "s"
        let preferred = workspacePrefix + sessionPrefix
        let used = Set(allSessionTiles.map { $0.session.label })
        if !used.contains(preferred) { return preferred }
        for suffix in 2...9 {
            let candidate = workspacePrefix + String(suffix)
            if !used.contains(candidate) { return candidate }
        }
        return workspacePrefix + "x"
    }

    func performAPIOperation(_ operation: String, params: JSONObject) throws -> Any {
        switch operation {
        case "system.snapshot":
            return snapshotJSON()
        case "target.list":
            return targetListJSON()
        case "target.register":
            return try apiRegisterTarget(params)
        case "target.remove":
            return try apiRemoveTarget(params)
        case "target.sessions":
            return targetSessionsJSON()
        case "workspace.list":
            return ["workspaces": workspaces.map(workspaceJSON)]
        case "workspace.get":
            return workspaceJSON(try requireWorkspace(params))
        case "workspace.create":
            return try apiCreateWorkspace(params)
        case "workspace.update":
            return try apiUpdateWorkspace(params)
        case "workspace.move":
            return try apiMoveWorkspace(params)
        case "workspace.stop":
            return apiStopWorkspace(try requireWorkspace(params))
        case "workspace.restart":
            return apiRestartWorkspace(try requireWorkspace(params))
        case "workspace.delete":
            return try apiDeleteWorkspace(try requireWorkspace(params))
        case "tile.list":
            let workspaceID = params["workspaceId"] as? String
            let tiles = allSessionTiles.filter { workspaceID == nil || $0.session.workspaceID == workspaceID }
            return ["tiles": tiles.map(tileJSON)]
        case "tile.get":
            return tileJSON(try requireTile(params))
        case "tile.create":
            return try apiCreateTile(params)
        case "tile.update":
            return try apiUpdateTile(params)
        case "tile.move":
            return try apiMoveTile(params)
        case "tile.attach":
            return try apiAttachTile(try requireTile(params))
        case "tile.detach":
            return try apiDetachTile(try requireTile(params))
        case "tile.delete":
            return try apiDeleteTile(try requireTile(params))
        case "terminal.get":
            return terminalJSON(try requireTerminal(params))
        case "terminal.update":
            return try apiUpdateTerminal(params)
        case "terminal.send":
            return try apiSendTerminal(params)
        case "terminal.signal":
            return try apiSignalTerminal(params)
        case "terminal.resize":
            return try apiResizeTerminal(params)
        case "terminal.stop":
            return apiStopTerminal(try requireTerminal(params))
        case "terminal.restart":
            return try apiRestartTerminal(
                try requireTerminal(params),
                focus: params["focus"] as? Bool ?? false
            )
        case "status.list":
            refreshStatusBar()
            return [
                "widgets": statusWidgets.values.map { $0.json() },
                "effectiveWidgets": effectiveStatusWidgets.map { $0.json() },
            ]
        case "status.set":
            return try apiSetStatusWidget(params)
        case "status.remove":
            return try apiRemoveStatusWidget(params)
        case "command.list":
            return ["commands": activeContextCommands().map { $0.json() }]
        case "command.set":
            return try apiSetContextCommand(params)
        case "command.remove":
            return try apiRemoveContextCommand(params)
        case "selectionOpener.list":
            return ["openers": activeSelectionOpeners().map { $0.json() }]
        case "selectionOpener.set":
            return try apiSetSelectionOpener(params)
        case "selectionOpener.remove":
            return try apiRemoveSelectionOpener(params)
        case "ui.get":
            return uiJSON()
        case "ui.select":
            return try apiSelect(params)
        case "ui.focus":
            return try apiFocus(params)
        case "ui.enter":
            guard !isTransitioning else { throw MachinenAPIError("conflict", "The camera is moving") }
            activate(selectedIndex)
            return uiJSON()
        case "ui.zoomOut":
            return try apiZoomOut(params)
        case "ui.overview":
            return try apiShowOverview()
        case "ui.activate":
            NSApp.activate(ignoringOtherApps: true)
            window?.makeKeyAndOrderFront(nil)
            return uiJSON()
        default:
            throw MachinenAPIError("unknown_operation", "Unknown operation: \(operation)")
        }
    }

    private func targetListJSON() -> JSONObject {
        ["targets": registeredTargetLocations().map { target in
            let discovery = targetDiscoveries[target.id]
            var result: JSONObject = target.id == "local"
                ? ["id": "local", "kind": "local", "implicit": true]
                : ["id": target.id, "kind": "ssh", "host": target.location.sshHost ?? ""]
            result["state"] = discovery?.state.rawValue ?? "inactive"
            result["lastCheckedAt"] = discovery.map { ISO8601DateFormatter().string(from: $0.checkedAt) } ?? NSNull()
            result["error"] = discovery?.error ?? NSNull()
            return result
        }]
    }

    private func targetSessionsJSON() -> JSONObject {
        let targets: [JSONObject] = registeredTargetLocations().map { target in
            let discovery = targetDiscoveries[target.id]
            let targetJSON: JSONObject
            if target.id == "local" {
                targetJSON = ["id": "local", "kind": "local"]
            } else {
                targetJSON = targetMachines.first(where: { $0.id == target.id })?.json ?? [:]
            }
            let workspaces: [JSONObject] = discovery?.workspaces.map { record in
                ["id": record.id, "name": record.name, "rootDirectory": record.rootDirectory]
            } ?? []
            let sessions: [JSONObject] = discovery?.sessions
                .filter { $0.state == "running" || $0.state == "created" }
                .map { session in
                [
                    "id": session.id,
                    "name": session.name ?? NSNull(),
                    "workspaceId": session.workspaceId ?? NSNull(),
                    "workingDirectory": session.workingDirectory,
                    "state": session.state,
                ]
            } ?? []
            return [
                "target": targetJSON,
                "state": discovery?.state.rawValue ?? "inactive",
                "workspaces": workspaces,
                "sessions": sessions,
                "error": discovery?.error ?? NSNull(),
            ]
        }
        return ["targets": targets]
    }

    private func apiRegisterTarget(_ params: JSONObject) throws -> Any {
        guard let host = validSSHHost(try requiredString("host", in: params)) else {
            throw MachinenAPIError("invalid_params", "host must be an OpenSSH alias, host, or user@host")
        }
        if let existing = targetMachines.first(where: { TargetMachine.normalizedHost($0.sshHost) == TargetMachine.normalizedHost(host) }) {
            return existing.json
        }
        let target = TargetMachine(sshHost: host)
        targetMachines.append(target)
        saveSessions()
        refreshRegisteredTarget(target.id, at: target.location, force: true)
        emitAPIEvent("target.registered", data: target.json)
        return target.json
    }

    private func apiRemoveTarget(_ params: JSONObject) throws -> Any {
        let id = try requiredString("targetId", in: params)
        guard id != "local", let index = targetMachines.firstIndex(where: { $0.id == id }) else {
            throw MachinenAPIError("invalid_params", "Only an explicit SSH target may be removed")
        }
        let target = targetMachines.remove(at: index)
        targetDiscoveryGeneration[id] = (targetDiscoveryGeneration[id] ?? 0) + 1
        targetDiscoveryInFlight.remove(id)
        targetDiscoveryFailureCount.removeValue(forKey: id)
        targetDiscoveryRetryAfter.removeValue(forKey: id)
        targetDiscoveries.removeValue(forKey: id)
        availableSessionsByMachine.removeValue(forKey: target.location.machineID)
        availableSessionsErrors.removeValue(forKey: target.location.machineID)
        availableSessionsLastRefresh.removeValue(forKey: target.location.machineID)
        saveSessions()
        targetDiscoveryDidChange()
        emitAPIEvent("target.removed", data: target.json)
        return target.json
    }

    private func removeTargetMachine(_ id: String) {
        guard let target = targetMachines.first(where: { $0.id == id }) else { return }
        _ = try? apiRemoveTarget(["targetId": target.id])
        refreshTargetSessionsView()
    }

    private func apiCreateWorkspace(_ params: JSONObject) throws -> Any {
        let requestedName = try requiredString("name", in: params)
        guard let name = WorkspaceName.validated(requestedName) else {
            throw MachinenAPIError("invalid_params", "name must not be empty")
        }
        guard !workspaceNameExists(name) else {
            throw MachinenAPIError("workspace_name_conflict", "That workspace name is already in use")
        }
        let location: WorkspaceLocation
        if let requested = params["location"] as? JSONObject {
            location = try validatedWorkspaceLocation(locationFromJSON(requested))
        } else {
            location = .local(try validatedWorkingDirectory(
                params["workingDirectory"] as? String
                    ?? FileManager.default.homeDirectoryForCurrentUser.path
            ))
        }
        let workspace = WorkspaceRecord(
            name: name,
            workingDirectory: location.path,
            sshHost: location.sshHost
        )
        let position = clampedPosition(params["position"] as? Int, count: workspaces.count)
        workspaces.insert(workspace, at: position)
        rememberWorkspaceLocation(location)
        registerTargetIfNeeded(for: location)
        rebuildWorkspaceClusters()
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        persistNativeWorkspace(workspace)
        let result = workspaceJSON(workspace)
        emitAPIEvent("workspace.created", data: result)
        return result
    }

    private func updateWorkspaceLocation(
        _ workspace: WorkspaceRecord,
        to location: WorkspaceLocation
    ) throws {
        let validated = try validatedWorkspaceLocation(location)
        guard canonicalLocationKey(validated) != canonicalLocationKey(workspace.location) else {
            rememberWorkspaceLocation(validated)
            return
        }
        let previous = workspace.location
        let keepsPreviousReplica = persistedSessionTiles.contains {
            $0.session.workspaceID == workspace.id
                && $0.session.location.machineID == previous.machineID
        }
        workspace.location = validated
        rememberWorkspaceLocation(validated)
        registerTargetIfNeeded(for: validated)
        if previous.machineID != validated.machineID, !keepsPreviousReplica {
            sessionBackend.deleteWorkspace(id: workspace.id, at: previous) { result in
                if case let .failure(error) = result {
                    NSLog(
                        "Machinen could not remove the previous native workspace: %@",
                        String(describing: error)
                    )
                }
            }
        }
    }

    private func apiUpdateWorkspace(_ params: JSONObject) throws -> Any {
        let workspace = try requireWorkspace(params)
        if let requestedName = params["name"] as? String {
            guard let name = WorkspaceName.validated(requestedName) else {
                throw MachinenAPIError("invalid_params", "name must not be empty")
            }
            guard !workspaceNameExists(name, excluding: workspace.id) else {
                throw MachinenAPIError("workspace_name_conflict", "That workspace name is already in use")
            }
            workspace.name = name
            for tile in allSessionTiles where tile.session.workspaceID == workspace.id {
                tile.session.workspace = name
            }
        }
        if let requested = params["location"] as? JSONObject {
            try updateWorkspaceLocation(workspace, to: locationFromJSON(requested))
        } else if let directory = params["workingDirectory"] as? String {
            let location = workspace.location.sshHost.map {
                WorkspaceLocation.ssh(host: $0, path: directory)
            } ?? .local(directory)
            try updateWorkspaceLocation(workspace, to: location)
        }
        rebuildWorkspaceClusters()
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        persistNativeWorkspace(workspace)
        let result = workspaceJSON(workspace)
        emitAPIEvent("workspace.updated", data: result)
        return result
    }

    private func apiMoveWorkspace(_ params: JSONObject) throws -> Any {
        let workspace = try requireWorkspace(params)
        guard let requested = params["position"] as? Int else {
            throw MachinenAPIError("invalid_params", "position is required")
        }
        guard let old = workspaces.firstIndex(where: { $0 === workspace }) else {
            throw MachinenAPIError("workspace_not_found", "Workspace does not exist")
        }
        workspaces.remove(at: old)
        workspaces.insert(workspace, at: clampedPosition(requested, count: workspaces.count))
        rebuildWorkspaceClusters()
        updateWorldGeometry()
        setCameraImmediately()
        saveSessions()
        let result = workspaceJSON(workspace)
        emitAPIEvent("workspace.moved", data: result)
        return result
    }

    private func apiStopWorkspace(_ workspace: WorkspaceRecord) -> Any {
        for tile in persistedSessionTiles where tile.session.workspaceID == workspace.id {
            tile.stopTerminal()
            tile.transition(to: .stopped, terminalText: tile.session.terminalText)
            emitAPIEvent("terminal.stateChanged", data: terminalJSON(tile))
        }
        saveSessions()
        return workspaceJSON(workspace)
    }

    private func apiRestartWorkspace(_ workspace: WorkspaceRecord) -> Any {
        for tile in allSessionTiles where tile.session.workspaceID == workspace.id {
            guard tile.session.startsSessionIfMissing,
                  (tile.currentState == .stopped || tile.currentState == .exited)
            else { continue }
            tile.transition(to: .starting, terminalText: tile.session.terminalText)
            tile.restartTerminal()
        }
        saveSessions()
        return workspaceJSON(workspace)
    }

    private func apiDeleteWorkspace(_ workspace: WorkspaceRecord) throws -> Any {
        let persistedTiles = persistedSessionTiles.filter {
            $0.session.workspaceID == workspace.id
        }
        guard !persistedTiles.contains(where: { terminalIsRunning($0.session) }) else {
            throw MachinenAPIError("workspace_running", "Stop the workspace's terminals before deleting it")
        }
        let disconnectedIDs = recentlyClosedTerminals.values.compactMap {
            $0.tile.session.workspaceID == workspace.id ? $0.tile.session.id : nil
        }
        for terminalID in disconnectedIDs {
            finalizePendingClose(terminalID: terminalID)
        }
        let tiles = allSessionTiles.filter { $0.session.workspaceID == workspace.id }
        let removalView: NSView? = if currentWorkspace == workspace.id {
            selectedSessionTile() ?? workspaceCluster(named: workspace.id)
        } else {
            workspaceCluster(named: workspace.id)
        }
        deleteNativeWorkspace(workspace)
        let removalSnapshot = removalView.flatMap(paneRemovalSnapshot)
        for tile in tiles {
            tile.removeTerminal()
            tile.removeFromSuperview()
            emitAPIEvent("tile.deleted", data: tileJSON(tile))
        }
        allSessionTiles.removeAll { $0.session.workspaceID == workspace.id }
        workspaces.removeAll { $0 === workspace }
        if currentWorkspace == workspace.id {
            currentWorkspace = nil
            focusedIndex = nil
        }
        rebuildWorkspaceClusters()
        selectedIndex = min(selectedIndex, max(0, workspaceClusters.count - 1))
        updateWorldGeometry()
        updateSelection()
        finishPaneRemoval(snapshot: removalSnapshot)
        saveSessions()
        let result = workspaceJSON(workspace)
        emitAPIEvent("workspace.deleted", data: result)
        return result
    }

    private func apiCreateTile(_ params: JSONObject) throws -> Any {
        let workspace = try requireWorkspace(params)
        let kind = params["kind"] as? String ?? "terminal"
        guard kind == "terminal" else {
            throw MachinenAPIError("invalid_params", "Only terminal tiles are supported in API v1")
        }
        let terminalParams = params["terminal"] as? JSONObject ?? [:]
        let location: WorkspaceLocation
        if let directory = terminalParams["workingDirectory"] as? String {
            location = try validatedWorkspaceLocation(
                workspace.location.sshHost.map {
                    WorkspaceLocation.ssh(host: $0, path: directory)
                } ?? .local(directory)
            )
        } else {
            location = workspace.location
        }
        let launch = try parseLaunch(terminalParams["launch"] as? JSONObject)
        let name = params["name"] as? String ?? defaultName(for: launch)
        let label = params["label"] as? String
            ?? nextAvailableLabel(workspace: workspace.name, session: name)
        guard !label.isEmpty else { throw MachinenAPIError("invalid_params", "label cannot be empty") }
        let session = TerminalSession(
            label: label,
            workspaceID: workspace.id,
            workspace: workspace.name,
            name: name,
            launch: launch,
            workingDirectory: location.path,
            workspaceRoot: workspace.workingDirectory,
            sshHost: location.sshHost,
            state: .starting
        )
        let tile = TerminalTileView(session: session)
        installTile(tile)
        installPersistentTerminal(in: tile)
        let siblings = allSessionTiles.filter { $0.session.workspaceID == workspace.id }
        let position = clampedPosition(params["position"] as? Int, count: siblings.count)
        insertTile(tile, in: workspace.id, at: position)
        rebuildWorkspaceClusters()
        updateWorldGeometry()
        if params["focus"] as? Bool ?? false {
            currentWorkspace = workspace.id
            selectedIndex = position
            focusedIndex = position
            updateSelection()
            moveCamera()
        } else {
            updateSelection()
            setCameraImmediately()
        }
        saveSessions()
        let tileResult = tileJSON(tile)
        let terminalResult = terminalJSON(tile)
        emitAPIEvent("tile.created", data: tileResult)
        emitAPIEvent("terminal.stateChanged", data: terminalResult)
        return ["tile": tileResult, "terminal": terminalResult]
    }

    private func apiUpdateTile(_ params: JSONObject) throws -> Any {
        let tile = try requireTile(params)
        if let name = params["name"] as? String {
            guard !name.isEmpty else { throw MachinenAPIError("invalid_params", "name cannot be empty") }
            tile.session.name = name
        }
        if let label = params["label"] as? String {
            guard !label.isEmpty else { throw MachinenAPIError("invalid_params", "label cannot be empty") }
            guard !allSessionTiles.contains(where: { $0 !== tile && $0.session.label == label }) else {
                throw MachinenAPIError("conflict", "Another tile already uses label \(label)")
            }
            tile.session.label = label
        }
        if let activity = params["activityState"] as? String {
            guard let state = TerminalSession.ActivityState(rawValue: activity) else {
                throw MachinenAPIError("invalid_params", "Unknown activityState: \(activity)")
            }
            tile.session.activityState = state
        }
        tile.transition(to: tile.session.state, terminalText: tile.session.terminalText)
        refreshStatusBar()
        refreshSpatialMinimapActivityStates()
        saveSessions()
        let result = tileJSON(tile)
        emitAPIEvent("tile.updated", data: result)
        return result
    }

    private func apiMoveTile(_ params: JSONObject) throws -> Any {
        let tile = try requireTile(params)
        let workspace = try requireWorkspace(params)
        guard tile.session.workspaceID == workspace.id else {
            throw MachinenAPIError(
                "terminal_relocation_unsupported",
                "Terminals cannot move between workspace locations"
            )
        }
        let movedTileWasSelected = currentWorkspace != nil && selectedSessionTile() === tile
        let movedTileWasFocused = movedTileWasSelected && focusedIndex != nil
        let position = clampedPosition(
            params["position"] as? Int,
            count: allSessionTiles.count { $0.session.workspaceID == workspace.id && $0 !== tile }
        )
        tile.session.workspaceID = workspace.id
        tile.session.workspace = workspace.name
        allSessionTiles.removeAll { $0 === tile }
        insertTile(tile, in: workspace.id, at: position)
        rebuildWorkspaceClusters()
        if movedTileWasSelected {
            currentWorkspace = workspace.id
            selectedIndex = position
            focusedIndex = movedTileWasFocused ? position : nil
        } else if currentWorkspace != nil {
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
        }
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        let result = tileJSON(tile)
        emitAPIEvent("tile.moved", data: result)
        return result
    }

    private func apiAttachTile(_ tile: TerminalTileView) throws -> Any {
        switch tile.currentState {
        case .running, .starting:
            return tileJSON(tile)
        case .detached, .disconnected:
            tile.transition(to: .starting, terminalText: tile.session.terminalText)
            tile.attachTerminal()
        case .stopped, .exited:
            throw MachinenAPIError("invalid_state", "Restart the terminal before attaching its viewer")
        }
        saveSessions()
        let result = tileJSON(tile)
        emitAPIEvent("tile.viewerChanged", data: result)
        return result
    }

    private func apiDetachTile(_ tile: TerminalTileView) throws -> Any {
        guard terminalIsRunning(tile.session) else {
            throw MachinenAPIError("invalid_state", "A stopped terminal has no viewer to detach")
        }
        tile.transition(to: .detached, terminalText: tile.session.terminalText)
        tile.detachTerminalViewer()
        if focusedIndex != nil, selectedSessionTile() === tile {
            leaveFocusedSession()
        }
        saveSessions()
        let result = tileJSON(tile)
        emitAPIEvent("tile.viewerChanged", data: result)
        return result
    }

    private func apiDeleteTile(_ tile: TerminalTileView) throws -> Any {
        guard !terminalIsRunning(tile.session) else {
            throw MachinenAPIError("terminal_running", "Stop the terminal before deleting its tile")
        }
        let result = tileJSON(tile)
        let workspaceID = tile.session.workspaceID
        let removalSnapshot = paneRemovalSnapshot(of: tile)
        let previousFrames = allSessionTiles.compactMap { sibling in
            sibling !== tile && sibling.session.workspaceID == workspaceID
                ? (tile: sibling, frame: sibling.frame)
                : nil
        }
        tile.removeTerminal()
        tile.removeFromSuperview()
        allSessionTiles.removeAll { $0 === tile }
        rebuildWorkspaceClusters()
        if currentWorkspace == workspaceID {
            focusedIndex = nil
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
        }
        updateWorldGeometry()
        updateSelection()
        finishPaneRemoval(snapshot: removalSnapshot, previousFrames: previousFrames)
        saveSessions()
        emitAPIEvent("tile.deleted", data: result)
        return result
    }

    private func apiUpdateTerminal(_ params: JSONObject) throws -> Any {
        let tile = try requireTerminal(params)
        guard let requested = params["title"] else {
            throw MachinenAPIError("invalid_params", "title is required")
        }
        if requested is NSNull {
            tile.session.titleOverride = nil
        } else if let title = requested as? String {
            let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, trimmed.count <= 128 else {
                throw MachinenAPIError("invalid_params", "title must contain 1 to 128 characters")
            }
            tile.session.titleOverride = trimmed
        } else {
            throw MachinenAPIError("invalid_params", "title must be a string or null")
        }
        tile.needsDisplay = true
        saveSessions()
        refreshStatusBar()
        let result = terminalJSON(tile)
        emitAPIEvent("terminal.updated", data: result)
        return result
    }

    private func apiSendTerminal(_ params: JSONObject) throws -> Any {
        let tile = try requireTerminal(params)
        let hasText = params["text"] is String
        let hasData = params["dataBase64"] is String
        guard hasText != hasData else {
            throw MachinenAPIError("invalid_params", "Provide exactly one of text or dataBase64")
        }
        let data: Data
        if let text = params["text"] as? String {
            let value = text + ((params["appendNewline"] as? Bool ?? false) ? "\n" : "")
            data = Data(value.utf8)
        } else if let encoded = params["dataBase64"] as? String,
                  let decoded = Data(base64Encoded: encoded)
        {
            data = decoded
        } else {
            throw MachinenAPIError("invalid_params", "dataBase64 is invalid")
        }
        guard tile.sendTerminalInput(data) else {
            throw MachinenAPIError("terminal_input_failed", "Could not send input to the persistent PTY")
        }
        return ["terminalId": tile.session.id, "bytesWritten": data.count]
    }

    private func apiResizeTerminal(_ params: JSONObject) throws -> Any {
        let tile = try requireTerminal(params)
        guard let columns = params["columns"] as? Int,
              let rows = params["rows"] as? Int,
              (1...1_000).contains(columns),
              (1...1_000).contains(rows)
        else {
            throw MachinenAPIError(
                "invalid_params",
                "columns and rows must be integers between 1 and 1000"
            )
        }
        guard sessionBackend.resize(
            tile.session,
            columns: UInt16(columns),
            rows: UInt16(rows)
        ) else {
            throw MachinenAPIError(
                "terminal_resize_failed",
                "Could not resize the persistent PTY"
            )
        }
        return terminalJSON(tile)
    }

    private func apiSignalTerminal(_ params: JSONObject) throws -> Any {
        let tile = try requireTerminal(params)
        let signal = try requiredString("signal", in: params)
        let mapped: String
        switch signal {
        case "interrupt": mapped = "interrupt"
        case "terminate": mapped = "TERM"
        case "kill": mapped = "KILL"
        case "hangup": mapped = "HUP"
        default: throw MachinenAPIError("invalid_params", "Unknown signal: \(signal)")
        }
        tile.signalTerminal(mapped)
        return terminalJSON(tile)
    }

    private func apiStopTerminal(_ tile: TerminalTileView) -> Any {
        tile.stopTerminal()
        tile.transition(to: .stopped, terminalText: tile.session.terminalText)
        saveSessions()
        let result = terminalJSON(tile)
        emitAPIEvent("terminal.stateChanged", data: result)
        return result
    }

    private func apiRestartTerminal(_ tile: TerminalTileView, focus: Bool) throws -> Any {
        guard tile.session.startsSessionIfMissing else {
            throw MachinenAPIError(
                "restart_unavailable",
                "This terminal was imported from an existing session without a restart command"
            )
        }
        tile.transition(to: .starting, terminalText: tile.session.terminalText)
        tile.restartTerminal()
        if focus {
            currentWorkspace = tile.session.workspaceID
            selectedIndex = activeSessionTiles.firstIndex(where: { $0 === tile }) ?? 0
            focusedIndex = selectedIndex
            updateSelection()
            moveCamera()
        }
        saveSessions()
        return terminalJSON(tile)
    }

    private func apiSetStatusWidget(_ params: JSONObject) throws -> Any {
        let id = try requiredString("id", in: params)
        guard id.count <= 128 else {
            throw MachinenAPIError("invalid_params", "status widget id must be at most 128 characters")
        }
        let (scopeKind, scopeID) = try parseStatusScope(params["scope"] as? JSONObject)
        let placementName = params["placement"] as? String ?? "right"
        let kindName = params["kind"] as? String ?? "text"
        let toneName = params["tone"] as? String ?? "neutral"
        let graphStyleName = params["graphStyle"] as? String
        guard let placement = MachinenStatusWidget.Placement(rawValue: placementName) else {
            throw MachinenAPIError("invalid_params", "Unknown status placement: \(placementName)")
        }
        guard let kind = MachinenStatusWidget.Kind(rawValue: kindName) else {
            throw MachinenAPIError("invalid_params", "Unknown status widget kind: \(kindName)")
        }
        guard let tone = MachinenStatusWidget.Tone(rawValue: toneName) else {
            throw MachinenAPIError("invalid_params", "Unknown status widget tone: \(toneName)")
        }
        let graphStyle = try graphStyleName.map { name in
            guard let style = MachinenStatusWidget.GraphStyle(rawValue: name) else {
                throw MachinenAPIError("invalid_params", "Unknown status graph style: \(name)")
            }
            return style
        }
        let value: String
        if let string = params["value"] as? String {
            value = string
        } else if let number = params["value"] as? NSNumber {
            value = number.stringValue
        } else if kind == .separator || kind == .state || kind == .progress || kind == .sparkline {
            value = ""
        } else {
            throw MachinenAPIError("invalid_params", "status widget value must be a string or number")
        }
        let samples = try statusSamples(params["samples"], name: "samples")
        let secondarySamples = try statusSamples(params["secondarySamples"], name: "secondarySamples")
        let links = try statusLinks(params["links"])
        let states = params["states"] as? [String] ?? []
        let validStates = Set(["working", "waiting", "idle", "unknown", "neutral", "good", "busy", "attention", "error"])
        guard states.count <= 32, states.allSatisfy(validStates.contains) else {
            throw MachinenAPIError("invalid_params", "status widget states contains an unsupported state")
        }
        let progress = (params["progress"] as? NSNumber)?.doubleValue
        if let progress, !(0...1).contains(progress) {
            throw MachinenAPIError("invalid_params", "status widget progress must be between 0 and 1")
        }
        let ttl = (params["ttlMilliseconds"] as? NSNumber)?.doubleValue
        if let ttl, ttl <= 0 {
            throw MachinenAPIError("invalid_params", "ttlMilliseconds must be positive")
        }
        let widget = MachinenStatusWidget(
            id: id,
            scopeKind: scopeKind,
            scopeID: scopeID,
            placement: placement,
            kind: kind,
            label: params["label"] as? String,
            value: value,
            progress: progress,
            tone: tone,
            tooltip: params["tooltip"] as? String,
            priority: (params["priority"] as? NSNumber)?.intValue ?? 50,
            expiresAt: ttl.map { Date().timeIntervalSince1970 + $0 / 1000 },
            graphStyle: graphStyle,
            samples: samples,
            secondarySamples: secondarySamples,
            states: states,
            links: links
        )
        statusWidgets[widget.storageKey] = widget
        refreshStatusBar()
        if let ttl, let expiresAt = widget.expiresAt {
            DispatchQueue.main.asyncAfter(deadline: .now() + ttl / 1000) { [weak self] in
                self?.expireStatusWidget(widget.storageKey, expiresAt: expiresAt)
            }
        }
        let result = widget.json()
        emitAPIEvent("status.changed", data: statusEventData(action: "set", widget: widget))
        return result
    }

    private func statusSamples(_ value: Any?, name: String) throws -> [Double] {
        guard let values = value as? [NSNumber] else { return [] }
        guard values.count <= 60 else {
            throw MachinenAPIError("invalid_params", "status widget \(name) must contain at most 60 values")
        }
        let samples = values.map(\.doubleValue)
        guard samples.allSatisfy({ $0.isFinite }) else {
            throw MachinenAPIError("invalid_params", "status widget \(name) values must be finite")
        }
        return samples
    }

    private func statusLinks(_ value: Any?) throws -> [MachinenStatusWidget.Link] {
        guard let values = value as? [JSONObject] else { return [] }
        guard values.count <= 32 else {
            throw MachinenAPIError("invalid_params", "status widget links must contain at most 32 values")
        }
        return try values.map { link in
            guard let title = link["title"] as? String, !title.isEmpty, title.count <= 512,
                  let rawURL = link["url"] as? String, rawURL.count <= 2_048,
                  let url = URL(string: rawURL), ["http", "https"].contains(url.scheme?.lowercased())
            else {
                throw MachinenAPIError("invalid_params", "status widget links require a title and HTTP(S) URL")
            }
            return MachinenStatusWidget.Link(title: title, url: url)
        }
    }

    private func expireStatusWidget(_ storageKey: String, expiresAt: TimeInterval) {
        guard let widget = statusWidgets[storageKey], widget.expiresAt == expiresAt,
              expiresAt <= Date().timeIntervalSince1970
        else { return }
        statusWidgets.removeValue(forKey: storageKey)
        refreshStatusBar()
        emitAPIEvent("status.changed", data: statusEventData(action: "expire", widget: widget))
    }

    private func apiRemoveStatusWidget(_ params: JSONObject) throws -> Any {
        let id = try requiredString("id", in: params)
        let (scopeKind, scopeID) = try parseStatusScope(params["scope"] as? JSONObject)
        let key = "\(scopeKind.rawValue):\(scopeID ?? ""):\(id)"
        guard let removed = statusWidgets.removeValue(forKey: key) else {
            throw MachinenAPIError("status_widget_not_found", "Status widget \(id) does not exist in that scope")
        }
        refreshStatusBar()
        let result = removed.json()
        emitAPIEvent("status.changed", data: statusEventData(action: "remove", widget: removed))
        return result
    }

    private func statusEventData(
        action: String,
        widget: MachinenStatusWidget
    ) -> JSONObject {
        var data: JSONObject = ["action": action, "widget": widget.json()]
        if widget.scopeKind == .machine, let machineID = widget.scopeID {
            data["machineId"] = machineID
        } else if widget.scopeKind == .workspace, let workspaceID = widget.scopeID {
            data["workspaceId"] = workspaceID
        } else if widget.scopeKind == .terminal, let terminalID = widget.scopeID {
            data["terminalId"] = terminalID
            if let tile = allSessionTiles.first(where: { $0.session.id == terminalID }) {
                data["workspaceId"] = tile.session.workspaceID
                data["tileId"] = tile.session.tileID
            }
        }
        return data
    }

    private func parseStatusScope(
        _ object: JSONObject?
    ) throws -> (MachinenStatusWidget.ScopeKind, String?) {
        let kindName = object?["kind"] as? String ?? "global"
        guard let kind = MachinenStatusWidget.ScopeKind(rawValue: kindName) else {
            throw MachinenAPIError("invalid_params", "Unknown status scope: \(kindName)")
        }
        if kind == .global { return (kind, nil) }
        guard let id = object?["id"] as? String, !id.isEmpty else {
            throw MachinenAPIError("invalid_params", "A \(kindName) status scope requires id")
        }
        if kind == .machine,
           !workspaces.contains(where: { $0.location.machineID == id })
        {
            throw MachinenAPIError("invalid_params", "Machine \(id) does not exist")
        }
        if kind == .workspace,
           !workspaces.contains(where: { $0.id == id })
        {
            throw MachinenAPIError("workspace_not_found", "Workspace \(id) does not exist")
        }
        if kind == .terminal,
           !allSessionTiles.contains(where: { $0.session.id == id })
        {
            throw MachinenAPIError("terminal_not_found", "Terminal \(id) does not exist")
        }
        return (kind, id)
    }

    private func apiSetContextCommand(_ params: JSONObject) throws -> Any {
        let id = try requiredString("id", in: params)
        let title = try requiredString("title", in: params)
        guard id.count <= 128 else {
            throw MachinenAPIError("invalid_params", "command id must be at most 128 characters")
        }
        guard title.count <= 512 else {
            throw MachinenAPIError("invalid_params", "command title must be at most 512 characters")
        }
        let subtitle = params["subtitle"] as? String
        if let subtitle, subtitle.count > 512 {
            throw MachinenAPIError("invalid_params", "command subtitle must be at most 512 characters")
        }
        let group = params["group"] as? String
        if let group, group.isEmpty || group.count > 512 {
            throw MachinenAPIError(
                "invalid_params",
                "command group must contain 1 to 512 characters"
            )
        }
        guard let contextName = params["context"] as? String,
              let context = MachinenContextCommand.Context(rawValue: contextName)
        else {
            throw MachinenAPIError("invalid_params", "command context must be workspace or terminal")
        }
        let locationKinds = try validatedLocationKinds(params["locationKinds"])
        let ttl = (params["ttlMilliseconds"] as? NSNumber)?.doubleValue
        if let ttl, ttl <= 0 {
            throw MachinenAPIError("invalid_params", "ttlMilliseconds must be positive")
        }
        let command = MachinenContextCommand(
            id: id,
            title: title,
            subtitle: subtitle,
            group: group,
            context: context,
            locationKinds: locationKinds,
            priority: (params["priority"] as? NSNumber)?.intValue ?? 50,
            expiresAt: ttl.map { Date().timeIntervalSince1970 + $0 / 1000 }
        )
        contextCommands[id] = command
        if let ttl, let expiresAt = command.expiresAt {
            DispatchQueue.main.asyncAfter(deadline: .now() + ttl / 1000) { [weak self] in
                self?.expireContextCommand(id, expiresAt: expiresAt)
            }
        }
        emitAPIEvent("command.changed", data: [
            "action": "set",
            "command": command.json(),
        ])
        return command.json()
    }

    private func validatedLocationKinds(_ value: Any?) throws -> [WorkspaceLocation.Kind]? {
        guard let names = value as? [String] else { return nil }
        guard !names.isEmpty,
              names.count <= 2,
              Set(names).count == names.count,
              names.allSatisfy({ WorkspaceLocation.Kind(rawValue: $0) != nil })
        else {
            throw MachinenAPIError(
                "invalid_params",
                "locationKinds must contain unique local or ssh values"
            )
        }
        return names.compactMap { WorkspaceLocation.Kind(rawValue: $0) }
    }

    private func apiRemoveContextCommand(_ params: JSONObject) throws -> Any {
        let id = try requiredString("id", in: params)
        guard let removed = contextCommands.removeValue(forKey: id) else {
            throw MachinenAPIError("command_not_found", "Command \(id) does not exist")
        }
        emitAPIEvent("command.changed", data: [
            "action": "remove",
            "command": removed.json(),
        ])
        return removed.json()
    }

    private func expireContextCommand(_ id: String, expiresAt: TimeInterval) {
        guard let command = contextCommands[id], command.expiresAt == expiresAt,
              expiresAt <= Date().timeIntervalSince1970
        else { return }
        contextCommands.removeValue(forKey: id)
        emitAPIEvent("command.changed", data: [
            "action": "expire",
            "command": command.json(),
        ])
    }

    private func apiSetSelectionOpener(_ params: JSONObject) throws -> Any {
        let id = try requiredString("id", in: params)
        let title = try requiredString("title", in: params)
        guard id.count <= 128 else {
            throw MachinenAPIError("invalid_params", "selection opener id must be at most 128 characters")
        }
        guard title.count <= 512 else {
            throw MachinenAPIError("invalid_params", "selection opener title must be at most 512 characters")
        }
        let subtitle = params["subtitle"] as? String
        if let subtitle, subtitle.count > 512 {
            throw MachinenAPIError("invalid_params", "selection opener subtitle must be at most 512 characters")
        }
        let selectionPattern = params["selectionPattern"] as? String
        if let selectionPattern {
            guard selectionPattern.count <= 1_024 else {
                throw MachinenAPIError("invalid_params", "selectionPattern must be at most 1024 characters")
            }
            do {
                _ = try NSRegularExpression(pattern: selectionPattern, options: [.caseInsensitive])
            } catch {
                throw MachinenAPIError("invalid_params", "selectionPattern must be a valid regular expression")
            }
        }
        let locationKinds = try validatedLocationKinds(params["locationKinds"])
        let ttl = (params["ttlMilliseconds"] as? NSNumber)?.doubleValue
        if let ttl, ttl <= 0 {
            throw MachinenAPIError("invalid_params", "ttlMilliseconds must be positive")
        }
        let opener = MachinenSelectionOpener(
            id: id,
            title: title,
            subtitle: subtitle,
            selectionPattern: selectionPattern,
            locationKinds: locationKinds,
            priority: (params["priority"] as? NSNumber)?.intValue ?? 50,
            expiresAt: ttl.map { Date().timeIntervalSince1970 + $0 / 1000 }
        )
        selectionOpeners[id] = opener
        if let ttl, let expiresAt = opener.expiresAt {
            DispatchQueue.main.asyncAfter(deadline: .now() + ttl / 1000) { [weak self] in
                self?.expireSelectionOpener(id, expiresAt: expiresAt)
            }
        }
        emitAPIEvent("selectionOpener.changed", data: [
            "action": "set",
            "selectionOpener": opener.json(),
        ])
        return opener.json()
    }

    private func apiRemoveSelectionOpener(_ params: JSONObject) throws -> Any {
        let id = try requiredString("id", in: params)
        guard let removed = selectionOpeners.removeValue(forKey: id) else {
            throw MachinenAPIError(
                "selection_opener_not_found",
                "Selection opener \(id) does not exist"
            )
        }
        emitAPIEvent("selectionOpener.changed", data: [
            "action": "remove",
            "selectionOpener": removed.json(),
        ])
        return removed.json()
    }

    private func expireSelectionOpener(_ id: String, expiresAt: TimeInterval) {
        guard let opener = selectionOpeners[id], opener.expiresAt == expiresAt,
              expiresAt <= Date().timeIntervalSince1970
        else { return }
        selectionOpeners.removeValue(forKey: id)
        emitAPIEvent("selectionOpener.changed", data: [
            "action": "expire",
            "selectionOpener": opener.json(),
        ])
    }

    private func apiSelect(_ params: JSONObject) throws -> Any {
        if let tileID = params["tileId"] as? String {
            guard let tile = allSessionTiles.first(where: { $0.session.tileID == tileID }) else {
                throw MachinenAPIError("tile_not_found", "Tile \(tileID) does not exist")
            }
            if currentWorkspace == tile.session.workspaceID {
                selectedIndex = activeSessionTiles.firstIndex(where: { $0 === tile }) ?? 0
            } else {
                currentWorkspace = nil
                selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == tile.session.workspaceID } ?? 0
            }
        } else if let workspaceID = params["workspaceId"] as? String {
            guard workspaceClusters.contains(where: { $0.workspaceID == workspaceID }) else {
                throw MachinenAPIError("workspace_not_found", "Workspace \(workspaceID) does not exist")
            }
            currentWorkspace = nil
            selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == workspaceID } ?? 0
        } else {
            throw MachinenAPIError("invalid_params", "tileId or workspaceId is required")
        }
        focusedIndex = nil
        updateSelection()
        setCameraImmediately()
        return uiJSON()
    }

    private func apiFocus(_ params: JSONObject) throws -> Any {
        guard !isTransitioning else { throw MachinenAPIError("conflict", "The camera is moving") }
        let tile = try requireTile(params)
        if tile.currentState == .detached {
            guard params["attach"] as? Bool ?? false else {
                throw MachinenAPIError("terminal_detached", "Attach the tile before focusing it")
            }
            _ = try apiAttachTile(tile)
        }
        currentWorkspace = tile.session.workspaceID
        selectedIndex = activeSessionTiles.firstIndex(where: { $0 === tile }) ?? 0
        focusedIndex = selectedIndex
        updateSelection()
        moveCamera()
        if params["activateApplication"] as? Bool ?? false {
            NSApp.activate(ignoringOtherApps: true)
            window?.makeKeyAndOrderFront(nil)
        }
        return uiJSON()
    }

    private func apiZoomOut(_ params: JSONObject) throws -> Any {
        guard !isTransitioning else { throw MachinenAPIError("conflict", "The camera is moving") }
        let all = params["levels"] as? String == "all"
        let requested = params["levels"] as? Int ?? 1
        guard all || requested > 0 else { throw MachinenAPIError("invalid_params", "levels must be positive or all") }
        var remaining = all ? 2 : requested
        if focusedIndex != nil, remaining > 0 {
            focusedIndex = nil
            remaining -= 1
        }
        if currentWorkspace != nil, remaining > 0 {
            currentWorkspace = nil
            focusedIndex = nil
        }
        updateSelection()
        moveCamera()
        return uiJSON()
    }

    private func apiShowOverview() throws -> Any {
        guard !isTransitioning else { throw MachinenAPIError("conflict", "The camera is moving") }
        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = min(selectedIndex, max(0, workspaceClusters.count - 1))
        updateSelection()
        moveCamera()
        return uiJSON()
    }

    private func locationFromJSON(_ value: JSONObject) throws -> WorkspaceLocation {
        let kind = try requiredString("kind", in: value)
        let path = try requiredString("path", in: value)
        switch kind {
        case WorkspaceLocation.Kind.local.rawValue:
            return .local(path)
        case WorkspaceLocation.Kind.ssh.rawValue:
            return .ssh(host: try requiredString("host", in: value), path: path)
        default:
            throw MachinenAPIError("invalid_params", "Unknown workspace location kind: \(kind)")
        }
    }

    private func validatedWorkspaceLocation(
        _ location: WorkspaceLocation
    ) throws -> WorkspaceLocation {
        switch location.kind {
        case .local:
            return .local(try validatedWorkingDirectory(location.path))
        case .ssh:
            guard let host = location.sshHost,
                  let parsed = WorkspaceLocation.parseSSHReference("\(host):\(location.path)")
            else {
                throw MachinenAPIError(
                    "invalid_params",
                    "Remote locations require an SSH host and an absolute path"
                )
            }
            return parsed
        }
    }

    private func validatedWorkingDirectory(_ path: String) throws -> String {
        let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: standardized, isDirectory: &isDirectory),
              isDirectory.boolValue
        else {
            throw MachinenAPIError("invalid_params", "workingDirectory is not a directory")
        }
        return standardized
    }

    private func snapshotJSON() -> JSONObject {
        [
            "workspaces": workspaces.map(workspaceJSON),
            "tiles": allSessionTiles.map(tileJSON),
            "terminals": allSessionTiles.map(terminalJSON),
            "targets": targetListJSON()["targets"] ?? [],
            "ui": uiJSON(),
        ]
    }

    private func workspaceJSON(_ workspace: WorkspaceRecord) -> JSONObject {
        [
            "id": workspace.id,
            "name": workspace.name,
            "workingDirectory": workspace.workingDirectory,
            "machineId": workspace.location.machineID,
            "location": workspace.location.json,
            "position": workspaces.firstIndex(where: { $0 === workspace }) ?? 0,
            "tileIds": allSessionTiles
                .filter { $0.session.workspaceID == workspace.id }
                .map { $0.session.tileID },
        ]
    }

    private func tileJSON(_ tile: TerminalTileView) -> JSONObject {
        let session = tile.session
        let siblings = allSessionTiles.filter { $0.session.workspaceID == session.workspaceID }
        return [
            "id": session.tileID,
            "workspaceId": session.workspaceID,
            "kind": "terminal",
            "name": session.name,
            "label": session.label,
            "pid": session.associatedPID ?? NSNull(),
            "shellPid": session.shellPID ?? NSNull(),
            "position": siblings.firstIndex(where: { $0 === tile }) ?? 0,
            "terminalId": session.id,
            "viewerState": terminalViewerIsAttached(session) ? "attached" : "detached",
        ]
    }

    private func terminalJSON(_ tile: TerminalTileView) -> JSONObject {
        let session = tile.session
        var result: JSONObject = [
            "id": session.id,
            "tileId": session.tileID,
            "workingDirectory": session.workingDirectory,
            "currentWorkingDirectory": session.currentWorkingDirectory ?? NSNull(),
            "location": session.location.json,
            "launch": launchJSON(session.launch),
            "backend": TerminalSession.backendName,
            "title": session.commandTitle,
            "runtimeLabel": session.runtimeLabel ?? NSNull(),
            "shellName": session.inferredShellName ?? NSNull(),
            "pid": session.associatedPID ?? NSNull(),
            "shellPid": session.shellPID ?? NSNull(),
            "titleOverride": session.titleOverride ?? NSNull(),
            "observedCommand": session.observedCommand ?? NSNull(),
            "processState": processState(session.state),
            "activityState": session.activityState.rawValue,
            "viewerState": terminalViewerIsAttached(session) ? "attached" : "detached",
        ]
        if let geometry = tile.terminalResponder?.sessionGeometry {
            result["geometry"] = [
                "columns": geometry.columns,
                "rows": geometry.rows,
                "generation": geometry.generation,
                "ownerClientId": geometry.ownerClientId.map { $0 as Any } ?? NSNull(),
                "controlledByThisViewer": geometry.ownerClientId == session.viewerClientID,
            ]
        } else {
            result["geometry"] = NSNull()
        }
        return result
    }

    private func uiJSON() -> JSONObject {
        let selectedTile = selectedSessionTile()
        let level = focusedIndex != nil ? "terminal" : (currentWorkspace != nil ? "workspace" : "overview")
        return [
            "level": level,
            "selectedWorkspaceId": selectedWorkspaceID() ?? NSNull(),
            "selectedTileId": selectedTile?.session.tileID ?? NSNull(),
            "focusedTileId": focusedIndex == nil ? NSNull() : (selectedTile?.session.tileID ?? NSNull()),
            "statusTitle": statusBarView.title,
        ]
    }

    private func launchJSON(_ launch: TerminalLaunch) -> JSONObject {
        var result: JSONObject = ["kind": launch.kind.rawValue]
        if let command = launch.command { result["command"] = command }
        if let executable = launch.executable { result["executable"] = executable }
        if let arguments = launch.arguments { result["arguments"] = arguments }
        if let environment = launch.environment { result["environment"] = environment }
        return result
    }

    private func parseLaunch(_ value: JSONObject?) throws -> TerminalLaunch {
        guard let value else { return .loginShell }
        let kind = value["kind"] as? String ?? "loginShell"
        switch kind {
        case "loginShell":
            return .loginShell
        case "shellCommand":
            return .shellCommand(try requiredString("command", in: value))
        case "exec":
            let executable = try requiredString("executable", in: value)
            let arguments = value["arguments"] as? [String] ?? []
            let environment = value["environment"] as? [String: String]
            return .executable(executable, arguments: arguments, environment: environment)
        default:
            throw MachinenAPIError("invalid_params", "Unknown launch kind: \(kind)")
        }
    }

    private func defaultName(for launch: TerminalLaunch) -> String {
        switch launch.kind {
        case .loginShell: return "shell"
        case .shellCommand:
            return launch.command?.split(separator: " ").first.map(String.init) ?? "command"
        case .exec:
            return launch.executable.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "command"
        }
    }

    private func launchDescription(_ launch: TerminalLaunch) -> String {
        switch launch.kind {
        case .loginShell: return "$SHELL -l"
        case .shellCommand: return launch.command ?? "$SHELL -lc"
        case .exec:
            return ([launch.executable ?? ""] + (launch.arguments ?? [])).joined(separator: " ")
        }
    }

    private func processState(_ state: TerminalSession.State) -> String {
        switch state {
        case .starting: return "starting"
        case .running, .detached: return "running"
        case .stopped: return "stopped"
        case .exited: return "exited"
        case .disconnected: return "disconnected"
        }
    }

    private func terminalViewerIsAttached(_ session: TerminalSession) -> Bool {
        session.state == .starting || session.state == .running
    }

    private func terminalIsRunning(_ session: TerminalSession) -> Bool {
        session.state == .starting || session.state == .running || session.state == .detached
            || session.state == .disconnected
    }

    private func requireWorkspace(_ params: JSONObject) throws -> WorkspaceRecord {
        let id = try requiredString("workspaceId", in: params)
        guard let workspace = workspaces.first(where: { $0.id == id }) else {
            throw MachinenAPIError("workspace_not_found", "Workspace \(id) does not exist")
        }
        return workspace
    }

    private func requireTile(_ params: JSONObject) throws -> TerminalTileView {
        let id = try requiredString("tileId", in: params)
        guard let tile = allSessionTiles.first(where: { $0.session.tileID == id }) else {
            throw MachinenAPIError("tile_not_found", "Tile \(id) does not exist")
        }
        return tile
    }

    private func requireTerminal(_ params: JSONObject) throws -> TerminalTileView {
        let id = try requiredString("terminalId", in: params)
        guard let tile = allSessionTiles.first(where: { $0.session.id == id }) else {
            throw MachinenAPIError("terminal_not_found", "Terminal \(id) does not exist")
        }
        return tile
    }

    private func requiredString(_ key: String, in params: JSONObject) throws -> String {
        guard let value = params[key] as? String, !value.isEmpty else {
            throw MachinenAPIError("invalid_params", "\(key) is required")
        }
        return value
    }

    private func clampedPosition(_ requested: Int?, count: Int) -> Int {
        min(max(0, requested ?? count), count)
    }

    private func insertTile(_ tile: TerminalTileView, in workspaceID: String, at position: Int) {
        let indexes = allSessionTiles.indices.filter {
            allSessionTiles[$0].session.workspaceID == workspaceID
        }
        if indexes.indices.contains(position) {
            allSessionTiles.insert(tile, at: indexes[position])
        } else if let last = indexes.last {
            allSessionTiles.insert(tile, at: last + 1)
        } else if let workspacePosition = workspaces.firstIndex(where: { $0.id == workspaceID }) {
            let laterIDs = Set(workspaces.dropFirst(workspacePosition + 1).map(\.id))
            let insertion = allSessionTiles.firstIndex { laterIDs.contains($0.session.workspaceID) }
                ?? allSessionTiles.endIndex
            allSessionTiles.insert(tile, at: insertion)
        } else {
            allSessionTiles.append(tile)
        }
    }

    private func emitAPIEvent(_ event: String, data: JSONObject) {
        onAPIEvent?(event, data)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.055, alpha: 1).setFill()
        bounds.fill()
    }

    private func sessionControlStatusWidget(
        for tile: TerminalTileView,
        workspace: WorkspaceRecord
    ) -> MachinenStatusWidget {
        let item = availableSessionItems(for: workspace).first {
            $0.session.id == tile.session.id
        }
        let clients = item?.session.clients ?? []
        let localClientID = tile.session.viewerClientID
        let localClient = clients.first { $0.id == localClientID }
        let geometry = tile.terminalResponder?.sessionGeometry
        let hasControl = geometry.map { $0.ownerClientId == localClientID }
            ?? (localClient?.writer == true && localClient?.resize == true)
        let hasViewerDetails = item?.session.clientControlAvailable == true
        let hasRefreshed = availableSessionsLastRefresh[workspace.location.machineID] != nil
        let role: String
        let tone: MachinenStatusWidget.Tone
        if hasControl {
            role = "CONTROL"
            tone = .good
        } else if geometry != nil || localClient != nil {
            role = "VIEWING"
            tone = .attention
        } else if hasRefreshed {
            role = "ATTACHED"
            tone = .neutral
        } else {
            role = "CHECKING"
            tone = .neutral
        }

        let others = clients.filter { $0.id != localClientID }
        let value = role + (others.isEmpty ? "" : " +\(others.count)")
        var detail: [String] = []
        switch role {
        case "CONTROL":
            detail.append("You control terminal input and resize.")
        case "VIEWING":
            if let controller = clients.first(where: { $0.writer && $0.resize }) {
                detail.append("You are viewing; \(controller.name) is in control.")
            } else {
                detail.append("You are viewing this terminal.")
            }
        case "ATTACHED":
            detail.append("This Desktop is attached; control details are unavailable.")
        default:
            detail.append("Checking terminal control and attached viewers…")
        }
        if hasViewerDetails {
            if others.isEmpty {
                detail.append("No other viewers are attached.")
            } else {
                detail.append(
                    "\(others.count) other \(others.count == 1 ? "viewer is" : "viewers are") attached:"
                )
                detail += others.map { client in
                    let clientRole = client.writer && client.resize
                        ? "CONTROL"
                        : (client.readOnly ? "READ ONLY" : "VIEWING")
                    return "\(clientRole) · \(client.name)"
                }
            }
        }
        if let error = availableSessionsErrors[workspace.location.machineID] {
            detail.append("Could not refresh viewers: \(error)")
        }
        detail.append("Click to view participants or transfer control.")

        return MachinenStatusWidget(
            id: "machinen.sessionControl",
            scopeKind: .terminal,
            scopeID: tile.session.id,
            placement: .right,
            kind: .text,
            label: nil,
            value: value,
            progress: nil,
            tone: tone,
            tooltip: detail.joined(separator: "\n"),
            priority: 975,
            expiresAt: nil
        )
    }

    private func refreshStatusBar() {
        let now = Date().timeIntervalSince1970
        statusWidgets = statusWidgets.filter { $0.value.expiresAt.map { $0 > now } ?? true }

        let workspaceID = selectedWorkspaceID()
        let focusedTerminalID = focusedIndex == nil ? nil : selectedSession()?.id
        let focusedTerminal = focusedTerminalID.flatMap { id in
            allSessionTiles.first { $0.session.id == id }
        }
        let workspace = selectedWorkspaceRecord()
        if let terminal = focusedTerminal {
            let workspaceName = workspace?.name ?? terminal.session.workspace
            statusBarView.title = "Workspaces > \(workspaceName) > \(terminal.session.displayName)"
            statusBarView.titleTooltip = "\(terminal.session.effectiveLocation.displayName) · \(terminal.session.commandTitle)"
        } else if currentWorkspace != nil, let workspace {
            statusBarView.title = "Workspaces > \(workspace.name)"
            statusBarView.titleTooltip = workspace.location.displayName
        } else {
            statusBarView.title = "Workspaces"
            statusBarView.titleTooltip = nil
        }
        statusBarView.workspaceChoices = workspaces.map { candidate in
            MachinenStatusNavigationChoice(
                id: candidate.id,
                title: candidate.name,
                tooltip: candidate.location.displayName
            )
        }
        statusBarView.selectedWorkspaceID = currentWorkspace
        statusBarView.terminalChoices = currentWorkspace.map { id in
            activeSessionTiles(for: id).map { tile in
                MachinenStatusNavigationChoice(
                    id: tile.session.id,
                    title: tile.session.displayName,
                    tooltip: "\(tile.session.effectiveLocation.displayName) · \(tile.session.commandTitle)"
                )
            }
        } ?? []
        statusBarView.selectedTerminalID = focusedTerminalID

        var resolved: [String: MachinenStatusWidget] = [:]
        let orderedScopes: [(MachinenStatusWidget.ScopeKind, String?)] = [
            (.global, nil),
            (.machine, workspace?.location.machineID),
            (.workspace, workspaceID),
            (.terminal, focusedTerminalID),
        ]
        for (kind, scopeID) in orderedScopes {
            guard kind == .global || scopeID != nil else { continue }
            for widget in statusWidgets.values
                where widget.scopeKind == kind && widget.scopeID == scopeID
            {
                resolved[widget.id] = widget
            }
        }
        if let focusedTerminal, let workspace,
           terminalViewerIsAttached(focusedTerminal.session)
        {
            resolved["machinen.sessionControl"] = sessionControlStatusWidget(
                for: focusedTerminal,
                workspace: workspace
            )
        }
        resolved["machinen.versions"] = MachinenStatusWidget(
            id: "machinen.versions",
            scopeKind: .global,
            scopeID: nil,
            placement: .right,
            kind: .text,
            label: nil,
            value: MachinenBuildVersions.statusText,
            progress: nil,
            tone: .neutral,
            tooltip: "Machinen Desktop \(MachinenBuildVersions.desktop)\n"
                + "Native session handler \(MachinenBuildVersions.sessionHandler)",
            priority: 10_000,
            expiresAt: nil
        )
        let registeredDiscoveries = registeredTargetLocations().compactMap {
            targetDiscoveries[$0.id]
        }
        let targetSessionCount = registeredDiscoveries.reduce(0) { count, discovery in
            count + discovery.sessions.count
        }
        let targetIsUnreachable = registeredDiscoveries.contains {
            $0.state == .unreachable
        }
        resolved["machinen.targetSessions"] = MachinenStatusWidget(
            id: "machinen.targetSessions",
            scopeKind: .global,
            scopeID: nil,
            placement: .right,
            kind: .count,
            label: "Shared",
            value: String(targetSessionCount),
            progress: nil,
            tone: targetIsUnreachable ? .attention : (targetSessionCount > 0 ? .good : .neutral),
            tooltip: targetIsUnreachable
                ? "A shared computer is unreachable; showing its last known state · click to manage"
                : "\(targetSessionCount) active sessions across computers · click to manage",
            priority: 960,
            expiresAt: nil
        )
        if let workspace {
            let availableCount = availableSessionItems(for: workspace).count { !$0.isAttached }
            if availableCount > 0 {
                resolved["machinen.availableSessions"] = MachinenStatusWidget(
                    id: "machinen.availableSessions",
                    scopeKind: .workspace,
                    scopeID: workspace.id,
                    placement: .right,
                    kind: .count,
                    label: "Not attached",
                    value: String(availableCount),
                    progress: nil,
                    tone: .attention,
                    tooltip: "\(availableCount) \(availableCount == 1 ? "session is" : "sessions are") not attached to Desktop · click to view",
                    priority: 950,
                    expiresAt: nil
                )
            }
        }
        effectiveStatusWidgets = Array(resolved.values)
        statusBarView.widgets = effectiveStatusWidgets.filter {
            $0.id == "machinen.versions"
        }
    }
}

private final class CameraSceneView: NSView {
    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
}
