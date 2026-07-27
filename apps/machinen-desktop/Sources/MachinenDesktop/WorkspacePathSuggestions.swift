import Foundation

enum WorkspacePathSuggestions {
    static func localChildDirectories(at path: String) -> [String] {
        let directory = URL(fileURLWithPath: expandedLocalPath(path), isDirectory: true)
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: []
        ) else { return [] }
        return contents.compactMap { url -> String? in
            guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            else { return nil }
            return url.standardizedFileURL.path
        }
        .sorted { left, right in
            let leftHidden = URL(fileURLWithPath: left).lastPathComponent.hasPrefix(".")
            let rightHidden = URL(fileURLWithPath: right).lastPathComponent.hasPrefix(".")
            if leftHidden != rightHidden { return !leftHidden }
            return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
        }
    }

    static func localDirectories(matching query: String) -> [String] {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return [] }
        let expanded = expandedLocalPath(value)
        let parent: URL
        let prefix: String
        if value.hasSuffix("/") {
            parent = URL(fileURLWithPath: expanded, isDirectory: true)
            prefix = ""
        } else {
            let url = URL(fileURLWithPath: expanded)
            parent = url.deletingLastPathComponent()
            prefix = url.lastPathComponent
        }
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: parent,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsPackageDescendants]
        ) else { return [] }
        return contents.compactMap { url -> String? in
            guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
                  (prefix.hasPrefix(".") || !url.lastPathComponent.hasPrefix(".")),
                  fuzzyComponent(prefix, matches: url.lastPathComponent)
            else { return nil }
            return url.standardizedFileURL.path
        }
        .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        .prefix(24)
        .map { $0 }
    }

    static func expandedLocalPath(_ value: String) -> String {
        let input = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if input == "~" { return home }
        if input.hasPrefix("~/") {
            return URL(fileURLWithPath: home).appendingPathComponent(String(input.dropFirst(2))).path
        }
        if input.hasPrefix("/") { return input }
        return URL(fileURLWithPath: home).appendingPathComponent(input).path
    }

    static func displayLocalPath(_ path: String, prefersTilde: Bool) -> String {
        guard prefersTilde else { return path }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path == home { return "~" }
        if path.hasPrefix(home + "/") { return "~/" + String(path.dropFirst(home.count + 1)) }
        return path
    }

    static func fuzzyComponent(_ needle: String, matches candidate: String) -> Bool {
        guard !needle.isEmpty else { return true }
        let value = candidate.lowercased()
        var index = value.startIndex
        for character in needle.lowercased() {
            guard let match = value[index...].firstIndex(of: character) else { return false }
            index = value.index(after: match)
        }
        return true
    }

    static func remoteCompletionRequest(_ query: String) -> (parent: String, prefix: String)? {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if value.hasSuffix("/") {
            let parent = String(value.dropLast())
            return (parent.isEmpty ? "/" : parent, "")
        }
        guard let slash = value.lastIndex(of: "/") else { return ("~", value) }
        let parent = String(value[..<slash])
        return (parent.isEmpty ? "/" : parent, String(value[value.index(after: slash)...]))
    }
}
