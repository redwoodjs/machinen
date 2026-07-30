import Foundation

struct MachinenContextCommand {
    enum Context: String {
        case workspace
        case terminal
    }

    let id: String
    let title: String
    let subtitle: String?
    let group: String?
    let context: Context
    let locationKinds: [WorkspaceLocation.Kind]?
    let priority: Int
    let expiresAt: TimeInterval?

    func matches(context: Context, location: WorkspaceLocation) -> Bool {
        guard self.context == context else { return false }
        return locationKinds?.contains(location.kind) ?? true
    }

    func json() -> JSONObject {
        var result: JSONObject = [
            "id": id,
            "title": title,
            "context": context.rawValue,
            "priority": priority,
        ]
        if let subtitle { result["subtitle"] = subtitle }
        if let group { result["group"] = group }
        if let locationKinds { result["locationKinds"] = locationKinds.map(\.rawValue) }
        if let expiresAt {
            result["expiresAt"] = ISO8601DateFormatter().string(
                from: Date(timeIntervalSince1970: expiresAt)
            )
        }
        return result
    }
}
