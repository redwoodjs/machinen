import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Selects the shared-state server without using the Desktop location.
struct MachinenServerAddress: Equatable, Sendable {
    let value: String

    static func commandOption(arguments: [String] = CommandLine.arguments) -> String? {
        guard let index = arguments.firstIndex(of: "--server"), arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }

    static func resolve(
        commandOption: String? = MachinenServerAddress.commandOption(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        savedSetting: String? = nil
    ) -> MachinenServerAddress {
        let choices = [commandOption, environment["MACHINEN_SERVER"], savedSetting]
        if let value = choices.compactMap({ $0?.trimmingCharacters(in: .whitespacesAndNewlines) })
            .first(where: { !$0.isEmpty })
        {
            return MachinenServerAddress(value: value)
        }
        return MachinenServerAddress(value: "unix:///var/run/machinen/server.sock")
    }

    var isLocal: Bool { value.hasPrefix("unix://") }
}

struct AuthoritativeChange: Codable, Equatable, Sendable {
    let revision: Int64
    let type: String
    let recordID: String
    let clientID: String
    let timestamp: Date
    let data: Data
}

struct AuthoritativeSnapshot: Codable, Equatable, Sendable {
    let revision: Int64
    /// The key is a record type such as `workspace`, `tile`, or `terminal`.
    let records: [String: [String: Data]]
}

enum AuthoritativeServerError: Error, Equatable {
    case unknownClient
    case idempotencyConflict
    case invalidRecord
    case revisionGap
    case revisionConflict
    case database(String)
    case unavailable(String)
}

private struct AuthoritativeRequest: Codable {
    enum Operation: String, Codable { case snapshot, apply }

    let operation: Operation
    let clientID: String
    let idempotencyKey: String?
    let expectedRevision: Int64?
    let data: Data?
}

private struct AuthoritativeResponse: Codable {
    let ok: Bool
    let revision: Int64?
    let data: Data?
    let error: String?
}

/// Runs one request against the one scene database on the server host.
/// The Desktop uses this entry point locally and through SSH.
struct AuthoritativeSceneCommand {
    static let version = "1"
    static let requestOption = "--authoritative-scene-request"
    static let versionOption = "--authoritative-scene-version"
    static let sceneKind = "scene"
    static let sceneID = "primary"

    static func runIfRequested(arguments: [String] = CommandLine.arguments) -> Int32? {
        if arguments.contains(versionOption) {
            print(version)
            return 0
        }
        guard let index = arguments.firstIndex(of: requestOption),
              arguments.indices.contains(index + 1),
              let requestData = Data(base64Encoded: arguments[index + 1])
        else { return nil }
        do {
            let request = try JSONDecoder().decode(AuthoritativeRequest.self, from: requestData)
            let store = try AuthoritativeStore(databaseURL: databaseURL())
            try store.registerClient(id: request.clientID, user: NSUserName())
            let response: AuthoritativeResponse
            switch request.operation {
            case .snapshot:
                let snapshot = try store.snapshot()
                response = AuthoritativeResponse(
                    ok: true,
                    revision: snapshot.revision,
                    data: snapshot.records[sceneKind]?[sceneID],
                    error: nil
                )
            case .apply:
                guard let data = request.data, let key = request.idempotencyKey else {
                    throw AuthoritativeServerError.invalidRecord
                }
                let change = try store.apply(
                    type: sceneKind,
                    recordID: sceneID,
                    data: data,
                    clientID: request.clientID,
                    idempotencyKey: key,
                    expectedRevision: request.expectedRevision
                )
                response = AuthoritativeResponse(
                    ok: true,
                    revision: change.revision,
                    data: change.data,
                    error: nil
                )
            }
            print(try encoded(response))
            return 0
        } catch {
            let response = AuthoritativeResponse(
                ok: false,
                revision: nil,
                data: nil,
                error: String(describing: error)
            )
            if let value = try? encoded(response) { print(value) }
            return 1
        }
    }

    private static func databaseURL() throws -> URL {
        let root: URL
        if let override = ProcessInfo.processInfo.environment["MACHINEN_STATE_DIR"],
           !override.isEmpty
        {
            root = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            root = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            )[0].appendingPathComponent("Machinen", isDirectory: true)
        }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent("scene.sqlite3")
    }

    private static func encoded(_ response: AuthoritativeResponse) throws -> String {
        try JSONEncoder().encode(response).base64EncodedString()
    }
}

/// A strict scene client. It never reads or writes a second shared-state store.
final class AuthoritativeSceneClient: @unchecked Sendable {
    struct Snapshot: Sendable { let revision: Int64; let data: Data? }

