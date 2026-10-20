import Foundation

/// Marking a link done. Ports `doneActionLabel` and `ACTIONABLE_LINK_CATEGORIES`
/// (`packages/convex/shared/linkCategories.ts`) and the web's toggle copy.
public enum LinkDone {
    /// The verb for a category: "read", "watched", "bought"…, else "done".
    public static func verb(_ category: String?) -> String {
        guard let category, !category.isEmpty else { return "done" }
        return SharedConstants.shared.linkCategoryDoneVerbs[category] ?? "done"
    }

    /// Whether `is:todo` lists a link of this category while it isn't done.
    public static func isActionable(_ category: String?) -> Bool {
        category.map(SharedConstants.shared.actionableLinkCategories.contains) ?? false
    }

    /// The toggle's label while the link isn't done: "Mark as read".
    public static func markLabel(_ category: String?) -> String { "Mark as \(verb(category))" }

    /// The toggle's label once it's done: "Read".
    public static func doneLabel(_ category: String?) -> String { verb(category).capitalized }

    /// The confirmation after a change: "Marked as read" or "Marked as not read".
    public static func toast(_ category: String?, done: Bool) -> String {
        done ? "Marked as \(verb(category))" : "Marked as not \(verb(category))"
    }

    /// The done badge's spoken label on a tile.
    public static func badgeLabel(_ category: String?) -> String { "Marked as \(verb(category))" }
}

public struct LinkPrice: Codable, Sendable, Hashable {
    public let amount: Double
    public var currency: String?

    public init(amount: Double, currency: String? = nil) {
        self.amount = amount
        self.currency = currency
    }

    /// Port of `formatLinkPrice` (`packages/convex/shared/price.ts`): zero is
    /// "Free", a currency formats as money, anything else as a plain amount.
    public func formatted(locale: Locale = .current) -> String {
        if amount == 0 { return "Free" }
        if let currency, currency.wholeMatch(of: /[A-Za-z]{3}/) != nil {
            return amount.formatted(.currency(code: currency.uppercased()).locale(locale))
        }
        return amount.formatted(.number.precision(.fractionLength(0...2)).locale(locale))
    }
}

public struct ImageExif: Codable, Sendable, Hashable {
    public var exposureTime: Double?
    public var fNumber: Double?
    public var focalLength: Double?
    public var iso: Double?
    public var latitude: Double?
    public var longitude: Double?
    public var make: String?
    public var model: String?
    public var takenAt: Double?

    public init(exposureTime: Double? = nil, fNumber: Double? = nil, focalLength: Double? = nil, iso: Double? = nil,
                latitude: Double? = nil, longitude: Double? = nil, make: String? = nil, model: String? = nil,
                takenAt: Double? = nil) {
        self.exposureTime = exposureTime
        self.fNumber = fNumber
        self.focalLength = focalLength
        self.iso = iso
        self.latitude = latitude
        self.longitude = longitude
        self.make = make
        self.model = model
        self.takenAt = takenAt
    }
}

/// Port of `apps/web/src/lib/exif.ts`. Location is never shown.
public enum ExifFacts {
    private static func positive(_ value: Double?) -> Double? {
        guard let value, value.isFinite, value > 0 else { return nil }
        return value
    }

    private static func clean(_ value: String?) -> String {
        (value ?? "").replacing(/\s+/, with: " ").trimmingCharacters(in: .whitespaces)
    }

    /// One decimal at most, with no trailing ".0".
    private static func trimDecimal(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
    }

    public static func camera(make: String?, model: String?) -> String? {
        let cleanMake = clean(make)
        let cleanModel = clean(model)
        if cleanModel.isEmpty { return cleanMake.isEmpty ? nil : cleanMake }
        let firstWord = cleanMake.lowercased().split(separator: " ").first.map(String.init) ?? ""
        if cleanMake.isEmpty || cleanModel.lowercased().hasPrefix(firstWord) { return cleanModel }
        return "\(cleanMake) \(cleanModel)"
    }

    /// 0.3 s and longer read as decimals, shorter ones as fractions.
    public static func exposure(_ seconds: Double?) -> String? {
        guard let seconds = positive(seconds) else { return nil }
        if seconds >= 0.3 { return "\(trimDecimal(seconds)) s" }
        return "1/\(Int((1 / seconds).rounded())) s"
    }

    public static func rows(_ exif: ImageExif?, timeZone: TimeZone = .current) -> [DetailRow] {
        guard let exif else { return [] }
        let taken = positive(exif.takenAt).map { milliseconds -> String in
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US")
            formatter.timeZone = timeZone
            formatter.dateFormat = "MMM d, yyyy, hh:mm a"
            return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
        }
        let fields: [(String, String?)] = [
            ("Camera", camera(make: exif.make, model: exif.model)),
            ("Taken", taken),
            ("Exposure", exposure(exif.exposureTime)),
            ("Aperture", positive(exif.fNumber).map { "f/\(trimDecimal($0))" }),
            ("Focal length", positive(exif.focalLength).map { "\(trimDecimal($0)) mm" }),
            ("ISO", positive(exif.iso).map { String(Int($0.rounded())) }),
        ]
        return fields.compactMap { label, value in value.map { DetailRow(label, $0) } }
    }
}

/// Port of `formatPublishedDate` (`apps/web/src/lib/linkByline.ts`): a link's
/// publish date in UTC, dropped when it's before 1990 or over a day and a
/// half in the future.
public enum PublishedDate {
    public static func format(_ value: String?, now: Date = Date()) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
              let date = parse(trimmed)
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard calendar.component(.year, from: date) >= 1990,
              date.timeIntervalSince(now) <= 36 * 60 * 60
        else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }

    private static func parse(_ value: String) -> Date? {
        let iso = ISO8601DateFormatter()
        for options: ISO8601DateFormatter.Options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime]] {
            iso.formatOptions = options
            if let date = iso.date(from: value) { return date }
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        for format in ["yyyy-MM-dd", "EEE, dd MMM yyyy HH:mm:ss zzz", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: value) { return date }
        }
        return nil
    }
}

/// The "From" row on a card saved from somewhere else: the source's host.
public enum CardSourceRow {
    public static func host(_ sourceUrl: String?) -> String? { SafeURL.hostname(sourceUrl) }
}
