import Foundation
import Observation
import os

/// The language Teak's own text is in: the account's Language setting, or the
/// system's language for the app while signed out. The app group keeps it, so
/// the share and Safari extensions speak it too.
///
/// Text comes from `Localizable.xcstrings`, which `apps/apple/scripts/i18n.ts`
/// generates from `packages/i18n`. Read it with `tr`.
public enum AppLanguage {
    public struct Option: Decodable, Sendable, Hashable, Identifiable {
        /// A BCP 47 code, such as `pt-BR`.
        public let id: String
        /// The language in its own name, such as "Português (Brasil)".
        public let name: String
    }

    /// Teak's languages, in the order the Language setting lists them.
    public static var options: [Option] { SharedConstants.shared.locales }
    public static var codes: [String] { options.map(\.id) }

    private static let storageKey = "teak.language"

    /// The app group's defaults, read without `TeakConfig`, which needs the app's
    /// Info.plist: tests and previews have none.
    private static var defaults: UserDefaults {
        let group = Bundle.main.object(forInfoDictionaryKey: "TeakAppGroup") as? String
        return UserDefaults(suiteName: group.flatMap { $0.isEmpty || $0.hasPrefix("$(") ? nil : $0 }
            ?? "group.com.praveenjuge.teak") ?? .standard
    }

    private static let state = OSAllocatedUnfairLock<String?>(initialState: nil)

    /// The language now in use.
    public static var current: String {
        state.withLock { cached in
            if let cached { return cached }
            let stored = defaults.string(forKey: storageKey).flatMap(supported)
            let code = stored ?? system
            cached = code
            return code
        }
    }

    public static var locale: Locale { Locale(identifier: current) }

    /// The language the system picks for this process from Teak's languages:
    /// the per-app language when one is set, else the device's.
    public static var system: String {
        Bundle.preferredLocalizations(from: codes, forPreferences: Locale.preferredLanguages).first ?? "en"
    }

    /// Switches every later lookup to `code` and shares it with the extensions.
    /// Views that read text through `tr` update in place, keeping their state.
    public static func use(_ code: String) {
        guard let code = supported(code) else { return }
        state.withLock { $0 = code }
        defaults.set(code, forKey: storageKey)
        LanguageObservation.shared.changed()
    }

    /// Reads the shared language again: an extension calls this as each request starts,
    /// since its process can outlive a change the app made.
    public static func reload() {
        state.withLock { $0 = nil }
        LanguageObservation.shared.changed()
    }

    /// One of Teak's codes for a stored or system value, or nil.
    public static func supported(_ value: String) -> String? {
        codes.contains(value) ? value : nil
    }

    private static let bundles = OSAllocatedUnfairLock<[String: Bundle]>(initialState: [:])

    static func bundle(_ code: String) -> Bundle {
        bundles.withLock { cache in
            if let bundle = cache[code] { return bundle }
            let bundle = Bundle.module.path(forResource: code, ofType: "lproj").flatMap(Bundle.init(path:)) ?? .module
            cache[code] = bundle
            return bundle
        }
    }

    /// The catalog's text for `key` in `code`, falling back to English.
    static func format(_ key: String, in code: String) -> String {
        let missing = "\u{1}"
        let text = bundle(code).localizedString(forKey: key, value: missing, table: nil)
        if text != missing { return text }
        return bundle("en").localizedString(forKey: key, value: key, table: nil)
    }
}

/// Teak's text for a catalog key, in the app's language: `tr("native.library.title")`.
/// A message with a plural takes its `count`; other placeholders take strings,
/// in the order the English message first uses them.
public func tr(_ key: String, count: Int? = nil, _ args: String...) -> String {
    LanguageObservation.shared.track()
    return tr(key, count: count, args, in: AppLanguage.current)
}

/// What SwiftUI observes for `tr`: a view whose body reads text depends on the language,
/// so a new language re-renders it without rebuilding it, and drafts in `@State` survive.
final class LanguageObservation: Observable, Sendable {
    static let shared = LanguageObservation()
    private let registrar = ObservationRegistrar()

    var language: String { AppLanguage.current }

    func track() {
        registrar.access(self, keyPath: \.language)
    }

    func changed() {
        registrar.withMutation(of: self, keyPath: \.language) {}
    }
}

/// `tr` in a given language, for tests and previews.
public func tr(_ key: String, count: Int? = nil, _ args: [String], in code: String) -> String {
    let format = AppLanguage.format(key, in: code)
    var values: [any CVarArg] = []
    if let count { values.append(count) }
    values.append(contentsOf: args)
    guard !values.isEmpty else { return format }
    return String(format: format, locale: Locale(identifier: code), arguments: values)
}
