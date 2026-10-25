import Foundation

/// The `teak://` links the app opens, from Shortcuts, Spotlight, Control Center
/// and other apps.
public enum TeakLink: Hashable, Sendable {
    /// `teak://save?text=…`: saves the text, as the Save to Teak shortcut does.
    case save(String)
    /// `teak://connect`: back from connecting an app on the web.
    case connect
    /// `teak://card/<id>`: opens a card.
    case card(String)
    /// `teak://new-note`: opens the note composer.
    case newNote
    /// `teak://voice-memo`: opens the voice memo recorder.
    case voiceMemo

    public static let scheme = "teak"

    public init?(_ url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        let path = url.pathComponents.filter { $0 != "/" }
        switch url.host()?.lowercased() {
        case "save": self = .save(SaveLink.text(from: url.absoluteString))
        case "connect": self = .connect
        case "card":
            guard path.count == 1, let id = path.first, Self.isCardId(id) else { return nil }
            self = .card(id)
        case "new-note" where path.isEmpty: self = .newNote
        case "voice-memo" where path.isEmpty: self = .voiceMemo
        default: return nil
        }
    }

    public var url: URL {
        var components = URLComponents()
        components.scheme = Self.scheme
        switch self {
        case let .save(text):
            components.host = "save"
            // `SaveLink` reads `+` as a space, so it's escaped along with everything else.
            let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
            components.percentEncodedQuery = "text=" + (text.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
        case .connect: components.host = "connect"
        case let .card(id):
            components.host = "card"
            components.path = "/" + id
        case .newNote: components.host = "new-note"
        case .voiceMemo: components.host = "voice-memo"
        }
        return components.url!
    }

    /// Whether the text could be a card's id, as `[[…|teak:<id>]]` links write it.
    public static func isCardId(_ value: String) -> Bool {
        value.wholeMatch(of: /[a-z0-9]{16,64}/) != nil
    }
}