    private let address: MachinenServerAddress
    private let clientID: String
    private let lock = NSLock()
    private var installedRemoteHosts = Set<String>()

    init(address: MachinenServerAddress, clientID: String) {
        self.address = address
        self.clientID = clientID
    }

    func snapshot() throws -> Snapshot {
        let response = try request(.snapshot, key: nil, expectedRevision: nil, data: nil)
        return Snapshot(revision: response.revision ?? 0, data: response.data)
    }

    func apply(
        data: Data,
        idempotencyKey: String,
        expectedRevision: Int64
    ) throws -> Int64 {
        let response = try request(
            .apply,
            key: idempotencyKey,
            expectedRevision: expectedRevision,
            data: data
        )
        guard let revision = response.revision else {
            throw AuthoritativeServerError.unavailable("The scene server returned no revision")
        }
        return revision
    }

    private func request(
        _ operation: AuthoritativeRequest.Operation,
        key: String?,
        expectedRevision: Int64?,
        data: Data?
    ) throws -> AuthoritativeResponse {
        let request = AuthoritativeRequest(
            operation: operation,
            clientID: clientID,
            idempotencyKey: key,
            expectedRevision: expectedRevision,
            data: data
        )
        let encoded = try JSONEncoder().encode(request).base64EncodedString()
        let result: String
        if address.isLocal {
            result = try run(
                executable: CommandLine.arguments[0],
                arguments: [AuthoritativeSceneCommand.requestOption, encoded]
            )
        } else {
            let host = try remoteHost()
            try ensureRemoteHelper(host: host)
            let command = "$HOME/.local/bin/machinen-scene-server "
                + AuthoritativeSceneCommand.requestOption + " " + shellQuote(encoded)
            result = try run(
                executable: "/usr/bin/ssh",
                arguments: MachinenSSHTransport.arguments(connectTimeout: 8) + [host, command]
            )
        }
        guard let responseData = Data(base64Encoded: result),
              let response = try? JSONDecoder().decode(AuthoritativeResponse.self, from: responseData)
        else {
            throw AuthoritativeServerError.unavailable("The scene server returned invalid data")
        }
        guard response.ok else {
            throw AuthoritativeServerError.unavailable(response.error ?? "The scene server rejected the request")
        }
        return response
    }

    private func remoteHost() throws -> String {
        guard address.value.hasPrefix("ssh://") else {
            throw AuthoritativeServerError.unavailable("The server address must use unix:// or ssh://")
        }
        let host = String(address.value.dropFirst("ssh://".count))
        guard !host.isEmpty, !host.contains("/") else {
            throw AuthoritativeServerError.unavailable("The SSH server address is invalid")
        }
        return host
    }

