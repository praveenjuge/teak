import AppIntents
import TeakCore

// These open the app on a screen. They run in the foreground, so the system brings Teak
// forward and performs them there, where the `teak://` link goes to the app's router.
// `OpenURLIntent` can't do this: it opens universal links only, not `teak://`.
//
// The New Note and Voice Memo controls run these too, so this file and IntentSession.swift
// are also in the TeakWidgets extension, as Apple requires for a control that opens its app.

struct NewNoteIntent: AppIntent {
    static let title = LocalizedStringResource("intents.newNoteTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("intents.newNoteDescription", table: "AppIntents"))
    static let supportedModes: IntentModes = .foreground

    @MainActor
    func perform() async throws -> some IntentResult {
        try await openInTeak(.newNote)
        return .result()
    }
}

struct RecordVoiceMemoIntent: AppIntent {
    static let title = LocalizedStringResource("intents.recordVoiceMemoTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("intents.recordVoiceMemoDescription", table: "AppIntents"))
    static let supportedModes: IntentModes = .foreground

    @MainActor
    func perform() async throws -> some IntentResult {
        try await openInTeak(.voiceMemo)
        return .result()
    }
}

@MainActor
func openInTeak(_ link: TeakLink) async throws {
    try await IntentSession.requireSignedIn()
    #if !TEAK_WIDGETS
    let services = AppServices.shared
    #if os(macOS)
    services.showMainWindow()
    #endif
    services.router.handle(link.url, phase: services.app.phase)
    #endif
}
