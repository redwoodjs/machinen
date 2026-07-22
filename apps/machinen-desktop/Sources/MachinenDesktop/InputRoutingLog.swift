import AppKit
import Foundation

/// Lightweight, file-backed diagnostics for terminal input routing. This stays
/// enabled in prototype builds so a physical-machine interaction can be traced
/// without requiring Accessibility permission or Console.app.
enum InputRoutingLog {
    private static let directory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/Machinen", isDirectory: true)
    static let url = directory.appendingPathComponent("input-routing.log")
    private static let maximumSize = 1_000_000

    static func start() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
           size > maximumSize
        {
            try? FileManager.default.removeItem(at: url)
        }
        log("--- launch pid=\(ProcessInfo.processInfo.processIdentifier) ---")
    }

    static func log(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let line = "\(timestamp) \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: url.path) {
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: data)
            }
        } else {
            try? data.write(to: url, options: .atomic)
        }
    }

    static func event(_ event: NSEvent) -> String {
        let point = event.locationInWindow
        let flags = event.modifierFlags.intersection([.command, .control, .option, .shift])
        let detail: String
        switch event.type {
        case .keyDown, .keyUp, .flagsChanged:
            detail = "key=\(event.keyCode)"
        case .leftMouseDown, .leftMouseUp, .leftMouseDragged,
             .rightMouseDown, .rightMouseUp, .rightMouseDragged,
             .otherMouseDown, .otherMouseUp, .otherMouseDragged:
            detail = "clicks=\(event.clickCount)"
        default:
            detail = ""
        }
        return "type=\(event.type.rawValue) \(detail) point=(\(Int(point.x)),\(Int(point.y))) flags=\(flags.rawValue)"
    }
}
