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
        InputRoutingLog.log("remote-folder complete host=\(host) query=\(query.debugDescription)")
        cancel()
        guard let request = WorkspacePathSuggestions.remoteCompletionRequest(query) else {
            InputRoutingLog.log("remote-folder rejected query: no completion request")
            return
        }
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
        InputRoutingLog.log("remote-folder ssh host=\(host) parent=\(request.parent) prefix=\(request.prefix.debugDescription) command=\(child.arguments?.last ?? "")")
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = output
        child.standardError = FileHandle.nullDevice
        child.terminationHandler = { [weak self] child in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let rawOutput = String(decoding: data, as: UTF8.self)
            InputRoutingLog.log("remote-folder ssh finished status=\(child.terminationStatus) bytes=\(data.count) output=\(rawOutput.debugDescription)")
            let names = rawOutput
                .split(whereSeparator: { $0.isNewline })
                .map { String($0).replacingOccurrences(of: "./", with: "", options: .anchored) }
                .filter { WorkspacePathSuggestions.fuzzyComponent(request.prefix, matches: $0) }
                .sorted {
                    // Keep ordinary folders ahead of dot-directories so the useful
                    // entries are easy to scan in a home directory full of dot-directories.
                    let lhsHidden = $0.hasPrefix(".")
                    let rhsHidden = $1.hasPrefix(".")
                    if lhsHidden != rhsHidden { return !lhsHidden }
                    return $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
                }
            let paths = names.map { name in
                if request.parent == "~" { return "~/\(name)" }
                if request.parent == "/" { return "/\(name)" }
                return "\(request.parent)/\(name)"
            }
            Task { @MainActor [weak self] in
                guard let self, self.generation == requestGeneration,
                      child.terminationStatus == 0
                else {
                    InputRoutingLog.log("remote-folder discarded stale/failed result generation=\(requestGeneration)")
                    return
                }
                self.process = nil
                InputRoutingLog.log("remote-folder completion paths=\(paths)")
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
