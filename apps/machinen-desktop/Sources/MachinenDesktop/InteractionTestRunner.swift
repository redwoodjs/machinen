import AppKit
import Foundation

@MainActor
enum InteractionTestRunner {
    static func run() -> Int32 {
        _ = NSApplication.shared
        do {
            try commandNCreatesInTheCurrentSpatialContext()
            try commandArrowsMoveThroughTheHierarchy()
            try commandLeftAndRightCycleFocusedTerminals()
            try workspacePaletteCreatesRenamesAndClosesWithKeyboard()
            try processSamplesDistinguishInputFromOtherWaits()
            try statusWidgetsInheritBySpatialScope()
            try graphicalStatusWidgetsRender()
            try workspaceWorkingDirectoryBindsTerminals()
            print("Machinen interaction tests passed (8 scenarios)")
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
        try expect(try harness.statusTitle(of: deck) == "alpha", "the overview did not title the selected workspace")
        deck.zoomInOneLevel()
        try expect(try harness.uiLevel(of: deck) == "workspace", "⌘↓ did not enter the workspace")
        try expect(try harness.statusTitle(of: deck) == "alpha", "the workspace did not retain the single bar title")
        deck.zoomInOneLevel()
        try expect(try harness.uiLevel(of: deck) == "terminal", "⌘↓ did not focus the terminal")
        try expect(try harness.statusTitle(of: deck) == "shell", "the terminal did not title the observed command")
        deck.zoomOutOneLevel()
        try expect(try harness.uiLevel(of: deck) == "workspace", "⌘↑ did not leave the terminal")
        deck.zoomOutOneLevel()
        try expect(try harness.uiLevel(of: deck) == "overview", "⌘↑ did not leave the workspace")
    }

    private static func commandLeftAndRightCycleFocusedTerminals() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 2),
        ])
        let shortcut = TerminalCycleShortcut { [weak deck] offset in
            deck?.cycleFocusedTerminal(by: offset) == true
        }
        defer { shortcut.stop() }

        deck.zoomInOneLevel()
        deck.zoomInOneLevel()
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_0",
            "the first terminal was not initially focused"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 124)) == nil,
            "⌘→ was not handled at terminal level"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_1",
            "⌘→ did not focus the next terminal"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 124)) == nil,
            "cross-workspace ⌘→ was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_beta_0",
            "⌘→ did not cross to the next workspace"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 123)) == nil,
            "cross-workspace ⌘← was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_1",
            "⌘← did not cross to the previous workspace"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 123)) == nil,
            "⌘← was not handled within the workspace"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_0",
            "⌘← did not focus the previous terminal"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 123)) == nil,
            "wrapping ⌘← was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_beta_1",
            "⌘← did not wrap to the final terminal"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 124)) == nil,
            "wrapping ⌘→ was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_0",
            "⌘→ did not wrap to the first terminal"
        )
    }

    private static func processSamplesDistinguishInputFromOtherWaits() throws {
        let readSample = "Call graph:\n  read  (in libsystem_kernel.dylib) + 8"
        let sleepSample = "Call graph:\n  nanosleep  (in libsystem_c.dylib) + 220"
        let rawEventLoop = "Call graph:\n  kevent  (in libsystem_kernel.dylib) + 8"
        let rawSSHWait = "Call graph:\n  pselect  (in libsystem_kernel.dylib) + 112"
        try expect(
            TerminalActivityDetector.classifySample(readSample, canonical: true, echo: true) == .waiting,
            "a process blocked in read was not classified as waiting for input"
        )
        try expect(
            TerminalActivityDetector.classifySample(sleepSample, canonical: true, echo: true) == .working,
            "sleep was incorrectly classified as waiting for input"
        )
        try expect(
            TerminalActivityDetector.classifySample(rawEventLoop, canonical: false, echo: false) == .waiting,
            "a raw interactive event loop was not classified as waiting"
        )
        try expect(
            TerminalActivityDetector.classifySample(rawSSHWait, canonical: false, echo: false) == .waiting,
            "a quiet raw SSH session was not classified as waiting"
        )

        let legacyProcesses = """
         13959 13948 13959 13959 ?? machinen-dtach -A /tmp/legacy.sock
          4458     1  4458     0 ?? machinen-dtach -A /tmp/legacy.sock
          4459  4458  4459  7022 ?? /bin/zsh -l
          7022  4459  7022  7022 ?? ssh -t example pi
        """
        let legacy = TerminalActivityDetector.parseLegacyStatus(
            legacyProcesses,
            socketPath: "/tmp/legacy.sock"
        )
        try expect(legacy?.masterPid == 4458, "the legacy dtach master was not discovered")
        try expect(legacy?.childPid == 4459, "the legacy login shell was not discovered")
        try expect(legacy?.foregroundPgrp == 7022, "the legacy foreground process group was not discovered")

        let legacySession = TerminalSession(
            id: "term_legacy_output",
            tileID: "tile_legacy_output",
            label: "lo",
            workspaceID: "ws_legacy",
            workspace: "legacy",
            name: "shell",
            launch: .loginShell,
            workingDirectory: FileManager.default.temporaryDirectory.path,
            state: .running
        )
        let detector = TerminalActivityDetector(session: legacySession)
        var observedActivity: TerminalSession.ActivityState?
        detector.onActivityChange = { observedActivity = $0 }
        detector.recordOutput()
        try expect(observedActivity == .working, "live viewer output did not mark a legacy terminal as working")
    }

    private static func statusWidgetsInheritBySpatialScope() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 1)])
        _ = try deck.performAPIOperation("status.set", params: [
            "id": "git.modified",
            "kind": "count",
            "label": "modified",
            "value": 1,
        ])
        _ = try deck.performAPIOperation("status.set", params: [
            "id": "git.modified",
            "scope": ["kind": "workspace", "id": "ws_alpha"],
            "kind": "count",
            "label": "modified",
            "value": 3,
            "tone": "attention",
        ])
        var effective = try harness.effectiveStatusWidgets(of: deck)
        try expect(
            effective.first(where: { $0.id == "git.modified" })?.value == "3",
            "the workspace widget did not override the global widget"
        )
        _ = try deck.performAPIOperation("status.set", params: [
            "id": "network.graph",
            "kind": "sparkline",
            "graphStyle": "mirrored",
            "samples": [1, 4, 2],
            "secondarySamples": [2, 1, 3],
            "tooltip": "network transfer",
        ])
        effective = try harness.effectiveStatusWidgets(of: deck)
        let graph = effective.first(where: { $0.id == "network.graph" })
        try expect(graph?.graphStyle == "mirrored", "the graphical widget style was not retained")
        try expect(graph?.samples == [1, 4, 2], "the graphical widget samples were not retained")

        _ = try deck.performAPIOperation("status.remove", params: [
            "id": "git.modified",
            "scope": ["kind": "workspace", "id": "ws_alpha"],
        ])
        effective = try harness.effectiveStatusWidgets(of: deck)
        try expect(
            effective.first(where: { $0.id == "git.modified" })?.value == "1",
            "removing the workspace widget did not restore the global widget"
        )
    }

    private static func graphicalStatusWidgetsRender() throws {
        let view = MachinenStatusBarView(frame: NSRect(x: 0, y: 0, width: 900, height: 40))
        func widget(
            _ id: String,
            _ kind: MachinenStatusWidget.Kind,
            _ tone: MachinenStatusWidget.Tone,
            _ progress: Double?,
            _ style: MachinenStatusWidget.GraphStyle?,
            _ samples: [Double],
            _ secondary: [Double],
            _ states: [String]
        ) -> MachinenStatusWidget {
            MachinenStatusWidget(
                id: id,
                scopeKind: .global,
                scopeID: nil,
                placement: .right,
                kind: kind,
                label: id,
                value: "",
                progress: progress,
                tone: tone,
                tooltip: id,
                priority: 50,
                expiresAt: nil,
                graphStyle: style,
                samples: samples,
                secondarySamples: secondary,
                states: states
            )
        }
        view.widgets = [
            widget("activity", .state, .busy, nil, nil, [], [], ["working", "waiting", "idle", "unknown"]),
            widget("progress", .progress, .good, 0.62, nil, [], [], []),
            widget("cpu", .sparkline, .busy, nil, .area, [0.1, 0.6, 0.3], [], []),
            widget("git", .sparkline, .attention, nil, .bars, [2, 8, 3], [1, 0, 4], []),
            widget("network", .sparkline, .busy, nil, .mirrored, [1, 4, 2], [3, 1, 5], []),
            widget("services", .state, .good, nil, nil, [], [], ["good", "good"]),
        ]
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
            throw InteractionTestFailure("could not allocate a graphical status-bar bitmap")
        }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        let png = bitmap.representation(using: .png, properties: [:])
        try expect((png?.count ?? 0) > 1_000, "the graphical status bar rendered an empty image")
        if let path = ProcessInfo.processInfo.environment["MACHINEN_STATUS_PREVIEW_PATH"], let png {
            try png.write(to: URL(fileURLWithPath: path))
        }
    }

    private static func workspaceWorkingDirectoryBindsTerminals() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 1)])
        let projectDirectory = try harness.makeDirectory(named: "project")

        _ = try deck.performAPIOperation("workspace.update", params: [
            "workspaceId": "ws_alpha",
            "workingDirectory": projectDirectory.path,
        ])
        deck.createNewWorkspaceOrTerminal()
        let snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.workspaces.first?.workingDirectory == projectDirectory.path,
            "the workspace did not retain its bound working directory"
        )
        try expect(
            snapshot.terminals.allSatisfy { $0.workingDirectory == projectDirectory.path },
            "a terminal did not inherit the workspace working directory"
        )

        guard let focusedTerminalID = snapshot.terminals.last?.id else {
            throw InteractionTestFailure("the workspace did not contain a terminal")
        }
        _ = try deck.performAPIOperation("terminal.update", params: [
            "terminalId": focusedTerminalID,
            "title": "reviewing changes",
        ])
        try expect(
            try harness.statusTitle(of: deck) == "reviewing changes",
            "an agent-supplied terminal title did not reach the single status bar"
        )
        _ = try deck.performAPIOperation("terminal.update", params: [
            "terminalId": focusedTerminalID,
            "title": NSNull(),
        ])
        try expect(
            try harness.statusTitle(of: deck) == "shell",
            "clearing the terminal title did not restore automatic command naming"
        )
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

    func makeDirectory(named name: String) throws -> URL {
        let directory = temporaryDirectory.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
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
        let workspace = WorkspaceRecord(
            id: id,
            name: name,
            workingDirectory: temporaryDirectory.path
        )
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

    func effectiveStatusWidgets(of deck: TerminalDeckView) throws -> [StatusWidgetSnapshot] {
        let result = try deck.performAPIOperation("status.list", params: [:])
        let data = try JSONSerialization.data(withJSONObject: result)
        return try JSONDecoder().decode(StatusListSnapshot.self, from: data).effectiveWidgets
    }

    func uiLevel(of deck: TerminalDeckView) throws -> String {
        let result = try deck.performAPIOperation("ui.get", params: [:])
        guard let object = result as? [String: Any], let level = object["level"] as? String else {
            throw InteractionTestFailure("ui.get returned an invalid response")
        }
        return level
    }

    func focusedTileID(of deck: TerminalDeckView) throws -> String? {
        let result = try deck.performAPIOperation("ui.get", params: [:])
        guard let object = result as? [String: Any] else {
            throw InteractionTestFailure("ui.get returned an invalid response")
        }
        return object["focusedTileId"] as? String
    }

    func statusTitle(of deck: TerminalDeckView) throws -> String? {
        let result = try deck.performAPIOperation("ui.get", params: [:])
        guard let object = result as? [String: Any] else {
            throw InteractionTestFailure("ui.get returned an invalid response")
        }
        return object["statusTitle"] as? String
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

    func commandArrow(keyCode: UInt16) throws -> NSEvent {
        try keyEvent(characters: "", keyCode: keyCode, modifierFlags: [.command])
    }

    private func keyEvent(
        characters: String,
        keyCode: UInt16,
        modifierFlags: NSEvent.ModifierFlags = []
    ) throws -> NSEvent {
        guard let event = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: modifierFlags,
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

private struct StatusListSnapshot: Decodable {
    let effectiveWidgets: [StatusWidgetSnapshot]
}

private struct StatusWidgetSnapshot: Decodable {
    let id: String
    let value: String
    let graphStyle: String?
    let samples: [Double]?
}

private struct InteractionSnapshot: Decodable {
    struct Workspace: Decodable {
        let name: String
        let workingDirectory: String
    }

    struct Tile: Decodable {
        let workspaceId: String
    }

    struct Terminal: Decodable {
        let id: String
        let workingDirectory: String
    }

    let workspaces: [Workspace]
    let tiles: [Tile]
    let terminals: [Terminal]
}

private struct InteractionTestFailure: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}
