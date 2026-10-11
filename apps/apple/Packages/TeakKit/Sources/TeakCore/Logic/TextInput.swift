import Foundation

/// How a note or pasted link is saved: a link card when there is an http(s) URL, otherwise text.
public struct TextCardInput: Hashable, Sendable {
    public let content: String
    public let type: CardType
    public let url: String?

    /// Arguments for `cards:createCard`.
    public var createArgs: ConvexArgs {
        var args: ConvexArgs = ["content": .string(content)]
        if type == .link, let url {
            args["type"] = "link"
            args["url"] = .string(url)
        }
        return args
    }
}

/// Port of `resolveTextCardInput` (`packages/convex/shared/utils/linkDetection.ts`).
public enum LinkDetection {
    private static let entities = ["amp": "&", "lt": "<", "gt": ">"]

    private static func unescape(_ candidate: String) -> String {
        candidate
            .replacing(/\\([!-\/:-@\[-`{-~])/) { String($0.1) }
            .replacing(/&(amp|lt|gt);/) { entities[String($0.1)] ?? String($0.0) }
    }

    // WHATWG URL parsing (what the backend uses) accepts characters Foundation
    // rejects, so check only what it requires: an http(s) scheme and a host.
    private static func isHttpURL(_ candidate: String) -> Bool {
        candidate.prefixMatch(of: /(?i)https?:\/\/[^\/?#\s]+/) != nil
    }

    /// The URL in `content`, and the content to save alongside it.
    public static func extractURL(_ content: String) -> (url: String?, content: String) {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return (nil, "") }
        if trimmed.wholeMatch(of: /https?:\/\/\S+/) != nil {
            let url = unescape(trimmed)
            return isHttpURL(url) ? (url, url) : (nil, trimmed)
        }
        if let match = trimmed.firstMatch(of: /(https?:\/\/\S+)/) {
            let url = unescape(String(match.1))
            if isHttpURL(url) { return (url, trimmed) }
        }
        return (nil, trimmed)
    }

    public static func resolve(_ content: String) -> TextCardInput {
        let (url, cleaned) = extractURL(content)
        if let url { return TextCardInput(content: cleaned, type: .link, url: url) }
        return TextCardInput(content: content, type: .text, url: nil)
    }
}

/// Reads the text from a `teak://save?text=…` link straight from the raw URL,
/// so a `#`, `&` or `%` inside the text survives exactly as the automation
/// app sent it. Port of `textFromSaveLink`.
public enum SaveLink {
    public static func text(from url: String?) -> String {
        guard let url, let queryStart = url.firstIndex(of: "?") else { return "" }
        let afterQuery = url.index(after: queryStart)
        let queryEnd = url[afterQuery...].firstIndex(of: "#") ?? url.endIndex
        for pair in url[afterQuery..<queryEnd].split(separator: "&", omittingEmptySubsequences: false) {
            let separator = pair.firstIndex(of: "=")
            let key = separator.map { pair[..<$0] } ?? pair[...]
            guard key == "text" else { continue }
            let value = separator.map { String(pair[pair.index(after: $0)...]) } ?? ""
            // decodeURIComponent semantics after turning + into a space; malformed escapes save nothing.
            return value.replacingOccurrences(of: "+", with: " ").removingPercentEncoding?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        return ""
    }
}

/// Card URLs are user-controlled. Only absolute http(s) URLs are opened.
/// Port of `sanitizeExternalUrl` (`packages/convex/shared/utils/safeUrl.ts`).
public enum SafeURL {
    public static func sanitize(_ value: String?) -> URL? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
              let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              url.host() != nil
        else { return nil }
        return url
    }

    public static func hostname(_ value: String?) -> String? {
        guard let host = sanitize(value)?.host() else { return nil }
        let name = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        return name.isEmpty ? nil : name
    }
}
