import Foundation

struct WorkspaceLocation: Codable, Equatable {
    enum Kind: String, Codable {
        case local
        case ssh
    }

    var kind: Kind
    var path: String
    var host: String?

    static func local(_ path: String) -> WorkspaceLocation {
        WorkspaceLocation(kind: .local, path: path, host: nil)
    }

    static func ssh(host: String, path: String) -> WorkspaceLocation {
        WorkspaceLocation(kind: .ssh, path: path, host: host)
    }

    var sshHost: String? {
        kind == .ssh ? host : nil
    }

    var displayName: String {
        guard let sshHost else { return path }
        return "\(sshHost):\(path)"
    }

    var json: JSONObject {
        var result: JSONObject = [
            "kind": kind.rawValue,
            "path": path,
        ]
        if let sshHost { result["host"] = sshHost }
        return result
    }

    static func parseSSHReference(_ input: String) -> WorkspaceLocation? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        if value.hasPrefix("ssh://"), let components = URLComponents(string: value),
           let hostname = components.host, !hostname.isEmpty, components.port == nil
        {
            let host = components.user.map { "\($0)@\(hostname)" } ?? hostname
            let path = components.percentEncodedPath.removingPercentEncoding ?? components.path
            return validSSHLocation(host: host, path: path)
        }

        guard let separator = value.firstIndex(of: ":") else { return nil }
        let host = String(value[..<separator])
        let path = String(value[value.index(after: separator)...])
        return validSSHLocation(host: host, path: path)
    }

    static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    var remoteShellPath: String {
        if path == "~" { return "\"$HOME\"" }
        if path.hasPrefix("~/") {
            return "\"$HOME\"/" + Self.shellQuote(String(path.dropFirst(2)))
        }
        return Self.shellQuote(path)
    }

    private static func validSSHLocation(host: String, path: String) -> WorkspaceLocation? {
        guard !host.isEmpty, !host.hasPrefix("-"),
              host.unicodeScalars.allSatisfy({
                  !CharacterSet.whitespacesAndNewlines.contains($0)
                      && !CharacterSet.controlCharacters.contains($0)
              }),
              path == "~" || path.hasPrefix("~/") || path.hasPrefix("/"),
              path.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        else { return nil }
        return .ssh(host: host, path: path)
    }
}
