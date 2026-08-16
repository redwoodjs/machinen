import AppKit
import Darwin

if let status = AuthoritativeSceneCommand.runIfRequested() {
    Darwin.exit(status)
}

if CommandLine.arguments.contains("--interaction-tests") {
    Darwin.exit(InteractionTestRunner.run())
}

let application = NSApplication.shared
let applicationDelegate = AppDelegate()
application.setActivationPolicy(.regular)
application.delegate = applicationDelegate
application.run()
