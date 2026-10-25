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

    /// A link that needs the library, held until the app knows who's signed in.
    private var pendingLink: TeakLink?

    /// Follows a `teak://` link. Signed out, the app stays on the welcome
    /// screen and a link into the library is dropped.
    func handle(_ url: URL, phase: AppPhase) {
        switch TeakLink(url) {
        case let .save(text): saveRequest = SaveRequest(text: text)
        case .connect: tab = .home
        case let link?:
            pendingLink = link
            follow(phase)
        case nil: break
        }
    }

    /// Opens a held link once the library shows, or drops it when no one is signed in.
    func follow(_ phase: AppPhase) {
        guard let link = pendingLink else { return }
        switch phase {
        case .signedIn:
            pendingLink = nil
            open(link)
        case .signedOut:
            pendingLink = nil
        case .loading, .offline, .failed:
            break
        }
    }

    private func open(_ link: TeakLink) {
        switch link {
        case let .card(id):
            tab = .home
            if homePath.last?.id != id { homePath = [CardRoute(id: id, summary: nil)] }
        case .newNote: compose()
        case .voiceMemo: isRecording = true
        case .save, .connect: break
        }
    }
}
