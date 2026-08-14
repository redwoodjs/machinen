import AppKit
import Foundation
import GhosttyKit

@MainActor
enum InteractionTestRunner {
    static func run() -> Int32 {
        _ = NSApplication.shared
        do {
            if ProcessInfo.processInfo.environment["MACHINEN_RENDERER_TESTS"] == "1" {
                try ghosttyRendererSurvivesViewerReconnects()
                print("Machinen renderer reconnect test passed")
                return 0
            }
            try commandNAlwaysAsksWhatAndWhere()
            try mapEditAddWorkspaceUsesOverviewLayoutAndKeyboard()
            try shortcutConfigCreatesDefaultsAndLoadsOverrides()
            try settingsFileIsAvailableInApplicationMenu()
            try commandArrowsMoveThroughTheHierarchy()
            try statusNavigationMenusSwitchAndZoomOut()
            try commandPlusAndMinusMagnifyTheCurrentLevel()
            try configuredShortcutsNavigateHierarchy()
            try paneAndWorkspaceShortcutsTransitionAtFixedZoom()
            try configuredShortcutsSelectAndMoveSpatialObjects()
            try workspacePaletteCreatesRenamesAndClosesWithKeyboard()
            try commandPaletteFuzzySearchesAndCompletes()
            try terminalOutputAndRuntimeLabelsReportActivity()
            try statusWidgetsInheritBySpatialScope()
            try selectionOpenersRegisterMatchAndExpire()
            try contextCommandsUseWorkspaceAndOSC7TerminalDirectories()
            try availableNativeSessionsReconnectIntoWorkspace()
            try attachedSessionCanTakeControl()
            try sharedSessionGeometryFollowsItsController()
            try registeredTargetDiscoveryRequiresExplicitOpenAndAttach()
            try graphicalStatusWidgetsRender()
            try desktopServicesRestartUntilTheAppStops()
            try workspaceNamesRemainUniqueAndLocationsCanBeShared()
            try oldManifestsRequireNativeRestart()
            try sshTerminalViewportAppearsBeforeConnectionCompletes()
            try terminalViewportRemainsStableAcrossFocus()
            try ghosttyRendererSurvivesViewerReconnects()
            try terminalTileCaptionRendersWithSafeFonts()
            try ghosttyPreservesModifiedEnter()
            try scrollWheelReachesFocusedTerminalThroughPreview()
            try pointerTilesSeparateClickFocusAndDrag()
            try singletonWorkspaceTileFillsSurface()
            try overviewUsesOnlyItsTopInset()
            try statusBarIsExcludedFromTerminalViewport()
            try clickingWorkspaceBackgroundDoesNotFocusTerminal()
            try clickedTileFocusesItsOwnTerminal()
            try draggingPreviewCannotMoveTileToAnotherWorkspace()
            try commandWDisconnectsSingletonSession()
            try disconnectedTerminalsCanReconnectOrBeKilled()
            print("Machinen interaction tests passed (39 scenarios)")
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
        let newChooser = try harness.commandPalette(in: deck)
        try harness.type("new workspace", into: newChooser)
        try harness.pressReturn(on: newChooser)
        snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 1, "a workspace was created before naming it")
        try expect(snapshot.tiles.count == 2, "a terminal was created before choosing a workspace location")

        let locationPalette = try harness.commandPalette(in: deck)
        try harness.type("alpha", into: locationPalette)
        try harness.pressReturn(on: locationPalette)
        let namePalette = try harness.commandPalette(in: deck)
        try harness.type("beta", into: namePalette)
        try harness.pressReturn(on: namePalette)
        snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 2, "a shared location did not create a distinct workspace")
        try expect(snapshot.tiles.count == 3, "the new workspace did not contain a terminal")
        try expect(snapshot.workspaces.map(\.name) == ["alpha", "beta"], "the chosen workspace name changed")
        try expect(
            Set(snapshot.workspaces.map(\.workingDirectory)).count == 1,
            "workspaces could not share the same default directory"
        )
    }

    private static func mapEditAddWorkspaceUsesOverviewLayoutAndKeyboard() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 1),
            harness.workspace("beta", terminalCount: 1),
        ])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_200, height: 760),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        window.makeFirstResponder(deck)
        deck.layoutSubtreeIfNeeded()

        deck.toggleMapEditOverlay()
        guard let scene = deck.subviews.first(where: { view in
            view.subviews.contains { $0 is WorkspaceClusterView }
        }),
              let workspace = scene.subviews.first(where: { $0 is WorkspaceClusterView }),
              let addCard = scene.subviews.first(where: { $0 is AddWorkspaceCardView }),
              let overlay = deck.subviews.first(where: { $0 is MapEditOverlayView })
        else {
            throw InteractionTestFailure("the overview edit map did not show its add workspace card")
        }
        try expect(addCard.frame.size == workspace.frame.size,
                   "the add workspace card did not use the overview card size")
        try harness.pressReturn(on: overlay)
        try expect(deck.window?.firstResponder === addCard,
                   "the in-card workspace form did not capture immediate arrow input")
        let selectedWorkspace = try harness.selectedWorkspaceID(of: deck)
        try harness.pressDown(on: addCard)
        try expect(try harness.selectedWorkspaceID(of: deck) == selectedWorkspace,
                   "an in-card source arrow changed the overview workspace")
        try harness.pressReturn(on: addCard)
        try harness.type("gamma", into: addCard)
        try harness.pressReturn(on: addCard)
        let created = try harness.snapshot(of: deck)
        try expect(created.workspaces.map(\.name).contains("gamma"),
                   "the in-card workspace form did not create its named workspace")
        try expect(!deck.subviews.contains(where: { $0 is CommandPaletteView }),
                   "the in-card workspace form opened the command palette")

        let escapeDeck = harness.makeDeck(workspaces: [harness.workspace("beta", terminalCount: 1)])
        _ = try escapeDeck.performAPIOperation("ui.overview", params: [:])
        escapeDeck.toggleMapEditOverlay()
        guard let reopened = escapeDeck.subviews.first(where: { $0 is MapEditOverlayView }) else {
            throw InteractionTestFailure("the overview edit map did not open for Escape")
        }
        try harness.pressEscape(on: reopened)
        try expect(!escapeDeck.subviews.contains(where: { $0 is MapEditOverlayView }),
                   "Escape did not close the map edit overlay")
    }

    private static func shortcutConfigCreatesDefaultsAndLoadsOverrides() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let configURL = URL(fileURLWithPath: harness.temporaryDirectoryPath)
            .appendingPathComponent("config.json")
        let defaults = MachinenConfiguration.load(from: configURL)
        try expect(
            FileManager.default.fileExists(atPath: configURL.path),
            "the default shortcut config was not created"
        )
        let defaultData = try Data(contentsOf: configURL)
        let defaultObject = try JSONSerialization.jsonObject(with: defaultData) as? [String: Any]
        let defaultShortcuts = defaultObject?["shortcuts"] as? [String: String]
        try expect(
            defaultShortcuts == [
                "enter": "cmd+shift+down",
                "leave": "cmd+shift+up",
                "selectLeft": "left",
                "selectRight": "right",
                "selectDown": "down",
                "selectUp": "up",
                "moveLeft": "shift+left",
                "moveRight": "shift+right",
                "moveDown": "shift+down",
                "moveUp": "shift+up",
                "previousPane": "cmd+shift+left",
                "nextPane": "cmd+shift+right",
                "previousWorkspace": "cmd+shift+[",
                "nextWorkspace": "cmd+shift+]",
            ],
            "the generated shortcut config did not contain the documented defaults"
        )

        let overrideData = try JSONSerialization.data(withJSONObject: [
            "shortcuts": [
                "enter": "ctrl+j",
                "leave": "ctrl+k",
                "moveUp": "cmd+shift+up",
                "previousPane": "cmd+left",
                "nextPane": "option+tab",
                "previousWorkspace": "cmd+[",
                "nextWorkspace": "cmd+]",
            ]
        ])
        try overrideData.write(to: configURL, options: .atomic)
        let configured = MachinenConfiguration.load(from: configURL)
        try expect(
            configured.shortcuts[.enter]?.matches(
                try harness.keyEvent(characters: "j", keyCode: 38, modifierFlags: [.control])
            ) == true,
            "the config did not replace the enter shortcut"
        )
        try expect(
            configured.shortcuts[.nextPane]?.matches(
                try harness.keyEvent(characters: "\t", keyCode: 48, modifierFlags: [.option])
            ) == true,
            "the config did not replace the next-pane shortcut"
        )
        let migratedData = try Data(contentsOf: configURL)
        let migratedObject = try JSONSerialization.jsonObject(with: migratedData) as? [String: Any]
        let migratedShortcuts = migratedObject?["shortcuts"] as? [String: String]
        try expect(
            migratedShortcuts?.count == DesktopShortcutAction.allCases.count
                && migratedShortcuts?["enter"] == "ctrl+j"
                && migratedShortcuts?["previousPane"] == "cmd+shift+left"
                && migratedShortcuts?["moveUp"] == "shift+up"
                && migratedShortcuts?["previousWorkspace"] == "cmd+shift+["
                && migratedShortcuts?["nextWorkspace"] == "cmd+shift+]",
            "loading an older config did not migrate the spatial defaults"
        )

        var actions: [DesktopShortcutAction] = []
        let monitor = DesktopShortcutMonitor(
            shortcuts: defaults.shortcuts,
            startMonitoring: false
        ) { action in
            actions.append(action)
            return true
        }
        defer { monitor.stop() }
        try expect(
            monitor.process(harness.commandShiftArrow(keyCode: 125)) == nil && actions == [.enter],
            "the default enter shortcut was not routed"
        )
        try expect(
            monitor.process(harness.commandShiftArrow(keyCode: 124)) == nil
                && actions == [.enter, .nextPane],
            "the default next-pane shortcut was not routed"
        )
        try expect(
            monitor.process(
                try harness.keyEvent(characters: "", keyCode: 123, modifierFlags: [.shift])
            ) == nil && actions.last == .moveLeft,
            "the default move-left shortcut was not routed"
        )
        let unbound = try harness.keyEvent(
            characters: "x",
            keyCode: 7,
            modifierFlags: [.control, .option]
        )
        try expect(monitor.process(unbound) === unbound, "an unconfigured shortcut was consumed")
    }

    private static func settingsFileIsAvailableInApplicationMenu() throws {
        let previousMenu = NSApp.mainMenu
        defer { NSApp.mainMenu = previousMenu }
        let delegate = AppDelegate()
        delegate.installMainMenu()

        let appMenu = NSApp.mainMenu?.items.first?.submenu
        let settingsItem = appMenu?.items.first(where: { $0.title == "Open Settings File" })
        try expect(settingsItem != nil, "the application menu did not include the settings file")
        try expect(
            settingsItem?.action == NSSelectorFromString("openSettingsFile")
                && settingsItem?.target === delegate,
            "the settings menu item was not wired to the application delegate"
        )
        try expect(
            settingsItem?.keyEquivalent == ","
                && settingsItem?.keyEquivalentModifierMask == [.command],
            "the settings menu item did not use the standard ⌘, shortcut"
        )
        let newItems = appMenu?.items.filter {
            $0.action == NSSelectorFromString("createNewWorkspaceOrTerminal")
        } ?? []
        try expect(
            newItems.contains(where: {
                $0.keyEquivalent == "n" && $0.keyEquivalentModifierMask == [.command]
            }),
            "the application menu did not expose ⌘N for the New chooser"
        )
        try expect(
            newItems.contains(where: {
                $0.keyEquivalent == "n"
                    && $0.keyEquivalentModifierMask == [.command, .shift]
                    && $0.isHidden
                    && $0.allowsKeyEquivalentWhenHidden
            }),
            "the application menu did not expose ⇧⌘N for the New chooser"
        )
        let commandItems = appMenu?.items.filter {
            $0.action == NSSelectorFromString("toggleCommands")
        } ?? []
        try expect(
            commandItems.contains(where: {
                $0.keyEquivalent == "k" && $0.keyEquivalentModifierMask == [.command]
            }),
            "the application menu did not expose ⌘K for commands"
        )
        try expect(
            commandItems.contains(where: {
                $0.keyEquivalent == "k"
                    && $0.keyEquivalentModifierMask == [.command, .shift]
                    && $0.isHidden
                    && $0.allowsKeyEquivalentWhenHidden
            }),
            "the application menu did not expose ⇧⌘K for commands"
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

    private static func statusNavigationMenusSwitchAndZoomOut() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 2),
        ])
        guard let statusBar = deck.subviews.compactMap({
            $0 as? MachinenStatusBarView
        }).first else {
            throw InteractionTestFailure("the deck did not install its status bar")
        }
        try expect(
            statusBar.widgets.first(where: { $0.id == "machinen.versions" })?.value
                == MachinenBuildVersions.statusText,
            "the status bar did not show the Desktop and session-handler versions"
        )

        try expect(
            statusBar.workspaceMenu().items.map(\.title) == ["alpha", "beta"],
            "the workspace title did not provide a spatially ordered dropdown"
        )
        try expect(
            statusBar.workspaceMenu().items.map(\.state) == [.on, .off],
            "the workspace dropdown did not mark the current workspace"
        )

        deck.zoomInOneLevel()
        deck.zoomInOneLevel()
        try expect(
            statusBar.terminalMenu().items.map(\.title) == ["shell 1", "shell 2"],
            "the terminal title did not provide a spatially ordered dropdown"
        )
        try expect(
            statusBar.terminalMenu().items.map(\.state) == [.on, .off],
            "the terminal dropdown did not mark the focused terminal"
        )
        try expect(
            statusBar.chooseTerminal("term_alpha_1")
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_1",
            "choosing a terminal from the status bar did not focus it"
        )
        try expect(
            statusBar.chooseWorkspace("ws_alpha")
                && (try harness.uiLevel(of: deck)) == "workspace",
            "choosing the current workspace did not zoom out of its terminal"
        )
        try expect(
            statusBar.chooseWorkspace("ws_beta")
                && statusBar.selectedWorkspaceID == "ws_beta"
                && (try harness.uiLevel(of: deck)) == "workspace",
            "choosing another workspace did not enter its terminal deck"
        )
        try expect(
            statusBar.chooseTerminal("term_beta_1")
                && (try harness.focusedTileID(of: deck)) == "tile_beta_1",
            "the terminal dropdown did not follow the selected workspace"
        )
    }

    private static func commandPlusAndMinusMagnifyTheCurrentLevel() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 2)])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        deck.layoutSubtreeIfNeeded()

        guard let camera = deck.subviews.first else {
            throw InteractionTestFailure("the deck did not install its camera scene")
        }
        let initialLevel = try harness.uiLevel(of: deck)
        let initialWidth = camera.bounds.width

        deck.magnifyCamera()
        RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        try expect(
            try harness.uiLevel(of: deck) == initialLevel,
            "⌘+ changed the workspace hierarchy level"
        )
        try expect(camera.bounds.width < initialWidth, "⌘+ did not magnify the camera")
        let zoomInIncrement = initialWidth / camera.bounds.width - 1

        deck.resetCameraMagnification()
        RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        try expect(
            abs(camera.bounds.width - initialWidth) < 0.5,
            "⌘0 did not reset the camera magnification"
        )

        deck.demagnifyCamera()
        RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        try expect(
            try harness.uiLevel(of: deck) == initialLevel,
            "⌘− changed the workspace hierarchy level"
        )
        try expect(camera.bounds.width > initialWidth, "⌘− did not demagnify the camera")
        let zoomOutIncrement = 1 - initialWidth / camera.bounds.width
        try expect(
            abs(zoomInIncrement - zoomOutIncrement) < 0.001,
            "⌘+ and ⌘− changed magnification by different amounts"
        )

        deck.resetCameraMagnification()
        RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        try expect(
            try harness.uiLevel(of: deck) == initialLevel
                && abs(camera.bounds.width - initialWidth) < 0.5,
            "⌘0 changed hierarchy level or did not restore actual size"
        )
    }

    private static func configuredShortcutsNavigateHierarchy() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 2),
        ])
        let shortcut = DesktopShortcutMonitor(
            shortcuts: MachinenConfiguration.defaults.shortcuts,
            startMonitoring: false
        ) { [weak deck] action in
            deck?.performShortcut(action) == true
        }
        defer { shortcut.stop() }

        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 125)) == nil
                && (try harness.uiLevel(of: deck)) == "workspace",
            "the enter shortcut did not enter the workspace"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 125)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_0",
            "the enter shortcut did not focus the first pane"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 124)) == nil,
            "the next-pane shortcut was not handled at terminal level"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_1",
            "the next-pane shortcut did not focus the next terminal"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 123)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_0",
            "the previous-pane shortcut did not focus the previous terminal"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 123)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_1",
            "the previous-pane shortcut did not wrap within the workspace"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 124)) == nil,
            "the wrapping next-pane shortcut was not handled"
        )
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_0",
            "the next-pane shortcut did not wrap within the workspace"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 124)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_1",
            "the second terminal was not made active in the first workspace"
        )
        try expect(
            shortcut.process(harness.commandShiftBracket(keyCode: 33)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_beta_0",
            "the previous-workspace shortcut did not wrap to the final workspace"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 124)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_beta_1",
            "the second terminal was not made active in the final workspace"
        )
        try expect(
            shortcut.process(harness.commandShiftBracket(keyCode: 30)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_1",
            "workspace cycling did not restore the first workspace's active terminal"
        )
        try expect(
            shortcut.process(harness.commandShiftBracket(keyCode: 30)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_beta_1",
            "workspace cycling did not restore the final workspace's active terminal"
        )
        try expect(
            shortcut.process(harness.commandShiftBracket(keyCode: 30)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_1",
            "the wrapping workspace shortcut did not preserve the active terminal"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 126)) == nil
                && (try harness.uiLevel(of: deck)) == "workspace",
            "the leave shortcut did not leave the focused pane"
        )
    }

    private static func paneAndWorkspaceShortcutsTransitionAtFixedZoom() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 1),
        ])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        deck.layoutSubtreeIfNeeded()

        deck.zoomInOneLevel()
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        deck.zoomInOneLevel()
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_0",
            "the first terminal was not focused before direct pane movement"
        )
        guard let camera = deck.subviews.first else {
            throw InteractionTestFailure("the deck did not install its camera scene")
        }
        guard let statusBar = deck.subviews.compactMap({
            $0 as? MachinenStatusBarView
        }).first else {
            throw InteractionTestFailure("the deck did not install its status bar")
        }
        guard let minimap = deck.subviews.compactMap({
            $0 as? SpatialMinimapView
        }).first else {
            throw InteractionTestFailure("the deck did not install its spatial minimap")
        }
        let statusMinimap = statusBar.spatialMinimapForTesting
        statusBar.display()
        try expect(minimap.isHidden, "the spatial minimap was visible while the camera was idle")
        try expect(
            !statusMinimap.isHidden
                && statusMinimap.frame.size == NSSize(width: 56, height: 26)
                && statusMinimap.representedWorkspaceCount == 2
                && statusMinimap.representedPaneCount == 3
                && !statusMinimap.rendersPaneDetail
                && statusMinimap.rendersPaneBlocks
                && statusMinimap.usesPixelArtPresentation
                && statusMinimap.usesMonochromePixelPalette
                && statusMinimap.pixelArtWorkspaceGap == 1
                && statusMinimap.pixelArtPaneGap == 1
                && !minimap.rendersPaneDetail
                && minimap.rendersPaneBlocks
                && minimap.usesPixelArtPresentation
                && minimap.usesMonochromePixelPalette
                && minimap.pixelArtWorkspaceGap == statusMinimap.pixelArtWorkspaceGap
                && minimap.pixelArtPaneGap == statusMinimap.pixelArtPaneGap,
            "the large and status minimaps did not share the pixel-art presentation"
        )
        try expect(
            abs(minimap.frame.maxX - (deck.bounds.maxX - 18)) < 0.5
                && abs(minimap.frame.minY - (statusBar.frame.maxY + 12)) < 0.5,
            "the large minimap was not anchored below the status bar at the right edge"
        )
        let statusWidgetFrames = statusBar.widgetFramesForTesting
        try expect(
            abs(statusMinimap.frame.maxX - (statusBar.bounds.maxX - 14)) < 0.5
                && statusBar.navigationTitleFrameForTesting.maxX < statusMinimap.frame.minX
                && !statusWidgetFrames.isEmpty
                && statusWidgetFrames.allSatisfy { $0.maxX < statusMinimap.frame.minX },
            "the status minimap was not the final item at the right edge"
        )
        let minimapHoverPoint = NSPoint(x: statusMinimap.frame.midX, y: statusMinimap.frame.midY)
        try expect(
            statusBar.hitTest(minimapHoverPoint) === statusBar,
            "the status minimap did not accept read-only hover tracking"
        )
        _ = statusBar.hoverText(at: minimapHoverPoint)
        try expect(
            !minimap.isHidden && minimap.alphaValue > 0.99,
            "hovering the status minimap did not reveal the large minimap"
        )
        _ = statusBar.hoverText(at: .zero)
        RunLoop.current.run(until: Date().addingTimeInterval(0.38))
        try expect(
            minimap.isHidden,
            "the hover-previewed large minimap did not fade after the pointer left"
        )
        let initialCameraBounds = camera.bounds

        try expect(deck.cycleFocusedTerminal(by: 1), "the next-pane action was not accepted")
        let initialMinimapCameraBounds = minimap.representedCameraBounds
        try expect(
            try harness.uiLevel(of: deck) == "terminal"
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_1",
            "pane switching zoomed out instead of focusing the destination directly"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        let middleCameraBounds = camera.bounds
        try expect(
            abs(middleCameraBounds.minX - initialCameraBounds.minX) > 0.5
                || abs(middleCameraBounds.minY - initialCameraBounds.minY) > 0.5,
            "pane switching did not begin moving toward the destination"
        )
        try expect(
            abs(middleCameraBounds.width - initialCameraBounds.width) < 0.5
                && abs(middleCameraBounds.height - initialCameraBounds.height) < 0.5,
            "pane switching changed the camera zoom during the pan"
        )
        try expect(
            !minimap.isHidden && minimap.alphaValue > 0.9
                && minimap.representedWorkspaceCount == 2
                && minimap.representedPaneCount == 3
                && (abs(minimap.representedCameraBounds.minX - initialMinimapCameraBounds.minX) > 0.5
                    || abs(minimap.representedCameraBounds.minY - initialMinimapCameraBounds.minY) > 0.5),
            "the spatial minimap did not represent and animate the complete scene"
        )
        guard let representedPane = minimap.representedWorkspaces.first?.panes.first,
              let mappedPane = minimap.mappedRepresentation(of: representedPane.frame)
        else {
            throw InteractionTestFailure("the spatial minimap did not map its first pane")
        }
        try expect(
            abs(mappedPane.width / representedPane.frame.width
                - mappedPane.height / representedPane.frame.height) < 0.001,
            "the spatial minimap did not preserve a uniform 1:1 scene scale"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.20))
        try expect(
            abs(camera.bounds.minX - middleCameraBounds.minX) > 0.5
                || abs(camera.bounds.minY - middleCameraBounds.minY) > 0.5,
            "pane switching finished too abruptly instead of continuing its pan"
        )
        try expect(
            abs(camera.bounds.width - initialCameraBounds.width) < 0.5
                && abs(camera.bounds.height - initialCameraBounds.height) < 0.5,
            "pane switching changed the camera zoom at the destination"
        )
        try expect(
            !minimap.isHidden && minimap.alphaValue > 0.99 && !statusMinimap.isHidden,
            "the minimap did not hold at full opacity after pane movement"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        try expect(
            !minimap.isHidden && minimap.alphaValue > 0.99 && !statusMinimap.isHidden,
            "the transient minimap faded before its hold completed"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(1.25))
        try expect(
            minimap.isHidden && !statusMinimap.isHidden,
            "the transient minimap did not fade after its hold"
        )

        let workspaceInitialCameraBounds = camera.bounds
        try expect(
            deck.cycleFocusedWorkspace(by: 1)
                && (try harness.uiLevel(of: deck)) == "terminal"
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_1",
            "workspace switching left Terminal mode during its outgoing slide"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.04))
        let workspaceExitCameraBounds = camera.bounds
        try expect(
            abs(workspaceExitCameraBounds.minX - workspaceInitialCameraBounds.minX) > 0.5
                && camera.alphaValue < 0.95,
            "workspace switching did not slide and fade the source pane"
        )
        try expect(
            abs(workspaceExitCameraBounds.width - workspaceInitialCameraBounds.width) < 0.5
                && abs(workspaceExitCameraBounds.height - workspaceInitialCameraBounds.height) < 0.5,
            "workspace switching changed zoom during its outgoing slide"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.07))
        try expect(
            try harness.uiLevel(of: deck) == "terminal"
                && (try harness.focusedTileID(of: deck)) == "tile_beta_0"
                && camera.alphaValue < 0.95,
            "workspace switching traversed the scene hierarchy instead of revealing directly"
        )
        let workspaceEntryCameraBounds = camera.bounds
        RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        try expect(
            camera.alphaValue > 0.99
                && abs(camera.bounds.width - workspaceEntryCameraBounds.width) < 0.5
                && abs(camera.bounds.height - workspaceEntryCameraBounds.height) < 0.5,
            "workspace switching changed zoom while revealing the destination"
        )
        try expect(
            !minimap.isHidden && minimap.alphaValue > 0.99 && !statusMinimap.isHidden,
            "the workspace minimap did not hold at full opacity"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        try expect(
            !minimap.isHidden && minimap.alphaValue > 0.99,
            "the workspace minimap faded before its hold completed"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(1.25))
        try expect(
            minimap.isHidden && !statusMinimap.isHidden
                && statusMinimap.representedWorkspaces.contains(where: {
                    $0.id == "ws_beta" && $0.isActive
                }),
            "the tiny status minimap did not persist at the destination workspace"
        )

        let switchedSingletonCameraBounds = camera.bounds
        try expect(deck.zoomOutOneLevel(), "the singleton pane could not be left")
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        try expect(deck.zoomInOneLevel(), "the singleton pane could not be re-entered")
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        try expect(
            abs(camera.bounds.width - switchedSingletonCameraBounds.width) < 0.5
                && abs(camera.bounds.height - switchedSingletonCameraBounds.height) < 0.5,
            "workspace switching did not use the singleton pane's fitted framing"
        )
        try expect(
            deck.cycleFocusedWorkspace(by: -1)
                && (try harness.focusedTileID(of: deck)) == "tile_beta_0",
            "the return workspace transition did not begin from the active terminal"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.10))
        try expect(
            try harness.focusedTileID(of: deck) == "tile_alpha_1",
            "workspace switching did not restore the prior active terminal"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        try expect(
            abs(camera.bounds.width - workspaceInitialCameraBounds.width) < 0.5
                && abs(camera.bounds.height - workspaceInitialCameraBounds.height) < 0.5,
            "returning to the multi-pane workspace did not restore its fitted framing"
        )

        let statusPaneInitialCameraBounds = camera.bounds
        try expect(
            statusBar.chooseTerminal("term_alpha_0")
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_0",
            "the status bar did not begin a direct pane transition"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        try expect(
            (abs(camera.bounds.minX - statusPaneInitialCameraBounds.minX) > 0.5
                || abs(camera.bounds.minY - statusPaneInitialCameraBounds.minY) > 0.5)
                && abs(camera.bounds.width - statusPaneInitialCameraBounds.width) < 0.5
                && abs(camera.bounds.height - statusPaneInitialCameraBounds.height) < 0.5,
            "the status-bar terminal item did not use the fixed-zoom pane pan"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.20))

        try expect(
            statusBar.chooseWorkspace("ws_beta")
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_0",
            "the status bar did not begin from the current terminal"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.04))
        try expect(
            camera.alphaValue < 0.95 && (try harness.uiLevel(of: deck)) == "terminal",
            "the status-bar workspace item did not slide and fade the source pane"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.07))
        let statusWorkspaceEntryCameraBounds = camera.bounds
        try expect(
            camera.alphaValue < 0.95
                && (try harness.focusedTileID(of: deck)) == "tile_beta_0",
            "the status-bar workspace item did not reveal the destination directly"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        try expect(
            camera.alphaValue > 0.99
                && abs(camera.bounds.width - statusWorkspaceEntryCameraBounds.width) < 0.5
                && abs(camera.bounds.height - statusWorkspaceEntryCameraBounds.height) < 0.5,
            "the status-bar workspace transition changed zoom during its entry slide"
        )
    }

    private static func configuredShortcutsSelectAndMoveSpatialObjects() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 2),
            harness.workspace("beta", terminalCount: 1),
        ])
        let shortcut = DesktopShortcutMonitor(
            shortcuts: MachinenConfiguration.defaults.shortcuts,
            startMonitoring: false
        ) { [weak deck] action in
            deck?.performShortcut(action) == true
        }
        defer { shortcut.stop() }

        try expect(
            shortcut.process(
                try harness.keyEvent(characters: "", keyCode: 124, modifierFlags: [])
            ) == nil && (try harness.statusTitle(of: deck)) == "beta",
            "the select-right shortcut did not select the next workspace"
        )
        try expect(
            shortcut.process(
                try harness.keyEvent(characters: "", keyCode: 123, modifierFlags: [])
            ) == nil && (try harness.statusTitle(of: deck)) == "alpha",
            "the select-left shortcut did not restore the first workspace"
        )
        try expect(
            shortcut.process(
                try harness.keyEvent(
                    characters: "",
                    keyCode: 124,
                    modifierFlags: [.shift]
                )
            ) == nil && (try harness.snapshot(of: deck)).workspaces.map(\.name) == ["beta", "alpha"],
            "the move-right shortcut did not reorder the selected workspace"
        )
        try expect(
            shortcut.process(
                try harness.keyEvent(
                    characters: "",
                    keyCode: 123,
                    modifierFlags: [.shift]
                )
            ) == nil && (try harness.snapshot(of: deck)).workspaces.map(\.name) == ["alpha", "beta"],
            "the move-left shortcut did not restore the workspace order"
        )

        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 125)) == nil
                && (try harness.uiLevel(of: deck)) == "workspace",
            "the enter shortcut did not enter the reordered workspace"
        )
        try expect(
            shortcut.process(
                try harness.keyEvent(
                    characters: "",
                    keyCode: 125,
                    modifierFlags: [.shift]
                )
            ) == nil
                && (try harness.snapshot(of: deck)).tiles.prefix(2).map(\.id)
                    == ["tile_alpha_1", "tile_alpha_0"],
            "the move-down shortcut did not reorder panes inside the workspace"
        )
        try expect(
            shortcut.process(
                try harness.keyEvent(characters: "", keyCode: 126, modifierFlags: [])
            ) == nil,
            "the select-up shortcut was not handled inside the workspace"
        )
        try expect(
            shortcut.process(harness.commandShiftArrow(keyCode: 125)) == nil
                && (try harness.focusedTileID(of: deck)) == "tile_alpha_1",
            "enter did not focus the pane chosen with a selection shortcut"
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

        let nestedShellDetector = TerminalActivityDetector(session: session) { completion in
            completion(TerminalTelemetry(
                activity: .working,
                shellPid: 42,
                processPid: 84,
                shellName: "zsh",
                command: "bash"
            ))
        }
        var nestedShellActivity: TerminalSession.ActivityState?
        nestedShellDetector.onActivityChange = { nestedShellActivity = $0 }
        nestedShellDetector.start()
        defer { nestedShellDetector.stop() }
        try expect(
            nestedShellActivity == .idle,
            "an idle nested shell was incorrectly reported as active"
        )
        nestedShellDetector.recordOutput()
        try expect(
            nestedShellActivity == .idle,
            "renderer redraws incorrectly marked an idle nested shell active"
        )

        let sshDetector = TerminalActivityDetector(session: session) { completion in
            completion(TerminalTelemetry(
                activity: .working,
                shellPid: 42,
                processPid: 84,
                shellName: "zsh",
                command: "ssh"
            ))
        }
        var sshActivity: TerminalSession.ActivityState?
        sshDetector.onActivityChange = { sshActivity = $0 }
        sshDetector.start()
        defer { sshDetector.stop() }
        try expect(sshActivity == .idle, "an interactive SSH prompt was reported as active")
        sshDetector.recordOutput()
        try expect(sshActivity == .working, "SSH output did not report transient activity")

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
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.borderless],
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
        guard let terminalTile = descendants(of: deck, as: TerminalTileView.self).first else {
            throw InteractionTestFailure("the status test could not find its terminal")
        }
        terminalTile.updateProcessInfo(TerminalProcessInfo(shellPID: 4201, processPID: 4242))
        _ = try deck.performAPIOperation("tile.update", params: [
            "tileId": terminalTile.session.tileID,
            "activityState": "idle",
        ])
        guard let statusBar = descendants(of: deck, as: MachinenStatusBarView.self).first,
              let largeMinimap = deck.subviews.first(where: {
                  $0.identifier?.rawValue == "spatial-minimap"
              }) as? SpatialMinimapView
        else {
            throw InteractionTestFailure("the activity test could not find both minimaps")
        }
        let miniMinimap = statusBar.spatialMinimapForTesting
        try expect(
            largeMinimap.representedActivityStates == [.idle]
                && miniMinimap.representedActivityStates == [.idle],
            "idle terminal activity was not represented spatially in both minimaps"
        )
        try expect(
            largeMinimap.outerCornerRadius == 6 && miniMinimap.outerCornerRadius == 6,
            "the minimap activity indicators did not use rounded outer corners"
        )
        _ = try deck.performAPIOperation("tile.update", params: [
            "tileId": terminalTile.session.tileID,
            "activityState": "working",
        ])
        try expect(
            largeMinimap.representedActivityStates == [.working]
                && miniMinimap.representedActivityStates == [.working],
            "working terminal activity was not represented spatially in both minimaps"
        )
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
        try expect(
            effective.allSatisfy { $0.id != "machinen.activity" }
                && statusBar.widgets.allSatisfy { $0.id != "machinen.activity" },
            "the redundant built-in activity widget remained in the status bar"
        )
        _ = try deck.performAPIOperation("status.set", params: [
            "id": "network.graph",
            "kind": "sparkline",
            "graphStyle": "mirrored",
            "samples": [1, 4, 2],
            "secondarySamples": [2, 1, 3],
            "tooltip": "network transfer",
            "links": [["title": "Open dashboard", "url": "http://localhost:3000"]],
        ])
        effective = try harness.effectiveStatusWidgets(of: deck)
        let graph = effective.first(where: { $0.id == "network.graph" })
        try expect(graph?.graphStyle == "mirrored", "the graphical widget style was not retained")
        try expect(graph?.samples == [1, 4, 2], "the graphical widget samples were not retained")
        try expect(
            graph?.links?.first == .init(title: "Open dashboard", url: "http://localhost:3000"),
            "the graphical widget link was not retained"
        )

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

    private static func selectionOpenersRegisterMatchAndExpire() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 1)])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_200, height: 760),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        deck.layoutSubtreeIfNeeded()
        var openerInvocations: [JSONObject] = []
        deck.onAPIEvent = { event, data in
            if event == "selectionOpener.invoked" { openerInvocations.append(data) }
        }
        _ = try deck.performAPIOperation("selectionOpener.set", params: [
            "id": "test.markdown",
            "title": "Open Markdown",
            "subtitle": "Glow",
            "selectionPattern": "\\.(?:md|markdown)$",
            "locationKinds": ["local"],
            "priority": 100,
        ])
        let result = try deck.performAPIOperation("selectionOpener.list", params: [:])
        let openers = (result as? JSONObject)?["openers"] as? [JSONObject]
        try expect(
            openers?.first?["id"] as? String == "test.markdown",
            "the selection opener was not listed"
        )
        try expect(
            MachinenSelectionOpener(
                id: "test.markdown",
                title: "Open Markdown",
                subtitle: nil,
                selectionPattern: "\\.(?:md|markdown)$",
                locationKinds: [.local],
                priority: 100,
                expiresAt: nil
            ).matches(selection: "docs/guide.md", location: .local("/project")),
            "the selection opener did not match a Markdown selection"
        )
        try expect(
            !MachinenSelectionOpener(
                id: "test.local",
                title: "Local only",
                subtitle: nil,
                selectionPattern: nil,
                locationKinds: [.local],
                priority: 100,
                expiresAt: nil
            ).matches(selection: "docs/guide.md", location: .ssh(host: "mini", path: "/project")),
            "a local-only selection opener matched an SSH workspace"
        )
        do {
            _ = try deck.performAPIOperation("selectionOpener.set", params: [
                "id": "test.invalid",
                "title": "Invalid",
                "selectionPattern": "[",
            ])
            throw InteractionTestFailure("an invalid selection opener pattern was accepted")
        } catch let error as MachinenAPIError {
            try expect(error.code == "invalid_params", "an invalid pattern returned the wrong API error")
        }
        guard let tile = harness.terminalTile(in: deck), let terminal = tile.terminalResponder else {
            throw InteractionTestFailure("the selection opener test did not create a terminal")
        }
        let menu = deck.terminalContextMenu(
            for: terminal,
            tile: tile,
            selection: "docs/guide.md"
        )
        try expect(
            menu.items.filter { !$0.isSeparatorItem }.map(\.title)
                == ["Open Selection With", "Copy", "Paste", "Select All"],
            "the terminal context menu did not include every terminal action"
        )
        let openItem = menu.items.first { $0.title == "Open Selection With" }
        try expect(
            openItem?.submenu?.items.first?.title == "Open Markdown",
            "the terminal context menu did not include the registered opener"
        )
        let noSelectionMenu = deck.terminalContextMenu(
            for: terminal,
            tile: tile,
            selection: nil
        )
        try expect(
            noSelectionMenu.items.filter { !$0.isSeparatorItem }.map(\.title)
                == ["Open Selection With", "Copy", "Paste", "Select All"],
            "the keyboard terminal menu hid actions when no text was selected"
        )
        try expect(
            noSelectionMenu.items.first { $0.title == "Open Selection With" }?.isEnabled == false,
            "Open Selection With remained enabled without a selection"
        )

        deck.showSelectionOpenerPalette(
            for: terminal,
            tile: tile,
            selection: "docs/guide.md"
        )
        let openerPalette = try harness.commandPalette(in: deck)
        try expect(
            openerPalette.displayedContext == "terminal · shell 1 · alpha",
            "the selection opener palette lost its terminal context"
        )
        try harness.pressEscape(on: openerPalette)
        let returnedCommands = try harness.commandPalette(in: deck)
        try expect(
            !returnedCommands.displayedSpaces.isEmpty,
            "Escape from selection openers did not return to commands"
        )
        try harness.pressEscape(on: returnedCommands)

        deck.showSelectionOpenerPalette(
            for: terminal,
            tile: tile,
            selection: "docs/guide.md"
        )
        try harness.type("Open Markdown", into: harness.commandPalette(in: deck))
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        try expect(
            openerInvocations.last?["openerId"] as? String == "test.markdown"
                && openerInvocations.last?["selection"] as? String == "docs/guide.md"
                && openerInvocations.last?["terminalId"] as? String == tile.session.id,
            "the command palette did not invoke the selected opener"
        )

        _ = try deck.performAPIOperation("selectionOpener.remove", params: ["id": "test.markdown"])
        let empty = try deck.performAPIOperation("selectionOpener.list", params: [:])
        let remaining = (empty as? JSONObject)?["openers"] as? [JSONObject]
        try expect(remaining?.isEmpty == true, "the removed selection opener remained registered")
    }

    private static func contextCommandsUseWorkspaceAndOSC7TerminalDirectories() throws {
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
        deck.layoutSubtreeIfNeeded()
        guard let tile = harness.terminalTile(in: deck), let terminal = tile.terminalResponder else {
            throw InteractionTestFailure("the context command test did not create a terminal")
        }

        var invocations: [JSONObject] = []
        deck.onAPIEvent = { event, data in
            if event == "command.invoked" { invocations.append(data) }
        }
        _ = try deck.performAPIOperation("command.set", params: [
            "id": "test.workspace",
            "title": "Run in workspace",
            "context": "workspace",
            "priority": 100,
        ])
        _ = try deck.performAPIOperation("command.set", params: [
            "id": "test.terminal",
            "title": "Run in terminal directory",
            "subtitle": "OSC 7 cwd",
            "context": "terminal",
            "priority": 90,
        ])
        _ = try deck.performAPIOperation("command.set", params: [
            "id": "test.open-in-glow",
            "title": "Glow",
            "group": "Open in…",
            "context": "terminal",
            "priority": 110,
        ])
        _ = try deck.performAPIOperation("command.set", params: [
            "id": "test.open-in-yazi",
            "title": "Yazi",
            "group": "Open in…",
            "context": "terminal",
            "priority": 110,
        ])

        let liveDirectory = harness.temporaryDirectoryPath + "/live cwd"
        terminal.ghosttyWorkingDirectoryChanged(liveDirectory)
        let snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.terminals.first?.currentWorkingDirectory == liveDirectory,
            "OSC 7 did not update the terminal's current working directory"
        )
        try expect(
            harness.loadStoredState().sessions.first?.currentWorkingDirectory == liveDirectory,
            "the last OSC 7 directory was not persisted"
        )
        try expect(
            MachinenTerminalView.normalizedOSC7WorkingDirectory("relative/path") == nil,
            "a relative OSC 7 path was accepted"
        )

        deck.toggleCommandPalette()
        let overviewPalette = try harness.commandPalette(in: deck)
        try expect(
            overviewPalette.displayedContext == "workspace overview"
                && overviewPalette.displayedSpaces == [.workspaceOverview],
            "the workspace overview palette exposed commands from a deeper space"
        )
        try harness.pressEscape(on: overviewPalette)

        deck.zoomInOneLevel()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        deck.toggleCommandPalette()
        let workspaceLevelPalette = try harness.commandPalette(in: deck)
        try expect(
            workspaceLevelPalette.displayedContext == "workspace · alpha"
                && workspaceLevelPalette.displayedSpaces == [.workspace, .workspaceOverview],
            "the workspace palette did not cascade through workspace and overview commands"
        )
        try harness.type("New terminal", into: workspaceLevelPalette)
        try harness.pressReturn(on: workspaceLevelPalette)
        let newTerminalPalette = try harness.commandPalette(in: deck)
        try expect(
            newTerminalPalette.displayedContext == "workspace: alpha",
            "New terminal did not open as a nested workspace command"
        )
        try harness.pressEscape(on: newTerminalPalette)
        let returnedWorkspacePalette = try harness.commandPalette(in: deck)
        try expect(
            returnedWorkspacePalette.displayedContext == "workspace · alpha",
            "Escape from New terminal did not return to commands"
        )
        try harness.pressEscape(on: returnedWorkspacePalette)

        deck.zoomInOneLevel()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        deck.toggleCommandPalette()
        let terminalPalette = try harness.commandPalette(in: deck)
        try expect(
            terminalPalette.displayedContext == "terminal · shell 1 · alpha"
                && terminalPalette.displayedSpaces
                    == [.terminal, .workspace, .workspaceOverview],
            "the terminal palette did not cascade through all three command spaces"
        )
        try harness.type("Open in", into: terminalPalette)
        try harness.pressReturn(on: terminalPalette)
        let openInPalette = try harness.commandPalette(in: deck)
        try expect(
            openInPalette.displayedContext == "current directory · shell 1 · alpha",
            "the grouped command palette did not describe its terminal directory target"
        )
        try harness.pressEscape(on: openInPalette)
        let returnedTerminalPalette = try harness.commandPalette(in: deck)
        try expect(
            returnedTerminalPalette.displayedContext == "terminal · shell 1 · alpha",
            "Escape from a grouped command did not return to commands"
        )
        try harness.type("Open in", into: returnedTerminalPalette)
        try harness.pressReturn(on: returnedTerminalPalette)
        let reopenedOpenInPalette = try harness.commandPalette(in: deck)
        try harness.type("Yazi", into: reopenedOpenInPalette)
        try harness.pressReturn(on: reopenedOpenInPalette)
        try expect(
            invocations.last?["commandId"] as? String == "test.open-in-yazi"
                && invocations.last?["context"] as? String == "terminal"
                && invocations.last?["workingDirectory"] as? String == liveDirectory
                && invocations.last?["terminalId"] as? String == tile.session.id,
            "the grouped terminal command did not receive the OSC 7 directory context"
        )

        deck.toggleCommandPalette()
        let terminalCommandPalette = try harness.commandPalette(in: deck)
        try harness.type("Run in terminal directory", into: terminalCommandPalette)
        try harness.pressReturn(on: terminalCommandPalette)
        try expect(
            invocations.last?["commandId"] as? String == "test.terminal"
                && invocations.last?["context"] as? String == "terminal"
                && invocations.last?["workingDirectory"] as? String == liveDirectory
                && invocations.last?["terminalId"] as? String == tile.session.id,
            "the terminal command did not receive the OSC 7 directory context"
        )

        deck.toggleCommandPalette()
        let workspacePalette = try harness.commandPalette(in: deck)
        try harness.type("Run in workspace", into: workspacePalette)
        try harness.pressReturn(on: workspacePalette)
        try expect(
            invocations.last?["commandId"] as? String == "test.workspace"
                && invocations.last?["context"] as? String == "workspace"
                && invocations.last?["workingDirectory"] as? String
                    == harness.temporaryDirectoryPath
                && invocations.last?["terminalId"] == nil,
            "the workspace command did not receive the workspace's default location"
        )

        _ = try deck.performAPIOperation("command.remove", params: ["id": "test.workspace"])
        _ = try deck.performAPIOperation("command.remove", params: ["id": "test.terminal"])
        _ = try deck.performAPIOperation("command.remove", params: ["id": "test.open-in-glow"])
        _ = try deck.performAPIOperation("command.remove", params: ["id": "test.open-in-yazi"])
        let result = try deck.performAPIOperation("command.list", params: [:])
        let commands = (result as? JSONObject)?["commands"] as? [JSONObject]
        try expect(commands?.isEmpty == true, "removed context commands remained registered")

        deck.toggleCommandPalette()
        let disconnectTerminalPalette = try harness.commandPalette(in: deck)
        try harness.type("Disconnect terminal", into: disconnectTerminalPalette)
        try harness.pressReturn(on: disconnectTerminalPalette)
        let closedSnapshot = try harness.snapshot(of: deck)
        try expect(
            closedSnapshot.tiles.count == 1 && deck.canReopenClosedTerminal,
            "Disconnect terminal did not remove the tile while retaining its session"
        )
    }

    private static func availableNativeSessionsReconnectIntoWorkspace() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        harness.setAvailableSessions([
            AvailableTerminalSession(
                id: "term_external",
                name: "agent",
                state: "running",
                workspaceId: "ws_alpha",
                workingDirectory: harness.temporaryDirectoryPath + "/nested",
                createdAtMs: 1,
                updatedAtMs: 3
            ),
            AvailableTerminalSession(
                id: "term_elsewhere",
                name: "elsewhere",
                state: "running",
                workspaceId: "ws_elsewhere",
                workingDirectory: "/var/empty/elsewhere",
                createdAtMs: 1,
                updatedAtMs: 2
            ),
            AvailableTerminalSession(
                id: "term_exited",
                name: "finished",
                state: "exited",
                workspaceId: "ws_alpha",
                workingDirectory: harness.temporaryDirectoryPath,
                createdAtMs: 1,
                updatedAtMs: 1
            ),
        ])
        let alpha = harness.workspace("alpha", terminalCount: 1)
        alpha.1.forEach { $0.state = .running }
        let deck = harness.makeDeck(workspaces: [alpha])

        let status = try harness.effectiveStatusWidgets(of: deck)
        try expect(
            status.first(where: { $0.id == "machinen.availableSessions" })?.value == "1",
            "the status bar did not show the unrepresented workspace session"
        )

        deck.toggleAvailableSessions()
        let manager = try harness.availableSessions(in: deck)
        try expect(
            manager.items.map(\.session.id) == ["term_external", "term_alpha_0"],
            "the session picker did not include every workspace session"
        )
        try expect(
            manager.items.first?.attachmentState == .detached
                && manager.items.last?.attachmentState == .attached,
            "the session picker did not distinguish attached and unattached sessions"
        )
        try harness.pressReturn(on: manager)

        var snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.terminals.map(\.id).contains("term_external"),
            "reconnecting did not create a tile for the existing native session"
        )
        try expect(
            harness.loadStoredState().sessions.first(where: { $0.id == "term_external" })?
                .startsSessionIfMissing == false,
            "the imported session could be replaced with an invented command"
        )
        try expect(
            !(try harness.effectiveStatusWidgets(of: deck)).contains {
                $0.id == "machinen.availableSessions"
            },
            "the represented session remained available in the status bar"
        )

        deck.toggleAvailableSessions()
        let allSessions = try harness.availableSessions(in: deck)
        try expect(
            allSessions.items.count == 2 && allSessions.items.allSatisfy { $0.isAttached },
            "the session picker did not show every attached workspace session"
        )
        try harness.pressReturn(on: allSessions)
        snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.terminals.count == 1 && deck.canReopenClosedTerminal,
            "disconnecting from the session picker did not remove the Desktop tile"
        )
        try expect(
            allSessions.items.first?.attachmentState == .detached,
            "the disconnected session did not remain visible in the session picker"
        )
        try harness.pressReturn(on: allSessions)
        snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.terminals.count == 2,
            "the session picker did not reconnect the disconnected session"
        )

        guard let detachedTileID = snapshot.tiles.first?.id,
              let detachedTile = try deck.performAPIOperation(
                  "tile.get",
                  params: ["tileId": snapshot.tiles.first?.id ?? ""]
              ) as? JSONObject,
              let detachedTerminalID = detachedTile["terminalId"] as? String
        else { throw InteractionTestFailure("the deck had no tile to detach") }
        _ = try deck.performAPIOperation("tile.detach", params: ["tileId": detachedTileID])
        deck.toggleAvailableSessions()
        let detachedSessions = try harness.availableSessions(in: deck)
        try expect(
            detachedSessions.items.first(where: { $0.session.id == detachedTerminalID })?
                .attachmentState == .detached,
            "the session picker marked a detached viewer as attached"
        )
        try harness.pressReturn(on: detachedSessions)
        let reattachedTile = try deck.performAPIOperation(
            "tile.get",
            params: ["tileId": detachedTileID]
        ) as? JSONObject
        try expect(
            reattachedTile?["viewerState"] as? String == "attached"
                && (try harness.snapshot(of: deck)).tiles.count == 2,
            "attaching from the session picker duplicated or failed to attach the tile"
        )
    }

    private static func attachedSessionCanTakeControl() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let alpha = harness.workspace("alpha", terminalCount: 1)
        guard let terminal = alpha.1.first else {
            throw InteractionTestFailure("the takeover fixture had no terminal")
        }
        terminal.state = .running
        harness.setAvailableSessions([
            AvailableTerminalSession(
                id: terminal.id,
                name: terminal.name,
                state: "running",
                workspaceId: terminal.workspaceID,
                workingDirectory: terminal.workingDirectory,
                clientControlAvailable: true,
                clients: [
                    AttachedTerminalClient(
                        id: 99,
                        name: "Machinen Desktop on another Mac",
                        pid: 10,
                        connectedAtMs: 1,
                        writer: true,
                        resize: true,
                        readOnly: false
                    ),
                    AttachedTerminalClient(
                        id: terminal.viewerClientID,
                        name: "Machinen Desktop on this Mac",
                        pid: 20,
                        connectedAtMs: 2,
                        writer: false,
                        resize: false,
                        readOnly: false
                    ),
                ],
                createdAtMs: 1,
                updatedAtMs: 2
            ),
        ])
        let deck = harness.makeDeck(workspaces: [alpha])
        let status = try harness.effectiveStatusWidgets(of: deck)
        let controlStatus = status.first { $0.id == "machinen.sessionControl" }
        try expect(
            controlStatus?.value == "VIEWING +1"
                && controlStatus?.tooltip?.contains("Machinen Desktop on another Mac") == true,
            "the status bar did not show control ownership and the other viewer"
        )
        deck.toggleTargetSessions(selecting: terminal.id)
        let browser = try harness.targetSessions(in: deck)
        try expect(
            browser.items.first(where: { $0.sessionID == terminal.id })?.sessionAction
                == .takeControl,
            "the shared workspace tree did not offer control for the attached watcher"
        )
        try harness.pressReturn(on: browser)
        try harness.pressReturn(on: browser)
        try expect(
            harness.takenControlSessionIDs == [terminal.id],
            "the shared workspace tree did not request control for its own attachment"
        )
    }

    private static func sharedSessionGeometryFollowsItsController() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let workspace = harness.workspace("geometry", terminalCount: 1)
        guard let session = workspace.1.first else {
            throw InteractionTestFailure("the geometry fixture had no terminal")
        }
        session.state = .running
        let terminal = MachinenTerminalView(
            session: session,
            terminalBackend: harness.backend,
            telemetryProvider: { completion in completion(nil) }
        )
        terminal.ghosttyTitleChanged(
            "machinen.geometry:v1:239:59:8:99:\(session.viewerClientID):0:149:42"
        )
        try expect(
            terminal.sessionGeometry == TerminalGeometry(
                columns: 239,
                rows: 59,
                generation: 8,
                ownerClientId: 99
            ),
            "the viewer did not accept the worker's authoritative geometry"
        )
        let pixels = MachinenTerminalView.authoritativeSurfacePixelSize(
            viewportSize: NSSize(width: 1_200, height: 720),
            backingScale: 2,
            cellSize: NSSize(width: 16, height: 34),
            geometry: terminal.sessionGeometry!,
            localColumns: 149,
            localRows: 42
        )
        try expect(
            pixels.width == 3_840 && pixels.height == 2_018
                && terminal.rendersAuthoritativeGrid,
            "the watcher did not preserve the controller's cell grid"
        )
        terminal.ghosttyTitleChanged(
            "machinen.geometry:v1:149:42:9:\(session.viewerClientID):"
                + "\(session.viewerClientID):1:149:42"
        )
        try expect(
            !terminal.rendersAuthoritativeGrid,
            "the new controller did not return to its local viewport"
        )
        terminal.ghosttyTitleChanged(
            "machinen.geometry:v1:100:30:10:\(session.viewerClientID):"
                + "\(session.viewerClientID):1:149:42"
        )
        terminal.ghosttyTitleChanged(
            "machinen.geometry:v1:100:30:10:\(session.viewerClientID):"
                + "\(session.viewerClientID):1:100:30"
        )
        try expect(
            terminal.rendersAuthoritativeGrid,
            "the controller did not preserve an explicit resize request"
        )
        terminal.setFrameSize(NSSize(width: 1_200, height: 720))
        try expect(
            !terminal.rendersAuthoritativeGrid,
            "a local viewport change did not resume automatic geometry"
        )
        terminal.setTerminalInputFocused(true)
        try expect(
            harness.takenControlSessionIDs.isEmpty,
            "focusing a watcher unexpectedly stole geometry control"
        )

        harness.setAvailableSessions([
            AvailableTerminalSession(
                id: session.id,
                name: session.name,
                state: "running",
                workspaceId: session.workspaceID,
                workingDirectory: session.workingDirectory,
                clientControlAvailable: true,
                clients: [
                    AttachedTerminalClient(
                        id: session.viewerClientID,
                        name: "Machinen Desktop on this Mac",
                        pid: 20,
                        connectedAtMs: 1,
                        writer: true,
                        resize: true,
                        readOnly: false
                    ),
                ],
                createdAtMs: 1,
                updatedAtMs: 2
            ),
        ])
        let deck = harness.makeDeck(workspaces: [workspace])
        _ = try deck.performAPIOperation(
            "terminal.resize",
            params: [
                "terminalId": session.id,
                "columns": 100,
                "rows": 30,
            ]
        )
        try expect(
            harness.resizedSessionRequests.contains(where: {
                $0.id == session.id && $0.columns == 100 && $0.rows == 30
            }),
            "terminal.resize did not request an explicit PTY geometry"
        )
        try expect(
            (try harness.effectiveStatusWidgets(of: deck)).first {
                $0.id == "machinen.sessionControl"
            }?.value == "CONTROL",
            "the status bar did not identify this Desktop as the controller"
        )
    }

    private static func registeredTargetDiscoveryRequiresExplicitOpenAndAttach() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        harness.setNativeWorkspaces([
            NativeWorkspaceRecord(
                id: "ws_recovered", name: "recovered",
                rootDirectory: harness.temporaryDirectoryPath, createdAtMs: 1, updatedAtMs: 2
            ),
        ])
        harness.setAvailableSessions([
            AvailableTerminalSession(
                id: "term_recovered", name: "agent", state: "running",
                workspaceId: "ws_recovered", workingDirectory: harness.temporaryDirectoryPath + "/packages/app",
                createdAtMs: 1, updatedAtMs: 2
            ),
        ])

        let deck = harness.makeDeck(state: harness.loadStoredState())
        try expect((try harness.snapshot(of: deck)).workspaces.isEmpty,
                   "target discovery opened a workspace or attached a session")
        let discovery = try deck.performAPIOperation("target.sessions", params: [:]) as? JSONObject
        let local = (discovery?["targets"] as? [JSONObject])?.first
        try expect((local?["workspaces"] as? [JSONObject])?.map { $0["id"] as? String } == ["ws_recovered"],
                   "registered local discovery did not report native workspaces")
        try expect((try harness.effectiveStatusWidgets(of: deck)).contains {
            $0.id == "machinen.targetSessions" && $0.value == "1"
        }, "the status bar did not expose the registered target session browser")

        deck.toggleTargetSessions()
        let browser = try harness.targetSessions(in: deck)
        try harness.pressReturn(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressReturn(on: browser)
        try expect((try harness.snapshot(of: deck)).workspaces.map(\.id) == ["ws_recovered"],
                   "opening a discovered workspace was not an explicit browser action")
        deck.toggleTargetSessions()
        let sessionsBrowser = try harness.targetSessions(in: deck)
        try harness.pressReturn(on: sessionsBrowser)
        try harness.pressReturn(on: sessionsBrowser)
        try harness.pressDown(on: sessionsBrowser)
        try harness.pressDown(on: sessionsBrowser)
        try harness.pressReturn(on: sessionsBrowser)
        try harness.pressReturn(on: sessionsBrowser)
        try expect((try harness.snapshot(of: deck)).terminals.map(\.id).contains("term_recovered"),
                   "attaching a discovered session was not an explicit action")
        deck.toggleTargetSessions(selecting: "term_recovered")
        let attachedBrowser = try harness.targetSessions(in: deck)
        try expect(attachedBrowser.items.first(where: {
            $0.sessionID == "term_recovered"
        })?.sessionAction == .detach,
        "the shared workspace tree did not show the attached session state")
        try harness.pressReturn(on: attachedBrowser)
        try harness.pressReturn(on: attachedBrowser)
        try expect((try harness.snapshot(of: deck)).terminals.isEmpty,
                   "detaching from the shared workspace tree left the viewer attached")
        deck.restoreUndoToastTerminal()

        harness.setSessionDiscovery(.success([]), for: "ssh:mini")
        harness.setWorkspaceDiscovery(.success([]), for: "ssh:mini")
        let target = try deck.performAPIOperation("target.register", params: ["host": "mini"]) as? JSONObject
        try expect(target?["host"] as? String == "mini", "SSH target registration failed")
        let persisted = harness.loadStoredState().targetMachines
        try expect(persisted.count == 1 && persisted[0].sshHost == "mini" && !persisted[0].id.isEmpty,
                   "registered SSH target was not persisted with a stable identity")

        let migrationHarness = try Harness()
        defer { migrationHarness.cleanUp() }
        try migrationHarness.storeManifest(
            version: 10,
            workspaces: [WorkspaceRecord(
                id: "ws_legacy_remote", name: "legacy remote",
                workingDirectory: "/project", sshHost: "mini"
            )],
            sessions: []
        )
        let migrated = migrationHarness.loadStoredState()
        try expect(migrated.targetMachines.map(\.sshHost) == ["mini"],
                   "legacy SSH workspace locations were not seeded as target profiles")
        let migratedDeck = migrationHarness.makeDeck(state: migrated)
        _ = try migratedDeck.performAPIOperation(
            "target.remove",
            params: ["targetId": migrated.targetMachines[0].id]
        )
        try expect(migrationHarness.loadStoredState().targetMachines.isEmpty,
                   "a removed migrated target returned from SSH location history")

        try registeredTargetStatesAndStaleDiscoveryAreDistinct()
        try removingTargetInvalidatesPendingDiscovery()
        try addingSharedWorkspaceDoesNotOpenIt()
        try closingOneTargetWorkspaceSupportsUndo()
    }

    private static func addingSharedWorkspaceDoesNotOpenIt() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(state: harness.loadStoredState())
        deck.toggleTargetSessions()
        let browser = try harness.targetSessions(in: deck)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)

        var palette = try harness.commandPalette(in: deck)
        try harness.pressReturn(on: palette)
        palette = try harness.commandPalette(in: deck)
        try harness.pressReturn(on: palette)
        palette = try harness.commandPalette(in: deck)
        try harness.type("shared home", into: palette)
        try harness.pressReturn(on: palette)

        guard let saved = harness.savedWorkspaces.last else {
            throw InteractionTestFailure("Add Workspace did not save a native workspace")
        }
        try expect(saved.name == "shared home" && saved.sessions.isEmpty,
                   "Add Workspace did not register an empty shared workspace")
        try expect((try harness.snapshot(of: deck)).workspaces.isEmpty,
                   "registering a shared workspace opened it in the scene")
    }

    private static func closingOneTargetWorkspaceSupportsUndo() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let target = TargetMachine(id: "target_close_mini", sshHost: "mini")
        let machineID = "ssh:mini"
        harness.setWorkspaceDiscovery(.success([
            NativeWorkspaceRecord(
                id: "ws_close_one", name: "one",
                rootDirectory: harness.temporaryDirectoryPath + "/one",
                createdAtMs: 1, updatedAtMs: 2
            ),
            NativeWorkspaceRecord(
                id: "ws_keep_two", name: "two",
                rootDirectory: harness.temporaryDirectoryPath + "/two",
                createdAtMs: 1, updatedAtMs: 2
            ),
        ]), for: machineID)
        harness.setSessionDiscovery(.success([
            AvailableTerminalSession(
                id: "term_close_one", name: "agent", state: "running",
                workspaceId: "ws_close_one", workingDirectory: harness.temporaryDirectoryPath,
                createdAtMs: 1, updatedAtMs: 2
            ),
        ]), for: machineID)
        let deck = harness.makeDeck(state: MachinenStoredState(
            workspaces: [], sessions: [], targetMachines: [target]
        ))

        deck.toggleTargetSessions()
        var browser = try harness.targetSessions(in: deck)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressReturn(on: browser)
        try expect((try harness.snapshot(of: deck)).workspaces.map(\.id) == ["ws_close_one"],
                   "the workspace needed for the close-undo proof was not opened")

        deck.toggleTargetSessions()
        browser = try harness.targetSessions(in: deck)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        let closed = try deck.performAPIOperation("target.sessions", params: [:]) as? JSONObject
        let closedTarget = (closed?["targets"] as? [JSONObject])?.first {
            ($0["target"] as? JSONObject)?["id"] as? String == target.id
        }
        try expect((closedTarget?["workspaces"] as? [JSONObject])?.compactMap {
            $0["id"] as? String
        } == ["ws_keep_two"], "closing one workspace removed every target workspace")
        let listed = try deck.performAPIOperation("target.list", params: [:]) as? JSONObject
        try expect((listed?["targets"] as? [JSONObject])?.contains {
            $0["id"] as? String == target.id
        } == true, "closing one workspace removed its registered target")
        try expect((try harness.snapshot(of: deck)).workspaces.isEmpty,
                   "closing a target workspace left its scene workspace open")
        try expect(deck.canRestoreUndoToast, "closing a workspace did not offer undo")

        deck.restoreUndoToastTerminal()
        let restored = try deck.performAPIOperation("target.sessions", params: [:]) as? JSONObject
        let restoredTarget = (restored?["targets"] as? [JSONObject])?.first {
            ($0["target"] as? JSONObject)?["id"] as? String == target.id
        }
        try expect(Set((restoredTarget?["workspaces"] as? [JSONObject])?.compactMap {
            $0["id"] as? String
        } ?? []) == Set(["ws_close_one", "ws_keep_two"]),
        "undo did not restore the individually closed workspace")
        try expect((try harness.snapshot(of: deck)).workspaces.map(\.id) == ["ws_close_one"],
                   "undo did not restore the scene workspace")
        try expect(harness.deletedWorkspaceIDs.isEmpty,
                   "undo ran after the native workspace had already been deleted")

        deck.toggleTargetSessions()
        browser = try harness.targetSessions(in: deck)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        deck.terminateLastClosedTerminalNow()
        try expect(harness.deletedWorkspaceIDs == ["ws_close_one"],
                   "committing one close deleted the wrong native workspace")
    }

    private static func registeredTargetStatesAndStaleDiscoveryAreDistinct() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let target = TargetMachine(id: "target_mini", sshHost: "mini")
        let machineID = "ssh:mini"
        let finished = AvailableTerminalSession(
            id: "term_finished", name: "finished", state: "exited",
            workspaceId: nil, workingDirectory: "/project", createdAtMs: 1, updatedAtMs: 1
        )
        harness.setSessionDiscovery(.success([finished]), for: machineID)
        harness.setWorkspaceDiscovery(.success([]), for: machineID)
        let deck = harness.makeDeck(state: MachinenStoredState(
            workspaces: [], sessions: [], targetMachines: [target]
        ))

        func targetResult(_ operation: String) throws -> JSONObject? {
            let result = try deck.performAPIOperation(operation, params: [:]) as? JSONObject
            return (result?["targets"] as? [JSONObject])?.first {
                let candidate = ($0["target"] as? JSONObject) ?? $0
                return candidate["id"] as? String == target.id
            }
        }

        try expect(try targetResult("target.list")?["state"] as? String == "inactive",
                   "a target with only exited sessions was reported online")

        let active = AvailableTerminalSession(
            id: "term_active", name: "agent", state: "running",
            workspaceId: nil, workingDirectory: "/project", createdAtMs: 2, updatedAtMs: 2
        )
        harness.setSessionDiscovery(.success([active]), for: machineID)
        deck.toggleTargetSessions()
        let browser = try harness.targetSessions(in: deck)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        try expect(try targetResult("target.list")?["state"] as? String == "online",
                   "an active registered target was not reported online")

        let workspaceCalls = harness.workspaceDiscoveryCallCount(for: machineID)
        harness.setSessionDiscovery(
            .failure(InteractionTestFailure("SSH is offline")),
            for: machineID
        )
        try harness.pressDown(on: browser)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        let stale = try targetResult("target.sessions")
        try expect(stale?["state"] as? String == "unreachable",
                   "a failed target poll was reported inactive")
        try expect((stale?["sessions"] as? [JSONObject])?.map { $0["id"] as? String }
            == ["term_active"], "unreachable discovery did not retain its stale active sessions")
        try expect(harness.workspaceDiscoveryCallCount(for: machineID) == workspaceCalls,
                   "a failed session poll performed a second SSH workspace request")
    }

    private static func removingTargetInvalidatesPendingDiscovery() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let target = TargetMachine(id: "target_pending", sshHost: "pending")
        let machineID = "ssh:pending"
        harness.deferSessionDiscovery(for: machineID)
        let deck = harness.makeDeck(state: MachinenStoredState(
            workspaces: [], sessions: [], targetMachines: [target]
        ))

        deck.toggleTargetSessions()
        let browser = try harness.targetSessions(in: deck)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressDown(on: browser)
        try harness.pressReturn(on: browser)
        try harness.pressReturn(on: browser)
        try expect(harness.sessionDiscoveryCallCount(for: machineID) == 1,
                   "an in-flight target poll allowed overlapping SSH requests")

        _ = try deck.performAPIOperation(
            "target.remove",
            params: ["targetId": target.id]
        )
        harness.completeSessionDiscovery(
            for: machineID,
            with: .success([AvailableTerminalSession(
                id: "term_late", name: "late", state: "running",
                workspaceId: nil, workingDirectory: "/project", createdAtMs: 1, updatedAtMs: 1
            )])
        )
        let listed = try deck.performAPIOperation("target.list", params: [:]) as? JSONObject
        try expect((listed?["targets"] as? [JSONObject])?.compactMap { $0["id"] as? String }
            == ["local"], "a late discovery result resurrected a removed target")
        try expect(harness.workspaceDiscoveryCallCount(for: machineID) == 0,
                   "a removed target continued into workspace discovery")
        try expect((try harness.effectiveStatusWidgets(of: deck)).first {
            $0.id == "machinen.targetSessions"
        }?.value == "0", "a removed target remained in the status-bar session count")
    }

    private static func graphicalStatusWidgetsRender() throws {
        let view = MachinenStatusBarView(frame: NSRect(x: 0, y: 0, width: 900, height: 40))
        view.title = "workspace > shell"
        view.titleTooltip = "/projects/workspace"
        view.workspaceChoices = [MachinenStatusNavigationChoice(
            id: "ws_workspace",
            title: "workspace",
            tooltip: "/projects/workspace"
        )]
        view.selectedWorkspaceID = "ws_workspace"
        view.terminalChoices = [MachinenStatusNavigationChoice(
            id: "term_shell",
            title: "shell",
            tooltip: "/projects/workspace · zsh"
        )]
        view.selectedTerminalID = "term_shell"
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

    private static func desktopServicesRestartUntilTheAppStops() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("machinen-services-supervisor-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let marker = directory.appendingPathComponent("launches")
        var environment = ProcessInfo.processInfo.environment
        environment["MACHINEN_SUPERVISOR_TEST_MARKER"] = marker.path
        let supervisor = DesktopServicesSupervisor(
            executableURL: URL(fileURLWithPath: "/bin/sh"),
            arguments: [
                "-c",
                "printf 'launch\\n' >> \"$MACHINEN_SUPERVISOR_TEST_MARKER\"; exit 9",
            ],
            environment: environment,
            restartBaseDelay: 0.02
        )
        defer { supervisor.stop() }

        func launchCount() -> Int {
            let contents = try? String(contentsOf: marker, encoding: .utf8)
            return contents?.split(separator: "\n").count ?? 0
        }

        supervisor.start()
        let deadline = Date().addingTimeInterval(2)
        while launchCount() < 2, Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        }
        try expect(launchCount() >= 2, "Desktop services were not restarted after an unexpected exit")

        supervisor.stop()
        let countAfterStop = launchCount()
        RunLoop.main.run(until: Date().addingTimeInterval(0.15))
        try expect(
            launchCount() == countAfterStop,
            "Desktop services restarted after their supervisor stopped"
        )
    }

    private static func workspaceNamesRemainUniqueAndLocationsCanBeShared() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 1)])
        let projectDirectory = try harness.makeDirectory(named: "project")

        _ = try deck.performAPIOperation("workspace.update", params: [
            "workspaceId": "ws_alpha",
            "workingDirectory": projectDirectory.path,
        ])
        var snapshot = try harness.snapshot(of: deck)
        try expect(
            snapshot.workspaces.first?.workingDirectory == projectDirectory.path,
            "a workspace with terminals did not accept its new location"
        )
        try expect(
            snapshot.terminals.first?.workingDirectory == harness.temporaryDirectoryPath,
            "changing a workspace location moved an existing terminal"
        )
        let sharedWorkspace = try deck.performAPIOperation("workspace.create", params: [
            "name": "beta",
            "workingDirectory": projectDirectory.path,
        ]) as? [String: Any]
        try expect(
            sharedWorkspace?["workingDirectory"] as? String == projectDirectory.path,
            "a second workspace could not reuse an existing location"
        )
        do {
            _ = try deck.performAPIOperation("workspace.create", params: [
                "name": "  ALPHA  ",
                "workingDirectory": projectDirectory.path,
            ])
            throw InteractionTestFailure("a case-variant duplicate workspace name was created")
        } catch let error as MachinenAPIError {
            try expect(error.code == "workspace_name_conflict", "duplicate name returned the wrong error")
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
        do {
            _ = try deck.performAPIOperation("workspace.update", params: [
                "workspaceId": emptyWorkspaceID,
                "name": " BETA ",
            ])
            throw InteractionTestFailure("a workspace was renamed to a case-variant duplicate")
        } catch let error as MachinenAPIError {
            try expect(error.code == "workspace_name_conflict", "duplicate rename returned the wrong error")
        }
        snapshot = try harness.snapshot(of: deck)
        let relocated = snapshot.workspaces.first(where: { $0.id == emptyWorkspaceID })
        try expect(
            relocated?.location.kind == "ssh" && relocated?.location.host == "mini",
            "an empty workspace did not accept its new location"
        )
        _ = try deck.performAPIOperation("workspace.delete", params: [
            "workspaceId": emptyWorkspaceID,
        ])
        let savedLocationHistory = harness.loadStoredState().workspaceLocationHistory
        try expect(
            savedLocationHistory.contains(.local(projectDirectory.path))
                && savedLocationHistory.contains(.ssh(
                    host: "mini",
                    path: "/Users/p4p8/gh/redwoodjs/machinen"
                )),
            "removing a workspace discarded its previously chosen directories"
        )

        let legacyAlpha = WorkspaceRecord(
            id: "ws_legacy_alpha",
            name: "Alpha",
            workingDirectory: harness.temporaryDirectoryPath
        )
        let legacyDuplicate = WorkspaceRecord(
            id: "ws_legacy_duplicate",
            name: " alpha ",
            workingDirectory: harness.temporaryDirectoryPath
        )
        try harness.storeManifest(
            version: 6,
            workspaces: [legacyAlpha, legacyDuplicate],
            sessions: []
        )
        let migratedNames = harness.loadStoredState().workspaces.map(\.name)
        try expect(
            migratedNames == ["Alpha", "alpha 2"],
            "manifest migration did not repair duplicate workspace names: \(migratedNames)"
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
            remoteCommand.contains("'--workspace-id' 'ws_remote_quote'")
                && remoteCommand.contains("'--workspace-name' 'remote quote'")
                && remoteCommand.contains("'--workspace-root' '/Users/p4p8/project'\\''s files'")
                && remoteCommand.contains("'--cwd' '/Users/p4p8/project'\\''s files'")
                && remoteCommand.contains(
                    "MACHINEN_SESSION_DATABASE=\"$HOME/Library/Application Support/Machinen/sessions.sqlite3\""
                )
                && remoteCommand.contains(
                    "MACHINEN_LEGACY_SESSION_DATABASE=\"${XDG_STATE_HOME:-$HOME/.local/state}/machinen/sessions.sqlite3\""
                )
                && remoteCommand.contains("'--database' \"$MACHINEN_SESSION_DATABASE\"")
                && remoteCommand.contains("inspect --database")
                && remoteCommand.contains("printf") && remoteCommand.contains("ready"),
            "the remote terminal command did not safely select and quote its database, path, and command: \(remoteCommand)"
        )
        let mergedSessions = try MachinenNativeSessionBackend.decodeSessionListOutput(
            """
            {"sessions":[{"id":"term_shared","name":"canonical","state":"running","workspaceId":"ws_one","workingDirectory":"/one","createdAtMs":1,"updatedAtMs":2}]}
            {"sessions":[{"id":"term_shared","name":"legacy","state":"running","workspaceId":"ws_old","workingDirectory":"/old","createdAtMs":1,"updatedAtMs":3},{"id":"term_legacy","name":null,"state":"running","workspaceId":"ws_one","workingDirectory":"/one","createdAtMs":1,"updatedAtMs":4}]}
            """
        )
        try expect(
            mergedSessions.map(\.id) == ["term_shared", "term_legacy"]
                && mergedSessions.first?.name == "canonical",
            "remote canonical and legacy session stores were not merged with canonical precedence"
        )
        let sshArguments = MachinenSSHTransport.arguments(connectTimeout: 8)
        try expect(
            sshArguments.contains("BatchMode=yes")
                && sshArguments.contains("ControlMaster=auto")
                && sshArguments.contains("ControlPersist=60")
                && sshArguments.contains(where: { $0.hasPrefix("ControlPath=/tmp/machinen-") })
                && sshArguments.contains("ConnectTimeout=8"),
            "remote terminals did not reuse a bounded SSH control connection: \(sshArguments)"
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

    private static func sshTerminalViewportAppearsBeforeConnectionCompletes() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let session = TerminalSession(
            id: "term_deferred_ssh",
            tileID: "tile_deferred_ssh",
            label: "ds",
            workspaceID: "ws_deferred_ssh",
            workspace: "deferred ssh",
            name: "shell",
            launch: .loginShell,
            workingDirectory: "/Users/p4p8/project",
            sshHost: "mini",
            state: .starting
        )
        let backend = DeferredViewerBackend()
        let terminal = MachinenTerminalView(
            session: session,
            terminalBackend: backend,
            telemetryProvider: { completion in completion(nil) }
        )
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }

        let startedAt = ProcessInfo.processInfo.systemUptime
        window.contentView = terminal
        terminal.displayIfNeeded()
        let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
        try expect(elapsed < 0.05, "an SSH connection blocked its terminal viewport")
        try expect(backend.hasPendingViewer, "the terminal did not begin its deferred connection")
        try expect(
            session.state == .starting && terminal.ghosttySurface == nil,
            "the terminal did not remain visibly starting before SSH completed"
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
        let terminalSize = NSSize(width: 1_200, height: 760)
        let cardSize = TerminalTileView.cardSize(for: terminalSize)
        tile.frame = NSRect(origin: .zero, size: cardSize)
        tile.bounds = NSRect(origin: .zero, size: cardSize)
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
            unfocused.size == terminalSize && unfocused.maxY == tile.bounds.maxY,
            "the persistent terminal viewport did not retain its full content surface: \(unfocused), \(tile.bounds)"
        )
    }

    private static func ghosttyRendererSurvivesViewerReconnects() throws {
        // CoreVideo cannot create a Metal display link on headless builders.
        guard ProcessInfo.processInfo.environment["MACHINEN_RENDERER_TESTS"] == "1" else {
            return
        }

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("machinen-renderer-reconnect-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let workspace = WorkspaceRecord(
            id: "ws_renderer_reconnect",
            name: "renderer reconnect",
            workingDirectory: directory.path
        )
        let session = TerminalSession(
            id: "term_renderer_reconnect",
            tileID: "tile_renderer_reconnect",
            label: "rr",
            workspaceID: workspace.id,
            workspace: workspace.name,
            name: "cat",
            launch: .loginShell,
            workingDirectory: directory.path,
            state: .running
        )
        let deck = TerminalDeckView(
            state: MachinenStoredState(workspaces: [workspace], sessions: [session]),
            sessionStore: TerminalSessionStore(
                manifestURL: directory.appendingPathComponent("terminals.json")
            ),
            sessionBackend: ImmediateViewerBackend(workingDirectory: directory.path)
        )
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.contentView = deck
        window.makeKeyAndOrderFront(nil)
        deck.focusCurrentContent()
        defer {
            deck.prepareForTermination()
            window.contentView = nil
            window.close()
        }

        func waitForRunningViewer() throws {
            let deadline = Date(timeIntervalSinceNow: 2)
            while session.state != .running, Date() < deadline {
                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01))
            }
            try expect(session.state == .running, "Ghostty did not attach its test viewer")
        }

        try waitForRunningViewer()
        for _ in 0..<8 {
            deck.handleCommandW()
            try expect(deck.canReopenClosedTerminal, "the renderer test did not disconnect its viewer")
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02))

            deck.reopenLastClosedTerminal()
            try waitForRunningViewer()
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02))
        }
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
        let cardSize = TerminalTileView.cardSize(for: size)
        cluster.frame = NSRect(origin: .zero, size: cardSize)
        _ = cluster.arrange(sessions: [tile], terminalSize: size)
        cluster.isSelected = true
        cluster.layoutSubtreeIfNeeded()
        try expect(
            tile.frame == NSRect(origin: .zero, size: cardSize),
            "a singleton tile did not fill its workspace surface"
        )
        try expect(
            tile.bounds == NSRect(origin: .zero, size: cardSize)
                && tile.terminalViewportRect.size == size,
            "a singleton tile did not retain its full terminal viewport"
        )
        guard let borderView = cluster.subviews.first(where: { $0 !== tile }) else {
            throw InteractionTestFailure("a singleton workspace did not create an overlay border")
        }
        try expect(
            borderView.layer?.borderWidth == 4,
            "a singleton workspace did not use the full selection border"
        )
        try expect(
            cluster.subviews.last === borderView,
            "the singleton selection border was drawn behind its terminal"
        )
        tile.updateProcessInfo(TerminalProcessInfo(shellPID: 4201, processPID: 4242))
        try expect(
            session.associatedPID == 4242 && session.shellPID == 4201,
            "a tile did not retain its live process metadata"
        )

        let harness = try Harness()
        defer { harness.cleanUp() }
        let singleton = harness.workspace("selected-singleton", terminalCount: 1)
        let peer = harness.workspace("peer", terminalCount: 2)
        let deck = harness.makeDeck(workspaces: [singleton, peer])
        deck.frame = NSRect(origin: .zero, size: size)
        deck.layoutSubtreeIfNeeded()

        func singletonTile(in view: NSView) -> TerminalTileView? {
            if let candidate = view as? TerminalTileView,
               candidate.session.workspaceID == singleton.0.id
            {
                return candidate
            }
            return view.subviews.lazy.compactMap(singletonTile).first
        }

        guard let selectedTile = singletonTile(in: deck) else {
            throw InteractionTestFailure("the singleton overview did not create its terminal")
        }
        try expect(
            selectedTile.layer?.borderWidth == 1,
            "workspace selection incorrectly used the narrower terminal selection border"
        )
    }

    private static func overviewUsesOnlyItsTopInset() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 1),
            harness.workspace("beta", terminalCount: 1),
        ])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_200, height: 760),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        deck.layoutSubtreeIfNeeded()

        guard let statusBar = deck.subviews.compactMap({
            $0 as? MachinenStatusBarView
        }).first else {
            throw InteractionTestFailure("the overview test did not create its status bar")
        }
        let clusters = deck.subviews
            .flatMap(\.subviews)
            .compactMap { $0 as? WorkspaceClusterView }
        guard let contentTop = clusters.map({
            $0.convert($0.bounds, to: deck).minY
        }).min() else {
            throw InteractionTestFailure("the overview test did not create workspace surfaces")
        }
        let expectedTop = statusBar.frame.maxY + 18
        try expect(
            abs(contentTop - expectedTop) < 1,
            "the overview accumulated a gap below the status bar: \(contentTop - statusBar.frame.maxY)"
        )
    }

    private static func statusBarIsExcludedFromTerminalViewport() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("alpha", terminalCount: 1)])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_200, height: 760),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        deck.layoutSubtreeIfNeeded()

        guard let statusBar = deck.subviews.compactMap({ $0 as? MachinenStatusBarView }).first,
              let tile = harness.terminalTile(in: deck),
              let terminal = tile.terminalResponder
        else {
            throw InteractionTestFailure("the viewport test did not create its status bar and terminal")
        }
        let terminalFrame = terminal.convert(terminal.bounds, to: deck)
        let expectedViewport = NSRect(
            x: 0,
            y: MachinenStatusBarView.preferredHeight,
            width: deck.bounds.width,
            height: deck.bounds.height - MachinenStatusBarView.preferredHeight
        )
        try expect(
            terminalFrame == expectedViewport,
            "the focused terminal did not fill the viewport below the status bar: \(terminalFrame)"
        )
        try expect(
            statusBar.frame.maxY == terminalFrame.minY,
            "the focused terminal extended underneath the status bar"
        )
        try expect(
            tile.terminalViewportRect.size == expectedViewport.size,
            "the terminal renderer did not retain the full content viewport"
        )
        try expect(
            tile.bounds.size == TerminalTileView.cardSize(for: expectedViewport.size),
            "the terminal card did not keep its caption outside the content viewport"
        )
    }

    private static func clickingWorkspaceBackgroundDoesNotFocusTerminal() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [
            harness.workspace("alpha", terminalCount: 3),
            harness.workspace("beta", terminalCount: 2),
        ])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_200, height: 760),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        window.makeFirstResponder(deck)
        deck.layoutSubtreeIfNeeded()

        let clusters = deck.subviews
            .flatMap(\.subviews)
            .compactMap { $0 as? WorkspaceClusterView }
        guard let cluster = clusters.first(where: { $0.workspaceID == "ws_alpha" }) else {
            throw InteractionTestFailure("the overview did not create the alpha workspace")
        }
        let workspacePoint = NSPoint(x: cluster.bounds.midX, y: cluster.bounds.midY)
        try expect(
            !cluster.sessions.contains(where: { $0.frame.contains(workspacePoint) }),
            "the workspace click test did not target the gap between terminals"
        )
        try expect(
            cluster.sessions.allSatisfy { $0.hitTest(workspacePoint) == nil },
            "a terminal accepted a click in the workspace background"
        )
        let deckPoint = cluster.convert(workspacePoint, to: deck)

        func event(_ type: NSEvent.EventType) throws -> NSEvent {
            guard let event = NSEvent.mouseEvent(
                with: type,
                location: deckPoint,
                modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber,
                context: nil,
                eventNumber: 0,
                clickCount: 1,
                pressure: 1
            ) else {
                throw InteractionTestFailure("could not create a workspace click event")
            }
            return event
        }

        cluster.mouseDown(with: try event(.leftMouseDown))
        cluster.mouseUp(with: try event(.leftMouseUp))

        try expect(
            try harness.uiLevel(of: deck) == "workspace",
            "clicking a workspace background focused one of its terminals"
        )
        try expect(
            try harness.focusedTileID(of: deck) == nil,
            "clicking a workspace background selected a particular terminal"
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
        let commandK = try harness.keyEvent(
            characters: "k",
            keyCode: 40,
            modifierFlags: [.command]
        )
        try expect(
            focusedTerminal.performKeyEquivalent(with: commandK),
            "a focused terminal did not route command-k to the command palette"
        )
        _ = try harness.commandPalette(in: deck)
        deck.toggleCommandPalette()
        let commandShiftK = try harness.keyEvent(
            characters: "k",
            keyCode: 40,
            modifierFlags: [.command, .shift]
        )
        try expect(
            focusedTerminal.performKeyEquivalent(with: commandShiftK),
            "a focused terminal did not route shift-command-k to the command palette"
        )
        _ = try harness.commandPalette(in: deck)
        deck.toggleCommandPalette()

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

    private static func commandWDisconnectsSingletonSession() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let deck = harness.makeDeck(workspaces: [harness.workspace("solo", terminalCount: 1)])

        deck.handleCommandW()
        var snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 1, "⌘W closed a singleton workspace")
        try expect(snapshot.tiles.isEmpty, "⌘W did not disconnect the singleton terminal")
        try expect(deck.canReopenClosedTerminal, "the singleton session was not reconnectable")

        deck.handleCommandW()
        snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.workspaces.count == 1, "a second ⌘W closed the workspace")
        try expect(!deck.canReopenClosedTerminal, "a second ⌘W did not kill the session")
    }

    private static func disconnectedTerminalsCanReconnectOrBeKilled() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let alpha = harness.workspace("alpha", terminalCount: 4)
        alpha.1.forEach { $0.state = .running }
        let deck = harness.makeDeck(workspaces: [alpha])
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        defer { window.close() }
        window.contentView = deck
        deck.layoutSubtreeIfNeeded()

        let originalIDs = Set(try harness.snapshot(of: deck).tiles.map(\.id))
        deck.zoomInOneLevel()
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
        deck.handleCommandW()

        var snapshot = try harness.snapshot(of: deck)
        try expect(snapshot.tiles.count == 3, "⌘W did not disconnect the selected terminal tile")
        try expect(deck.canReopenClosedTerminal, "the disconnected session was not retained")
        try expect(
            harness.undoToast(in: deck) != nil,
            "disconnecting did not show the reconnect-or-kill toast"
        )
        try expect(
            try harness.effectiveStatusWidgets(of: deck).contains {
                $0.id == "machinen.availableSessions" && $0.value == "1"
            },
            "the disconnected session did not appear in the status bar"
        )

        deck.toggleAvailableSessions()
        let sessions = try harness.availableSessions(in: deck)
        try expect(
            sessions.items.count == 4
                && sessions.items.first?.session.state == "running"
                && sessions.items.first?.attachmentState == .detached
                && sessions.items.dropFirst().allSatisfy { $0.isAttached },
            "the session panel did not include attached and unattached terminals"
        )

        let restoredDeck = harness.makeDeck(state: harness.loadStoredState())
        try expect(
            try harness.snapshot(of: restoredDeck).tiles.count == 3,
            "relaunch made a disconnected terminal visible without reconnecting"
        )
        try expect(
            restoredDeck.canReopenClosedTerminal,
            "relaunch discarded the disconnected session"
        )
        restoredDeck.reopenLastClosedTerminal()
        try expect(
            Set(try harness.snapshot(of: restoredDeck).tiles.map(\.id)) == originalIDs,
            "relaunch did not reconnect the same terminal tile"
        )

        try harness.pressReturn(on: sessions)
        snapshot = try harness.snapshot(of: deck)
        try expect(
            Set(snapshot.tiles.map(\.id)) == originalIDs,
            "the reconnect panel did not return the same terminal tile"
        )
        try expect(!deck.canReopenClosedTerminal, "reconnect left the session disconnected")

        deck.handleCommandW()
        try expect(deck.canRestoreUndoToast, "the toast did not enable its reconnect shortcut")
        deck.restoreUndoToastTerminal()
        try expect(
            Set(try harness.snapshot(of: deck).tiles.map(\.id)) == originalIDs,
            "the toast's ⌘Z shortcut did not reconnect its session"
        )

        deck.handleCommandW()
        deck.handleCommandW()
        try expect(!deck.canReopenClosedTerminal, "a second ⌘W did not kill the session")
        try expect(try harness.snapshot(of: deck).tiles.count == 3, "killing restored a tile")

        deck.handleCommandW()
        deck.toggleAvailableSessions()
        let killPanel = try harness.availableSessions(in: deck)
        deck.handleCommandW()
        try expect(!deck.canReopenClosedTerminal, "the session panel did not kill its selection")
        try expect(
            killPanel.items.count == 2 && killPanel.items.allSatisfy { $0.isAttached },
            "the killed session remained in the session panel"
        )
    }

    private static func commandPaletteFuzzySearchesAndCompletes() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let path = "~/gh/redwoodjs/machinen"
        let palette = CommandPaletteView(
            frame: NSRect(x: 0, y: 0, width: 900, height: 640),
            heading: "TEST",
            context: "fuzzy paths",
            commands: [
                PaletteCommand(
                    id: .useWorkspaceLocation,
                    title: path,
                    shortcut: "used by desktop",
                    completion: path
                ),
                PaletteCommand(
                    id: .back,
                    title: "Other folder",
                    shortcut: "unused"
                ),
            ],
            acceptsFreeform: true
        )
        try harness.type("rwm", into: palette)
        try expect(palette.currentQuery == "rwm", "the fuzzy path query was not retained")
        try harness.pressTab(on: palette)
        try expect(
            palette.currentQuery == path,
            "Tab did not complete the highest-ranked fuzzy path"
        )

        let project = try harness.makeDirectory(named: "redwood-project")
        let gh = try harness.makeDirectory(named: "gh")
        let hidden = try harness.makeDirectory(named: ".hidden-project")
        let localChildren = WorkspacePathSuggestions.localChildDirectories(
            at: harness.temporaryDirectoryPath
        )
        try expect(
            localChildren == [gh.path, project.path, hidden.path],
            "the local browser omitted or reordered visible folders: \(localChildren)"
        )
        let localSuggestions = WorkspacePathSuggestions.localDirectories(
            matching: "\(harness.temporaryDirectoryPath)/rwp"
        )
        try expect(
            localSuggestions == [project.path],
            "local path completion did not fuzzy-match a filesystem directory"
        )
        let remoteRequest = WorkspacePathSuggestions.remoteCompletionRequest("~/gh/red")
        try expect(
            remoteRequest?.parent == "~/gh" && remoteRequest?.prefix == "red",
            "remote path completion split the parent and prefix incorrectly"
        )
    }

    private static func workspacePaletteCreatesRenamesAndClosesWithKeyboard() throws {
        let harness = try Harness()
        defer { harness.cleanUp() }
        let project = try harness.makeDirectory(named: "redwood-project")
        let deck = harness.makeDeck(state: MachinenStoredState(
            workspaces: [],
            sessions: [],
            workspaceLocationHistory: [.local(project.path)]
        ))

        deck.toggleCommandPalette()
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        let locationChooser = try harness.commandPalette(in: deck)
        try expect(
            try harness.snapshot(of: deck).workspaces.isEmpty,
            "New workspace was created before choosing a location"
        )
        try harness.pressEscape(on: locationChooser)
        let returnedTopLevel = try harness.commandPalette(in: deck)
        try expect(
            returnedTopLevel !== locationChooser,
            "Escape closed a nested workspace dialog instead of going back"
        )
        try harness.pressEscape(on: returnedTopLevel)
        try expect(!harness.hasCommandPalette(in: deck), "Escape did not close the top-level dialog")

        deck.toggleCommandPalette()
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        let previousLocations = try harness.commandPalette(in: deck)
        try harness.pressReturn(on: previousLocations)
        let suggestedName = try harness.commandPalette(in: deck)
        try expect(
            suggestedName.currentQuery == "redwood-project",
            "the selected folder did not suggest its basename as the workspace name"
        )
        try harness.pressEscape(on: suggestedName)
        let locationsAfterEscape = try harness.commandPalette(in: deck)
        try expect(
            locationsAfterEscape !== suggestedName,
            "Escape did not return from the name prompt to locations"
        )
        try harness.pressReturn(on: locationsAfterEscape)
        let returnedName = try harness.commandPalette(in: deck)
        try harness.type("alpha", into: returnedName)
        try harness.pressReturn(on: returnedName)
        let created = try harness.snapshot(of: deck)
        try expect(
            created.workspaces.map(\.name) == ["alpha"]
                && created.workspaces.first?.workingDirectory == project.path,
            "New workspace did not accept its name and selected location"
        )

        deck.toggleCommandPalette()
        try harness.type("Rename workspace", into: harness.commandPalette(in: deck))
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
        let locationTypePalette = try harness.commandPalette(in: deck)
        try expect(
            locationTypePalette !== locationCommandPalette,
            "a workspace with terminals did not enter the location-changing flow"
        )
        try harness.pressEscape(on: locationTypePalette)

        try harness.type("close workspace", into: harness.commandPalette(in: deck))
        try harness.pressReturn(on: harness.commandPalette(in: deck))
        try harness.pressEscape(on: harness.confirmation(in: deck))
        try expect(
            harness.hasCommandPalette(in: deck),
            "Escape from a ⌘K confirmation did not return to workspace commands"
        )
        try harness.type("close workspace", into: harness.commandPalette(in: deck))
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
private final class ImmediateViewerBackend: TerminalSessionBackend {
    private let workingDirectory: String

    init(workingDirectory: String) {
        self.workingDirectory = workingDirectory
    }

    func prepareViewer(
        for session: TerminalSession,
        loginShell: String,
        completion: @escaping @MainActor @Sendable (Result<TerminalViewerLaunch, Error>) -> Void
    ) {
        let workingDirectory = self.workingDirectory
        DispatchQueue.main.async {
            completion(.success(TerminalViewerLaunch(
                executable: "/bin/cat",
                arguments: [],
                environment: nil,
                executableName: "cat",
                workingDirectory: workingDirectory
            )))
        }
    }

    func send(_ data: Data, to session: TerminalSession) -> Bool { false }

    func inspect(
        _ session: TerminalSession,
        completion: @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
    ) {
        completion(nil)
    }

    func listSessions(
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<[AvailableTerminalSession], Error>) -> Void
    ) {
        completion(.success([]))
    }

    func listWorkspaces(
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<[NativeWorkspaceRecord], Error>) -> Void
    ) {
        completion(.success([]))
    }

    func saveWorkspace(
        id: String,
        name: String,
        at location: WorkspaceLocation,
        sessionIDs: [String],
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        completion(.success(()))
    }

    func deleteWorkspace(
        id: String,
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        completion(.success(()))
    }

    func takeControl(
        of session: TerminalSession,
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        completion(.success(()))
    }
    func resize(_ session: TerminalSession, columns: UInt16, rows: UInt16) -> Bool { true }
    func signal(_ signal: String, session: TerminalSession) {}
    func stop(_ session: TerminalSession) {}
    func reset(_ session: TerminalSession) {}
    func remove(_ session: TerminalSession) {}
}

