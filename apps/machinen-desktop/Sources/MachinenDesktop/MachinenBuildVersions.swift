import Foundation

enum MachinenBuildVersions {
    static let sessionHandler = "0.5.6"

    static var desktop: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            ?? "0.1.0"
    }

    static var statusText: String {
        "Desktop \(desktop) · Session \(sessionHandler)"
    }
}
