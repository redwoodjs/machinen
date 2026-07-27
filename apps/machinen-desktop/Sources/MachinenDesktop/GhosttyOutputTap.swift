import Darwin
import Foundation

/// Mirrors a Ghostty viewer's byte stream without opening a second session client.
final class GhosttyOutputTap: @unchecked Sendable {
    let path: String

    private let handle: FileHandle
    private let lock = NSLock()
    private var closed = false

    init(onData: @escaping @Sendable (Data) -> Void) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("machinen-ghostty", isDirectory: true).path
        try FileManager.default.createDirectory(
            atPath: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        _ = chmod(directory, 0o700)

        path = "\(directory)/output-\(UUID().uuidString.lowercased()).fifo"
        guard mkfifo(path, S_IRUSR | S_IWUSR) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        let descriptor = Darwin.open(path, O_RDWR | O_NONBLOCK)
        guard descriptor >= 0 else {
            let code = errno
            unlink(path)
            throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
        }

        handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        handle.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { onData(data) }
        }
    }

    func close() {
        lock.lock()
        guard !closed else {
            lock.unlock()
            return
        }
        closed = true
        lock.unlock()

        handle.readabilityHandler = nil
        try? handle.close()
        unlink(path)
    }

    deinit {
        close()
    }
}