@MainActor
private final class DeferredViewerBackend: TerminalSessionBackend {
    typealias SessionListCompletion = @MainActor @Sendable (
        Result<[AvailableTerminalSession], Error>
    ) -> Void

    private var viewerCompletion: (
        @MainActor @Sendable (Result<TerminalViewerLaunch, Error>) -> Void
    )?
    var hasPendingViewer: Bool { viewerCompletion != nil }

    func prepareViewer(
        for session: TerminalSession,
        loginShell: String,
        completion: @escaping @MainActor @Sendable (Result<TerminalViewerLaunch, Error>) -> Void
    ) {
        viewerCompletion = completion
    }

    func send(_ data: Data, to session: TerminalSession) -> Bool { false }

    func inspect(
        _ session: TerminalSession,
        completion: @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
    ) {
        completion(nil)
    }

    var availableSessions: [AvailableTerminalSession] = []
    var nativeWorkspaces: [NativeWorkspaceRecord] = []
    var sessionResultsByMachine: [String: Result<[AvailableTerminalSession], Error>] = [:]
    var workspaceResultsByMachine: [String: Result<[NativeWorkspaceRecord], Error>] = [:]
    var deferredSessionMachines: Set<String> = []
    var pendingSessionLists: [String: [SessionListCompletion]] = [:]
    var sessionListCallsByMachine: [String: Int] = [:]
    var workspaceListCallsByMachine: [String: Int] = [:]
    var savedWorkspaces: [(id: String, name: String, location: WorkspaceLocation, sessions: [String])] = []
    var deletedWorkspaces: [(id: String, location: WorkspaceLocation)] = []
    var takenControlOf: [String] = []
    var resizedSessions: [(id: String, columns: UInt16, rows: UInt16)] = []

