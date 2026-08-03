import AppKit

struct TargetSessionBrowserItem {
    enum Kind { case target, workspace, session }
    enum SessionAction: Equatable { case attach, detach, takeControl }

    let kind: Kind
    let targetID: String
    let workspaceID: String?
    let parentWorkspaceID: String?
    let sessionID: String?
    let title: String
    let detail: String
    let state: TargetDiscovery.State
    let sessionAction: SessionAction?

    init(
        kind: Kind,
        targetID: String,
        workspaceID: String?,
        sessionID: String?,
        title: String,
        detail: String,
        state: TargetDiscovery.State,
        sessionAction: SessionAction? = nil,
        parentWorkspaceID: String? = nil
    ) {
        self.kind = kind
        self.targetID = targetID
        self.workspaceID = workspaceID
        self.parentWorkspaceID = kind == .session ? parentWorkspaceID : workspaceID
        self.sessionID = sessionID
        self.title = title
        self.detail = detail
        self.state = state
        self.sessionAction = sessionAction
    }
}

/// Hierarchical shared-workspace browser using the same interaction and visual
/// language as the Command-K palette.
final class TargetSessionsView: NSView {
    private enum Level: Equatable {
        case computers
        case computer(String)
        case workspace(targetID: String, workspaceID: String?)
        case session(targetID: String, sessionID: String)
    }

    private enum BrowserAction {
        case enterComputer(String)
        case enterWorkspace(targetID: String, workspaceID: String?)
        case enterSession(targetID: String, sessionID: String)
        case activate(TargetSessionBrowserItem)
        case closeWorkspace(TargetSessionBrowserItem)
        case killSession(TargetSessionBrowserItem)
        case refreshComputer(TargetSessionBrowserItem)
        case removeComputer(String)
        case addWorkspace
        case useComputer
        case back
    }

    var items: [TargetSessionBrowserItem] = [] {
        didSet {
            validateLevel()
            rebuildPalette()
        }
    }
    /// Kept for the deck's status-item API. Command-K style palettes are centered.
    var anchorRect: NSRect?
    var onDismiss: (() -> Void)?
    var onActivate: ((TargetSessionBrowserItem) -> Void)?
    var onCloseWorkspace: ((TargetSessionBrowserItem) -> Void)?
    var onKillSession: ((TargetSessionBrowserItem) -> Void)?
    var onUseComputer: (() -> Void)?
    var onAddWorkspace: (() -> Void)?
    var onRemoveTarget: ((String) -> Void)?