    private func ensureRemoteHelper(host: String) throws {
        lock.lock()
        let installed = installedRemoteHosts.contains(host)
        lock.unlock()
        if installed { return }
        let version = try? run(
            executable: "/usr/bin/ssh",
            arguments: MachinenSSHTransport.arguments(connectTimeout: 8) + [
                host,
                "test -x \"$HOME/.local/bin/machinen-scene-server\" && "
                    + "\"$HOME/.local/bin/machinen-scene-server\" "
                    + AuthoritativeSceneCommand.versionOption,
            ]
        )
        if version != AuthoritativeSceneCommand.version {
            let executable = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[0]))
            let install = "umask 077; mkdir -p \"$HOME/.local/bin\"; "
                + "tmp=\"$HOME/.local/bin/.machinen-scene-server.$$\"; "
                + "cat > \"$tmp\" && chmod 700 \"$tmp\" && "
                + "mv -f \"$tmp\" \"$HOME/.local/bin/machinen-scene-server\""
            _ = try run(
                executable: "/usr/bin/ssh",
                arguments: MachinenSSHTransport.arguments(connectTimeout: 8) + [host, install],
                input: executable
            )
        }
        lock.lock()
        installedRemoteHosts.insert(host)
        lock.unlock()
    }

    private func run(
        executable: String,
        arguments: [String],
        input: Data? = nil
    ) throws -> String {
        let task = Process()
        let output = Pipe()
        let errors = Pipe()
        let inputPipe = Pipe()
        task.executableURL = URL(fileURLWithPath: executable)
        task.arguments = arguments
        task.standardOutput = output
        task.standardError = errors
        task.standardInput = input == nil ? FileHandle.nullDevice : inputPipe
        try task.run()
        if let input {
            inputPipe.fileHandleForWriting.write(input)
            try? inputPipe.fileHandleForWriting.close()
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let errorData = errors.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        let value = String(decoding: data, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard task.terminationStatus == 0 else {
            let errorValue = String(decoding: errorData, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw AuthoritativeServerError.unavailable(
                errorValue.isEmpty ? (value.isEmpty ? "The scene server is unavailable" : value) : errorValue
            )
        }
        return value
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

/// The SQLite state authority. Terminal processes remain outside this store.
final class AuthoritativeStore: @unchecked Sendable {
    private var database: OpaquePointer?
    private let lock = NSLock()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(databaseURL: URL, changeLimit: Int = 10_000) throws {
        try FileManager.default.createDirectory(
            at: databaseURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        var handle: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &handle,
                              SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
                              nil) == SQLITE_OK, let handle else {
            throw AuthoritativeServerError.database("Could not open the state database")
        }
        database = handle
        self.changeLimit = max(1, changeLimit)
        try execute("PRAGMA journal_mode=WAL")
        try execute("PRAGMA foreign_keys=ON")
        try execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL)")
        try execute("INSERT OR IGNORE INTO metadata(key, value) VALUES ('revision', 0)")
        try execute("CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, user TEXT NOT NULL, last_seen REAL NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(kind, id))")
        try execute("CREATE TABLE IF NOT EXISTS changes (revision INTEGER PRIMARY KEY, type TEXT NOT NULL, record_id TEXT NOT NULL, client_id TEXT NOT NULL, timestamp REAL NOT NULL, data BLOB NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS requests (client_id TEXT NOT NULL, key TEXT NOT NULL, fingerprint BLOB NOT NULL, result BLOB NOT NULL, PRIMARY KEY(client_id, key))")
        try execute("CREATE INDEX IF NOT EXISTS changes_revision ON changes(revision)")
    }

    deinit { sqlite3_close(database) }

    private let changeLimit: Int

    func registerClient(id: String, user: String) throws {
        guard !id.isEmpty, !user.isEmpty else { throw AuthoritativeServerError.unknownClient }
        lock.lock(); defer { lock.unlock() }
        try execute("INSERT INTO clients(id, user, last_seen) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET user=excluded.user, last_seen=excluded.last_seen", [id, user, Date().timeIntervalSince1970])
    }

    func snapshot() throws -> AuthoritativeSnapshot {
        lock.lock(); defer { lock.unlock() }
        let revision = try scalar("SELECT value FROM metadata WHERE key='revision'")
        var records: [String: [String: Data]] = [:]
        try query("SELECT kind, id, data FROM records ORDER BY kind, id") { statement in
            let kind = String(cString: sqlite3_column_text(statement, 0))
            let id = String(cString: sqlite3_column_text(statement, 1))
            let bytes = sqlite3_column_blob(statement, 2)
            let count = Int(sqlite3_column_bytes(statement, 2))
            records[kind, default: [:]][id] = Data(bytes: bytes!, count: count)
        }
        return AuthoritativeSnapshot(revision: revision, records: records)
    }

    func changes(after revision: Int64) throws -> [AuthoritativeChange] {
        lock.lock(); defer { lock.unlock() }
        let current = try scalar("SELECT value FROM metadata WHERE key='revision'")
        guard revision < current else { return [] }
        let oldest = try scalar("SELECT COALESCE(MIN(revision), 0) FROM changes")
        guard oldest == 0 || revision >= oldest - 1 else {
            throw AuthoritativeServerError.revisionGap
        }
        return try decodedChanges("SELECT revision, type, record_id, client_id, timestamp, data FROM changes WHERE revision > ? ORDER BY revision", [revision])
    }

    /// Applies one shared mutation and returns its durable change. The same key returns the first result.
    func apply(
        type: String,
        recordID: String,
        data: Data,
        clientID: String,
        idempotencyKey: String,
        expectedRevision: Int64? = nil
    ) throws -> AuthoritativeChange {
        guard !type.isEmpty, !recordID.isEmpty, !clientID.isEmpty, !idempotencyKey.isEmpty else {
            throw AuthoritativeServerError.invalidRecord
        }
        lock.lock(); defer { lock.unlock() }
        guard try scalar("SELECT COUNT(*) FROM clients WHERE id=?", [clientID]) == 1 else {
            throw AuthoritativeServerError.unknownClient
        }
        let fingerprint = try encoder.encode([type, recordID, data.base64EncodedString()])
        if let prior = try requestResult(clientID: clientID, key: idempotencyKey) {
            guard prior.fingerprint == fingerprint else { throw AuthoritativeServerError.idempotencyConflict }
            return prior.change
        }
        try execute("BEGIN IMMEDIATE")
        do {
            let currentRevision = try scalar("SELECT value FROM metadata WHERE key='revision'")
            if let expectedRevision, expectedRevision != currentRevision {
                throw AuthoritativeServerError.revisionConflict
            }
            let revision = currentRevision + 1
            let now = Date()
            let change = AuthoritativeChange(revision: revision, type: type, recordID: recordID, clientID: clientID, timestamp: now, data: data)
            try execute("INSERT INTO records(kind, id, data, revision) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data=excluded.data, revision=excluded.revision", [type, recordID, data, revision])
            try execute("INSERT INTO changes(revision, type, record_id, client_id, timestamp, data) VALUES (?, ?, ?, ?, ?, ?)", [revision, type, recordID, clientID, now.timeIntervalSince1970, data])
            try execute("UPDATE metadata SET value=? WHERE key='revision'", [revision])
            try execute("INSERT INTO requests(client_id, key, fingerprint, result) VALUES (?, ?, ?, ?)", [clientID, idempotencyKey, fingerprint, try encoder.encode(change)])
            try execute("DELETE FROM changes WHERE revision <= (SELECT MAX(revision) - ? FROM changes)", [changeLimit])
            try execute("COMMIT")
            return change
        } catch {
            _ = try? execute("ROLLBACK")
            throw error
        }
    }

    private func requestResult(clientID: String, key: String) throws -> (fingerprint: Data, change: AuthoritativeChange)? {
        var value: (Data, AuthoritativeChange)?
        try query("SELECT fingerprint, result FROM requests WHERE client_id=? AND key=?", [clientID, key]) { statement in
            let fingerprint = Data(bytes: sqlite3_column_blob(statement, 0)!, count: Int(sqlite3_column_bytes(statement, 0)))
            let result = Data(bytes: sqlite3_column_blob(statement, 1)!, count: Int(sqlite3_column_bytes(statement, 1)))
            value = (fingerprint, try! decoder.decode(AuthoritativeChange.self, from: result))
        }
        return value
    }

    private func decodedChanges(_ sql: String, _ values: [Any]) throws -> [AuthoritativeChange] {
        var changes: [AuthoritativeChange] = []
        try query(sql, values) { statement in
            let data = Data(bytes: sqlite3_column_blob(statement, 5)!, count: Int(sqlite3_column_bytes(statement, 5)))
            changes.append(AuthoritativeChange(revision: sqlite3_column_int64(statement, 0), type: String(cString: sqlite3_column_text(statement, 1)), recordID: String(cString: sqlite3_column_text(statement, 2)), clientID: String(cString: sqlite3_column_text(statement, 3)), timestamp: Date(timeIntervalSince1970: sqlite3_column_double(statement, 4)), data: data))
        }
        return changes
    }

    private func scalar(_ sql: String, _ values: [Any] = []) throws -> Int64 {
        var value: Int64 = 0
        try query(sql, values) { value = sqlite3_column_int64($0, 0) }
        return value
    }

    private func execute(_ sql: String, _ values: [Any] = []) throws { try query(sql, values) { _ in } }

    private func query(_ sql: String, _ values: [Any] = [], row: (OpaquePointer) -> Void) throws {
        guard let database else { throw AuthoritativeServerError.database("The state database is closed") }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw databaseError() }
        defer { sqlite3_finalize(statement) }
        for (index, value) in values.enumerated() {
            let parameter = Int32(index + 1)
            let code: Int32
            switch value {
            case let value as String: code = sqlite3_bind_text(statement, parameter, value, -1, SQLITE_TRANSIENT)
            case let value as Int: code = sqlite3_bind_int64(statement, parameter, Int64(value))
            case let value as Int64: code = sqlite3_bind_int64(statement, parameter, value)
            case let value as Double: code = sqlite3_bind_double(statement, parameter, value)
            case let value as Data: code = value.withUnsafeBytes { sqlite3_bind_blob(statement, parameter, $0.baseAddress, Int32(value.count), SQLITE_TRANSIENT) }
            default: throw AuthoritativeServerError.database("Unsupported SQLite value")
            }
            guard code == SQLITE_OK else { throw databaseError() }
        }
        while true {
            let code = sqlite3_step(statement)
            if code == SQLITE_ROW { row(statement); continue }
            guard code == SQLITE_DONE else { throw databaseError() }
            return
        }
    }

    private func databaseError() -> AuthoritativeServerError {
        AuthoritativeServerError.database(database.map { String(cString: sqlite3_errmsg($0)) } ?? "Unknown SQLite error")
    }
}
