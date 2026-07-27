import Darwin
import Foundation

@MainActor
final class MachinenAPIServer {
    nonisolated static let protocolVersion = 1
    nonisolated static let maximumRequestBytes = 1_048_576

    private struct Subscription {
        let id: String
        let patterns: [String]
        let workspaceIDs: Set<String>
        let tileIDs: Set<String>
        let terminalIDs: Set<String>
        let includeOutput: Bool
    }

    private final class Connection: @unchecked Sendable {
        let fd: Int32
        weak var server: MachinenAPIServer?
        var didHello = false
        var subscriptions: [String: Subscription] = [:]

        private let queue: DispatchQueue
        private var source: DispatchSourceRead?
        private var buffer = Data()
        private var closed = false

        init(fd: Int32, server: MachinenAPIServer) {
            self.fd = fd
            self.server = server
            queue = DispatchQueue(label: "dev.machinen.api.connection.\(fd)", qos: .userInitiated)
            let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
            self.source = source
            source.setEventHandler { [weak self] in self?.readAvailableData() }
            source.setCancelHandler { [fd] in Darwin.close(fd) }
            source.resume()
        }

        func send(_ data: Data) {
            queue.async { [weak self] in
                guard let self, !self.closed else { return }
                data.withUnsafeBytes { bytes in
                    guard let base = bytes.baseAddress else { return }
                    var offset = 0
                    while offset < bytes.count {
                        let sent = Darwin.send(
                            self.fd,
                            base.advanced(by: offset),
                            bytes.count - offset,
                            MSG_NOSIGNAL
                        )
                        if sent < 0, errno == EINTR { continue }
                        guard sent > 0 else {
                            self.closeOnQueue()
                            return
                        }
                        offset += sent
                    }
                }
            }
        }

        func close() {
            queue.async { [weak self] in self?.closeOnQueue() }
        }

        private func closeOnQueue() {
            guard !closed else { return }
            closed = true
            source?.cancel()
            source = nil
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.server?.remove(self)
            }
        }

