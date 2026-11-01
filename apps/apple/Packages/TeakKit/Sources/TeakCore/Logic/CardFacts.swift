import Foundation

/// Marking a link done. Ports `doneActionLabel` and `ACTIONABLE_LINK_CATEGORIES`
/// (`packages/convex/shared/linkCategories.ts`) and the web's toggle copy.
public enum LinkDone {
    public static func verb(_ category: String?) -> String {
        guard let category, !category.isEmpty else { return "done" }
        return SharedConstants.shared.linkCategoryDoneVerbs[category] ?? "done"
    }

    public static func isActionable(_ category: String?) -> Bool {
        category.map(SharedConstants.shared.actionableLinkCategories.contains) ?? false
    }

    public static func markLabel(_ category: String?) -> String { words(category).markAs }

    public static func unmarkLabel(_ category: String?) -> String { words(category).markAsNot }

    public static func doneLabel(_ category: String?) -> String { words(category).state }

    public static func toast(_ category: String?, done: Bool) -> String {
        done ? words(category).markedAs : words(category).markedAsNot
    }

    public static func badgeLabel(_ category: String?) -> String { words(category).markedAs }

    public struct Words: Equatable, Sendable {
        public let markAs, markAsNot, state, markedAs, markedAsNot: String
    }

    private static func words(_ category: String?) -> Words { words(verb: verb(category)) ?? words(verb: "done")! }

