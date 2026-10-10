import Foundation

/// A created-at range in epoch milliseconds: `start` inclusive, `end` exclusive.
public struct CreatedAtRange: Hashable, Sendable {
    public let start: Double
    public let end: Double

    public init(start: Double, end: Double) {
        self.start = start
        self.end = end
    }
}

public struct TimeFilter: Hashable, Sendable {
    public let label: String
    public let range: CreatedAtRange
}

/// Turns searches like "last week", "monday", "march", "June 2024" or
/// "2024-06-05 to 2024-07-01" into a created-at range, so the library filters
/// by date instead of searching text. Port of `parseTimeSearchQuery`
/// (`packages/convex/shared/utils/timeSearch.ts`) with weeks starting on
/// Sunday, plus the Mac app's bare month names ("march" is this year's March).
public enum TimeSearch {
    private struct DayRange {
        let start: Date
        let end: Date
        let label: String
    }

    private static let months: [String: Int] = [
        "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4, "apr": 4,
        "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8, "september": 9,
        "sep": 9, "sept": 9, "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
    ]
    /// Bare month names. Three-letter abbreviations stay text searches.
    private static let fullMonths: Set<String> = [
        "january", "february", "march", "april", "may", "june", "july", "august", "september", "sept",
        "october", "november", "december",
    ]
    private static let weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

    public static func parse(_ query: String, now: Date = Date(), timeZone: TimeZone = .current) -> TimeFilter? {
        let normalized = query.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        guard !normalized.isEmpty else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.firstWeekday = 1
        let today = calendar.startOfDay(for: now)
        let input = String(normalized.prefix(200))

        func split(_ separator: String, dropping prefix: Int = 0) -> (String, String)? {
            guard let range = input.range(of: separator) else { return nil }
            let left = input[input.index(input.startIndex, offsetBy: prefix)..<range.lowerBound]
            return (left.trimmingCharacters(in: .whitespaces),
                    input[range.upperBound...].trimmingCharacters(in: .whitespaces))
        }

        let parts: (String, String)?
        let toIndex = input.range(of: " to ")?.lowerBound
        if input.hasPrefix("from "), let toIndex, input.distance(from: input.startIndex, to: toIndex) > 5 {
            parts = split(" to ", dropping: 5)
        } else if let toIndex, toIndex > input.startIndex, !input.hasPrefix("from ") {
            parts = split(" to ")
        } else if let dash = input.range(of: " - ")?.lowerBound, dash > input.startIndex {
            parts = split(" - ")
        } else {
            parts = nil
        }

        if let (left, right) = parts {
            guard let first = single(left, today: today, calendar: calendar),
                  let last = single(right, today: today, calendar: calendar),
                  first.start < last.end else { return nil }
            return TimeFilter(label: "\(first.label) – \(last.label)", range: range(first.start, last.end))
        }
        guard let match = single(normalized, today: today, calendar: calendar) else { return nil }
        return TimeFilter(label: match.label, range: range(match.start, match.end))
    }

    private static func range(_ start: Date, _ end: Date) -> CreatedAtRange {
        CreatedAtRange(start: (start.timeIntervalSince1970 * 1000).rounded(),
                       end: (end.timeIntervalSince1970 * 1000).rounded())
    }

    private static func single(_ query: String, today: Date, calendar: Calendar) -> DayRange? {
        relative(query, today: today, calendar: calendar)
            ?? weekday(query, today: today, calendar: calendar)
            ?? explicit(query, today: today, calendar: calendar)
    }

