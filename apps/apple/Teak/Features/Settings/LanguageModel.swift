import Foundation
import Observation
import SwiftUI
import TeakCore
import TeakSync

/// Keeps the app on the account's language, as the web does. Settings → Language
/// saves a new one to the account; a language picked in the system's per-app list
/// (iOS Settings → Teak, or macOS Language & Region → Applications) is saved to
/// the account on the next launch.
@MainActor @Observable
final class LanguageModel {
    private(set) var code = AppLanguage.current
    private(set) var isSaving = false
    /// The language before the last change in Settings, while Undo is offered.
    private(set) var undoTo: String?
    var error: String?

    var locale: Locale { Locale(identifier: code) }

    @ObservationIgnored private let defaults = UserDefaults.standard
    /// The language the app last gave the system, to notice a change made there.
    @ObservationIgnored private static let appliedKey = "teak.language.applied"
    /// A language picked in the system's list that the account hasn't taken yet; kept until a save succeeds.
    @ObservationIgnored private static let pendingKey = "teak.language.pending"
    private var pendingSystemChoice: String? {
        get { defaults.string(forKey: Self.pendingKey).flatMap(AppLanguage.supported) }
        set { defaults.set(newValue, forKey: Self.pendingKey) }
    }
    @ObservationIgnored private var lastSeen: String?
    @ObservationIgnored private var undoTask: Task<Void, Never>?

    init() {
        let system = AppLanguage.system
        if let applied = defaults.string(forKey: Self.appliedKey), applied != system {
            pendingSystemChoice = system
            apply(system)
        }
    }

    /// Follows the account's language while signed in.
    func watch(_ backend: TeakBackend) async {
        while !Task.isCancelled {
            do {
                for try await preferences in backend.subscribe(ConvexFunctions.getPreferences) {
                    await accept(preferences?.locale, backend: backend)
                }
            } catch {}
            try? await Task.sleep(for: .seconds(3))
        }
    }

    private func accept(_ value: String?, backend: TeakBackend) async {
        guard let account = value.flatMap(AppLanguage.supported) else { return }
        // A system pick wins until the account has it; each update retries the save.
        if let pending = pendingSystemChoice {
            var saved = pending == account
            if !saved { saved = (try? await save(pending, backend: backend)) != nil }
            if saved {
                pendingSystemChoice = nil
                lastSeen = pending
            }
            return
        }
        // Acting only when the account's value changes never undoes a save still in flight.
        guard account != lastSeen else { return }
        lastSeen = account
        if account != code, !isSaving { apply(account) }
    }

    /// Settings → Language: switches now, saves to the account, and switches back if that fails.
    func choose(_ next: String, backend: TeakBackend) {
        let previous = code
        guard next != previous, !isSaving else { return }
        pendingSystemChoice = nil
        apply(next)
        isSaving = true
        error = nil
        Task {
            defer { isSaving = false }
            do {
                try await save(next, backend: backend)
                offerUndo(to: previous)
            } catch {
                apply(previous)
                self.error = tr("settings.language.changeFailed")
            }
        }
    }

    func undo(backend: TeakBackend) {
        guard let previous = undoTo else { return }
        undoTo = nil
        choose(previous, backend: backend)
    }

    private func save(_ next: String, backend: TeakBackend) async throws {
        let _: AccountPreferences = try await backend.mutation(ConvexFunctions.setLocale, ["locale": .string(next)])
        lastSeen = next
    }

    private func offerUndo(to previous: String) {
        undoTo = previous
        undoTask?.cancel()
        undoTask = Task {
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { undoTo = nil }
        }
    }

    /// Uses `next` for Teak's text, the extensions and the system's own controls,
    /// which follow the per-app language from the next launch.
    private func apply(_ next: String) {
        AppLanguage.use(next)
        defaults.set([next], forKey: "AppleLanguages")
        defaults.set(next, forKey: Self.appliedKey)
        code = next
    }
}

/// Settings → Language. Each language is listed in its own name.
struct LanguageSection: View {
    @Environment(LanguageModel.self) private var language
    @Environment(AppModel.self) private var app

    var body: some View {
        Section {
            Picker(tr("settings.language.label"), selection: Binding(
                get: { language.code },
                set: { language.choose($0, backend: app.backend) }
            )) {
                ForEach(AppLanguage.options) { Text(verbatim: $0.name).tag($0.id) }
            }
            .disabled(language.isSaving || app.phase != .signedIn)
            .accessibilityIdentifier("settings.language")
        } footer: {
            footer
        }
    }

    @ViewBuilder private var footer: some View {
        if let error = language.error {
            Text(error).foregroundStyle(.red)
        } else if language.undoTo != nil {
            HStack(spacing: 6) {
                Text(tr("settings.language.changed"))
                Button(tr("common.undo")) { language.undo(backend: app.backend) }
                    .buttonStyle(.borderless)
            }
        } else {
            Text(tr("native.settings.languageDescription"))
        }
    }
}
