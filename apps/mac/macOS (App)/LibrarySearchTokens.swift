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
        let punctuation = CharacterSet(charactersIn: ",.;:!?()[]{}\"'")
        let words = input.split(whereSeparator: \.isWhitespace).map { String($0).trimmingCharacters(in: punctuation) }
        var tokens: [LibrarySearchToken] = []
        var index = 0
        while index < words.count {
            var matchedDate: LibrarySearchToken?
            var consumed = 0
            // The longest supported expression is “from June 5 2024 to July 6 2025”.
            for length in stride(from: min(9, words.count - index), through: 1, by: -1) {
                let phrase = words[index..<(index + length)].joined(separator: " ")
                if let token = dateToken(phrase.lowercased(), now: now, calendar: calendar) {
                    matchedDate = token
                    consumed = length
                    break
                }
            }
            if let matchedDate {
                tokens.append(matchedDate)
                index += consumed
            } else {
                tokens.append(classify(words[index].trimmingCharacters(in: CharacterSet(charactersIn: ",.;:!?()[]{}\"'")), now: now, calendar: calendar))
                index += 1
            }
        }

        return tokens.filter { !$0.value.isEmpty }
    }

    private static func dateToken(_ value: String, now: Date, calendar: Calendar) -> LibrarySearchToken? {
        let range: Range<Date>?
        let safeValue = String(value.prefix(200))
        if let delimiter = safeValue.range(of: " to ") ?? safeValue.range(of: " - ") {
            var left = String(safeValue[..<delimiter.lowerBound])
            if left.hasPrefix("from ") { left = String(left.dropFirst(5)) }
            let right = String(safeValue[delimiter.upperBound...])
            if let first = singleDateRange(left, now: now, calendar: calendar),
               let last = singleDateRange(right, now: now, calendar: calendar),
               first.lowerBound < last.upperBound {
                range = first.lowerBound..<last.upperBound
            } else { range = nil }
        } else {
            range = singleDateRange(value, now: now, calendar: calendar)
        }
        guard let range else { return nil }
        return .init(kind: .date, value: value, label: value.capitalized, dateRange: range)
    }

    private static func singleDateRange(_ value: String, now: Date, calendar: Calendar) -> Range<Date>? {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = calendar.timeZone
        cal.firstWeekday = 1 // Match the web's Sunday-start date ranges.
        let today = cal.startOfDay(for: now)
        let relatives: [String: Calendar.Component] = ["today": .day, "yesterday": .day, "this week": .weekOfYear, "last week": .weekOfYear, "this month": .month, "last month": .month, "this year": .year, "last year": .year]
        var start: Date?
        var component: Calendar.Component = .day
        if let unit = relatives[value], let interval = cal.dateInterval(of: unit, for: today) {
            component = unit
            start = value == "yesterday" || value.hasPrefix("last ") ? cal.date(byAdding: unit, value: -1, to: interval.start) : interval.start
        } else {
            let weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
            let last = value.hasPrefix("last ")
            let weekday = last ? String(value.dropFirst(5)) : value
            if let index = weekdays.firstIndex(of: weekday) {
                let days = (cal.component(.weekday, from: today) - 1 - index + 7) % 7 + (last ? 7 : 0)
                start = cal.date(byAdding: .day, value: -days, to: today)
            } else {
                let parts = value.split(separator: " ")
                let months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
                let month = parts.first.flatMap { first in months.firstIndex(where: { $0 == first || $0.prefix(3) == first || ($0 == "september" && first == "sept") }) }
                if let month, parts.count == 3, parts[2].count == 4,
                   let day = Int(parts[1].trimmingCharacters(in: CharacterSet(charactersIn: ","))), let year = Int(parts[2]) {
                    start = validDate(year: year, month: month + 1, day: day, calendar: cal)
                } else if let month, parts.count <= 2 {
                    let year = parts.count == 2 && parts[1].count == 4 ? Int(parts[1]) : parts.count == 1 ? cal.component(.year, from: now) : nil
                    if let year { start = validDate(year: year, month: month + 1, day: 1, calendar: cal); component = .month }
                } else if value.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil {
                    let numbers = value.split(separator: "-").compactMap { Int($0) }
                    start = validDate(year: numbers[0], month: numbers[1], day: numbers[2], calendar: cal)
                } else if value.range(of: #"^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$"#, options: .regularExpression) != nil {
                    let numbers = value.split(separator: "/").compactMap { Int($0) }
                    start = validDate(year: numbers[2], month: numbers[0], day: numbers[1], calendar: cal)
                } else if value.count == 4, let year = Int(value) {
                    start = validDate(year: year, month: 1, day: 1, calendar: cal); component = .year
                }
            }
        }
        guard let start, let end = cal.date(byAdding: component, value: 1, to: start) else { return nil }
        return start..<end
    }

    private static func validDate(year: Int, month: Int, day: Int, calendar: Calendar) -> Date? {
        guard (100...9999).contains(year), (1...12).contains(month), (1...31).contains(day),
              let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return components.year == year && components.month == month && components.day == day ? date : nil
    }
}
