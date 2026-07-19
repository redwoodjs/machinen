import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private weak var deck: TerminalDeckView?
    private var controller: MachinenController?
    private var apiServer: MachinenAPIServer?
    private var commandChord: CommandChord?

    func applicationDidFinishLaunching(_ notification: Notification) {
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
        self.window = window
        commandChord = CommandChord { [weak deck] in
            deck?.toggleOverview()
        }

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
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

        let closeItem = NSMenuItem(
            title: "Detach Focused Viewer",
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
        NSApp.mainMenu = mainMenu
    }

    @objc private func toggleCommands() {
        deck?.toggleCommandPalette()
    }

    @objc private func toggleNewTerminal() {
        deck?.toggleNewTerminalPalette()
    }

    @objc private func handleCommandW() {
        deck?.handleCommandW()
    }
}
