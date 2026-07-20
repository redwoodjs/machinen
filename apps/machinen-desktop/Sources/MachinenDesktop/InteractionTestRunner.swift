import AppKit
import Foundation

@MainActor
enum InteractionTestRunner {
    static func run() -> Int32 {
        _ = NSApplication.shared
        do {
            try commandNCreatesInTheCurrentSpatialContext()
            try commandArrowsMoveThroughTheHierarchy()
            try workspacePaletteCreatesRenamesAndClosesWithKeyboard()
            print("Machinen interaction tests passed (3 scenarios)")
            return 0
        } catch {
            fputs("Machinen interaction tests failed: \(error)\n", stderr)
            return 1
        }
    }

    private static func commandNCreatesInTheCurrentSpatialContext() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 1)])

        deck.createNewWorkspaceOrTerminal()
        var snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 1, "⌘N inside a workspace created another workspace")
        try expect(snapshot.tiles.count == 2, "⌘N inside a workspace did not add a terminal")
        try expect(
            Set(snapshot.tiles.map(\.workspaceId)) == ["ws_alpha"],
            "the new terminal was added to the wrong workspace"
        )

        _ = try deck.performAPIOperation("ui.overview", params: [:])
        deck.createNewWorkspaceOrTerminal()
        snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 2, "⌘N in the overview did not create a workspace")
        try expect(snapshot.tiles.count == 3, "the new workspace did not contain a terminal")
        try expect(
            snapshot.workspaces.map(\.name) == ["alpha", "workspace"],
            "the automatic workspace name was not stable"
        )
    }

    private static func commandArrowsMoveThroughTheHierarchy() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 1),
        ])

        try expect(try harness.uiLevel(of: deck) == "overview", "the deck did not start in overview")
        deck.zoomInOneLevel()
        try expect(try harness.uiLevel(of: deck) == "workspace", "⌘↓ did not enter the workspace")
        deck.zoomInOneLevel()
        try expect(try harness.uiLevel(of: deck) == "terminal", "⌘↓ did not focus the terminal")
        deck.zoomOutOneLevel()
        try expect(try harness.uiLevel(of: deck) == "workspace", "⌘↑ did not leave the terminal")
        deck.zoomOutOneLevel()
        try expect(try harness.uiLevel(of: deck) == "overview", "⌘↑ did not leave the workspace")
    }

    private static func workspacePaletteCreatesRenamesAndClosesWithKeyboard() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [])

        deck.toggleCommandPalette()
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        try harness.type("alpha", into: harness.commandPalette(in: deck))
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        try expect(
            try harness.snapshot(of: deck).workspaces.map(\.name) == ["alpha"],
            "New workspace did not accept a keyboard-entered name"
        )

        deck.toggleCommandPalette()
        try harness.pressDown(on: harness.commandPalette(in: deck))
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        try harness.type("beta", into: harness.commandPalette(in: deck))
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        try expect(
            try harness.snapshot(of: deck).workspaces.map(\.name) == ["beta"],
            "Rename workspace did not update the name"
        )

        deck.toggleCommandPalette()
        try harness.pressDown(on: harness.commandPalette(in: deck))
        try harness.pressDown(on: harness.commandPalette(in: deck))
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        try harness.pressReturn(on: harness.confirmation(in: deck))
        let snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.isEmpty, "Close workspace left the workspace behind")
        try expect(snapshot.tiles.isEmpty, "Close workspace left its terminal behind")
    }

    private static func expect(
        _ condition: @autoclosure () throws -> Bool,
        _ message: String
    ) throws {
        guard try condition() else { throw InteractionTestFailure(message) }
    }
}

@MainActor
private final class Harness {
    private let temporaryDirectory: URL

    init() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("machinen-interaction-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: temporaryDirectory,
            withIntermediateDirectories: true
        )
    }

    func cleanUp() {
        try? FileManager.default.removeItem(at: temporaryDirectory)
    }

    func makeDeck(
        workspaces definitions: [(WorkspaceRecord, [TerminalSession])]
    ) -> TerminalDeckView {
        let state = MachinenStoredState(
            workspaces: definitions.map(\.0),
            sessions: definitions.flatMap(\.1)
        )
        let store = TerminalSessionStore(
            manifestURL: temporaryDirectory.appendingPathComponent("terminals.json")
        )
        return TerminalDeckView(state: state, sessionStore: store)
    }

    func workspace(
        _ name: String,
        terminalCount: Int
    ) -> (WorkspaceRecord, [TerminalSession]) {
        let id = "ws_\(name)"
        let workspace = WorkspaceRecord(id: id, name: name)
        let terminals = (0..<terminalCount).map { index in
            TerminalSession(
                id: "term_\(name)_\(index)",
                tileID: "tile_\(name)_\(index)",
                label: "\(name.prefix(1))\(index + 1)",
                workspaceID: id,
                workspace: name,
                name: "shell \(index + 1)",
                launch: .loginShell,
                workingDirectory: temporaryDirectory.path,
                state: .stopped
            )
        }
        return (workspace, terminals)
    }

    func snapshot(of deck: TerminalDeckView) throws -> InteractionSnapshot {
        let result = try deck.performAPIOperation("system.snapshot", params: [:])
        let data = try JSONSerialization.data(withJSONObject: result)
        return try JSONDecoder().decode(InteractionSnapshot.self, from: data)
    }

    func uiLevel(of deck: TerminalDeckView) throws -> String {
        let result = try deck.performAPIOperation("ui.get", params: [:])
        guard let object = result as? [String: Any], let level = object["level"] as? String else {
            throw InteractionTestFailure("ui.get returned an invalid response")
        }
        return level
    }

    func commandPalette(in deck: TerminalDeckView) throws -> CommandPaletteView {
        guard let palette = deck.subviews.compactMap({ $0 as? CommandPaletteView }).last else {
            throw InteractionTestFailure("the command palette did not open")
        }
        return palette
    }

    func confirmation(in deck: TerminalDeckView) throws -> ActionConfirmationView {
        guard let confirmation = deck.subviews.compactMap({ $0 as? ActionConfirmationView }).last else {
            throw InteractionTestFailure("the close confirmation did not open")
        }
        return confirmation
    }

    func type(_ text: String, into view: NSView) throws {
        for character in text {
            view.keyDown(with: try keyEvent(characters: String(character), keyCode: 0))
        }
    }

    func pressDown(on view: NSView) throws {
        view.keyDown(with: try keyEvent(characters: "", keyCode: 125))
    }

    func pressReturn(on view: NSView) throws {
        view.keyDown(with: try keyEvent(characters: "\r", keyCode: 36))
    }

    private func keyEvent(characters: String, keyCode: UInt16) throws -> NSEvent {
        guard let event = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: 0,
            context: nil,
            characters: characters,
            charactersIgnoringModifiers: characters,
            isARepeat: false,
            keyCode: keyCode
        ) else {
            throw InteractionTestFailure("could not create a keyboard event")
        }
        return event
    }
}

private struct InteractionSnapshot: Decodable {
    struct Workspace: Decodable {
        let name: String
    }

    struct Tile: Decodable {
        let workspaceId: String
    }

    let workspaces: [Workspace]
    let tiles: [Tile]
}

private struct InteractionTestFailure: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}
