import Foundation

struct InteractionIntentPolicy: Codable, Equatable, Sendable {
    enum Level: String, Codable, CaseIterable, Sendable, Hashable {
        case overview
        case workspace
        case terminal
    }

    enum Intent: String, Codable, CaseIterable, Sendable, Hashable {
        case edit
        case new
        case close
    }

    enum Target: String, Codable, Sendable, Hashable {
        case currentWorkspace
        case currentTerminal
        case addWorkspace
        case addTerminal
    }

    enum Panel: String, Codable, Sendable, Hashable {
        case none
        case newWorkspace
        case newTerminal
        case closeWorkspace
        case disconnectTerminal
    }

    enum Camera: String, Codable, Sendable, Hashable {
        case none
        case directIfNeeded
        case parentLevel
    }

    enum Effect: String, Codable, Sendable, Hashable {
        case none
        case createWorkspace
        case createTerminal
        case closeWorkspace
        case disconnectTerminal
    }

    struct Rule: Codable, Equatable, Sendable {
        let level: Level
        let intent: Intent
        let target: Target
        let panel: Panel
        let camera: Camera
        let effect: Effect
    }

    let version: Int
    let cameraDurationMilliseconds: Int
    let rules: [Rule]

    static let defaults = InteractionIntentPolicy(
        version: 1,
        cameraDurationMilliseconds: 200,
        rules: [
            Rule(
                level: .overview,
                intent: .edit,
                target: .currentWorkspace,
                panel: .none,
                camera: .none,
                effect: .none
            ),
            Rule(
                level: .overview,
                intent: .new,
                target: .addWorkspace,
                panel: .newWorkspace,
                camera: .directIfNeeded,
                effect: .createWorkspace
            ),
            Rule(
                level: .overview,
                intent: .close,
                target: .currentWorkspace,
                panel: .closeWorkspace,
                camera: .directIfNeeded,
                effect: .closeWorkspace
            ),
            Rule(
                level: .workspace,
                intent: .edit,
                target: .currentTerminal,
                panel: .none,
                camera: .none,
                effect: .none
            ),
            Rule(
                level: .workspace,
                intent: .new,
                target: .addTerminal,
                panel: .newTerminal,
                camera: .directIfNeeded,
                effect: .createTerminal
            ),
            Rule(
                level: .workspace,
                intent: .close,
                target: .currentTerminal,
                panel: .disconnectTerminal,
                camera: .directIfNeeded,
                effect: .disconnectTerminal
            ),
            Rule(
                level: .terminal,
                intent: .edit,
                target: .currentTerminal,
                panel: .none,
                camera: .parentLevel,
                effect: .none
            ),
            Rule(
                level: .terminal,
                intent: .new,
                target: .addTerminal,
                panel: .newTerminal,
                camera: .directIfNeeded,
                effect: .createTerminal
            ),
            Rule(
                level: .terminal,
                intent: .close,
                target: .currentTerminal,
                panel: .disconnectTerminal,
                camera: .none,
                effect: .disconnectTerminal
            ),
        ]
    )

    func rule(for intent: Intent, at level: Level) -> Rule? {
        rules.first { $0.intent == intent && $0.level == level }
    }

    func validate() throws {
        guard version == 1 else {
            throw InteractionPolicyError("version must be 1")
        }
        guard (0...1_000).contains(cameraDurationMilliseconds) else {
            throw InteractionPolicyError("cameraDurationMilliseconds must be from 0 through 1000")
        }
        var keys = Set<String>()
        for rule in rules {
            let key = "\(rule.level.rawValue):\(rule.intent.rawValue)"
            guard keys.insert(key).inserted else {
                throw InteractionPolicyError("duplicate rule for \(key)")
            }
            guard Self.allowedPanelEffects[rule.panel] == rule.effect else {
                throw InteractionPolicyError(
                    "panel \(rule.panel.rawValue) cannot run effect \(rule.effect.rawValue)"
                )
            }
            try Self.validateTarget(rule.target, panel: rule.panel)
            try Self.validateRuleShape(rule)
        }
        for level in Level.allCases {
            for intent in Intent.allCases {
                let key = "\(level.rawValue):\(intent.rawValue)"
                guard keys.contains(key) else {
                    throw InteractionPolicyError("missing rule for \(key)")
                }
            }
        }
    }

    private static let allowedPanelEffects: [Panel: Effect] = [
        .none: .none,
        .newWorkspace: .createWorkspace,
        .newTerminal: .createTerminal,
        .closeWorkspace: .closeWorkspace,
        .disconnectTerminal: .disconnectTerminal,
    ]

