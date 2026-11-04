// machinen-vz-runner
//
// One process per macOS guest. Owns the Virtualization.framework lifetime
// for a prepared VM bundle and reports lifecycle state through a JSON
// status file so the TypeScript runtime can wait for a real readiness
// signal instead of inferring it from a successful spawn.
//
// This binary never handles credentials, never opens a network listener,
// and never installs a guest. It loads a bundle that already exists.

import Foundation
import Virtualization

#if !arch(arm64)
#error("machinen-vz-runner supports arm64 only")
#endif

struct RunnerArguments {
    var bundlePath: String
    var memoryMib: UInt64
    var cpuCount: Int
    var statusPath: String

    static func parse(_ argv: [String]) throws -> RunnerArguments {
        var bundlePath: String?
        var memoryMib: UInt64 = 4096
        var cpuCount = 4
        var statusPath: String?

        var index = 1
        while index < argv.count {
            let flag = argv[index]
            let hasValue = index + 1 < argv.count
            switch flag {
            case "--version":
                print("machinen-vz-runner \(RunnerVersion.value)")
                exit(0)
            case "--help":
                print(RunnerArguments.usage)
                exit(0)
            case "--bundle":
                guard hasValue else { throw RunnerError.usage("--bundle needs a value") }
                bundlePath = argv[index + 1]
                index += 2
            case "--memory-mib":
                guard hasValue else { throw RunnerError.usage("--memory-mib needs a value") }
                guard let value = UInt64(argv[index + 1]), value >= 2048 else {
                    throw RunnerError.usage("--memory-mib must be an integer >= 2048")
                }
                memoryMib = value
                index += 2
            case "--cpus":
                guard hasValue else { throw RunnerError.usage("--cpus needs a value") }
                guard let value = Int(argv[index + 1]), value >= 1 else {
                    throw RunnerError.usage("--cpus must be an integer >= 1")
                }
                cpuCount = value
                index += 2
            case "--status-file":
                guard hasValue else { throw RunnerError.usage("--status-file needs a value") }
                statusPath = argv[index + 1]
                index += 2
            default:
                throw RunnerError.usage("unknown argument \(flag)")
            }
        }

        guard let bundlePath else { throw RunnerError.usage("--bundle is required") }
        guard let statusPath else { throw RunnerError.usage("--status-file is required") }
        return RunnerArguments(
            bundlePath: bundlePath,
            memoryMib: memoryMib,
            cpuCount: cpuCount,
            statusPath: statusPath
        )
    }

    static let usage = """
    usage: machinen-vz-runner --bundle <dir> --status-file <path> \
    [--memory-mib <n>] [--cpus <n>]
    """
}

enum RunnerVersion {
    static let value = "0.1.0"
}

enum RunnerError: Error, CustomStringConvertible {
    case usage(String)
    case unsupportedHost(String)
    case invalidBundle(String)
    case virtualization(String)

    var description: String {
        switch self {
        case .usage(let detail):
            return "usage error. \(detail)"
        case .unsupportedHost(let detail):
            return "unsupported host. \(detail)"
        case .invalidBundle(let detail):
            return "invalid bundle. \(detail)"
        case .virtualization(let detail):
            return "virtualization failure. \(detail)"
        }
    }
}

/// Status writer. Rewrites the whole document atomically so a reader never
/// observes a half-written file.
final class StatusWriter {
    enum State: String {
        case starting
        case running
        case stopping
        case stopped
        case failed
    }

    private let path: String
    private var state: State = .starting
    private var address: String?
    private var error: String?

    init(path: String) {
        self.path = path
    }

    func update(_ next: State, address: String? = nil, error: String? = nil) {
        state = next
        if let address {
            self.address = address
        }
        if let error {
            self.error = error
        }
        flush()
    }

