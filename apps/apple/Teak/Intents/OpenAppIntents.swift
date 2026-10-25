import AppIntents
import TeakCore

// These open the app through its `teak://` links, so they read only TeakCore
// and a control in an extension can run them too.

/// Opens Teak on a new note.
struct NewNoteIntent: AppIntent {
    static let title = LocalizedStringResource("apple.intents.newNoteTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("apple.intents.newNoteDescription", table: "AppIntents"))

    func perform() async throws -> some IntentResult & OpensIntent {
        try await IntentSession.requireSignedIn()
        return .result(opensIntent: OpenURLIntent(TeakLink.newNote.url))
    }
}

/// Opens Teak on the voice memo recorder.
struct RecordVoiceMemoIntent: AppIntent {
    static let title = LocalizedStringResource("apple.intents.recordVoiceMemoTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("apple.intents.recordVoiceMemoDescription", table: "AppIntents"))

    func perform() async throws -> some IntentResult & OpensIntent {
        try await IntentSession.requireSignedIn()
        return .result(opensIntent: OpenURLIntent(TeakLink.voiceMemo.url))
    }
}
