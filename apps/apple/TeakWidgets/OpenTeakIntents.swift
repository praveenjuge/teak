import AppIntents
import Foundation

// What the New Note and Voice Memo controls run. An intent that opens the app from a
// control has to be in both the app and the widget extension, so this file is in both
// targets: the system brings Teak forward and performs the intent there, where it hands
// the `teak://` route to the app's router. A signed-out router drops the request.
//
// `OpenURLIntent` can't do this: from a control it opens universal links only, not
// `teak://`. These intents stay out of Shortcuts and Spotlight, so their titles never
// show; the controls' text comes from the catalog.

struct OpenNewNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "New Note"
    static let isDiscoverable = false
    static let supportedModes: IntentModes = .foreground

    @MainActor
    func perform() async throws -> some IntentResult {
        openTeak("teak://new-note")
        return .result()
    }
}

struct OpenVoiceMemoIntent: AppIntent {
    static let title: LocalizedStringResource = "Voice Memo"
    static let isDiscoverable = false
    static let supportedModes: IntentModes = .foreground

    @MainActor
    func perform() async throws -> some IntentResult {
        openTeak("teak://voice-memo")
        return .result()
    }
}

@MainActor
private func openTeak(_ route: String) {
    #if !TEAK_WIDGETS
    guard let url = URL(string: route) else { return }
    AppServices.shared.router.handle(url)
    #endif
}