    func listSessions(
        at location: WorkspaceLocation,
        completion: @escaping SessionListCompletion
    ) {
        let machineID = location.machineID
        sessionListCallsByMachine[machineID, default: 0] += 1
        if deferredSessionMachines.contains(machineID) {
            pendingSessionLists[machineID, default: []].append(completion)
            return
        }
        completion(sessionResultsByMachine[machineID] ?? .success(availableSessions))
    }

    func listWorkspaces(
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<[NativeWorkspaceRecord], Error>) -> Void
    ) {
        let machineID = location.machineID
        workspaceListCallsByMachine[machineID, default: 0] += 1
        completion(workspaceResultsByMachine[machineID] ?? .success(nativeWorkspaces))
    }

    func completeSessionLists(
        for machineID: String,
        with result: Result<[AvailableTerminalSession], Error>
    ) {
        deferredSessionMachines.remove(machineID)
        let completions = pendingSessionLists.removeValue(forKey: machineID) ?? []
        for completion in completions { completion(result) }
    }

    func saveWorkspace(
        id: String,
        name: String,
        at location: WorkspaceLocation,
        sessionIDs: [String],
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        savedWorkspaces.append((id, name, location, sessionIDs))
        completion(.success(()))
    }

    func deleteWorkspace(
        id: String,
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        deletedWorkspaces.append((id, location))
        completion(.success(()))
    }

    func takeControl(
        of session: TerminalSession,
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        takenControlOf.append(session.id)
        completion(.success(()))
    }
    func resize(_ session: TerminalSession, columns: UInt16, rows: UInt16) -> Bool {
        resizedSessions.append((session.id, columns, rows))
        return true
    }
    func signal(_ signal: String, session: TerminalSession) {}
    func stop(_ session: TerminalSession) {}
    func reset(_ session: TerminalSession) {}
    func remove(_ session: TerminalSession) {}
}

