import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private weak var deck: TerminalDeckView?
    private var controller: MachinenController?
    private var apiServer: MachinenAPIServer?
    private var desktopServicesSupervisor: DesktopServicesSupervisor?
    private var commandChord: CommandChord?
    private var desktopShortcutMonitor: DesktopShortcutMonitor?

    func applicationDidFinishLaunching(_ notification: Notification) {
        InputRoutingLog.start()
        InputRoutingLog.log("application did finish launching")
        installMainMenu()

        let sessionStore = TerminalSessionStore()
        let deck = TerminalDeckView(state: sessionStore.load(), sessionStore: sessionStore)
        self.deck = deck
        let controller = MachinenController(deck: deck)
        let apiServer = MachinenAPIServer(controller: controller)
        self.controller = controller
        self.apiServer = apiServer
        deck.onAPIEvent = { [weak apiServer] event, data in
            apiServer?.publish(event: event, data: data)
        }
        deck.shouldPublishTerminalOutput = { [weak apiServer] data in
            apiServer?.hasSubscribers(for: "terminal.output", data: data) ?? false
        }
        do {
            try apiServer.start()
            desktopServicesSupervisor = DesktopServicesSupervisor.bundled(
                apiSocketPath: apiServer.socketPath
            )
            desktopServicesSupervisor?.start()
        } catch {
            NSLog("Machinen API could not start: %@", String(describing: error))
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Machinen"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1)
        window.minSize = NSSize(width: 620, height: 500)
        window.contentView = deck
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)
        centerWindowButtons(in: window)
        window.makeFirstResponder(deck)
        deck.focusCurrentContent()
        window.tabbingMode = .disallowed
        window.acceptsMouseMovedEvents = true
        self.window = window
        commandChord = CommandChord { [weak self, weak deck] in
            // A focused terminal owns its modifier gestures just like any
            // other input. The overview chord remains available outside tiles.
            guard !(self?.window?.firstResponder is MachinenTerminalView) else { return }
            deck?.toggleOverview()
        }
        let configuration = MachinenConfiguration.load()
        desktopShortcutMonitor = DesktopShortcutMonitor(
            shortcuts: configuration.shortcuts
        ) { [weak deck] action in
            deck?.performShortcut(action) == true
        }

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        desktopShortcutMonitor?.stop()
        apiServer?.stop()
        desktopServicesSupervisor?.stop()
        deck?.prepareForTermination()
    }

    func windowDidResize(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        centerWindowButtons(in: window)
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        centerWindowButtons(in: window)
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        centerWindowButtons(in: window)
    }

    private func centerWindowButtons(in window: NSWindow) {
        guard let contentView = window.contentView else { return }
        let statusBarCenter = NSPoint(x: 0, y: MachinenStatusBarView.preferredHeight / 2)
        for type: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
            guard let button = window.standardWindowButton(type),
                  let titlebarView = button.superview
            else { continue }
            let centerY = titlebarView.convert(statusBarCenter, from: contentView).y
            var frame = button.frame
            frame.origin.y = round(centerY - frame.height / 2)
            button.frame = frame
        }
    }

    func installMainMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "About Machinen",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        let settingsItem = NSMenuItem(
            title: "Open Settings File",
            action: #selector(openSettingsFile),
            keyEquivalent: ","
        )
        settingsItem.keyEquivalentModifierMask = [.command]
        settingsItem.target = self
        appMenu.addItem(settingsItem)
        appMenu.addItem(.separator())

        let newWorkspaceItem = NSMenuItem(
            title: "New…",
            action: #selector(createNewWorkspaceOrTerminal),
            keyEquivalent: "n"
        )
        newWorkspaceItem.keyEquivalentModifierMask = [.command]
        newWorkspaceItem.target = self
        appMenu.addItem(newWorkspaceItem)

        let commandsItem = NSMenuItem(
            title: "Commands…",
            action: #selector(toggleCommands),
            keyEquivalent: "k"
        )
        commandsItem.keyEquivalentModifierMask = [.command]
        commandsItem.target = self
        appMenu.addItem(commandsItem)

        let alternateCommandsItem = NSMenuItem(
            title: "Commands…",
            action: #selector(toggleCommands),
            keyEquivalent: "k"
        )
        alternateCommandsItem.keyEquivalentModifierMask = [.command, .shift]
        alternateCommandsItem.target = self
        alternateCommandsItem.isHidden = true
        alternateCommandsItem.allowsKeyEquivalentWhenHidden = true
        appMenu.addItem(alternateCommandsItem)

        let terminalMenuItem = NSMenuItem(
            title: "Terminal Menu…",
            action: #selector(showTerminalMenu),
            keyEquivalent: "o"
        )
        terminalMenuItem.keyEquivalentModifierMask = [.command]
        terminalMenuItem.target = self
        appMenu.addItem(terminalMenuItem)

        let zoomInItem = NSMenuItem(
            title: "Zoom In",
            action: #selector(zoomIn),
            keyEquivalent: "+"
        )
        zoomInItem.keyEquivalentModifierMask = [.command]
        zoomInItem.target = self
        appMenu.addItem(zoomInItem)

        let zoomOutItem = NSMenuItem(
            title: "Zoom Out",
            action: #selector(zoomOut),
            keyEquivalent: "-"
        )
        zoomOutItem.keyEquivalentModifierMask = [.command]
        zoomOutItem.target = self
        appMenu.addItem(zoomOutItem)

        let actualSizeItem = NSMenuItem(
            title: "Actual Size",
            action: #selector(resetZoom),
            keyEquivalent: "0"
        )
        actualSizeItem.keyEquivalentModifierMask = [.command]
        actualSizeItem.target = self
        appMenu.addItem(actualSizeItem)

        let closeItem = NSMenuItem(
            title: "Disconnect Terminal or Close Workspace",
            action: #selector(handleCommandW),
            keyEquivalent: "w"
        )
        closeItem.keyEquivalentModifierMask = [.command]
        closeItem.target = self
        appMenu.addItem(closeItem)

        let restoreToastItem = NSMenuItem(
            title: "Reconnect Disconnected Terminal",
            action: #selector(restoreUndoToastTerminal),
            keyEquivalent: "z"
        )
        restoreToastItem.keyEquivalentModifierMask = [.command]
        restoreToastItem.target = self
        appMenu.addItem(restoreToastItem)

        let reopenItem = NSMenuItem(
            title: "Reconnect Last Disconnected Terminal",
            action: #selector(reopenClosedTerminal),
            keyEquivalent: "t"
        )
        reopenItem.keyEquivalentModifierMask = [.command, .shift]
        reopenItem.target = self
        appMenu.addItem(reopenItem)

        let terminateClosedItem = NSMenuItem(
            title: "Kill Last Disconnected Terminal",
            action: #selector(terminateRecentlyClosedTerminal),
            keyEquivalent: ""
        )
        terminateClosedItem.target = self
        appMenu.addItem(terminateClosedItem)
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit Machinen",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let viewItem = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "View")
        let debugItem = NSMenuItem(
            title: "Show Debug Information",
            action: #selector(showDebugInformation),
            keyEquivalent: ""
        )
        debugItem.target = self
        viewMenu.addItem(debugItem)
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        // Leave these targetless so AppKit resolves them through the first
        // responder. A focused Ghostty surface implements copy:, paste:, and
        // selectAll:, while non-terminal views simply do not claim them.
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        addEditItem("Copy", action: #selector(MachinenTerminalView.copy(_:)), key: "c", to: editMenu)
        addEditItem("Paste", action: #selector(MachinenTerminalView.paste(_:)), key: "v", to: editMenu)
        editMenu.addItem(.separator())
        addEditItem("Select All", action: #selector(MachinenTerminalView.selectAll(_:)), key: "a", to: editMenu)
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        NSApp.mainMenu = mainMenu
    }

    private func addEditItem(_ title: String, action: Selector, key: String, to menu: NSMenu) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = [.command]
        // `nil` asks AppKit to use the responder chain, rather than handling
        // terminal text in the application delegate.
        item.target = nil
        menu.addItem(item)
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(restoreUndoToastTerminal) {
            return deck?.canRestoreUndoToast == true
        }
        if menuItem.action == #selector(reopenClosedTerminal)
            || menuItem.action == #selector(terminateRecentlyClosedTerminal)
        {
            return deck?.canReopenClosedTerminal == true
        }
        if menuItem.action == #selector(showTerminalMenu) {
            return window?.firstResponder is MachinenTerminalView
        }
        return true
    }

    @objc private func openSettingsFile() {
        let url = MachinenConfiguration.defaultURL
        _ = MachinenConfiguration.load(from: url)
        guard NSWorkspace.shared.open(url) else {
            NSLog("Machinen could not open settings file at %@", url.path)
            return
        }
    }

    @objc private func createNewWorkspaceOrTerminal() {
        deck?.createNewWorkspaceOrTerminal()
    }

    @objc private func toggleCommands() {
        deck?.toggleCommandPalette()
    }

    @objc private func showTerminalMenu() {
        deck?.showTerminalContextMenu()
    }

    @objc private func zoomIn() {
        deck?.magnifyCamera()
    }

    @objc private func zoomOut() {
        deck?.demagnifyCamera()
    }

    @objc private func resetZoom() {
        deck?.resetCameraMagnification()
    }

    @objc private func handleCommandW() {
        deck?.handleCommandW()
    }

    @objc private func restoreUndoToastTerminal() {
        deck?.restoreUndoToastTerminal()
    }

    @objc private func reopenClosedTerminal() {
        deck?.reopenLastClosedTerminal()
    }

    @objc private func terminateRecentlyClosedTerminal() {
        deck?.terminateLastClosedTerminalNow()
    }

    @objc private func showDebugInformation() {
        deck?.showDebugInformation()
    }
}