    private func flush() {
        var payload: [String: Any] = [
            "state": state.rawValue,
            "updatedAt": Int(Date().timeIntervalSince1970 * 1000),
        ]
        if let address {
            payload["address"] = address
        }
        if let error {
            payload["error"] = error
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            return
        }
        let temporary = path + ".tmp"
        do {
            try data.write(to: URL(fileURLWithPath: temporary))
            _ = try FileManager.default.replaceItemAt(
                URL(fileURLWithPath: path),
                withItemAt: URL(fileURLWithPath: temporary)
            )
        } catch {
            // Status reporting is diagnostic. A failure here must not kill
            // a guest that is otherwise running.
        }
    }
}

/// The prepared bundle. Every member is declared by config.json so a
/// directory that merely looks like a bundle is refused with a reason.
struct Bundle {
    let root: URL
    let diskImage: URL
    let auxiliaryStorage: URL?
    let hardwareModel: URL?

    static func load(path: String) throws -> Bundle {
        let root = URL(fileURLWithPath: path).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory) else {
            throw RunnerError.invalidBundle("bundle not found at \(root.path)")
        }
        guard isDirectory.boolValue else {
            throw RunnerError.invalidBundle("bundle must be a directory at \(root.path)")
        }
        let configURL = root.appendingPathComponent("config.json")
        guard let data = try? Data(contentsOf: configURL) else {
            throw RunnerError.invalidBundle("missing config.json at \(configURL.path)")
        }
        guard let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RunnerError.invalidBundle("config.json is not a JSON object")
        }
        func member(_ key: String, required: Bool) throws -> URL? {
            guard let value = parsed[key] as? String, !value.isEmpty else {
                if required {
                    throw RunnerError.invalidBundle("config.json must name \(key)")
                }
                return nil
            }
            let url = value.hasPrefix("/")
                ? URL(fileURLWithPath: value)
                : root.appendingPathComponent(value)
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw RunnerError.invalidBundle("\(key) points at \(url.path), which is missing")
            }
            return url
        }
        guard let disk = try member("diskImage", required: true) else {
            throw RunnerError.invalidBundle("config.json must name diskImage")
        }
        return Bundle(
            root: root,
            diskImage: disk,
            auxiliaryStorage: try member("auxiliaryStorage", required: false),
            hardwareModel: try member("hardwareModel", required: false)
        )
    }
}

final class GuestRunner: NSObject, VZVirtualMachineDelegate {
    private let bundle: Bundle
    private let memoryMib: UInt64
    private let cpuCount: Int
    private let status: StatusWriter
    private var machine: VZVirtualMachine?

    init(bundle: Bundle, memoryMib: UInt64, cpuCount: Int, status: StatusWriter) {
        self.bundle = bundle
        self.memoryMib = memoryMib
        self.cpuCount = cpuCount
        self.status = status
    }

    func start() throws {
        guard VZVirtualMachine.isSupported else {
            throw RunnerError.unsupportedHost("VZVirtualMachine reports no support on this host")
        }
        let configuration = try buildConfiguration()
        let machine = VZVirtualMachine(configuration: configuration)
        machine.delegate = self
        self.machine = machine
        status.update(.starting)
        // startWithCompletionHandler is refined for Swift as an async
        // function, so the completion-handler form is reached through its
        // NS_REFINED_FOR_SWIFT name.
        machine.__start { error in
            if let error {
                self.status.update(.failed, error: "start failed. \(error.localizedDescription)")
                exit(1)
            }
            self.reportRunning()
        }
    }

    private func reportRunning() {
        // `start` returning proves the VM began, not that the guest is
        // reachable. Report running with whatever address the guest has,
        // and let the runtime prove readiness over SSH.
        status.update(.running, address: nil)
    }

