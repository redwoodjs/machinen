import AppKit
import Foundation

typealias JSONObject = [String: Any]

struct MachinenAPIError: Error, @unchecked Sendable {
    let code: String
    let message: String
    let details: JSONObject

    init(_ code: String, _ message: String, details: JSONObject = [:]) {
        self.code = code
        self.message = message
        self.details = details
    }
}

@MainActor
final class MachinenController {
    private weak var deck: TerminalDeckView?

    init(deck: TerminalDeckView) {
        self.deck = deck
    }

    func perform(operation: String, params: JSONObject) throws -> Any {
        guard let deck else {
            throw MachinenAPIError("internal_error", "Machinen's scene is unavailable")
        }
        return try deck.performAPIOperation(operation, params: params)
    }
}