    private var level: Level = .computers
    private var palette: CommandPaletteView?
    private var actions: [BrowserAction] = []
    private var requestedSessionID: String?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        autoresizingMask = [.width, .height]
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Sessions")
        rebuildPalette()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        palette?.frame = bounds
    }

    override func keyDown(with event: NSEvent) {
        palette?.keyDown(with: event)
    }

    func selectSession(_ sessionID: String) {
        guard let item = items.first(where: { $0.sessionID == sessionID }) else {
            requestedSessionID = sessionID
            return
        }
        requestedSessionID = sessionID
        level = .workspace(targetID: item.targetID, workspaceID: item.parentWorkspaceID)
        rebuildPalette()
    }

    private func rebuildPalette() {
        palette?.removeFromSuperview()
        let configuration = paletteConfiguration()
        actions = configuration.actions
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "SESSIONS",
            context: configuration.context,
            placeholder: configuration.placeholder,
            defaultFooter: configuration.footer,
            commands: configuration.commands,
            initialSelectedIndex: configuration.selectedIndex
        )
        palette.autoresizingMask = [.width, .height]
        palette.onDismiss = { [weak self] in self?.navigateBack() }
        palette.onRun = { [weak self] command in self?.run(command) }
        self.palette = palette
        addSubview(palette)
        needsLayout = true
        if window?.firstResponder === self { window?.makeFirstResponder(self) }
    }

    private func paletteConfiguration() -> (
        context: String,
        placeholder: String,
        footer: String,
        commands: [PaletteCommand],
        actions: [BrowserAction],
        selectedIndex: Int
    ) {
        var entries: [(title: String, shortcut: String, action: BrowserAction)] = []
        let context: String
        let placeholder: String
        switch level {
        case .computers:
            context = "computers"
            placeholder = "Find a computer…"
            for computer in targetItems {
                let workspaces = workspaceItems(targetID: computer.targetID)
                let sessions = sessionItems(targetID: computer.targetID)
                let status = computer.state.displayTitle.lowercased()
                entries.append((
                    computer.title,
                    "\(status) · \(workspaces.count) \(workspaces.count == 1 ? "workspace" : "workspaces") · \(sessions.count) \(sessions.count == 1 ? "session" : "sessions")",
                    .enterComputer(computer.targetID)
                ))
            }
            entries.append(("Add Workspace…", "choose a computer and folder", .addWorkspace))
            entries.append(("Use Another Computer…", "connect with SSH", .useComputer))

        case let .computer(targetID):
            guard let computer = targetItem(targetID: targetID) else {
                return rootConfiguration()
            }
            context = "computers  ›  \(computer.title)"
            placeholder = "Find a workspace…"
            for workspace in workspaceItems(targetID: targetID) {
                let count = sessionItems(targetID: targetID, workspaceID: workspace.workspaceID).count
                entries.append((
                    workspace.title,
                    "\(count) \(count == 1 ? "session" : "sessions") · \(workspace.detail)",
                    .enterWorkspace(targetID: targetID, workspaceID: workspace.workspaceID)
                ))
            }
            entries.append(("Add Workspace…", "on this or another computer", .addWorkspace))
            entries.append(("Refresh \(computer.title)", computer.state.displayTitle, .refreshComputer(computer)))
            if targetID != "local" {
                entries.append((
                    "Stop Using \(computer.title)…",
                    "sessions keep running",
                    .removeComputer(targetID)
                ))
            }
            entries.append(("Back to Computers…", "←", .back))

        case let .workspace(targetID, workspaceID):
            guard let computer = targetItem(targetID: targetID),
                  let workspace = workspaceItem(targetID: targetID, workspaceID: workspaceID)
            else {
                return computerConfiguration(targetID: targetID)
            }
            context = "\(computer.title)  ›  \(workspace.title)"
            placeholder = "Find a session or action…"
            entries.append(("Open Workspace", workspace.detail, .activate(workspace)))
            entries.append(("Close Workspace…", "undo available", .closeWorkspace(workspace)))
            for session in sessionItems(targetID: targetID, workspaceID: workspaceID) {
                entries.append((
                    session.title,
                    session.detail,
                    .enterSession(targetID: targetID, sessionID: session.sessionID ?? "")
                ))
            }
            entries.append(("Back to \(computer.title)…", "←", .back))

        case let .session(targetID, sessionID):
            guard let computer = targetItem(targetID: targetID),
                  let session = items.first(where: {
                      $0.targetID == targetID && $0.sessionID == sessionID
                  })
            else {
                return computerConfiguration(targetID: targetID)
            }
            let workspace = workspaceItem(
                targetID: targetID,
                workspaceID: session.parentWorkspaceID
            )
            context = "\(computer.title)  ›  \(workspace?.title ?? "Unassigned")  ›  \(session.title)"
            placeholder = "Choose a session action…"
            entries.append((session.primaryActionTitle, session.detail, .activate(session)))
            entries.append(("Kill Session…", "terminate the process", .killSession(session)))
            entries.append(("Back to \(workspace?.title ?? "Workspace")…", "←", .back))
        }

        let commands = entries.enumerated().map { index, entry in
            PaletteCommand(
                id: .sharedWorkspaceBrowserAction(index),
                title: entry.title,
                shortcut: entry.shortcut
            )
        }
        let selectedIndex: Int
        if let requestedSessionID,
           let index = entries.firstIndex(where: { entry in
               if case let .enterSession(_, sessionID) = entry.action {
                   return sessionID == requestedSessionID
               }
               return false
           })
        {
            selectedIndex = index
            self.requestedSessionID = nil
        } else {
            selectedIndex = 0
        }
        let footer = level == .computers
            ? "↑↓ select    return open    esc close"
            : "↑↓ select    return open    esc back"
        return (
            context,
            placeholder,
            footer,
            commands,
            entries.map(\.action),
            selectedIndex
        )
    }

    private func rootConfiguration() -> (
        context: String, placeholder: String, footer: String,
        commands: [PaletteCommand], actions: [BrowserAction], selectedIndex: Int
    ) {
        level = .computers
        return paletteConfiguration()
    }

    private func computerConfiguration(targetID: String) -> (
        context: String, placeholder: String, footer: String,
        commands: [PaletteCommand], actions: [BrowserAction], selectedIndex: Int
    ) {
        if targetItem(targetID: targetID) != nil {
            level = .computer(targetID)
        } else {
            level = .computers
        }
        return paletteConfiguration()
    }

    private func run(_ command: PaletteCommand) {
        guard case let .sharedWorkspaceBrowserAction(index) = command.id,
              actions.indices.contains(index)
        else { return }
        switch actions[index] {
        case let .enterComputer(targetID):
            level = .computer(targetID)
            rebuildPalette()
        case let .enterWorkspace(targetID, workspaceID):
            level = .workspace(targetID: targetID, workspaceID: workspaceID)
            rebuildPalette()
        case let .enterSession(targetID, sessionID):
            guard !sessionID.isEmpty else { return }
            level = .session(targetID: targetID, sessionID: sessionID)
            rebuildPalette()
        case let .activate(item):
            onActivate?(item)
        case let .closeWorkspace(item):
            onCloseWorkspace?(item)
        case let .killSession(item):
            onKillSession?(item)
        case let .refreshComputer(item):
            onActivate?(item)
        case let .removeComputer(targetID):
            onRemoveTarget?(targetID)
        case .addWorkspace:
            onAddWorkspace?()
        case .useComputer:
            onUseComputer?()
        case .back:
            navigateBack()
        }
    }

    private func navigateBack() {
        switch level {
        case .computers:
            onDismiss?()
        case .computer:
            level = .computers
            rebuildPalette()
        case let .workspace(targetID, _):
            level = .computer(targetID)
            rebuildPalette()
        case let .session(targetID, sessionID):
            let workspaceID = items.first(where: {
                $0.targetID == targetID && $0.sessionID == sessionID
            })?.parentWorkspaceID
            level = .workspace(targetID: targetID, workspaceID: workspaceID)
            rebuildPalette()
        }
    }

    private func validateLevel() {
        switch level {
        case .computers:
            return
        case let .computer(targetID):
            if targetItem(targetID: targetID) == nil { level = .computers }
        case let .workspace(targetID, workspaceID):
            if workspaceItem(targetID: targetID, workspaceID: workspaceID) == nil {
                level = targetItem(targetID: targetID) == nil ? .computers : .computer(targetID)
            }
        case let .session(targetID, sessionID):
            if !items.contains(where: { $0.targetID == targetID && $0.sessionID == sessionID }) {
                level = targetItem(targetID: targetID) == nil ? .computers : .computer(targetID)
            }
        }
    }

    private var targetItems: [TargetSessionBrowserItem] {
        items.filter { $0.kind == .target }
    }

    private func targetItem(targetID: String) -> TargetSessionBrowserItem? {
        targetItems.first { $0.targetID == targetID }
    }

    private func workspaceItems(targetID: String) -> [TargetSessionBrowserItem] {
        items.filter { $0.kind == .workspace && $0.targetID == targetID }
    }

    private func workspaceItem(
        targetID: String,
        workspaceID: String?
    ) -> TargetSessionBrowserItem? {
        workspaceItems(targetID: targetID).first { $0.workspaceID == workspaceID }
    }

    private func sessionItems(targetID: String) -> [TargetSessionBrowserItem] {
        items.filter { $0.kind == .session && $0.targetID == targetID }
    }

    private func sessionItems(
        targetID: String,
        workspaceID: String?
    ) -> [TargetSessionBrowserItem] {
        sessionItems(targetID: targetID).filter { $0.parentWorkspaceID == workspaceID }
    }
}

private extension TargetSessionBrowserItem {
    var primaryActionTitle: String {
        switch sessionAction {
        case .attach, nil: "Attach Session"
        case .detach: "Detach Session"
        case .takeControl: "Take Control"
        }
    }
}

private extension TargetDiscovery.State {
    var displayTitle: String {
        switch self {
        case .online: "Online"
        case .unreachable: "Unreachable"
        case .inactive: "Inactive"
        }
    }
}