    private func buildConfiguration() throws -> VZVirtualMachineConfiguration {
        let configuration = VZVirtualMachineConfiguration()

        let platform: VZPlatformConfiguration
        if let hardwareModel = bundle.hardwareModel {
            let data = try Data(contentsOf: hardwareModel)
            guard let model = VZMacHardwareModel(dataRepresentation: data) else {
                throw RunnerError.invalidBundle(
                    "hardwareModel is not a valid VZMacHardwareModel"
                )
            }
            guard model.isSupported else {
                throw RunnerError.unsupportedHost(
                    "the bundle hardware model is not supported by this host"
                )
            }
            let platformConfig = VZMacPlatformConfiguration()
            platformConfig.hardwareModel = model
            platformConfig.machineIdentifier = try loadMachineIdentifier()
            if let auxiliary = bundle.auxiliaryStorage {
                platformConfig.auxiliaryStorage = VZMacAuxiliaryStorage(url: auxiliary)
            } else {
                throw RunnerError.invalidBundle(
                    "a macOS bundle must declare auxiliaryStorage"
                )
            }
            platform = platformConfig
        } else {
            throw RunnerError.invalidBundle(
                "a macOS bundle must declare hardwareModel and auxiliaryStorage"
            )
        }
        configuration.platform = platform

        let disk = try VZDiskImageStorageDeviceAttachment(
            url: bundle.diskImage,
            readOnly: false
        )
        configuration.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: disk)]

        configuration.memorySize = memoryMib * 1024 * 1024
        configuration.cpuCount = cpuCount

        let network = VZVirtioNetworkDeviceConfiguration()
        network.attachment = VZNATNetworkDeviceAttachment()
        configuration.networkDevices = [network]

        let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
        serial.attachment = VZFileHandleSerialPortAttachment(
            fileHandleForReading: FileHandle.standardInput,
            fileHandleForWriting: FileHandle.standardOutput
        )
        configuration.serialPorts = [serial]

        try configuration.validate()
        return configuration
    }

    private func loadMachineIdentifier() throws -> VZMacMachineIdentifier {
        let path = bundle.root.appendingPathComponent("machineIdentifier.bin")
        if let data = try? Data(contentsOf: path) {
            guard let stored = VZMacMachineIdentifier(dataRepresentation: data) else {
                throw RunnerError.invalidBundle(
                    "machineIdentifier.bin is not a valid machine identifier"
                )
            }
            return stored
        }
        // A prepared bundle without a stored identifier gets one generated
        // now and persisted, so the same bundle keeps the same identity.
        let identifier = VZMacMachineIdentifier()
        try identifier.dataRepresentation.write(to: path)
        return identifier
    }

    func stop() {
        guard let machine else {
            status.update(.stopped)
            exit(0)
        }
        status.update(.stopping)
        machine.stop { errorOrNil in
            if let errorOrNil {
                self.status.update(.failed, error: "stop failed. \(errorOrNil.localizedDescription)")
                exit(1)
            }
            self.status.update(.stopped)
            exit(0)
        }
    }

    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        status.update(.stopped, error: error.localizedDescription)
        exit(0)
    }

    func guestDidStop(_ virtualMachine: VZVirtualMachine) {
        status.update(.stopped)
        exit(0)
    }
}

func installSignalHandlers(runner: GuestRunner) {
    for signalNumber in [SIGTERM, SIGINT] {
        signal(signalNumber, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
        source.setEventHandler {
            runner.stop()
        }
        source.resume()
        signalSources.append(source)
    }
}

var signalSources: [DispatchSourceSignal] = []

func main() {
    do {
        let arguments = try RunnerArguments.parse(CommandLine.arguments)
        let bundle = try Bundle.load(path: arguments.bundlePath)
        let status = StatusWriter(path: arguments.statusPath)
        status.update(.starting)
        let runner = GuestRunner(
            bundle: bundle,
            memoryMib: arguments.memoryMib,
            cpuCount: arguments.cpuCount,
            status: status
        )
        installSignalHandlers(runner: runner)
        try runner.start()
        RunLoop.main.run()
    } catch let error as RunnerError {
        FileHandle.standardError.write(Data("machinen-vz-runner. \(error)\n".utf8))
        exit(2)
    } catch {
        FileHandle.standardError.write(Data("machinen-vz-runner. \(error)\n".utf8))
        exit(2)
    }
}

main()
