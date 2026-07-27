import AppKit
import GhosttyKit

extension NSEvent.ModifierFlags {
    static func ghosttyTranslationModifiers(_ modifiers: ghostty_input_mods_e) -> Self {
        var result = Self()
        if modifiers.rawValue & GHOSTTY_MODS_SHIFT.rawValue != 0 { result.insert(.shift) }
        if modifiers.rawValue & GHOSTTY_MODS_CTRL.rawValue != 0 { result.insert(.control) }
        if modifiers.rawValue & GHOSTTY_MODS_ALT.rawValue != 0 { result.insert(.option) }
        if modifiers.rawValue & GHOSTTY_MODS_SUPER.rawValue != 0 { result.insert(.command) }
        return result
    }

    var ghosttyModifiers: ghostty_input_mods_e {
        var value: UInt32 = GHOSTTY_MODS_NONE.rawValue
        if contains(.shift) { value |= GHOSTTY_MODS_SHIFT.rawValue }
        if contains(.control) { value |= GHOSTTY_MODS_CTRL.rawValue }
        if contains(.option) { value |= GHOSTTY_MODS_ALT.rawValue }
        if contains(.command) { value |= GHOSTTY_MODS_SUPER.rawValue }
        if contains(.capsLock) { value |= GHOSTTY_MODS_CAPS.rawValue }

        let raw = rawValue
        if raw & UInt(NX_DEVICERSHIFTKEYMASK) != 0 { value |= GHOSTTY_MODS_SHIFT_RIGHT.rawValue }
        if raw & UInt(NX_DEVICERCTLKEYMASK) != 0 { value |= GHOSTTY_MODS_CTRL_RIGHT.rawValue }
        if raw & UInt(NX_DEVICERALTKEYMASK) != 0 { value |= GHOSTTY_MODS_ALT_RIGHT.rawValue }
        if raw & UInt(NX_DEVICERCMDKEYMASK) != 0 { value |= GHOSTTY_MODS_SUPER_RIGHT.rawValue }
        return ghostty_input_mods_e(value)
    }
}

extension NSEvent {
    func ghosttyKeyEvent(
        _ action: ghostty_input_action_e,
        translationModifiers: ModifierFlags? = nil
    ) -> ghostty_input_key_s {
        var result = ghostty_input_key_s()
        result.action = action
        result.mods = modifierFlags.ghosttyModifiers
        result.consumed_mods = (translationModifiers ?? modifierFlags)
            .subtracting([.control, .command])
            .ghosttyModifiers
        result.keycode = UInt32(keyCode)
        result.text = nil
        result.composing = false
        if type == .keyDown || type == .keyUp,
           let scalar = characters(byApplyingModifiers: [])?.unicodeScalars.first
        {
            result.unshifted_codepoint = scalar.value
        }
        return result
    }

    var ghosttyText: String? {
        guard let characters else { return nil }
        if characters.count == 1, let scalar = characters.unicodeScalars.first {
            if scalar.value < 0x20 {
                return self.characters(byApplyingModifiers: modifierFlags.subtracting(.control))
            }
            if (0xF700...0xF8FF).contains(scalar.value) { return nil }
        }
        return characters
    }

    var ghosttyScrollModifiers: ghostty_input_scroll_mods_t {
        let momentum: Int32
        switch momentumPhase {
        case .began: momentum = 1
        case .stationary: momentum = 2
        case .changed: momentum = 3
        case .ended: momentum = 4
        case .cancelled: momentum = 5
        case .mayBegin: momentum = 6
        default: momentum = 0
        }
        return (hasPreciseScrollingDeltas ? 1 : 0) | (momentum << 1)
    }

    var ghosttyMouseButton: ghostty_input_mouse_button_e {
        switch buttonNumber {
        case 0: GHOSTTY_MOUSE_LEFT
        case 1: GHOSTTY_MOUSE_RIGHT
        case 2: GHOSTTY_MOUSE_MIDDLE
        case 3: GHOSTTY_MOUSE_EIGHT
        case 4: GHOSTTY_MOUSE_NINE
        case 5: GHOSTTY_MOUSE_SIX
        case 6: GHOSTTY_MOUSE_SEVEN
        case 7: GHOSTTY_MOUSE_FOUR
        case 8: GHOSTTY_MOUSE_FIVE
        case 9: GHOSTTY_MOUSE_TEN
        case 10: GHOSTTY_MOUSE_ELEVEN
        default: GHOSTTY_MOUSE_UNKNOWN
        }
    }
}
