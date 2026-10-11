import Observation
import SwiftUI
import TeakCore

enum AppTab: Hashable {
    case home, add, settings
}

/// A card opened in the detail page.
struct CardRoute: Hashable, Identifiable {
    let id: String
    /// The tile's summary, for a title and zoom source while the card loads.
    let summary: CardSummary?
}

/// What the app is showing, shared by menus, deep links and the views.
@MainActor @Observable
final class AppRouter {
    var tab: AppTab = .home
    var homePath: [CardRoute] = []
    var isComposing = false
    var composerText = ""
    var isRecording = false
    var isImportingFiles = false
    var isPickingPhotos = false
    var isUsingCamera = false
    /// Text from `teak://save?text=` waiting to be saved.
    var saveRequest: SaveRequest?

    struct SaveRequest: Identifiable, Equatable {
        let id = UUID()
        let text: String
    }

    func compose(_ text: String = "") {
        composerText = text
        isComposing = true
    }

    func open(_ route: CardRoute) {
        tab = .home
        homePath.append(route)
    }

    /// Routes `teak://` links. The auth callback is handled by the sign-in session.
    func handle(_ url: URL) {
        guard url.scheme == "teak" else { return }
        switch url.host() {
        case "save":
            saveRequest = SaveRequest(text: SaveLink.text(from: url.absoluteString))
        case "connect":
            // The Safari extension asks the app to sign in; the welcome screen shows when signed out.
            tab = .home
        default:
            break
        }
    }
}
