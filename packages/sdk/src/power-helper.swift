import Cocoa
import IOKit.pwr_mgt

// Power assertion handle — used to delay sleep during migration
var assertionID: IOPMAssertionID = 0

// Flush stdout after every print
setbuf(stdout, nil)

let center = NSWorkspace.shared.notificationCenter

center.addObserver(
    forName: NSWorkspace.willSleepNotification,
    object: nil,
    queue: .main
) { _ in
    // Take a power assertion to delay sleep until we release it
    let reason = "machinen: migrating container state to remote" as CFString
    let result = IOPMAssertionCreateWithName(
        kIOPMAssertPreventUserIdleSystemSleep as CFString,
        IOPMAssertionLevel(kIOPMAssertionLevelOn),
        reason,
        &assertionID
    )
    if result == kIOReturnSuccess {
        print("sleep-delayed")
    } else {
        print("sleep")
    }
}

center.addObserver(
    forName: NSWorkspace.didWakeNotification,
    object: nil,
    queue: .main
) { _ in
    print("wake")
}

// Listen for "release" command on stdin to release the power assertion
let stdinSource = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .global())
stdinSource.setEventHandler {
    guard let line = readLine() else { return }
    if line.trimmingCharacters(in: .whitespacesAndNewlines) == "release" {
        if assertionID != 0 {
            IOPMAssertionRelease(assertionID)
            assertionID = 0
            print("released")
        }
    }
}
stdinSource.resume()

// Keep running
RunLoop.current.run()
