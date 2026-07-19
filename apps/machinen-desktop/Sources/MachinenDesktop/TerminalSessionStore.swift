import Foundation

@MainActor
final class TerminalSessionStore {
    private struct Manifest: Codable {
        var version: Int
        var sessions: [TerminalSession]
    }

    let manifestURL: URL

    init() {
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
        manifestURL = root.appendingPathComponent("terminals.json")
    }

    func load() -> [TerminalSession] {
        guard let data = try? Data(contentsOf: manifestURL) else {
            let sessions = TerminalSession.bootstrap()
            save(sessions)
            return sessions
        }
        do {
            return try JSONDecoder().decode(Manifest.self, from: data).sessions
        } catch {
            let backup = manifestURL.appendingPathExtension("invalid")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.moveItem(at: manifestURL, to: backup)
            let sessions = TerminalSession.bootstrap()
            save(sessions)
            return sessions
        }
    }

    func save(_ sessions: [TerminalSession]) {
        do {
            try FileManager.default.createDirectory(
                at: manifestURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(Manifest(version: 1, sessions: sessions))
            try data.write(to: manifestURL, options: .atomic)
        } catch {
            NSLog("Machinen could not save terminal manifest: %@", String(describing: error))
        }
    }
}
