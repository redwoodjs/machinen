import AppKit

struct MachinenConfiguration {
    private struct FileContents: Codable {
        let shortcuts: [String: String]
        let server: String?
    }

    let shortcuts: [DesktopShortcutAction: DesktopShortcutBinding]
    let server: String?

    static var defaultURL: URL {
        let environment = ProcessInfo.processInfo.environment
        let configRoot: URL
        if let xdgConfigHome = environment["XDG_CONFIG_HOME"], !xdgConfigHome.isEmpty {
            configRoot = URL(fileURLWithPath: xdgConfigHome, isDirectory: true)
        } else {
            configRoot = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config", isDirectory: true)
        }
        return configRoot
            .appendingPathComponent("machinen", isDirectory: true)
            .appendingPathComponent("config.json")
    }

    static var defaults: MachinenConfiguration {
        MachinenConfiguration(
            shortcuts: defaultShortcutStrings.compactMapValues(DesktopShortcutBinding.init),
            server: nil
        )
    }

    static func load(
        from url: URL = defaultURL,
        createIfMissing: Bool = true
    ) -> MachinenConfiguration {
        let fileManager = FileManager.default
        if !fileManager.fileExists(atPath: url.path) {
            if createIfMissing {
                do {
                    try writeDefaults(to: url)
                } catch {
                    NSLog("Machinen could not create config at %@: %@", url.path, String(describing: error))
                }
            }
            return defaults
        }

        do {
            let contents = try JSONDecoder().decode(FileContents.self, from: Data(contentsOf: url))
            var descriptions = contents.shortcuts
            var updatedDefaults = false
            for (action, description) in defaultShortcutStrings {
                let name = action.rawValue
                if let legacyDescription = legacyShortcutStrings[action],
                   descriptions[name] == legacyDescription
                {
                    descriptions[name] = description
                    updatedDefaults = true
                } else if descriptions[name] == nil {
                    descriptions[name] = description
                    updatedDefaults = true
                }
            }
            if updatedDefaults {
                do {
                    try write(FileContents(shortcuts: descriptions, server: contents.server), to: url)
                } catch {
                    NSLog("Machinen could not update config at %@: %@", url.path, String(describing: error))
                }
            }

            var shortcuts = defaults.shortcuts
            for (name, description) in descriptions {
                guard let action = DesktopShortcutAction(rawValue: name) else {
                    NSLog("Machinen config ignored unknown shortcut action '%@'", name)
                    continue
                }
                guard let binding = DesktopShortcutBinding(description) else {
                    NSLog("Machinen config ignored invalid shortcut '%@' for %@", description, name)
                    continue
                }
                shortcuts[action] = binding
            }
            return MachinenConfiguration(shortcuts: shortcuts, server: contents.server)
        } catch {
            NSLog("Machinen could not read config at %@: %@", url.path, String(describing: error))
            return defaults
        }
    }

    private static let defaultShortcutStrings: [DesktopShortcutAction: String] = [
        .enter: "cmd+shift+down",
        .leave: "cmd+shift+up",
        .selectLeft: "left",
        .selectRight: "right",
        .selectDown: "down",
        .selectUp: "up",
        .moveLeft: "shift+left",
        .moveRight: "shift+right",
        .moveDown: "shift+down",
        .moveUp: "shift+up",
        .previousPane: "cmd+shift+left",
        .nextPane: "cmd+shift+right",
        .previousWorkspace: "cmd+shift+[",
        .nextWorkspace: "cmd+shift+]",
    ]

    private static let legacyShortcutStrings: [DesktopShortcutAction: String] = [
        .enter: "cmd+down",
        .leave: "cmd+up",
        .moveLeft: "cmd+shift+left",
        .moveRight: "cmd+shift+right",
        .moveDown: "cmd+shift+down",
        .moveUp: "cmd+shift+up",
        .previousPane: "cmd+left",
        .nextPane: "cmd+right",
        .previousWorkspace: "cmd+[",
        .nextWorkspace: "cmd+]",
    ]

