import Observation
import SwiftUI
import TeakCore

enum AppTab: Hashable {
    case home, add, folders, settings, tags
}

/// A page in iPhone's Folders tab: a folder's cards, or a card opened from one.
enum FoldersRoute: Hashable {
    case folder(String)
    case card(CardRoute)
}

struct CardRoute: Hashable, Identifiable {
    let id: String
    let summary: CardSummary?
}

@MainActor @Observable
final class AppRouter {
    var tab: AppTab = .home
    var homePath: [CardRoute] = []
    var foldersPath: [FoldersRoute] = []
    var isComposing = false
    var composerText = ""
    var isRecording = false
    var isImportingFiles = false
    var isPickingPhotos = false
    var isUsingCamera = false
    var saveRequest: SaveRequest?
    var isRevisiting = false

    struct SaveRequest: Identifiable, Equatable {
        let id = UUID()
        let text: String
    }

    func compose(_ text: String = "") {
        composerText = text
        isComposing = true
    }

    /// Opens a card in the tab it was chosen from: iPhone's Folders tab keeps its own stack.
    func open(_ route: CardRoute) {
        if tab == .folders {
            foldersPath.append(.card(route))
        } else {
            tab = .home
            homePath.append(route)
        }
    }

    /// Leaves a card that was deleted, archived or moved away from.
    func close(_ id: String) {
        homePath.removeAll { $0.id == id }
        foldersPath.removeAll { route in
            if case let .card(card) = route { card.id == id } else { false }
        }
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