    private static func validateRuleShape(_ rule: Rule) throws {
        let expected: (Target, Panel, Effect)
        switch (rule.level, rule.intent) {
        case (.overview, .edit):
            expected = (.currentWorkspace, .none, .none)
        case (.overview, .new):
            expected = (.addWorkspace, .newWorkspace, .createWorkspace)
        case (.overview, .close):
            expected = (.currentWorkspace, .closeWorkspace, .closeWorkspace)
        case (.workspace, .edit), (.terminal, .edit):
            expected = (.currentTerminal, .none, .none)
        case (.workspace, .new), (.terminal, .new):
            expected = (.addTerminal, .newTerminal, .createTerminal)
        case (.workspace, .close), (.terminal, .close):
            expected = (.currentTerminal, .disconnectTerminal, .disconnectTerminal)
        }
        guard rule.target == expected.0,
            rule.panel == expected.1,
            rule.effect == expected.2
        else {
            throw InteractionPolicyError(
                "rule \(rule.level.rawValue):\(rule.intent.rawValue) has an unsafe action shape"
            )
        }
    }

    private static func validateTarget(_ target: Target, panel: Panel) throws {
        let expectedTarget: Target?
        switch panel {
        case .none:
            expectedTarget = nil
        case .newWorkspace:
            expectedTarget = .addWorkspace
        case .newTerminal:
            expectedTarget = .addTerminal
        case .closeWorkspace:
            expectedTarget = .currentWorkspace
        case .disconnectTerminal:
            expectedTarget = .currentTerminal
        }
        if let expectedTarget, target != expectedTarget {
            throw InteractionPolicyError(
                "panel \(panel.rawValue) requires target \(expectedTarget.rawValue)"
            )
        }
    }
}

struct InteractionPolicyError: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

@MainActor
final class InteractionIntentEngine: NSObject {
    static var defaultURL: URL {
        let environment = ProcessInfo.processInfo.environment
        let configRoot: URL
        if let xdgConfigHome = environment["XDG_CONFIG_HOME"], !xdgConfigHome.isEmpty {
            configRoot = URL(fileURLWithPath: xdgConfigHome, isDirectory: true)
        } else {
            configRoot = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config", isDirectory: true)
        }
        return
            configRoot
            .appendingPathComponent("machinen", isDirectory: true)
            .appendingPathComponent("interactions.json")
    }

    private(set) var policy: InteractionIntentPolicy
    private(set) var generation = 1
    let policyURL: URL?

    private var lastAcceptedData: Data?
    private var lastAttemptedData: Data?
    private var reloadTimer: Timer?

    init(policy: InteractionIntentPolicy = .defaults) {
        self.policy = policy
        policyURL = nil
        super.init()
    }

    init(
        url: URL = defaultURL,
        createIfMissing: Bool = true,
        watch: Bool = true,
        reloadInterval: TimeInterval = 0.5
    ) {
        policy = .defaults
        policyURL = url
        super.init()
        if createIfMissing, !FileManager.default.fileExists(atPath: url.path) {
            do {
                try Self.writeDefaultPolicy(to: url)
            } catch {
                NSLog(
                    "Machinen could not create interaction policy at %@: %@",
                    url.path,
                    String(describing: error)
                )
            }
        }
        _ = reloadNow()
        if watch {
            let timer = Timer(
                timeInterval: reloadInterval,
                target: self,
                selector: #selector(checkForPolicyChange),
                userInfo: nil,
                repeats: true
            )
            reloadTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    func stopWatching() {
        reloadTimer?.invalidate()
        reloadTimer = nil
    }

    func snapshot() -> InteractionIntentPolicy {
        policy
    }

    @discardableResult
    func reloadNow() -> Bool {
        guard let policyURL else { return true }
        do {
            let data = try Data(contentsOf: policyURL)
            guard data != lastAcceptedData else {
                lastAttemptedData = data
                return true
            }
            let candidate = try JSONDecoder().decode(InteractionIntentPolicy.self, from: data)
            try candidate.validate()
            policy = candidate
            lastAcceptedData = data
            lastAttemptedData = data
            generation += 1
            NSLog(
                "Machinen loaded interaction policy generation %d from %@",
                generation,
                policyURL.path
            )
            return true
        } catch {
            let attemptedData = try? Data(contentsOf: policyURL)
            if attemptedData != lastAttemptedData {
                NSLog(
                    "Machinen retained interaction policy generation %d after reload error at %@: %@",
                    generation,
                    policyURL.path,
                    String(describing: error)
                )
            }
            lastAttemptedData = attemptedData
            return false
        }
    }

    @objc private func checkForPolicyChange() {
        guard let policyURL,
            let data = try? Data(contentsOf: policyURL),
            data != lastAttemptedData
        else { return }
        _ = reloadNow()
    }

    static func encodedPolicy(_ policy: InteractionIntentPolicy) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(policy)
        data.append(0x0A)
        return data
    }

    private static func writeDefaultPolicy(to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try encodedPolicy(.defaults).write(to: url, options: .atomic)
    }
}