    private static func writeDefaults(to url: URL) throws {
        let shortcuts = Dictionary(uniqueKeysWithValues: defaultShortcutStrings.map {
            ($0.key.rawValue, $0.value)
        })
        try write(FileContents(shortcuts: shortcuts, server: nil), to: url)
    }

    private static func write(_ contents: FileContents, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(contents)
        data.append(0x0A)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: url, options: .atomic)
    }
}

enum DesktopShortcutAction: String, CaseIterable {
    case enter
    case leave
    case selectLeft
    case selectRight
    case selectDown
    case selectUp
    case moveLeft
    case moveRight
    case moveDown
    case moveUp
    case previousPane
    case nextPane
    case previousWorkspace
    case nextWorkspace
}

struct DesktopShortcutBinding: Equatable {
    private enum Key: Equatable {
        case keyCode(UInt16)
        case character(String)
    }

    private static let recognizedModifiers: NSEvent.ModifierFlags = [
        .command,
        .control,
        .option,
        .shift,
    ]

    private let modifiers: NSEvent.ModifierFlags
    private let key: Key

    init?(_ description: String) {
        let tokens = description
            .split(separator: "+", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        guard !tokens.isEmpty, tokens.allSatisfy({ !$0.isEmpty }) else { return nil }

        var modifiers: NSEvent.ModifierFlags = []
        var key: Key?
        for token in tokens {
            let modifier: NSEvent.ModifierFlags?
            switch token {
            case "cmd", "command", "super": modifier = .command
            case "ctrl", "control": modifier = .control
            case "opt", "option", "alt": modifier = .option
            case "shift": modifier = .shift
            default: modifier = nil
            }
            if let modifier {
                guard !modifiers.contains(modifier) else { return nil }
                modifiers.insert(modifier)
                continue
            }
            guard key == nil, let parsedKey = Self.parseKey(token) else { return nil }
            key = parsedKey
        }
        guard let key else { return nil }
        self.modifiers = modifiers
        self.key = key
    }

    func matches(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown,
              event.modifierFlags.intersection(Self.recognizedModifiers) == modifiers
        else { return false }

        switch key {
        case .keyCode(let keyCode):
            return event.keyCode == keyCode
        case .character(let character):
            return event.charactersIgnoringModifiers?.lowercased() == character
        }
    }

    private static func parseKey(_ value: String) -> Key? {
        switch value {
        case "[", "leftbracket": return .keyCode(33)
        case "]", "rightbracket": return .keyCode(30)
        case "left": return .keyCode(123)
        case "right": return .keyCode(124)
        case "down": return .keyCode(125)
        case "up": return .keyCode(126)
        case "return", "enter": return .keyCode(36)
        case "tab": return .keyCode(48)
        case "space": return .keyCode(49)
        case "backspace", "delete": return .keyCode(51)
        case "escape", "esc": return .keyCode(53)
        default:
            return value.count == 1 ? .character(value) : nil
        }
    }
}

@MainActor
final class DesktopShortcutMonitor {
    private var monitor: Any?
    private let shortcuts: [DesktopShortcutAction: DesktopShortcutBinding]
    private let handler: (DesktopShortcutAction) -> Bool

    init(
        shortcuts: [DesktopShortcutAction: DesktopShortcutBinding],
        startMonitoring: Bool = true,
        handler: @escaping (DesktopShortcutAction) -> Bool
    ) {
        self.shortcuts = shortcuts
        self.handler = handler
        if startMonitoring {
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                self?.process(event) ?? event
            }
        }
    }

    func process(_ event: NSEvent) -> NSEvent? {
        for action in DesktopShortcutAction.allCases
        where shortcuts[action]?.matches(event) == true {
            if handler(action) { return nil }
        }
        return event
    }

    func stop() {
        guard let monitor else { return }
        NSEvent.removeMonitor(monitor)
        self.monitor = nil
    }
}
