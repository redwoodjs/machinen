import Foundation

@MainActor
final class TerminalSessionStore {
    private struct Manifest: Codable {
        var version: Int
        var workspaces: [WorkspaceRecord]?
        var sessions: [TerminalSession]
        var workspaceLocationHistory: [WorkspaceLocation]?
        var targetMachines: [TargetMachine]?
    }

    let manifestURL: URL

    init(manifestURL: URL? = nil) {
        if let manifestURL {
            self.manifestURL = manifestURL
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
    }

    func load() -> MachinenStoredState {
        guard let data = try? Data(contentsOf: manifestURL) else {
            let state = MachinenStoredState(workspaces: [], sessions: [])
            save(state)
            return state
        }
        do {
            let manifest = try JSONDecoder().decode(Manifest.self, from: data)
            let state = migrate(
                workspaces: manifest.workspaces,
                sessions: manifest.sessions,
                workspaceLocationHistory: manifest.workspaceLocationHistory,
                targetMachines: manifest.targetMachines
            )
            if manifest.version < 11 || manifest.workspaces == nil
                || manifest.workspaceLocationHistory == nil || manifest.targetMachines == nil
            {
                save(state)
            }
            return state
        } catch {
            let backup = manifestURL.appendingPathExtension("invalid")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.moveItem(at: manifestURL, to: backup)
            let state = MachinenStoredState(workspaces: [], sessions: [])
            save(state)
            return state
        }
    }

    func save(_ state: MachinenStoredState) {
        do {
            try FileManager.default.createDirectory(
                at: manifestURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let manifest = Manifest(
                version: 11,
                workspaces: state.workspaces,
                sessions: state.sessions,
                workspaceLocationHistory: state.workspaceLocationHistory,
                targetMachines: state.targetMachines
            )
            let data = try encoder.encode(manifest)
            try data.write(to: manifestURL, options: .atomic)
        } catch {
            NSLog("Machinen could not save terminal manifest: %@", String(describing: error))
        }
    }

    private func migrate(
        workspaces existingWorkspaces: [WorkspaceRecord]?,
        sessions: [TerminalSession],
        workspaceLocationHistory existingLocationHistory: [WorkspaceLocation]?,
        targetMachines existingTargets: [TargetMachine]?
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
        // Existing SSH workspace locations are intentional user choices, so
        // seed them as polling profiles. Do not restore their workspaces here.
        var targets = existingTargets ?? []
        var targetHosts = Set(targets.map { TargetMachine.normalizedHost($0.sshHost) })
        for location in locationHistory + workspaces.map(\.location) {
            guard let host = location.sshHost else { continue }
            let key = TargetMachine.normalizedHost(host)
            guard targetHosts.insert(key).inserted else { continue }
            targets.append(TargetMachine(sshHost: host))
        }
        return MachinenStoredState(
            workspaces: workspaces,
            sessions: sessions,
            workspaceLocationHistory: locationHistory,
            targetMachines: targets
        )
    }
}