    private static func relative(_ query: String, today: Date, calendar: Calendar) -> DayRange? {
        func add(_ component: Calendar.Component, _ value: Int, to date: Date) -> Date {
            calendar.date(byAdding: component, value: value, to: date)!
        }
        func start(of component: Calendar.Component) -> Date {
            calendar.dateInterval(of: component, for: today)!.start
        }
        switch query {
        case "today": return DayRange(start: today, end: add(.day, 1, to: today), label: "Today")
        case "yesterday": return DayRange(start: add(.day, -1, to: today), end: today, label: "Yesterday")
        case "this week":
            let week = start(of: .weekOfYear)
            return DayRange(start: week, end: add(.day, 7, to: week), label: "This Week")
        case "last week":
            let week = start(of: .weekOfYear)
            return DayRange(start: add(.day, -7, to: week), end: week, label: "Last Week")
        case "this month":
            let month = start(of: .month)
            return DayRange(start: month, end: add(.month, 1, to: month), label: "This Month")
        case "last month":
            let month = start(of: .month)
            return DayRange(start: add(.month, -1, to: month), end: month, label: "Last Month")
        case "this year":
            let year = start(of: .year)
            return DayRange(start: year, end: add(.year, 1, to: year), label: "This Year")
        case "last year":
            let year = start(of: .year)
            return DayRange(start: add(.year, -1, to: year), end: year, label: "Last Year")
        default: return nil
        }
    }

    private static func weekday(_ query: String, today: Date, calendar: Calendar) -> DayRange? {
        let last = query.hasPrefix("last ")
        let token = last ? String(query.dropFirst(5)).trimmingCharacters(in: .whitespaces) : query
        guard let index = weekdays.firstIndex(of: token) else { return nil }
        let todayIndex = calendar.component(.weekday, from: today) - 1
        let diff = (todayIndex - index + 7) % 7
        let mostRecent = calendar.date(byAdding: .day, value: -diff, to: today)!
        let start = last ? calendar.date(byAdding: .day, value: -7, to: mostRecent)! : mostRecent
        let label = last ? "Last \(token.capitalized)" : token.capitalized
        return DayRange(start: start, end: calendar.date(byAdding: .day, value: 1, to: start)!, label: label)
    }

    private static func explicit(_ query: String, today: Date, calendar: Calendar) -> DayRange? {
        func day(_ year: Int, _ month: Int, _ day: Int) -> DayRange? {
            guard let start = validDate(year: year, month: month, day: day, calendar: calendar) else { return nil }
            return DayRange(start: start, end: calendar.date(byAdding: .day, value: 1, to: start)!,
                            label: format(start, "MMM d, yyyy", calendar))
        }
        func month(_ year: Int, _ month: Int) -> DayRange? {
            guard let start = validDate(year: year, month: month, day: 1, calendar: calendar) else { return nil }
            return DayRange(start: start, end: calendar.date(byAdding: .month, value: 1, to: start)!,
                            label: format(start, "MMM yyyy", calendar))
        }

        if let m = query.wholeMatch(of: /(\d{4})-(\d{2})-(\d{2})/) {
            if let result = day(Int(m.1)!, Int(m.2)!, Int(m.3)!) { return result }
        }
        if let m = query.wholeMatch(of: /(\d{1,2})\/(\d{1,2})\/(\d{4})/) {
            if let result = day(Int(m.3)!, Int(m.1)!, Int(m.2)!) { return result }
        }
        if let m = query.wholeMatch(of: /([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/), let index = months[String(m.1)] {
            if let result = day(Int(m.3)!, index, Int(m.2)!) { return result }
        }
        if let m = query.wholeMatch(of: /([a-z]+)\s+(\d{4})/), let index = months[String(m.1)] {
            return month(Int(m.2)!, index)
        }
        if fullMonths.contains(query), let index = months[query] {
            return month(calendar.component(.year, from: today), index)
        }
        if let m = query.wholeMatch(of: /(\d{4})/) {
            let year = Int(m.1)!
            guard let start = validDate(year: year, month: 1, day: 1, calendar: calendar) else { return nil }
            return DayRange(start: start, end: calendar.date(byAdding: .year, value: 1, to: start)!, label: String(year))
        }
        return nil
    }

    private static func validDate(year: Int, month: Int, day: Int, calendar: Calendar) -> Date? {
        guard (1...12).contains(month), (1...31).contains(day),
              let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return parts.year == year && parts.month == month && parts.day == day ? date : nil
    }

    private static func format(_ date: Date, _ pattern: String, _ calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
}
