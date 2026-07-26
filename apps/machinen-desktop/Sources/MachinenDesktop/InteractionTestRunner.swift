import AppKit
import Foundation
import GhosttyKit

@MainActor
enum InteractionTestRunner {
    static func run() -> Int32 {
        _ = NSApplication.shared
        do {
            try commandNAlwaysAsksWhatAndWhere()
            try commandArrowsMoveThroughTheHierarchy()
            try focusedCycleShortcutsSeparateTerminalsAndWorkspaces()
            try workspacePaletteCreatesRenamesAndClosesWithKeyboard()
            try terminalOutputAndRuntimeLabelsReportActivity()
            try statusWidgetsInheritBySpatialScope()
            try activityMonitorStaysWorkspaceScoped()
            try openPortsStayMachineScoped()
            try gitStatusCoversTheWholeBranch()
            try graphicalStatusWidgetsRender()
            try workspaceLocationsRemainUnambiguous()
            try oldManifestsRequireNativeRestart()
            try terminalViewportRemainsStableAcrossFocus()
            try terminalTileCaptionRendersWithSafeFonts()
            try ghosttyPreservesModifiedEnter()
            try scrollWheelReachesFocusedTerminalThroughPreview()
            try pointerTilesSeparateClickFocusAndDrag()
            try singletonWorkspaceTileFillsSurface()
            try clickedTileFocusesItsOwnTerminal()
            try draggingPreviewCannotMoveTileToAnotherWorkspace()
            try closingTerminalShowsRemovalAnimation()
            print("Machinen interaction tests passed (21 scenarios)")
            return 0
        } catch {
            fputs("Machinen interaction tests failed: \(error)\n", stderr)
            return 1
        }
    }

