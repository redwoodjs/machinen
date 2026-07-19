import AppKit

private struct CommandChordState {
    private var leftDown = false
    private var rightDown = false
    private var contaminated = false
    private var fired = false

    mutating func markContaminated() {
        if leftDown || rightDown {
            contaminated = true
        }
    }

    mutating func handleFlags(keyCode: Int, flags: CGEventFlags) -> Bool {
        let wasBothDown = leftDown && rightDown
        let raw = flags.rawValue
        switch keyCode {
        case 55: // left Command
            leftDown = raw & CGEventFlags.maskCommand.rawValue != 0 && raw & 0x8 != 0
        case 54: // right Command
            rightDown = raw & CGEventFlags.maskCommand.rawValue != 0 && raw & 0x10 != 0
        default:
            return false
        }

        if !leftDown && !rightDown {
            contaminated = false
            fired = false
            return false
        }

        if wasBothDown, leftDown != rightDown, !contaminated {
            fired = false
        }

        if leftDown, rightDown, !contaminated, !fired {
            fired = true
            return true
        }
        return false
    }
}

/// Recognises cmdcmd's simultaneous left-and-right Command gesture while the
/// Machinen application is active. A local monitor is enough for the prototype;
/// a future global overview would require an explicit accessibility interaction.
@MainActor
final class CommandChord {
    private var monitors: [Any] = []
    private var state = CommandChordState()
    private let handler: () -> Void

    init(handler: @escaping () -> Void) {
        self.handler = handler

        let flagsMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            self?.handleFlags(event)
            return event
        }
        let keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.state.markContaminated()
            return event
        }
        monitors = [flagsMonitor, keyMonitor].compactMap { $0 }
    }

    private func handleFlags(_ event: NSEvent) {
        let flags = event.cgEvent?.flags ?? CGEventFlags(rawValue: UInt64(event.modifierFlags.rawValue))
        if state.handleFlags(keyCode: Int(event.keyCode), flags: flags) {
            handler()
        }
    }
}
