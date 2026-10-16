import Observation
import SwiftUI
import TeakCore

enum AppTab: Hashable {
    case home, add, settings
}

struct CardRoute: Hashable, Identifiable {
    let id: String
    let summary: CardSummary?
}

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

    func handle(_ url: URL) {
        guard url.scheme == "teak" else { return }
        switch url.host() {
        case "save":
            saveRequest = SaveRequest(text: SaveLink.text(from: url.absoluteString))
        case "connect":
            tab = .home
        default:
            break
        }
    }
}
