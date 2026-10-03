import Foundation

struct LibrarySearchToken: Identifiable, Equatable {
    enum Kind: String { case keyword, date, type, style, hue, hex, favorites, trash }
    let kind: Kind
    let value: String
    let label: String
    var dateRange: Range<Date>? = nil
    var id: String { "\(kind.rawValue):\(value)" }
}

enum LibrarySearchTokens {
    static let styles = ["abstract", "cinematic", "dark", "illustrative", "minimal", "monochrome", "moody", "pastel", "photographic", "retro", "surreal", "vintage", "vibrant"]
    static let hues = ["red", "orange", "yellow", "green", "teal", "cyan", "blue", "purple", "pink", "brown", "neutral"]
    private static let styleAliases: [String: String] = [
        "abstraction": "abstract", "artsy": "abstract", "cinema": "cinematic", "filmic": "cinematic", "movie": "cinematic",
        "darkmode": "dark", "lowkey": "dark", "illustration": "illustrative", "illustrated": "illustrative", "drawing": "illustrative", "sketch": "illustrative", "cartoon": "illustrative",
        "minimalist": "minimal", "grayscale": "monochrome", "greyscale": "monochrome", "blackandwhite": "monochrome", "blackwhite": "monochrome", "bw": "monochrome",
        "dramatic": "moody", "atmospheric": "moody", "soft": "pastel", "photo": "photographic", "photograph": "photographic", "photography": "photographic", "realistic": "photographic",
        "synthwave": "retro", "dreamlike": "surreal", "antique": "vintage", "colorful": "vibrant", "colourful": "vibrant", "saturated": "vibrant"
    ]
    private static let hueAliases = ["violet": "purple", "indigo": "purple", "magenta": "pink", "fuchsia": "pink", "gray": "neutral", "grey": "neutral"]

    static func classify(_ input: String, now: Date = Date(), calendar: Calendar = .current) -> LibrarySearchToken {
        let value = input.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        if ["fav", "favs", "favorites", "favourite", "favourites"].contains(value) { return .init(kind: .favorites, value: "favorites", label: "Favorites") }
        if ["trash", "deleted", "bin", "recycle", "trashed"].contains(value) { return .init(kind: .trash, value: "trash", label: "Trash") }
        if let date = dateToken(value, now: now, calendar: calendar) { return date }
        if let type = LibraryCardType(rawValue: value) { return .init(kind: .type, value: value, label: type.title) }
        let facet = value.filter { $0.isLetter || $0.isNumber }
        if let style = styleAliases[facet] ?? (styles.contains(value) ? value : nil) { return .init(kind: .style, value: style, label: style.capitalized) }
        if let hue = hueAliases[facet] ?? (hues.contains(value) ? value : nil) { return .init(kind: .hue, value: hue, label: hue.capitalized) }
        let hex = value.hasPrefix("#") ? String(value.dropFirst()) : value
        if [3, 6].contains(hex.count), hex.allSatisfy({ $0.isHexDigit }) {
            let full = hex.count == 3 ? hex.map { "\($0)\($0)" }.joined() : hex
            return .init(kind: .hex, value: "#" + full.uppercased(), label: "#" + full.uppercased())
        }
        return .init(kind: .keyword, value: input.trimmingCharacters(in: .whitespacesAndNewlines), label: input.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func parse(_ input: String, now: Date = Date(), calendar: Calendar = .current) -> [LibrarySearchToken] {
        let words = input.split(whereSeparator: \.isWhitespace).map(String.init)
        var tokens: [LibrarySearchToken] = []
        var index = 0
        while index < words.count {
            if index + 1 < words.count {
                let pair = classify(words[index] + " " + words[index + 1], now: now, calendar: calendar)
                if pair.kind == .date { tokens.append(pair); index += 2; continue }
            }
            tokens.append(classify(words[index].trimmingCharacters(in: CharacterSet(charactersIn: ",.;:!?()[]{}\"'")), now: now, calendar: calendar))
            index += 1
        }
        return tokens.filter { !$0.value.isEmpty }
    }

    private static func dateToken(_ value: String, now: Date, calendar: Calendar) -> LibrarySearchToken? {
        var cal = calendar
        cal.firstWeekday = 1 // Match the web's Sunday-start date ranges.
        let today = cal.startOfDay(for: now)
        let relatives: [String: Calendar.Component] = ["today": .day, "yesterday": .day, "this week": .weekOfYear, "last week": .weekOfYear, "this month": .month, "last month": .month, "this year": .year, "last year": .year]
        var start: Date?
        var component: Calendar.Component = .day
        if let unit = relatives[value], let interval = cal.dateInterval(of: unit, for: today) {
            component = unit
            start = value == "yesterday" || value.hasPrefix("last ") ? cal.date(byAdding: unit, value: -1, to: interval.start) : interval.start
        } else {
            let parts = value.split(separator: " ")
            let months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
            if let first = parts.first, let month = months.firstIndex(where: { $0 == first || $0.prefix(3) == first || ($0 == "september" && first == "sept") }), parts.count <= 2 {
                let year = parts.count == 2 ? Int(parts[1]) : cal.component(.year, from: now)
                if let year, (1...9999).contains(year) { start = cal.date(from: DateComponents(year: year, month: month + 1, day: 1)); component = .month }
            } else if value.count == 4, let year = Int(value), (1...9999).contains(year) {
                start = cal.date(from: DateComponents(year: year, month: 1, day: 1)); component = .year
            }
        }
        guard let start, let end = cal.date(byAdding: component, value: 1, to: start) else { return nil }
        return .init(kind: .date, value: value, label: value.capitalized, dateRange: start..<end)
    }
}
