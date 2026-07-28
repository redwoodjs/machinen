import Foundation

struct MachinenSelectionOpener {
    let id: String
    let title: String
    let subtitle: String?
    let selectionPattern: String?
    let locationKinds: [WorkspaceLocation.Kind]?
    let priority: Int
    let expiresAt: TimeInterval?

    func matches(selection: String, location: WorkspaceLocation) -> Bool {
        if let locationKinds, !locationKinds.contains(location.kind) { return false }
        guard let selectionPattern else { return true }
        guard let expression = try? NSRegularExpression(
            pattern: selectionPattern,
            options: [.caseInsensitive]
        ) else { return false }
        let range = NSRange(selection.startIndex..<selection.endIndex, in: selection)
        return expression.firstMatch(in: selection, range: range) != nil
    }

    func json() -> JSONObject {
        var result: JSONObject = [
            "id": id,
            "title": title,
            "priority": priority,
        ]
        if let subtitle { result["subtitle"] = subtitle }
        if let selectionPattern { result["selectionPattern"] = selectionPattern }
        if let locationKinds { result["locationKinds"] = locationKinds.map(\.rawValue) }
        if let expiresAt {
            result["expiresAt"] = ISO8601DateFormatter().string(
                from: Date(timeIntervalSince1970: expiresAt)
            )
        }
        return result
    }
}