    /// Every sentence for one verb, one catalog key each: the web words these with a select,
    /// which native text can't use. Nil for a verb this list doesn't know yet.
    public static func words(verb: String) -> Words? {
        switch verb {
        case "read":
            Words(markAs: tr("native.done.markAs.read"), markAsNot: tr("native.done.markAsNot.read"),
                  state: tr("native.done.state.read"), markedAs: tr("native.done.markedAs.read"),
                  markedAsNot: tr("native.done.markedAsNot.read"))
        case "watched":
            Words(markAs: tr("native.done.markAs.watched"), markAsNot: tr("native.done.markAsNot.watched"),
                  state: tr("native.done.state.watched"), markedAs: tr("native.done.markedAs.watched"),
                  markedAsNot: tr("native.done.markedAsNot.watched"))
        case "listened":
            Words(markAs: tr("native.done.markAs.listened"), markAsNot: tr("native.done.markAsNot.listened"),
                  state: tr("native.done.state.listened"), markedAs: tr("native.done.markedAs.listened"),
                  markedAsNot: tr("native.done.markedAsNot.listened"))
        case "bought":
            Words(markAs: tr("native.done.markAs.bought"), markAsNot: tr("native.done.markAsNot.bought"),
                  state: tr("native.done.state.bought"), markedAs: tr("native.done.markedAs.bought"),
                  markedAsNot: tr("native.done.markedAsNot.bought"))
        case "cooked":
            Words(markAs: tr("native.done.markAs.cooked"), markAsNot: tr("native.done.markAsNot.cooked"),
                  state: tr("native.done.state.cooked"), markedAs: tr("native.done.markedAs.cooked"),
                  markedAsNot: tr("native.done.markedAsNot.cooked"))
        case "played":
            Words(markAs: tr("native.done.markAs.played"), markAsNot: tr("native.done.markAsNot.played"),
                  state: tr("native.done.state.played"), markedAs: tr("native.done.markedAs.played"),
                  markedAsNot: tr("native.done.markedAsNot.played"))
        case "done":
            Words(markAs: tr("native.done.markAs.done"), markAsNot: tr("native.done.markAsNot.done"),
                  state: tr("native.done.state.done"), markedAs: tr("native.done.markedAs.done"),
                  markedAsNot: tr("native.done.markedAsNot.done"))
        default: nil
        }
    }
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
    public func formatted(locale: Locale = AppLanguage.locale) -> String {
        if amount == 0 { return tr("native.details.free") }
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
    /// Epoch ms, kept for released apps: an instant when the EXIF has an offset, else the camera's clock read as UTC.
    public var takenAt: Double?
    /// The camera's clock time as epoch ms, read as if that clock were UTC.
    public var takenAtClock: Double?
    /// Minutes east of UTC the camera recorded, when the EXIF has an offset.
    public var takenAtOffset: Double?

    public init(exposureTime: Double? = nil, fNumber: Double? = nil, focalLength: Double? = nil, iso: Double? = nil,
                latitude: Double? = nil, longitude: Double? = nil, make: String? = nil, model: String? = nil,
                takenAt: Double? = nil, takenAtClock: Double? = nil, takenAtOffset: Double? = nil) {
        self.exposureTime = exposureTime
        self.fNumber = fNumber
        self.focalLength = focalLength
        self.iso = iso
        self.latitude = latitude
        self.longitude = longitude
        self.make = make
        self.model = model
        self.takenAt = takenAt
        self.takenAtClock = takenAtClock
        self.takenAtOffset = takenAtOffset
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

    public static func exposure(_ seconds: Double?) -> String? {
        guard let seconds = positive(seconds) else { return nil }
        if seconds >= 0.3 { return "\(trimDecimal(seconds)) s" }
        return "1/\(Int((1 / seconds).rounded())) s"
    }

    private static func utcOffset(_ minutes: Double?) -> String? {
        guard let minutes, minutes.isFinite, minutes.rounded() == minutes, abs(minutes) <= 14 * 60 else { return nil }
        let total = Int(minutes)
        if total == 0 { return "UTC" }
        let rest = abs(total) % 60
        let sign = total < 0 ? "-" : "+"
        return "UTC\(sign)\(abs(total) / 60)" + (rest == 0 ? "" : String(format: ":%02d", rest))
    }

    private static func format(_ milliseconds: Double, in timeZone: TimeZone, locale: Locale) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateFormat = locale.language.languageCode == .english
            ? "MMM d, yyyy, hh:mm a"
            : DateFormatter.dateFormat(fromTemplate: "MMMdyyyyjjmm", options: 0, locale: locale)
        return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
    }

    /// `takenAtClock` holds the camera's clock time encoded as UTC, so it's formatted in UTC: a photo taken at
    /// 09:00 reads 09:00 wherever it's viewed. Photos processed before it existed keep their old reading of
    /// `takenAt` in the viewer's zone.
    private static func takenAt(_ exif: ImageExif, timeZone: TimeZone, locale: Locale) -> String? {
        if let milliseconds = positive(exif.takenAtClock) {
            let clock = format(milliseconds, in: TimeZone(identifier: "UTC")!, locale: locale)
            return utcOffset(exif.takenAtOffset).map { "\(clock) \($0)" } ?? clock
        }
        return positive(exif.takenAt).map { format($0, in: timeZone, locale: locale) }
    }

    public static func rows(_ exif: ImageExif?, timeZone: TimeZone = .current,
                            locale: Locale = AppLanguage.locale) -> [DetailRow] {
        guard let exif else { return [] }
        let fields: [(String, String?)] = [
            (tr("native.details.camera"), camera(make: exif.make, model: exif.model)),
            (tr("native.details.taken"), takenAt(exif, timeZone: timeZone, locale: locale)),
            (tr("native.details.exposure"), exposure(exif.exposureTime)),
            (tr("native.details.aperture"), positive(exif.fNumber).map { "f/\(trimDecimal($0))" }),
            (tr("native.details.focalLength"), positive(exif.focalLength).map { "\(trimDecimal($0)) mm" }),
            (tr("native.details.iso"), positive(exif.iso).map { String(Int($0.rounded())) }),
        ]
        return fields.compactMap { label, value in value.map { DetailRow(label, $0) } }
    }
}

/// Port of `formatPublishedDate` (`apps/web/src/lib/linkByline.ts`): a link's
/// publish date in UTC, dropped when it's before 1990 or over a day and a
/// half in the future.
public enum PublishedDate {
    public static func format(_ value: String?, now: Date = Date(), locale: Locale = AppLanguage.locale) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
              let date = parse(trimmed)
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard calendar.component(.year, from: date) >= 1990,
              date.timeIntervalSince(now) <= 36 * 60 * 60
        else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMdyyyy")
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

public enum CardSourceRow {
    public static func host(_ sourceUrl: String?) -> String? { SafeURL.hostname(sourceUrl) }
}