        private func readAvailableData() {
            var bytes = [UInt8](repeating: 0, count: 65_536)
            let count = Darwin.read(fd, &bytes, bytes.count)
            if count <= 0 {
                close()
                return
            }
            buffer.append(contentsOf: bytes.prefix(count))
            if buffer.count > MachinenAPIServer.maximumRequestBytes,
               !buffer.contains(0x0a)
            {
                close()
                return
            }
            while let newline = buffer.firstIndex(of: 0x0a) {
                let line = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                guard !line.isEmpty else { continue }
                if line.count > MachinenAPIServer.maximumRequestBytes {
                    close()
                    return
                }
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.server?.handle(line, from: self)
                }
            }
        }
    }

    private let controller: MachinenController
    private let socketQueue = DispatchQueue(label: "dev.machinen.api.socket", qos: .userInitiated)
    private var listenerFD: Int32 = -1
    private var lockFD: Int32 = -1
    private var listenerSource: DispatchSourceRead?
    private var connections: [ObjectIdentifier: Connection] = [:]
    private let eventDateFormatter = ISO8601DateFormatter()
    private var nextSequence: UInt64 = 1
    private var idempotentResults: [String: (fingerprint: Data, result: Any)] = [:]
    private var idempotencyOrder: [String] = []

    let socketPath: String

    init(controller: MachinenController) {
        self.controller = controller
        let environment = ProcessInfo.processInfo.environment
        socketPath = environment["MACHINEN_API_SOCKET"]
            ?? "/tmp/machinen-\(getuid())/api-v1.sock"
    }

    deinit {
        if listenerFD >= 0 { Darwin.close(listenerFD) }
        if lockFD >= 0 { Darwin.close(lockFD) }
    }

    func start() throws {
        let directory = URL(fileURLWithPath: socketPath).deletingLastPathComponent().path
        try FileManager.default.createDirectory(
            atPath: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        var directoryInfo = stat()
        if Darwin.lstat(directory, &directoryInfo) == 0, directoryInfo.st_uid == getuid(),
           Darwin.chmod(directory, mode_t(S_IRWXU)) != 0
        {
            throw posixError("Could not secure API socket directory")
        }
        guard socketPath.utf8CString.count <= MemoryLayout.size(ofValue: sockaddr_un().sun_path) else {
            throw MachinenAPIError("internal_error", "API socket path is too long")
        }

        let lockPath = socketPath + ".lock"
        let acquiredLock = Darwin.open(lockPath, O_CREAT | O_RDWR, mode_t(S_IRUSR | S_IWUSR))
        guard acquiredLock >= 0 else { throw posixError("Could not open API lock") }
        guard Darwin.lockf(acquiredLock, F_TLOCK, 0) == 0 else {
            Darwin.close(acquiredLock)
            throw MachinenAPIError("conflict", "Another Machinen API server is already running")
        }
        _ = Darwin.fcntl(acquiredLock, F_SETFD, FD_CLOEXEC)
        lockFD = acquiredLock
        try? FileManager.default.removeItem(atPath: socketPath)

        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            releaseAPILock()
            throw posixError("Could not create API socket")
        }
        _ = Darwin.fcntl(fd, F_SETFD, FD_CLOEXEC)
        var address = makeAddress(path: socketPath)
        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else {
            Darwin.close(fd)
            releaseAPILock()
            throw posixError("Could not bind API socket")
        }
        guard Darwin.chmod(socketPath, mode_t(S_IRUSR | S_IWUSR)) == 0,
              Darwin.listen(fd, 32) == 0
        else {
            Darwin.close(fd)
            try? FileManager.default.removeItem(atPath: socketPath)
            releaseAPILock()
            throw posixError("Could not listen on API socket")
        }

        _ = Darwin.fcntl(fd, F_SETFL, Darwin.fcntl(fd, F_GETFL) | O_NONBLOCK)
        listenerFD = fd
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: socketQueue)
        listenerSource = source
        source.setEventHandler(handler: Self.makeAcceptHandler(
            listenerFD: fd,
            expectedUID: getuid()
        ) { [weak self] clientFD in
            Task { @MainActor [weak self] in
                self?.addConnection(clientFD)
            }
        })
        source.setCancelHandler(handler: Self.makeCancelHandler(fd: fd, socketPath: socketPath))
        source.resume()
        NSLog("Machinen API listening at %@", socketPath)
    }

    func stop() {
        publish(event: "system.shuttingDown", data: [:])
        for connection in connections.values { connection.close() }
        connections.removeAll()
        listenerSource?.cancel()
        listenerSource = nil
        listenerFD = -1
        releaseAPILock()
    }

    private func releaseAPILock() {
        guard lockFD >= 0 else { return }
        _ = Darwin.lockf(lockFD, F_ULOCK, 0)
        Darwin.close(lockFD)
        lockFD = -1
    }

    func hasSubscribers(for event: String, data: JSONObject) -> Bool {
        connections.values.contains { connection in
            connection.subscriptions.values.contains {
                subscription($0, accepts: event, data: data)
            }
        }
    }

    func publish(event: String, data: JSONObject) {
        let recipients = connections.values.filter { connection in
            connection.subscriptions.values.contains {
                subscription($0, accepts: event, data: data)
            }
        }
        // Output-heavy terminals must not allocate JSON, Base64 payloads, or a
        // date formatter when no client asked to observe the event.
        guard !recipients.isEmpty else { return }
        let sequence = nextSequence
        nextSequence += 1
        let message: JSONObject = [
            "v": Self.protocolVersion,
            "type": "event",
            "seq": sequence,
            "event": event,
            "at": eventDateFormatter.string(from: Date()),
            "data": data,
        ]
        guard let encoded = encode(message) else { return }
        for connection in recipients {
            connection.send(encoded)
        }
    }

    nonisolated private static func makeAcceptHandler(
        listenerFD: Int32,
        expectedUID: uid_t,
        deliver: @escaping @Sendable (Int32) -> Void
    ) -> @Sendable () -> Void {
        {
            while true {
                let clientFD = Darwin.accept(listenerFD, nil, nil)
                if clientFD < 0 { break }
                _ = Darwin.fcntl(clientFD, F_SETFD, FD_CLOEXEC)
                _ = Darwin.fcntl(
                    clientFD,
                    F_SETFL,
                    Darwin.fcntl(clientFD, F_GETFL) & ~O_NONBLOCK
                )
                var timeout = timeval(tv_sec: 2, tv_usec: 0)
                _ = withUnsafePointer(to: &timeout) {
                    Darwin.setsockopt(
                        clientFD,
                        SOL_SOCKET,
                        SO_SNDTIMEO,
                        $0,
                        socklen_t(MemoryLayout<timeval>.size)
                    )
                }
                var peerUID = uid_t.max
                var peerGID = gid_t.max
                guard getpeereid(clientFD, &peerUID, &peerGID) == 0, peerUID == expectedUID else {
                    Darwin.close(clientFD)
                    continue
                }
                deliver(clientFD)
            }
        }
    }

    nonisolated private static func makeCancelHandler(
        fd: Int32,
        socketPath: String
    ) -> @Sendable () -> Void {
        {
            Darwin.close(fd)
            try? FileManager.default.removeItem(atPath: socketPath)
        }
    }

    private func addConnection(_ fd: Int32) {
        let connection = Connection(fd: fd, server: self)
        connections[ObjectIdentifier(connection)] = connection
    }

    private func remove(_ connection: Connection) {
        connections.removeValue(forKey: ObjectIdentifier(connection))
    }

    private func handle(_ data: Data, from connection: Connection) {
        let object: JSONObject
        do {
            guard let decoded = try JSONSerialization.jsonObject(with: data) as? JSONObject else {
                throw MachinenAPIError("invalid_request", "Request must be a JSON object")
            }
            object = decoded
        } catch let error as MachinenAPIError {
            sendError(error, id: NSNull(), to: connection)
            return
        } catch {
            sendError(MachinenAPIError("invalid_request", "Request is not valid JSON"), id: NSNull(), to: connection)
            return
        }

        let id: Any = object["id"] ?? NSNull()
        guard object["v"] as? Int == Self.protocolVersion,
              object["type"] as? String == "request",
              let operation = object["op"] as? String,
              let requestID = object["id"], requestID is String || requestID is NSNumber
        else {
            sendError(MachinenAPIError("invalid_request", "v, type, id, and op are required"), id: id, to: connection)
            return
        }
        let params = object["params"] as? JSONObject ?? [:]

        if operation == "system.hello" {
            let requestedProtocol = params["protocol"] as? JSONObject
            let minimum = requestedProtocol?["min"] as? Int ?? Self.protocolVersion
            let maximum = requestedProtocol?["max"] as? Int ?? Self.protocolVersion
            guard minimum <= Self.protocolVersion, maximum >= Self.protocolVersion else {
                sendError(
                    MachinenAPIError("unsupported_protocol", "Machinen supports protocol version 1"),
                    id: requestID,
                    to: connection
                )
                return
            }
            connection.didHello = true
            sendResult([
                "protocol": Self.protocolVersion,
                "application": ["name": "Machinen", "version": appVersion()],
                "socketPath": socketPath,
                "capabilities": [
                    "workspaces", "tiles", "terminals", "terminalInput",
                    "terminalOutput", "uiControl", "statusWidgets", "events",
                ],
            ], id: requestID, to: connection)
            return
        }
        guard connection.didHello else {
            sendError(MachinenAPIError("invalid_request", "system.hello must be the first request"), id: requestID, to: connection)
            return
        }

        if operation == "system.ping" {
            sendResult(["pong": true], id: requestID, to: connection)
            return
        }
        if operation == "events.subscribe" {
            subscribe(params, id: requestID, connection: connection)
            return
        }
        if operation == "events.unsubscribe" {
            guard let subscriptionID = params["subscriptionId"] as? String,
                  connection.subscriptions.removeValue(forKey: subscriptionID) != nil
            else {
                sendError(MachinenAPIError("invalid_params", "subscriptionId does not exist"), id: requestID, to: connection)
                return
            }
            sendResult(["subscriptionId": subscriptionID], id: requestID, to: connection)
            return
        }

        let idempotencyKey = object["idempotencyKey"] as? String
        let fingerprint = requestFingerprint(operation: operation, params: params)
        if let idempotencyKey, let cached = idempotentResults[idempotencyKey] {
            guard cached.fingerprint == fingerprint else {
                sendError(
                    MachinenAPIError("conflict", "idempotencyKey was already used for a different request"),
                    id: requestID,
                    to: connection
                )
                return
            }
            sendResult(cached.result, id: requestID, to: connection)
            return
        }

        do {
            let result = try controller.perform(operation: operation, params: params)
            if let idempotencyKey {
                remember(result: result, fingerprint: fingerprint, for: idempotencyKey)
            }
            sendResult(result, id: requestID, to: connection)
        } catch let error as MachinenAPIError {
            sendError(error, id: requestID, to: connection)
        } catch {
            sendError(
                MachinenAPIError("internal_error", String(describing: error)),
                id: requestID,
                to: connection
            )
        }
    }

    private func subscribe(_ params: JSONObject, id: Any, connection: Connection) {
        let subscriptionID = "sub_" + UUID().uuidString.lowercased()
        let subscription = Subscription(
            id: subscriptionID,
            patterns: params["events"] as? [String] ?? ["workspace.*", "tile.*", "terminal.*", "ui.changed"],
            workspaceIDs: Set(params["workspaceIds"] as? [String] ?? []),
            tileIDs: Set(params["tileIds"] as? [String] ?? []),
            terminalIDs: Set(params["terminalIds"] as? [String] ?? []),
            includeOutput: params["includeOutput"] as? Bool ?? false
        )
        connection.subscriptions[subscriptionID] = subscription
        var result: JSONObject = ["subscriptionId": subscriptionID]
        if params["includeSnapshot"] as? Bool ?? false,
           let snapshot = try? controller.perform(operation: "system.snapshot", params: [:])
        {
            result["snapshot"] = snapshot
        }
        sendResult(result, id: id, to: connection)
    }

    private func subscription(_ subscription: Subscription, accepts event: String, data: JSONObject) -> Bool {
        if event == "terminal.output", !subscription.includeOutput { return false }
        guard subscription.patterns.contains(where: { pattern in
            pattern == event || (pattern.hasSuffix(".*") && event.hasPrefix(String(pattern.dropLast())))
        }) else { return false }
        if !subscription.workspaceIDs.isEmpty {
            let workspaceID = (data["workspaceId"]
                ?? (event.hasPrefix("workspace.") ? data["id"] : nil)) as? String
            guard let workspaceID, subscription.workspaceIDs.contains(workspaceID) else { return false }
        }
        if !subscription.tileIDs.isEmpty {
            let tileID = (data["tileId"]
                ?? (event.hasPrefix("tile.") ? data["id"] : nil)) as? String
            guard let tileID, subscription.tileIDs.contains(tileID) else { return false }
        }
        if !subscription.terminalIDs.isEmpty {
            let terminalID = (data["terminalId"]
                ?? (event.hasPrefix("terminal.") ? data["id"] : nil)) as? String
            guard let terminalID, subscription.terminalIDs.contains(terminalID) else { return false }
        }
        return true
    }

    private func sendResult(_ result: Any, id: Any, to connection: Connection) {
        let response: JSONObject = [
            "v": Self.protocolVersion,
            "type": "response",
            "id": id,
            "ok": true,
            "result": result,
        ]
        if let data = encode(response) { connection.send(data) }
    }

    private func sendError(_ error: MachinenAPIError, id: Any, to connection: Connection) {
        let response: JSONObject = [
            "v": Self.protocolVersion,
            "type": "response",
            "id": id,
            "ok": false,
            "error": [
                "code": error.code,
                "message": error.message,
                "details": error.details,
            ],
        ]
        if let data = encode(response) { connection.send(data) }
    }

    private func encode(_ object: Any) -> Data? {
        guard JSONSerialization.isValidJSONObject(object),
              var data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        else { return nil }
        data.append(0x0a)
        return data
    }

    private func requestFingerprint(operation: String, params: JSONObject) -> Data {
        (try? JSONSerialization.data(
            withJSONObject: ["op": operation, "params": params],
            options: [.sortedKeys]
        )) ?? Data()
    }

    private func remember(result: Any, fingerprint: Data, for key: String) {
        idempotentResults[key] = (fingerprint, result)
        idempotencyOrder.removeAll { $0 == key }
        idempotencyOrder.append(key)
        while idempotencyOrder.count > 256 {
            idempotentResults.removeValue(forKey: idempotencyOrder.removeFirst())
        }
    }

    private func appVersion() -> String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development"
    }

    private func makeAddress(path: String) -> sockaddr_un {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        address.sun_len = UInt8(min(MemoryLayout<sockaddr_un>.size, Int(UInt8.max)))
        _ = bytes.withUnsafeBytes { source in
            withUnsafeMutablePointer(to: &address.sun_path) { destination in
                memcpy(destination, source.baseAddress, bytes.count)
            }
        }
        return address
    }

    private func posixError(_ prefix: String) -> MachinenAPIError {
        MachinenAPIError("internal_error", "\(prefix): \(String(cString: strerror(errno)))")
    }
}