@MainActor
private final class Harness {
    private let temporaryDirectory: URL
    private let terminalBackend = DeferredViewerBackend()
    var temporaryDirectoryPath: String { temporaryDirectory.path }
    var backend: DeferredViewerBackend { terminalBackend }

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
        makeDeck(state: MachinenStoredState(
            workspaces: definitions.map(\.0),
            sessions: definitions.flatMap(\.1)
        ))
    }

    func makeDeck(state: MachinenStoredState) -> TerminalDeckView {
        TerminalDeckView(
            state: state,
            sessionStore: sessionStore(),
            sessionBackend: terminalBackend
        )
    }

    func setAvailableSessions(_ sessions: [AvailableTerminalSession]) {
        terminalBackend.availableSessions = sessions
    }

    func setSessionDiscovery(
        _ result: Result<[AvailableTerminalSession], Error>,
        for machineID: String
    ) {
        terminalBackend.sessionResultsByMachine[machineID] = result
    }

    func setWorkspaceDiscovery(
        _ result: Result<[NativeWorkspaceRecord], Error>,
        for machineID: String
    ) {
        terminalBackend.workspaceResultsByMachine[machineID] = result
    }

    func deferSessionDiscovery(for machineID: String) {
        terminalBackend.deferredSessionMachines.insert(machineID)
    }

    func completeSessionDiscovery(
        for machineID: String,
        with result: Result<[AvailableTerminalSession], Error>
    ) {
        terminalBackend.completeSessionLists(for: machineID, with: result)
    }

    func sessionDiscoveryCallCount(for machineID: String) -> Int {
        terminalBackend.sessionListCallsByMachine[machineID] ?? 0
    }

    func workspaceDiscoveryCallCount(for machineID: String) -> Int {
        terminalBackend.workspaceListCallsByMachine[machineID] ?? 0
    }

    var takenControlSessionIDs: [String] { terminalBackend.takenControlOf }
    var resizedSessionRequests: [(id: String, columns: UInt16, rows: UInt16)] {
        terminalBackend.resizedSessions
    }
    var savedWorkspaceIDs: [String] { terminalBackend.savedWorkspaces.map(\.id) }
    var savedWorkspaces: [(id: String, name: String, location: WorkspaceLocation, sessions: [String])] {
        terminalBackend.savedWorkspaces
    }
    var deletedWorkspaceIDs: [String] { terminalBackend.deletedWorkspaces.map(\.id) }

    func setNativeWorkspaces(_ workspaces: [NativeWorkspaceRecord]) {
        terminalBackend.nativeWorkspaces = workspaces
    }

    func loadStoredState() -> MachinenStoredState {
        sessionStore().load()
    }

    func storeState(_ state: MachinenStoredState) {
        sessionStore().save(state)
    }

    func storeManifest(
        version: Int,
        workspaces: [WorkspaceRecord],
        sessions: [TerminalSession]
    ) throws {
        let encoder = JSONEncoder()
        let data = try encoder.encode(InteractionManifest(
            version: version,
            workspaces: workspaces,
            sessions: sessions
        ))
        try data.write(to: temporaryDirectory.appendingPathComponent("terminals.json"))
    }

    private func sessionStore() -> TerminalSessionStore {
        TerminalSessionStore(
            manifestURL: temporaryDirectory.appendingPathComponent("terminals.json")
        )
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

    func terminalTile(in view: NSView) -> TerminalTileView? {
        if let tile = view as? TerminalTileView { return tile }
        return view.subviews.lazy.compactMap(terminalTile).first
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

    func selectedWorkspaceID(of deck: TerminalDeckView) throws -> String? {
        let result = try deck.performAPIOperation("ui.get", params: [:])
        guard let object = result as? [String: Any] else {
            throw InteractionTestFailure("ui.get returned an invalid response")
        }
        return object["selectedWorkspaceId"] as? String
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

    func hasCommandPalette(in deck: TerminalDeckView) -> Bool {
        deck.subviews.contains { $0 is CommandPaletteView }
    }

    func availableSessions(in deck: TerminalDeckView) throws -> AvailableSessionsView {
        guard let manager = deck.subviews.compactMap({ $0 as? AvailableSessionsView }).last else {
            throw InteractionTestFailure("the available sessions picker did not open")
        }
        return manager
    }

    func targetSessions(in deck: TerminalDeckView) throws -> TargetSessionsView {
        guard let browser = deck.subviews.compactMap({ $0 as? TargetSessionsView }).last else {
            throw InteractionTestFailure("the registered target browser did not open")
        }
        return browser
    }

    func undoToast(in deck: TerminalDeckView) -> UndoTerminalCloseView? {
        deck.subviews.compactMap { $0 as? UndoTerminalCloseView }.last
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

    func pressTab(on view: NSView) throws {
        view.keyDown(with: try keyEvent(characters: "\t", keyCode: 48))
    }

    func pressEscape(on view: NSView) throws {
        view.keyDown(with: try keyEvent(characters: "\u{1b}", keyCode: 53))
    }

    func pressDelete(on view: NSView) throws {
        view.keyDown(with: try keyEvent(characters: "\u{7f}", keyCode: 51))
    }

    func commandShiftArrow(keyCode: UInt16) throws -> NSEvent {
        try keyEvent(characters: "", keyCode: keyCode, modifierFlags: [.command, .shift])
    }

    func commandShiftBracket(keyCode: UInt16) throws -> NSEvent {
        let characters = keyCode == 33 ? "{" : "}"
        return try keyEvent(
            characters: characters,
            keyCode: keyCode,
            modifierFlags: [.command, .shift]
        )
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

private struct InteractionManifest: Encodable {
    let version: Int
    let workspaces: [WorkspaceRecord]
    let sessions: [TerminalSession]
}

private struct StatusListSnapshot: Decodable {
    let effectiveWidgets: [StatusWidgetSnapshot]
}

private struct StatusWidgetSnapshot: Decodable {
    struct Scope: Decodable, Equatable {
        let kind: String
        let id: String?
    }

    struct Link: Decodable, Equatable {
        let title: String
        let url: String
    }

    let id: String
    let scope: Scope
    let value: String
    let tooltip: String?
    let graphStyle: String?
    let samples: [Double]?
    let states: [String]?
    let links: [Link]?
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
        let currentWorkingDirectory: String?
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
