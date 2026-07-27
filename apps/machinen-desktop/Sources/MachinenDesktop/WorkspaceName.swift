import Foundation

enum WorkspaceName {
    private static let comparisonLocale = Locale(identifier: "en_US_POSIX")

    static func validated(_ value: String) -> String? {
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty,
              cleaned.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        else { return nil }
        return cleaned
    }

    static func key(_ value: String) -> String {
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.folding(options: [.caseInsensitive], locale: comparisonLocale)
    }

    static func unique(_ requested: String, reserving keys: inout Set<String>) -> String {
        let base = validated(requested) ?? "workspace"
        var candidate = base
        var suffix = 2
        while keys.contains(key(candidate)) {
            candidate = "\(base) \(suffix)"
            suffix += 1
        }
        keys.insert(key(candidate))
        return candidate
    }
}
