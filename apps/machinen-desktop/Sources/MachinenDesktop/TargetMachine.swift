import Foundation

/// A machine Desktop is allowed to poll. Local is always implicit; remote
/// machines are explicit connection profiles and never imply a workspace.
struct TargetMachine: Codable, Equatable {
    let id: String
    var sshHost: String

    init(id: String = "target_" + UUID().uuidString.lowercased(), sshHost: String) {
        self.id = id
        self.sshHost = sshHost
    }

    var location: WorkspaceLocation { .ssh(host: sshHost, path: "~") }
    var displayName: String { sshHost }

    var json: JSONObject {
        [
            "id": id,
            "kind": "ssh",
            "host": sshHost,
        ]
    }

    static func normalizedHost(_ host: String) -> String {
        host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

struct TargetDiscovery {
    enum State: String, Equatable {
        case online
        case unreachable
        case inactive
    }

    var state: State
    var sessions: [AvailableTerminalSession]
    var workspaces: [NativeWorkspaceRecord]
    var checkedAt: Date
    var error: String?
}
