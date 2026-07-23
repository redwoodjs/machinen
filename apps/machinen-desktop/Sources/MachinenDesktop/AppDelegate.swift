import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private weak var deck: TerminalDeckView?
    private var controller: MachinenController?
    private var apiServer: MachinenAPIServer?
    private var commandChord: CommandChord?
    private var terminalControlReturnShortcut: TerminalControlReturnShortcut?
    private var terminalCycleShortcut: TerminalCycleShortcut?
    private var terminalInputRenderBoost: TerminalInputRenderBoost?

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
        window.center()
        window.makeKeyAndOrderFront(nil)
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
        terminalControlReturnShortcut = TerminalControlReturnShortcut { [weak deck] in
            deck?.sendControlReturnToFocusedTerminal() == true
        }
        terminalCycleShortcut = TerminalCycleShortcut { [weak deck] offset in
            deck?.cycleFocusedWorkspace(by: offset) == true
        }
        terminalInputRenderBoost = TerminalInputRenderBoost { [weak deck] in
            deck?.noteFocusedTerminalInput()
        }

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        terminalControlReturnShortcut?.stop()
        terminalCycleShortcut?.stop()
        terminalInputRenderBoost?.stop()
        apiServer?.stop()
        deck?.prepareForTermination()
    }

    private func installMainMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "About Machinen",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        let newWorkspaceItem = NSMenuItem(
            title: "New Workspace or Terminal",
            action: #selector(createNewWorkspaceOrTerminal),
            keyEquivalent: "n"
        )
        newWorkspaceItem.keyEquivalentModifierMask = [.command]
        newWorkspaceItem.target = self
        appMenu.addItem(newWorkspaceItem)

        let newTerminalItem = NSMenuItem(
            title: "New Terminal…",
            action: #selector(toggleNewTerminal),
            keyEquivalent: "t"
        )
        newTerminalItem.keyEquivalentModifierMask = [.command]
        newTerminalItem.target = self
        appMenu.addItem(newTerminalItem)

        let commandsItem = NSMenuItem(
            title: "Commands…",
            action: #selector(toggleCommands),
            keyEquivalent: "k"
        )
        commandsItem.keyEquivalentModifierMask = [.command]
        commandsItem.target = self
        appMenu.addItem(commandsItem)

        let zoomInItem = NSMenuItem(
            title: "Zoom In",
            action: #selector(zoomIn),
            keyEquivalent: String(Character(UnicodeScalar(NSDownArrowFunctionKey)!))
        )
        zoomInItem.keyEquivalentModifierMask = [.command]
        zoomInItem.target = self
        appMenu.addItem(zoomInItem)

        let zoomOutItem = NSMenuItem(
            title: "Zoom Out",
            action: #selector(zoomOut),
            keyEquivalent: String(Character(UnicodeScalar(NSUpArrowFunctionKey)!))
        )
        zoomOutItem.keyEquivalentModifierMask = [.command]
        zoomOutItem.target = self
        appMenu.addItem(zoomOutItem)

        let closeItem = NSMenuItem(
            title: "Close Terminal or Workspace…",
            action: #selector(handleCommandW),
            keyEquivalent: "w"
        )
        closeItem.keyEquivalentModifierMask = [.command]
        closeItem.target = self
        appMenu.addItem(closeItem)
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
        // responder. A focused SwiftTerm surface implements copy:, paste:, and
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
        // Do not let application menu equivalents steal terminal commands. The
        // workspace command palette remains available so a focused local or SSH
        // terminal can change its workspace metadata without zooming out first.
        // Targetless Edit items still resolve through the terminal responder.
        guard window?.firstResponder is MachinenTerminalView else { return true }
        switch menuItem.action {
        case #selector(createNewWorkspaceOrTerminal),
             #selector(toggleNewTerminal),
             #selector(zoomIn),
             #selector(zoomOut),
             #selector(handleCommandW):
            return false
        default:
            return true
        }
    }

    @objc private func createNewWorkspaceOrTerminal() {
        deck?.createNewWorkspaceOrTerminal()
    }

    @objc private func toggleCommands() {
        deck?.toggleCommandPalette()
    }

    @objc private func toggleNewTerminal() {
        deck?.toggleNewTerminalPalette()
    }

    @objc private func zoomIn() {
        deck?.zoomInOneLevel()
    }

    @objc private func zoomOut() {
        deck?.zoomOutOneLevel()
    }

    @objc private func handleCommandW() {
        deck?.handleCommandW()
    }

    @objc private func showDebugInformation() {
        deck?.showDebugInformation()
    }
}
