import Foundation

@MainActor
final class TerminalSessionStore {
    private struct Manifest: Codable {
        var version: Int
        var workspaces: [WorkspaceRecord]?
        var sessions: [TerminalSession]
        var workspaceLocationHistory: [WorkspaceLocation]?
        var targetMachines: [TargetMachine]?
        var selectedWorkspaceID: String?
        var selectedTerminalID: String?
        var uiLevel: String?
    }

    let manifestURL: URL
    private let sceneClient: AuthoritativeSceneClient?
    private let serverAddress: MachinenServerAddress?
    private var sceneRevision: Int64 = 0

    init(
        manifestURL: URL? = nil,
        serverAddress: MachinenServerAddress? = nil
    ) {
        if let manifestURL {
            self.manifestURL = manifestURL
            sceneClient = nil
            self.serverAddress = nil
            return
        }
        let environment = ProcessInfo.processInfo.environment
        let root: URL
        if let override = environment["MACHINEN_STATE_DIR"], !override.isEmpty {
            root = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            root = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            )[0].appendingPathComponent("Machinen", isDirectory: true)
        }
        self.manifestURL = root.appendingPathComponent("terminals.json")
        let address = serverAddress ?? MachinenServerAddress.resolve()
        self.serverAddress = address
        sceneClient = AuthoritativeSceneClient(
            address: address,
            clientID: Self.stableClientID()
        )
    }

    func load() -> MachinenStoredState {
        guard let sceneClient else { return loadLegacyManifest() }
        do {
            let snapshot = try sceneClient.snapshot()
            sceneRevision = snapshot.revision
            if let data = snapshot.data { return try decode(data) }
            guard serverAddress?.isLocal == true else {
                fatalError("The configured scene server has no scene to load")
            }
            let state = loadLegacyManifest()
            let data = try encode(state)
            sceneRevision = try sceneClient.apply(
                data: data,
                idempotencyKey: "initial-scene-" + Self.sceneFingerprint(data),
                expectedRevision: sceneRevision
            )
            return state
        } catch {
            fatalError("Machinen requires its scene server: \(error)")
        }
    }

    func save(_ state: MachinenStoredState) {
        guard let sceneClient else {
            saveLegacyManifest(state)
            return
        }
        do {
            let data = try encode(state)
            let key = UUID().uuidString.lowercased()
            do {
                sceneRevision = try sceneClient.apply(
                    data: data,
                    idempotencyKey: key,
                    expectedRevision: sceneRevision
                )
            } catch {
                let latest = try sceneClient.snapshot()
                sceneRevision = latest.revision
                sceneRevision = try sceneClient.apply(
                    data: data,
                    idempotencyKey: key,
                    expectedRevision: sceneRevision
                )
            }
        } catch {
            fatalError("Machinen lost its scene server: \(error)")
        }
    }

    func refresh() async -> MachinenStoredState? {
        guard let sceneClient else { return nil }
        do {
            let snapshot = try await Task.detached(priority: .utility) {
                try sceneClient.snapshot()
            }.value
            guard snapshot.revision > sceneRevision, let data = snapshot.data else { return nil }
            sceneRevision = snapshot.revision
            return try decode(data)
        } catch {
            fatalError("Machinen lost its scene server: \(error)")
        }
    }

    private func loadLegacyManifest() -> MachinenStoredState {
        guard let data = try? Data(contentsOf: manifestURL) else {
            let state = MachinenStoredState(workspaces: [], sessions: [])
            saveLegacyManifest(state)
            return state
        }
        do {
            return try decode(data)
        } catch {
            let backup = manifestURL.appendingPathExtension("invalid")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.moveItem(at: manifestURL, to: backup)
            let state = MachinenStoredState(workspaces: [], sessions: [])
            saveLegacyManifest(state)
            return state
        }
    }

    private func decode(_ data: Data) throws -> MachinenStoredState {
        let manifest = try JSONDecoder().decode(Manifest.self, from: data)
        return migrate(
            workspaces: manifest.workspaces,
            sessions: manifest.sessions,
            workspaceLocationHistory: manifest.workspaceLocationHistory,
            targetMachines: manifest.targetMachines,
            selectedWorkspaceID: manifest.selectedWorkspaceID,
            selectedTerminalID: manifest.selectedTerminalID,
            uiLevel: manifest.uiLevel
        )
    }

    private func encode(_ state: MachinenStoredState) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(Manifest(
            version: 11,
            workspaces: state.workspaces,
            sessions: state.sessions,
            workspaceLocationHistory: state.workspaceLocationHistory,
            targetMachines: state.targetMachines,
            selectedWorkspaceID: state.selectedWorkspaceID,
            selectedTerminalID: state.selectedTerminalID,
            uiLevel: state.uiLevel
        ))
    }

    private func saveLegacyManifest(_ state: MachinenStoredState) {
        do {
            try FileManager.default.createDirectory(
                at: manifestURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try encode(state).write(to: manifestURL, options: .atomic)
        } catch {
            NSLog("Machinen could not save terminal manifest: %@", String(describing: error))
        }
    }

    private static func stableClientID() -> String {
        let key = "MachinenAuthoritativeClientID"
        if let value = UserDefaults.standard.string(forKey: key), !value.isEmpty { return value }
        let value = "desktop_" + UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
    }

    private static func sceneFingerprint(_ data: Data) -> String {
        data.base64EncodedString().prefix(64).description
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
    }

    private func migrate(
        workspaces existingWorkspaces: [WorkspaceRecord]?,
        sessions: [TerminalSession],
        workspaceLocationHistory existingLocationHistory: [WorkspaceLocation]?,
        targetMachines existingTargets: [TargetMachine]?,
        selectedWorkspaceID: String? = nil,
        selectedTerminalID: String? = nil,
        uiLevel: String? = nil
    ) -> MachinenStoredState {
        var workspaces = existingWorkspaces ?? []
        var workspaceByLegacyName: [String: WorkspaceRecord] = [:]
        var usedNameKeys = Set<String>()
        for workspace in workspaces {
            let legacyName = workspace.name
            if workspace.workingDirectory.isEmpty {
                workspace.workingDirectory = sessions.first(where: {
                    $0.workspaceID == workspace.id || $0.workspace == legacyName
                })?.workingDirectory ?? FileManager.default.homeDirectoryForCurrentUser.path
            }
            if workspaceByLegacyName[legacyName] == nil {
                workspaceByLegacyName[legacyName] = workspace
            }
            workspace.name = WorkspaceName.unique(legacyName, reserving: &usedNameKeys)
        }

        for session in sessions {
            let workspace: WorkspaceRecord
            if !session.workspaceID.isEmpty,
               let existing = workspaces.first(where: { $0.id == session.workspaceID })
            {
                workspace = existing
            } else if let existing = workspaceByLegacyName[session.workspace] {
                workspace = existing
            } else {
                let name = WorkspaceName.unique(session.workspace, reserving: &usedNameKeys)
                workspace = WorkspaceRecord(
                    name: name,
                    workingDirectory: session.workingDirectory
                )
                workspaces.append(workspace)
                workspaceByLegacyName[session.workspace] = workspace
            }
            session.workspaceID = workspace.id
            session.workspace = workspace.name
            if session.workspaceRoot == session.workingDirectory {
                session.workspaceRoot = workspace.workingDirectory
            }
        }

        var locationHistory = existingLocationHistory ?? []
        for location in workspaces.map(\.location) where !locationHistory.contains(location) {
            locationHistory.append(location)
        }
        // Seed intentional SSH locations only while upgrading a manifest that
        // predates targets. An empty v11 list means the user removed them.
        var targets = existingTargets ?? []
        if existingTargets == nil {
            var targetHosts = Set<String>()
            for location in locationHistory + workspaces.map(\.location) {
                guard let host = location.sshHost else { continue }
                let key = TargetMachine.normalizedHost(host)
                guard targetHosts.insert(key).inserted else { continue }
                targets.append(TargetMachine(sshHost: host))
            }
        }
        return MachinenStoredState(
            workspaces: workspaces,
            sessions: sessions,
            workspaceLocationHistory: locationHistory,
            targetMachines: targets,
            selectedWorkspaceID: selectedWorkspaceID,
            selectedTerminalID: selectedTerminalID,
            uiLevel: uiLevel
        )
    }
}
