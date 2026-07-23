import AppKit
import Foundation

@MainActor
enum InteractionTestRunner {
    static func run() -> Int32 {
        _ = NSApplication.shared
        do {
            try commandNCreatesInTheCurrentSpatialContext()
            try commandArrowsMoveThroughTheHierarchy()
            try commandLeftAndRightCycleFocusedWorkspaces()
            try workspacePaletteCreatesRenamesAndClosesWithKeyboard()
            try processSamplesDistinguishInputFromOtherWaits()
            try statusWidgetsInheritBySpatialScope()
            try graphicalStatusWidgetsRender()
            try workspaceWorkingDirectoryBindsTerminals()
            try terminalViewportRemainsStableAcrossFocus()
            try controlReturnReachesLegacyTerminals()
            try pointerTilesSeparateClickFocusAndDrag()
            try singletonWorkspaceTileFillsSurface()
            try clickedTileFocusesItsOwnTerminal()
            try draggingPreviewMovesTileToAnotherWorkspace()
            print("Machinen interaction tests passed (14 scenarios)")
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
        try expect(try harness.statusTitle(of: deck) == "alpha > shell 1", "the terminal status title did not include workspace and terminal names")
        deck.zoomOutOneLevel()
        try expect(try harness.uiLevel(of: deck) == "workspace", "⌘↑ did not leave the terminal")
        deck.zoomOutOneLevel()
        try expect(try harness.uiLevel(of: deck) == "overview", "⌘↑ did not leave the workspace")
    }

    private static func commandLeftAndRightCycleFocusedWorkspaces() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 2),
        ])
        let shortcut = TerminalCycleShortcut { [weak deck] offset in
            deck?.cycleFocusedWorkspace(by: offset) == true
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
            try harness.focusedTileID(of: deck) == "tile_beta_0",
            "⌘→ did not travel through the hierarchy to the next workspace's first tile"
        )
        try expect(
            try harness.uiLevel(of: deck) == "terminal",
            "⌘→ did not finish focused on the destination tile"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 124)) == nil,
            "wrapping ⌘→ was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_0",
            "⌘→ did not wrap to the first workspace's first tile"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 123)) == nil,
            "wrapping ⌘← was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_beta_0",
            "⌘← did not wrap to the final workspace's first tile"
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

        guard let agentLabel = MachinenTerminalView.runtimeLabel(fromTerminalTitle: "machinen:agent") else {
            throw InteractionTestFailure("the Machinen OSC title was not recognized")
        }
        try expect(agentLabel == "agent", "the Machinen OSC title did not retain its label")
        guard let clearedLabel = MachinenTerminalView.runtimeLabel(fromTerminalTitle: "machinen:") else {
            throw InteractionTestFailure("the Machinen OSC title clear was not recognized")
        }
        try expect(clearedLabel == nil, "the Machinen OSC title did not clear its label")
        try expect(
            MachinenTerminalView.runtimeLabel(fromTerminalTitle: "ordinary terminal title") == nil,
            "an ordinary terminal title was treated as a Machinen label"
        )

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
        let titledTerminal = MachinenTerminalView(session: legacySession)
        var receivedLabel: String?
        var receivedLabelChange = false
        titledTerminal.onRuntimeLabelChange = { label in
            receivedLabelChange = true
            receivedLabel = label
        }
        titledTerminal.setTerminalTitle(source: titledTerminal, title: "machinen:agent")
        try expect(
            receivedLabelChange && receivedLabel == "agent",
            "the terminal did not deliver a Machinen OSC label to its host"
        )
        titledTerminal.setTerminalTitle(source: titledTerminal, title: "machinen:")
        try expect(
            receivedLabelChange && receivedLabel == nil,
            "the terminal did not deliver a Machinen OSC label clear to its host"
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
        view.title = "workspace"
        view.titleTooltip = "/projects/workspace"
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
            let value: String
            switch id {
            case "git": value = "+12 −5"
            case "cpu": value = "42%"
            case "network": value = "↓1M ↑512K"
            case "services": value = "2"
            default: value = ""
            }
            return MachinenStatusWidget(
                id: id,
                scopeKind: .global,
                scopeID: nil,
                placement: .right,
                kind: kind,
                label: id,
                value: value,
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
        var popoverTitle: String?
        var popoverDetail: String?
        view.onHoverChange = { widget, _, detail in
            popoverTitle = widget?.label
            popoverDetail = detail
        }
        try expect(
            view.hoverText(at: NSPoint(x: 875, y: 20)) == "services",
            "hovering a graphical instrument did not reveal its text"
        )
        try expect(
            popoverTitle == "services" && popoverDetail == "services",
            "hovering a graphical instrument did not provide popover text"
        )
        try expect(
            view.hoverText(at: NSPoint(x: 100, y: 20)) == "/projects/workspace",
            "hovering the workspace title did not reveal its path"
        )
        let popover = MachinenStatusPopoverView()
        popover.present(
            title: "System CPU",
            detail: "System CPU 42%",
            tone: .busy,
            at: NSRect(x: 720, y: 7, width: 62, height: 26),
            within: NSRect(x: 0, y: 0, width: 900, height: 640)
        )
        try expect(
            popover.displayedText?.title == "System CPU" && popover.displayedText?.detail == "System CPU 42%",
            "the graph popover did not render its label and exact value"
        )
        try expect(
            !view.acceptsFirstResponder && !popover.acceptsFirstResponder,
            "status chrome could steal keyboard focus from a terminal"
        )
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
        var snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.workspaces.first?.workingDirectory == projectDirectory.path,
            "the workspace did not retain its bound working directory"
        )
        try expect(
            snapshot.terminals.allSatisfy { $0.workingDirectory == projectDirectory.path },
            "a terminal did not inherit the workspace working directory"
        )

        _ = try deck.performAPIOperation("workspace.update", params: [
            "workspaceId": "ws_alpha",
            "location": [
                "kind": "ssh",
                "host": "mini",
                "path": "/Users/p4p8/gh/redwoodjs/machinen",
            ],
        ])
        snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.workspaces.first?.location.kind == "ssh"
                && snapshot.workspaces.first?.location.host == "mini",
            "the workspace did not retain its SSH location"
        )
        try expect(
            snapshot.terminals.allSatisfy {
                $0.location.kind == "ssh" && $0.location.host == "mini"
                    && $0.location.path == "/Users/p4p8/gh/redwoodjs/machinen"
            },
            "a terminal did not inherit the remote workspace location"
        )
        let remoteCommand = MachinenTerminalView.remoteCommand(
            for: .shellCommand("printf '%s' ready"),
            workingDirectory: "/Users/p4p8/project's files"
        )
        try expect(
            remoteCommand?.contains("cd -- '/Users/p4p8/project'\\''s files'") == true
                && remoteCommand?.contains("printf '\\''%s'\\'' ready") == true,
            "the remote terminal command did not safely quote its path and command"
        )
        try expect(
            WorkspaceLocation.parseSSHReference("mini:~/gh/peterp/notes")
                == .ssh(host: "mini", path: "~/gh/peterp/notes"),
            "the remote workspace reference was not parsed"
        )

        guard let focusedTerminalID = snapshot.terminals.last?.id else {
            throw InteractionTestFailure("the workspace did not contain a terminal")
        }
        let identityTitle = try harness.statusTitle(of: deck)
        _ = try deck.performAPIOperation("terminal.update", params: [
            "terminalId": focusedTerminalID,
            "title": "reviewing changes",
        ])
        try expect(
            try harness.statusTitle(of: deck) == identityTitle,
            "a terminal title override changed the workspace > terminal identity title"
        )
        _ = try deck.performAPIOperation("terminal.update", params: [
            "terminalId": focusedTerminalID,
            "title": NSNull(),
        ])
        try expect(
            try harness.statusTitle(of: deck) == identityTitle,
            "clearing a terminal title override changed the workspace > terminal identity title"
        )
    }

    private static func terminalViewportRemainsStableAcrossFocus() throws {
        let session = TerminalSession(
            id: "term_stable_viewport",
            tileID: "tile_stable_viewport",
            label: "sv",
            workspaceID: "ws_stable",
            workspace: "stable",
            name: "shell",
            launch: .loginShell,
            workingDirectory: FileManager.default.temporaryDirectory.path,
            state: .running
        )
        let tile = TerminalTileView(session: session)
        tile.frame = NSRect(x: 0, y: 0, width: 1_200, height: 760)
        tile.bounds = NSRect(x: 0, y: 0, width: 1_200, height: 760)
        let unfocused = tile.terminalViewportRect
        tile.isSelected = true
        try expect(tile.layer?.borderWidth == 3, "the selected terminal did not receive an accent border")
        tile.isFocused = true
        let focused = tile.terminalViewportRect
        try expect(tile.layer?.borderWidth == 0, "the focused terminal retained a duplicate border")
        tile.isFocused = false
        try expect(tile.layer?.borderWidth == 3, "the terminal border did not return after leaving focus")
        try expect(focused == unfocused, "focusing resized the terminal viewport")
        try expect(tile.terminalViewportRect == unfocused, "⌘↑ changed the terminal viewport")
        try expect(
            unfocused.width == tile.bounds.width && unfocused.maxY == tile.bounds.maxY,
            "the persistent terminal viewport did not retain its full content surface: \(unfocused), \(tile.bounds)"
        )
    }

    private static func controlReturnReachesLegacyTerminals() throws {
        try expect(
            MachinenTerminalView.legacyControlReturnBytes(
                keyCode: 36,
                modifiers: [.control],
                kittyKeyboardEnabled: false
            ) == [0x0D],
            "⌃↩ did not produce a carriage return for a legacy terminal"
        )
        try expect(
            MachinenTerminalView.legacyControlReturnBytes(
                keyCode: 76,
                modifiers: [.control],
                kittyKeyboardEnabled: false
            ) == [0x0D],
            "⌃ keypad Enter did not produce a carriage return for a legacy terminal"
        )
        try expect(
            MachinenTerminalView.legacyControlReturnBytes(
                keyCode: 36,
                modifiers: [.control],
                kittyKeyboardEnabled: true
            ) == nil,
            "⌃↩ bypassed Kitty keyboard reporting"
        )
        let shortcut = TerminalControlReturnShortcut { true }
        defer { shortcut.stop() }
        guard let controlReturn = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [.control],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: 0,
            context: nil,
            characters: "\r",
            charactersIgnoringModifiers: "\r",
            isARepeat: false,
            keyCode: 36
        ) else {
            throw InteractionTestFailure("could not create a ⌃↩ event")
        }
        try expect(shortcut.process(controlReturn) == nil, "⌃↩ was not intercepted before SwiftTerm")
    }

    private static func pointerTilesSeparateClickFocusAndDrag() throws {
        let session = TerminalSession(
            id: "term_pointer",
            tileID: "tile_pointer",
            label: "pt",
            workspaceID: "ws_pointer",
            workspace: "pointer",
            name: "shell",
            launch: .loginShell,
            workingDirectory: FileManager.default.temporaryDirectory.path,
            state: .stopped
        )
        let tile = TerminalTileView(session: session)
        var selected = 0
        var activated = 0
        var moved = false
        tile.onSelect = { _ in selected += 1 }
        tile.onActivate = { _ in activated += 1 }
        tile.onDragChanged = { _ in moved = true }
        tile.onDragEnded = { _ in moved }

        func event(_ type: NSEvent.EventType, point: NSPoint, clicks: Int = 1) throws -> NSEvent {
            guard let event = NSEvent.mouseEvent(
                with: type,
                location: point,
                modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: 0,
                context: nil,
                eventNumber: 0,
                clickCount: clicks,
                pressure: 1
            ) else {
                throw InteractionTestFailure("could not create a pointer event")
            }
            return event
        }

        tile.mouseDown(with: try event(.leftMouseDown, point: .zero))
        tile.mouseUp(with: try event(.leftMouseUp, point: .zero))
        try expect(selected == 1 && activated == 0, "a pointer click did not select a terminal tile")

        tile.mouseDown(with: try event(.leftMouseDown, point: .zero, clicks: 2))
        try expect(activated == 1, "a double click did not focus a terminal tile")

        moved = false
        tile.mouseDown(with: try event(.leftMouseDown, point: .zero))
        tile.mouseDragged(with: try event(.leftMouseDragged, point: NSPoint(x: 10, y: 0)))
        tile.mouseUp(with: try event(.leftMouseUp, point: NSPoint(x: 10, y: 0)))
        try expect(selected == 1 && moved, "a pointer drag selected instead of moving a terminal tile")
    }

    private static func singletonWorkspaceTileFillsSurface() throws {
        let session = TerminalSession(
            id: "term_singleton",
            tileID: "tile_singleton",
            label: "sg",
            workspaceID: "ws_singleton",
            workspace: "singleton",
            name: "shell",
            launch: .loginShell,
            workingDirectory: FileManager.default.temporaryDirectory.path,
            state: .stopped
        )
        let tile = TerminalTileView(session: session)
        let cluster = WorkspaceClusterView(
            workspaceID: "ws_singleton",
            workspace: "singleton",
            label: "sg"
        )
        let size = NSSize(width: 1_200, height: 760)
        _ = cluster.arrange(sessions: [tile], terminalSize: size)
        try expect(
            tile.frame == NSRect(origin: .zero, size: size),
            "a singleton tile did not fill its workspace surface"
        )
        try expect(
            tile.bounds == NSRect(origin: .zero, size: size),
            "a singleton tile did not retain its full terminal viewport"
        )
        tile.updateProcessInfo(TerminalProcessInfo(shellPID: 4201, processPID: 4242))
        try expect(
            session.associatedPID == 4242 && session.shellPID == 4201,
            "a tile did not retain its live process metadata"
        )
        let metrics = TerminalProcessMetricsMonitor()
        metrics.setContext(pid: 4242, terminalID: session.id)
        try expect(
            metrics.widgets.first(where: { $0.id == "machinen.pid" })?.value == "PID 4242",
            "the per-PID status widget was not created"
        )
    }

    private static func clickedTileFocusesItsOwnTerminal() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 2)])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_200, height: 760),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        window.makeFirstResponder(deck)
        deck.layoutSubtreeIfNeeded()
        try expect(try harness.uiLevel(of: deck) == "overview", "the test did not start in overview")

        func tiles(in view: NSView) -> [TerminalTileView] {
            view.subviews.flatMap { subview in
                (subview as? TerminalTileView).map { [$0] } ?? tiles(in: subview)
            }
        }
        let sessionTiles = tiles(in: deck).sorted { $0.session.id < $1.session.id }
        guard sessionTiles.count == 2 else {
            throw InteractionTestFailure("the overview did not render both terminal previews")
        }
        let target = sessionTiles[1]
        let targetFrame = target.convert(target.bounds, to: deck)
        let clickPoint = NSPoint(x: targetFrame.midX, y: targetFrame.midY)
        guard deck.hitTest(clickPoint) === target,
              let down = NSEvent.mouseEvent(
                  with: .leftMouseDown,
                  location: clickPoint,
                  modifierFlags: [],
                  timestamp: ProcessInfo.processInfo.systemUptime,
                  windowNumber: 0,
                  context: nil,
                  eventNumber: 0,
                  clickCount: 1,
                  pressure: 1
              ),
              let up = NSEvent.mouseEvent(
                  with: .leftMouseUp,
                  location: clickPoint,
                  modifierFlags: [],
                  timestamp: ProcessInfo.processInfo.systemUptime,
                  windowNumber: 0,
                  context: nil,
                  eventNumber: 0,
                  clickCount: 1,
                  pressure: 1
              )
        else {
            throw InteractionTestFailure("the visual terminal did not hit-test to its own tile")
        }
        // Deliver through the sibling to simulate a stale child hit target;
        // the deck must still focus the card visibly under the pointer.
        sessionTiles[0].mouseDown(with: down)
        sessionTiles[0].mouseUp(with: up)
        try expect(
            try harness.focusedTileID(of: deck) == target.session.tileID,
            "clicking a terminal did not focus its PTY before camera motion"
        )
        try expect(
            (window.firstResponder as? MachinenTerminalView)?.session.id == target.session.id,
            "camera motion delayed AppKit input focus for the clicked terminal"
        )
        let viewportPoint = target.convert(
            NSPoint(x: target.terminalViewportRect.midX, y: target.terminalViewportRect.midY),
            to: deck
        )
        try expect(
            deck.hitTest(viewportPoint) is MachinenTerminalView,
            "a focused terminal viewport did not own pointer input"
        )
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        try expect(
            try harness.focusedTileID(of: deck) == target.session.tileID,
            "clicking a terminal focused a different terminal"
        )
    }

    private static func draggingPreviewMovesTileToAnotherWorkspace() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 1),
            harness.workspace("beta", terminalCount: 1),
        ])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_200, height: 760),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        deck.layoutSubtreeIfNeeded()

        func descendants<T: NSView>(of view: NSView, as type: T.Type) -> [T] {
            view.subviews.flatMap { subview in
                (subview as? T).map { [$0] } ?? descendants(of: subview, as: type)
            }
        }
        guard let source = descendants(of: deck, as: TerminalTileView.self)
            .first(where: { $0.session.workspaceID == "ws_alpha" }),
              let destination = descendants(of: deck, as: WorkspaceClusterView.self)
            .first(where: { $0.workspaceID == "ws_beta" })
        else {
            throw InteractionTestFailure("the overview did not contain drag source and destination")
        }

        let sourcePoint = source.convert(NSPoint(x: source.bounds.midX, y: source.bounds.midY), to: deck)
        let destinationPoint = destination.convert(
            NSPoint(x: destination.bounds.midX, y: destination.bounds.midY),
            to: deck
        )
        func event(_ type: NSEvent.EventType, point: NSPoint) throws -> NSEvent {
            guard let event = NSEvent.mouseEvent(
                with: type,
                location: point,
                modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber,
                context: nil,
                eventNumber: 0,
                clickCount: 1,
                pressure: 1
            ) else {
                throw InteractionTestFailure("could not create a drag event")
            }
            return event
        }

        source.mouseDown(with: try event(.leftMouseDown, point: sourcePoint))
        source.mouseDragged(with: try event(.leftMouseDragged, point: destinationPoint))
        source.mouseUp(with: try event(.leftMouseUp, point: destinationPoint))

        let snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.tiles.first(where: { $0.id == source.session.tileID })?.workspaceId == "ws_beta",
            "dragging a terminal preview did not move it to the destination workspace"
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
        let locationPalette = try harness.commandPalette(in: deck)
        try harness.type("location", into: locationPalette)
        try harness.pressReturn(on: locationPalette)
        let locationTypePalette = try harness.commandPalette(in: deck)
        try harness.type("remote", into: locationTypePalette)
        try harness.pressReturn(on: locationTypePalette)
        let remoteLocationPalette = try harness.commandPalette(in: deck)
        try expect(
            remoteLocationPalette !== locationTypePalette,
            "Change workspace location did not offer an SSH remote folder"
        )
        try harness.pressEscape(on: remoteLocationPalette)

        deck.toggleCommandPalette()
        try harness.pressDown(on: harness.commandPalette(in: deck))
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

    func pressEscape(on view: NSView) throws {
        view.keyDown(with: try keyEvent(characters: "\u{1b}", keyCode: 53))
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
    struct Location: Decodable {
        let kind: String
        let path: String
        let host: String?
    }

    struct Workspace: Decodable {
        let name: String
        let workingDirectory: String
        let location: Location
    }

    struct Tile: Decodable {
        let id: String
        let workspaceId: String
    }

    struct Terminal: Decodable {
        let id: String
        let workingDirectory: String
        let location: Location
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
