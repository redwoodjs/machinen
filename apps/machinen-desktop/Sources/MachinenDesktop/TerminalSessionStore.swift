import Foundation

@MainActor
final class TerminalSessionStore {
    private struct Manifest: Codable {
        var version: Int
        var workspaces: [WorkspaceRecord]?
        var sessions: [TerminalSession]
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
            let state = TerminalSession.bootstrap()
            save(state)
            return state
        }
        do {
            let manifest = try JSONDecoder().decode(Manifest.self, from: data)
            let state = migrate(workspaces: manifest.workspaces, sessions: manifest.sessions)
            if manifest.version < 3 || manifest.workspaces == nil {
                save(state)
            }
            return state
        } catch {
            let backup = manifestURL.appendingPathExtension("invalid")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.moveItem(at: manifestURL, to: backup)
            let state = TerminalSession.bootstrap()
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
            let manifest = Manifest(version: 3, workspaces: state.workspaces, sessions: state.sessions)
            let data = try encoder.encode(manifest)
            try data.write(to: manifestURL, options: .atomic)
        } catch {
            NSLog("Machinen could not save terminal manifest: %@", String(describing: error))
        }
    }

    private func migrate(
        workspaces existingWorkspaces: [WorkspaceRecord]?,
        sessions: [TerminalSession]
    ) -> MachinenStoredState {
        var workspaces = existingWorkspaces ?? []
        var workspaceByName: [String: WorkspaceRecord] = [:]
        for workspace in workspaces where workspaceByName[workspace.name] == nil {
            if workspace.workingDirectory.isEmpty {
                workspace.workingDirectory = sessions.first(where: {
                    $0.workspaceID == workspace.id || $0.workspace == workspace.name
                })?.workingDirectory ?? FileManager.default.homeDirectoryForCurrentUser.path
            }
            workspaceByName[workspace.name] = workspace
        }

        for session in sessions {
            let workspace: WorkspaceRecord
            if !session.workspaceID.isEmpty,
               let existing = workspaces.first(where: { $0.id == session.workspaceID })
            {
                workspace = existing
            } else if let existing = workspaceByName[session.workspace] {
                workspace = existing
            } else {
                workspace = WorkspaceRecord(
                    name: session.workspace,
                    workingDirectory: session.workingDirectory
                )
                workspaces.append(workspace)
                workspaceByName[workspace.name] = workspace
            }
            session.workspaceID = workspace.id
            session.workspace = workspace.name
        }

        return MachinenStoredState(workspaces: workspaces, sessions: sessions)
    }
}
