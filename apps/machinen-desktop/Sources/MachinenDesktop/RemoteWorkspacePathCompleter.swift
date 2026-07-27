import Foundation

@MainActor
final class RemoteWorkspacePathCompleter {
    private var process: Process?
    private var scheduledTask: DispatchWorkItem?
    private var generation = 0

    func complete(
        host: String,
        query: String,
        completion: @escaping @MainActor ([String]) -> Void
    ) {
        cancel()
        guard let request = WorkspacePathSuggestions.remoteCompletionRequest(query) else { return }
        let requestGeneration = generation
        let task = DispatchWorkItem { [weak self] in
            Task { @MainActor in
                guard let self, self.generation == requestGeneration else { return }
                self.launch(
                    host: host,
                    request: request,
                    generation: requestGeneration,
                    completion: completion
                )
            }
        }
        scheduledTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: task)
    }

    func cancel() {
        generation += 1
        scheduledTask?.cancel()
        scheduledTask = nil
        if process?.isRunning == true {
            process?.terminate()
        }
        process = nil
    }

    private func launch(
        host: String,
        request: (parent: String, prefix: String),
        generation requestGeneration: Int,
        completion: @escaping @MainActor ([String]) -> Void
    ) {
        guard let parent = WorkspaceLocation.parseSSHReference("\(host):\(request.parent)") else { return }
        let output = Pipe()
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        child.arguments = [
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=3",
            host,
            "cd -- \(parent.remoteShellPath) && /usr/bin/find . -mindepth 1 -maxdepth 1 -type d -print",
        ]
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = output
        child.standardError = FileHandle.nullDevice
        child.terminationHandler = { [weak self] child in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let names = String(decoding: data, as: UTF8.self)
                .split(whereSeparator: { $0.isNewline })
                .map { String($0).replacingOccurrences(of: "./", with: "", options: .anchored) }
                .filter { WorkspacePathSuggestions.fuzzyComponent(request.prefix, matches: $0) }
                .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
                .prefix(24)
            let paths = names.map { name in
                if request.parent == "~" { return "~/\(name)" }
                if request.parent == "/" { return "/\(name)" }
                return "\(request.parent)/\(name)"
            }
            Task { @MainActor [weak self] in
                guard let self, self.generation == requestGeneration,
                      child.terminationStatus == 0
                else { return }
                self.process = nil
                completion(paths)
            }
        }
        do {
            try child.run()
            process = child
            scheduledTask = nil
        } catch {
            process = nil
        }
    }
}