    private static func commandNAlwaysAsksWhatAndWhere() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 1)])

        deck.createNewWorkspaceOrTerminal()
        var snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 1, "⌘N immediately created a workspace")
        try expect(snapshot.tiles.count == 1, "⌘N immediately created a terminal")
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 1, "choosing an existing workspace created a workspace")
        try expect(snapshot.tiles.count == 2, "choosing an existing workspace did not add a terminal")
        try expect(
            Set(snapshot.tiles.map(\.workspaceId)) == ["ws_alpha"],
            "the new terminal was added to the wrong workspace"
        )

        _ = try deck.performAPIOperation("ui.overview", params: [:])
        deck.createNewWorkspaceOrTerminal()
        var newChooser = try harness.commandPalette(in: deck)
        try harness.type("new workspace", into: newChooser)
        try harness.pressReturn(on: newChooser)
        let knownLocation = try harness.commandPalette(in: deck)
        try harness.type("alpha", into: knownLocation)
        try harness.pressReturn(on: knownLocation)
        snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 1, "a known location created a duplicate workspace")
        try expect(snapshot.tiles.count == 2, "opening a known workspace changed its terminals")

        _ = try deck.performAPIOperation("ui.overview", params: [:])
        deck.createNewWorkspaceOrTerminal()
        snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 1, "⌘N created a workspace before an explicit choice")
        try expect(snapshot.tiles.count == 2, "⌘N created a terminal before an explicit choice")
        newChooser = try harness.commandPalette(in: deck)
        try harness.type("new workspace", into: newChooser)
        try harness.pressReturn(on: newChooser)
        let locationPalette = try harness.commandPalette(in: deck)
        try harness.type("home", into: locationPalette)
        try harness.pressReturn(on: locationPalette)
        let namePalette = try harness.commandPalette(in: deck)
        try harness.type("workspace", into: namePalette)
        try harness.pressReturn(on: namePalette)
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

    private static func focusedCycleShortcutsSeparateTerminalsAndWorkspaces() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 2),
        ])
        let shortcut = TerminalCycleShortcut { [weak deck] scope, offset in
            switch scope {
            case .terminal:
                deck?.cycleFocusedTerminal(by: offset) == true
            case .workspace:
                deck?.cycleFocusedWorkspace(by: offset) == true
            }
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
            "⌘→ did not focus the next terminal in the current workspace"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 124)) == nil,
            "wrapping ⌘→ was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_0",
            "⌘→ did not wrap within the current workspace"
        )
        try expect(
            try shortcut.process(harness.commandArrow(keyCode: 123)) == nil,
            "wrapping ⌘← was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_1",
            "⌘← did not wrap to the current workspace's final terminal"
        )
        try expect(
            try shortcut.process(harness.commandBracket(keyCode: 30)) == nil,
            "⌘] was not handled at terminal level"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_beta_0",
            "⌘] did not focus the next workspace's first terminal"
        )
        try expect(
            try shortcut.process(harness.commandBracket(keyCode: 30)) == nil,
            "wrapping ⌘] was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_0",
            "⌘] did not wrap to the first workspace"
        )
        try expect(
            try shortcut.process(harness.commandBracket(keyCode: 33)) == nil,
            "wrapping ⌘[ was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_beta_0",
            "⌘[ did not wrap to the final workspace"
        )
    }

    private static func terminalOutputAndRuntimeLabelsReportActivity() throws {
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

        let session = TerminalSession(
            id: "term_output",
            tileID: "tile_output",
            label: "lo",
            workspaceID: "ws_output",
            workspace: "output",
            name: "shell",
            launch: .loginShell,
            workingDirectory: FileManager.default.temporaryDirectory.path,
            state: .running
        )
        let titledTerminal = MachinenTerminalView(session: session)
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

        let detector = TerminalActivityDetector(session: session) { completion in
            completion(TerminalTelemetry(
                activity: .idle,
                shellPid: 42,
                processPid: 42,
                shellName: "zsh",
                command: "zsh"
            ))
        }
        var observedActivity: TerminalSession.ActivityState?
        var observedCommand: String?
        var observedProcess: TerminalProcessInfo?
        detector.onActivityChange = { observedActivity = $0 }
        detector.onCommandChange = { observedCommand = $0 }
        detector.onProcessInfoChange = { observedProcess = $0 }
        detector.start()
        defer { detector.stop() }
        try expect(observedActivity == .idle, "native shell telemetry did not mark the terminal idle")
        try expect(observedCommand == "zsh", "native shell telemetry omitted the foreground command")
        try expect(
            observedProcess == TerminalProcessInfo(shellPID: 42, processPID: 42),
            "native shell telemetry omitted process identifiers"
        )
        detector.recordOutput()
        try expect(observedActivity == .working, "live viewer output did not mark the terminal as working")

        let legacyDetector = TerminalActivityDetector(session: session) { completion in
            completion(TerminalTelemetry(
                activity: .unknown,
                shellPid: nil,
                processPid: nil,
                shellName: nil,
                command: nil
            ))
        }
        var legacyActivity: TerminalSession.ActivityState?
        legacyDetector.onActivityChange = { legacyActivity = $0 }
        legacyDetector.start()
        defer { legacyDetector.stop() }
        try expect(legacyActivity == .idle, "a quiet protocol-v1 terminal did not fall back to idle")
        legacyDetector.recordOutput()
        try expect(legacyActivity == .working, "protocol-v1 viewer output did not mark the terminal active")

        // Renderer state can lag behind the persistent worker. Native
        // telemetry remains authoritative even while the viewer says stopped.
        session.state = .stopped
        let monitoredTerminal = MachinenTerminalView(session: session) { completion in
            completion(TerminalTelemetry(
                activity: .idle,
                shellPid: 42,
                processPid: 42,
                shellName: "zsh",
                command: "zsh"
            ))
        }
        var installedActivity: TerminalSession.ActivityState?
        monitoredTerminal.onActivityChange = { installedActivity = $0 }
        let monitoredTile = TerminalTileView(session: session)
        monitoredTile.installTerminalView(monitoredTerminal)
        try expect(
            installedActivity == .idle,
            "installing a terminal tile did not start persistent activity monitoring"
        )
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

    private static func activityMonitorStaysWorkspaceScoped() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 1),
        ])

        func activityWidget() throws -> StatusWidgetSnapshot {
            guard let widget = try harness.effectiveStatusWidgets(of: deck)
                .first(where: { $0.id == "machinen.activity" })
            else {
                throw InteractionTestFailure("the workspace activity monitor was missing")
            }
            return widget
        }

        var activity = try activityWidget()
        try expect(
            activity.scope == .init(kind: "workspace", id: "ws_alpha"),
            "overview activity was not scoped to the selected workspace"
        )
        try expect(activity.states?.count == 2, "overview activity included another workspace")

        deck.zoomInOneLevel()
        deck.zoomInOneLevel()
        activity = try activityWidget()
        try expect(
            activity.scope == .init(kind: "workspace", id: "ws_alpha"),
            "focused-terminal activity changed to terminal scope"
        )
        try expect(activity.states?.count == 2, "focused activity omitted workspace siblings")
    }

    private static func openPortsStayMachineScoped() throws {
        let output = """
        p10
        cnode
        fcwd
        n/tmp/project/api
        f7
        n127.0.0.1:3000
        f8
        n[::1]:3000
        p11
        cssh
        fcwd
        n/tmp
        f4
        n127.0.0.1:11435
        """
        let services = MachinenStatusMetricsMonitor.parseListeningServices(output)
        try expect(services.count == 2, "open ports were filtered by project directory")
        try expect(services[0].process == "node", "open port omitted its process name")
        try expect(services[0].port == 3000, "open port omitted its port number")
        try expect(services[0].addresses.count == 2, "open port duplicated IPv4 and IPv6 sockets")
        try expect(services[1].process == "ssh", "machine listener was omitted")

        let location = WorkspaceLocation.ssh(host: "mini", path: "/tmp/project")
        let links = MachinenStatusMetricsMonitor.links(for: services, location: location)
        try expect(location.machineID == "ssh:mini", "SSH machine scope was not stable")
        try expect(links.map(\.url.absoluteString) == [
            "http://mini:3000",
            "http://mini:11435",
        ], "open ports did not produce default-browser links")
        try expect(
            services.map(\.summary).joined(separator: "\n").contains("\n"),
            "open ports were not formatted on separate lines"
        )
    }

    private static func gitStatusCoversTheWholeBranch() throws {
        let output = """
        feat/desktop-interaction-prototype
        ---MACHINEN-BRANCH-COMMITS---
        53
        ---MACHINEN-BRANCH-NUMSTAT---
        120\t4\tSources/Feature.swift
        8\t2\tSources/Existing.swift
        -\t-\tAssets/image.png
        3\t0\tSources/Untracked.swift
        """
        let snapshot = MachinenStatusMetricsMonitor.parseGitOutput(output)
        try expect(
            snapshot == .init(
                branch: "feat/desktop-interaction-prototype",
                commits: 53,
                filesChanged: 4,
                additions: 131,
                deletions: 6,
                additionBars: [120, 8, 3, 0],
                deletionBars: [4, 2, 0, 0]
            ),
            "the Git status did not summarize and graph the complete branch diff"
        )
        try expect(
            MachinenStatusMetricsMonitor.formatCompactCount(19_000) == "19K"
                && MachinenStatusMetricsMonitor.formatCompactCount(1_250_000) == "1.3M",
            "the Git status did not compact large line counts"
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

    private static func workspaceLocationsRemainUnambiguous() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 1)])
        let projectDirectory = try harness.makeDirectory(named: "project")

        do {
            _ = try deck.performAPIOperation("workspace.update", params: [
                "workspaceId": "ws_alpha",
                "workingDirectory": projectDirectory.path,
            ])
            throw InteractionTestFailure("a workspace location changed while it had terminals")
        } catch let error as MachinenAPIError {
            try expect(error.code == "workspace_not_empty", "location change returned the wrong error")
        }
        var snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.workspaces.first?.workingDirectory == harness.temporaryDirectoryPath,
            "a rejected location change modified the workspace"
        )
        do {
            _ = try deck.performAPIOperation("workspace.create", params: [
                "name": "duplicate",
                "workingDirectory": harness.temporaryDirectoryPath,
            ])
            throw InteractionTestFailure("a duplicate workspace location was created")
        } catch let error as MachinenAPIError {
            try expect(error.code == "workspace_location_conflict", "duplicate location returned the wrong error")
        }

        let emptyWorkspace = try deck.performAPIOperation("workspace.create", params: [
            "name": "empty",
            "workingDirectory": projectDirectory.path,
        ]) as? [String: Any]
        guard let emptyWorkspaceID = emptyWorkspace?["id"] as? String else {
            throw InteractionTestFailure("workspace.create did not return an ID")
        }
        _ = try deck.performAPIOperation("workspace.update", params: [
            "workspaceId": emptyWorkspaceID,
            "location": [
                "kind": "ssh",
                "host": "mini",
                "path": "/Users/p4p8/gh/redwoodjs/machinen",
            ],
        ])
        snapshot = try harness.snapshot(of: deck)
        let relocated = snapshot.workspaces.first(where: { $0.id == emptyWorkspaceID })
        try expect(
            relocated?.location.kind == "ssh" && relocated?.location.host == "mini",
            "an empty workspace did not accept its new location"
        )
        let remoteSession = TerminalSession(
            id: "term_remote_quote",
            tileID: "tile_remote_quote",
            label: "rq",
            workspaceID: "ws_remote_quote",
            workspace: "remote quote",
            name: "shell",
            launch: .shellCommand("printf '%s' ready"),
            workingDirectory: "/Users/p4p8/project's files",
            sshHost: "mini",
            state: .stopped
        )
        let remoteCommand = try MachinenNativeSessionBackend.remoteNewCommand(for: remoteSession)
        try expect(
            remoteCommand.contains("'--cwd' '/Users/p4p8/project'\\''s files'")
                && remoteCommand.contains("printf") && remoteCommand.contains("ready"),
            "the remote terminal command did not safely quote its path and command: \(remoteCommand)"
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

    private static func oldManifestsRequireNativeRestart() throws {
        let session = TerminalSession(
            id: "term_backend",
            tileID: "tile_backend",
            label: "be",
            workspaceID: "ws_backend",
            workspace: "backend",
            name: "shell",
            launch: .loginShell,
            workingDirectory: FileManager.default.temporaryDirectory.path,
            state: .running
        )
        let encoded = try JSONEncoder().encode(session)
        let currentObject = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] ?? [:]
        try expect(
            currentObject["backend"] as? String == TerminalSession.backendName,
            "a terminal manifest did not identify the native session backend"
        )

        var oldObject = currentObject
        oldObject.removeValue(forKey: "backend")
        oldObject["activityState"] = "working"
        let oldData = try JSONSerialization.data(withJSONObject: oldObject)
        let migrated = try JSONDecoder().decode(TerminalSession.self, from: oldData)
        try expect(
            migrated.state == .stopped,
            "a pre-native manifest launched a replacement process without an explicit restart"
        )
        try expect(
            migrated.activityState == .unknown,
            "a stopped pre-native manifest retained stale activity"
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
        let unfocusedPixels = MachinenTerminalView.intrinsicSurfacePixelSize(
            for: unfocused.size,
            backingScale: 2
        )
        tile.isSelected = true
        try expect(tile.layer?.borderWidth == 3, "the selected terminal did not receive an accent border")
        tile.isFocused = true
        let focused = tile.terminalViewportRect
        try expect(tile.layer?.borderWidth == 0, "the focused terminal retained a duplicate border")
        tile.isFocused = false
        try expect(tile.layer?.borderWidth == 3, "the terminal border did not return after leaving focus")
        try expect(focused == unfocused, "focusing resized the terminal viewport")
        try expect(tile.terminalViewportRect == unfocused, "⌘↑ changed the terminal viewport")
        let focusedPixels = MachinenTerminalView.intrinsicSurfacePixelSize(
            for: focused.size,
            backingScale: 2
        )
        try expect(
            focusedPixels.width == unfocusedPixels.width
                && focusedPixels.height == unfocusedPixels.height,
            "camera focus changed the terminal renderer's intrinsic pixel size"
        )
        try expect(
            unfocused.width == tile.bounds.width && unfocused.maxY == tile.bounds.maxY,
            "the persistent terminal viewport did not retain its full content surface: \(unfocused), \(tile.bounds)"
        )
    }

    private static func terminalTileCaptionRendersWithSafeFonts() throws {
        let session = TerminalSession(
            id: "term_caption_render",
            tileID: "tile_caption_render",
            label: "cr",
            workspaceID: "ws_caption_render",
            workspace: "caption render",
            name: "shell",
            launch: .loginShell,
            workingDirectory: FileManager.default.temporaryDirectory.path,
            state: .stopped
        )
        let tile = TerminalTileView(session: session)
        tile.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        guard let bitmap = tile.bitmapImageRepForCachingDisplay(in: tile.bounds) else {
            throw InteractionTestFailure("could not allocate a terminal-tile bitmap")
        }
        tile.cacheDisplay(in: tile.bounds, to: bitmap)
        try expect(
            bitmap.representation(using: .png, properties: [:])?.isEmpty == false,
            "the terminal tile caption did not render"
        )
    }

    private static func ghosttyPreservesModifiedEnter() throws {
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
        let encoded = controlReturn.ghosttyKeyEvent(GHOSTTY_ACTION_PRESS)
        try expect(encoded.keycode == 36, "Ghostty lost the physical Return key")
        try expect(
            encoded.mods.rawValue & GHOSTTY_MODS_CTRL.rawValue != 0,
            "Ghostty lost the Control modifier for Return"
        )
    }

    private static func scrollWheelReachesFocusedTerminalThroughPreview() throws {
        let session = TerminalSession(
            id: "term_scroll",
            tileID: "tile_scroll",
            label: "sc",
            workspaceID: "ws_scroll",
            workspace: "scroll",
            name: "shell",
            launch: .loginShell,
            workingDirectory: FileManager.default.temporaryDirectory.path,
            state: .stopped
        )
        let preview = TerminalTileView(session: session)
        let terminal = MachinenTerminalView(session: session)
        var resolutions = 0
        preview.terminalInputTarget = { _ in
            resolutions += 1
            return terminal
        }
        guard let event = CGEvent(
            scrollWheelEvent2Source: nil,
            units: .line,
            wheelCount: 1,
            wheel1: 1,
            wheel2: 0,
            wheel3: 0
        ).flatMap(NSEvent.init(cgEvent:)) else {
            throw InteractionTestFailure("could not create a scroll-wheel event")
        }

        preview.scrollWheel(with: event)

        try expect(resolutions == 1, "an overlapping preview swallowed terminal scrolling")
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
        guard sessionTiles.count == 2,
              let previewTerminal = sessionTiles[0].terminalResponder
        else {
            throw InteractionTestFailure("the overview did not render both terminal previews")
        }
        let typingEvent = try harness.keyEvent(characters: "a", keyCode: 0)
        try expect(window.firstResponder === deck, "select mode did not keep the deck as first responder")
        try expect(
            !previewTerminal.performKeyEquivalent(with: typingEvent),
            "select mode routed typing into a terminal preview"
        )
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
        guard let focusedTerminal = target.terminalResponder else {
            throw InteractionTestFailure("focus mode did not retain its terminal responder")
        }
        try expect(
            focusedTerminal.performKeyEquivalent(with: typingEvent),
            "focus mode did not route typing into the terminal"
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

        deck.zoomOutOneLevel()
        try expect(try harness.uiLevel(of: deck) == "workspace", "focus mode did not return to select mode")
        try expect(window.firstResponder === deck, "select mode did not restore the deck responder")
        try expect(
            !focusedTerminal.performKeyEquivalent(with: typingEvent),
            "a terminal consumed typing after returning to select mode"
        )
    }

    private static func draggingPreviewCannotMoveTileToAnotherWorkspace() throws {
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
            snapshot.tiles.first(where: { $0.id == source.session.tileID })?.workspaceId == "ws_alpha",
            "dragging a terminal preview moved it to a different workspace location"
        )
        do {
            _ = try deck.performAPIOperation("tile.move", params: [
                "tileId": source.session.tileID,
                "workspaceId": "ws_beta",
            ])
            throw InteractionTestFailure("tile.move reassigned a terminal to another workspace")
        } catch let error as MachinenAPIError {
            try expect(
                error.code == "terminal_relocation_unsupported",
                "cross-workspace tile.move returned the wrong error"
            )
        }
    }

    private static func closingTerminalShowsRemovalAnimation() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 2)])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.contentView = deck
        deck.layoutSubtreeIfNeeded()

        deck.zoomInOneLevel()
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        deck.handleCommandW()
        try harness.pressReturn(on: harness.confirmation(in: deck))

        let snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.tiles.count == 1, "closing an animated terminal left its tile behind")
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            try expect(
                harness.paneCloseAnimation(in: deck) != nil,
                "closing a terminal did not leave a visual removal animation"
            )
        }
    }

    private static func workspacePaletteCreatesRenamesAndClosesWithKeyboard() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [])

        deck.toggleCommandPalette()
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        let newWorkspaceLocation = try harness.commandPalette(in: deck)
        try harness.type("home", into: newWorkspaceLocation)
        try harness.pressReturn(on: newWorkspaceLocation)
        try expect(
            try harness.snapshot(of: deck).workspaces.isEmpty,
            "New workspace was created before asking for its name"
        )
        try harness.type("alpha", into: harness.commandPalette(in: deck))
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        try expect(
            try harness.snapshot(of: deck).workspaces.map(\.name) == ["alpha"],
            "New workspace did not accept its name and selected location"
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
        let locationCommandPalette = try harness.commandPalette(in: deck)
        try harness.type("location", into: locationCommandPalette)
        try harness.pressReturn(on: locationCommandPalette)
        try expect(
            try harness.commandPalette(in: deck) === locationCommandPalette,
            "a workspace with terminals entered the location-changing flow"
        )
        try harness.pressEscape(on: locationCommandPalette)

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
    var temporaryDirectoryPath: String { temporaryDirectory.path }

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

    func paneCloseAnimation(in deck: TerminalDeckView) -> NSImageView? {
        deck.subviews.compactMap { $0 as? NSImageView }.first {
            $0.identifier?.rawValue == "pane-close-animation"
        }
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

    func commandBracket(keyCode: UInt16) throws -> NSEvent {
        let characters = keyCode == 33 ? "[" : "]"
        return try keyEvent(characters: characters, keyCode: keyCode, modifierFlags: [.command])
    }

    func keyEvent(
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
    struct Scope: Decodable, Equatable {
        let kind: String
        let id: String?
    }

    let id: String
    let scope: Scope
    let value: String
    let graphStyle: String?
    let samples: [Double]?
    let states: [String]?
}

private struct InteractionSnapshot: Decodable {
    struct Location: Decodable {
        let kind: String
        let path: String
        let host: String?
    }

    struct Workspace: Decodable {
        let id: String
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
