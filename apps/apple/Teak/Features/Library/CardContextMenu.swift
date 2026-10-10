import CoreTransferable
import SwiftUI
import TeakCore
import UniformTypeIdentifiers

/// A card's text, loaded in full only when someone shares it.
struct CardText: Transferable, Sendable {
    let preview: String
    let load: @Sendable () async throws -> String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .plainText) { item in
            Data(((try? await item.load()) ?? item.preview).utf8)
        }
    }
}

/// What a tile's context menu asks its library to do.
struct CardMenuActions {
    var open: (CardSummary) -> Void
    var edit: (CardSummary) -> Void
    var export: (CardSummary) -> Void
    var confirmDelete: (CardSummary) -> Void
    var confirmDeleteForever: (CardSummary) -> Void
}

/// The tile's context menu: the iPhone and Mac menus combined.
struct CardContextMenu: View {
    let card: CardSummary
    let library: LibraryModel
    let actions: CardMenuActions
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL

    var body: some View {
        if library.isTrash {
            Button("Restore", systemImage: "arrow.uturn.backward") {
                Task { await library.restore(card.id) }
            }
            Button("Delete Forever", systemImage: "trash", role: .destructive) {
                actions.confirmDeleteForever(card)
            }
        } else {
            Section {
                if card.type == .link, let url = SafeURL.sanitize(card.url) {
                    Button("Open Link", systemImage: "safari") { openURL(url) }
                }
                copyButton
                shareButton
                if isFile {
                    Button(saveLabel, systemImage: "arrow.down.circle") { actions.export(card) }
                }
            }
            Section {
                Button("Add Tags", systemImage: "tag") { actions.edit(card) }
                Button(card.favorited ? "Unfavorite" : "Favorite", systemImage: card.favorited ? "heart.slash" : "heart") {
                    Task { await library.setFavorite(card, !card.favorited) }
                }
                Button("Copy Link to Card", systemImage: "link") {
                    Pasteboard.copy(webURL.absoluteString)
                    library.show("Link copied")
                }
                Button("Open on Web", systemImage: "globe") { openURL(webURL) }
                Button("Select", systemImage: "checkmark.circle") { library.beginSelection(with: card.id) }
            }
            Button("Delete", systemImage: "trash", role: .destructive) { actions.confirmDelete(card) }
        }
    }

    private var webURL: URL { CardSheet.webURL(cardId: card.id, base: app.config.webURL) }

    private var isFile: Bool { [.image, .video, .audio, .document].contains(card.type) }

    private var saveLabel: String {
        #if os(macOS)
        "Download"
        #else
        "Save to Files"
        #endif
    }

    @ViewBuilder private var copyButton: some View {
        switch card.type {
        case .link:
            if let url = card.url {
                Button("Copy Link", systemImage: "doc.on.doc") { Pasteboard.copy(url) }
            }
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                Button("Copy Palette", systemImage: "doc.on.doc") { Pasteboard.copy(colors.joined(separator: ", ")) }
            }
        case .text, .quote:
            Button(card.type == .quote ? "Copy Quote" : "Copy Text", systemImage: "doc.on.doc") {
                Task {
                    let text = (try? await loadCard())?.content ?? card.previewText ?? card.title
                    Pasteboard.copy(text)
                }
            }
        case .image:
            Button("Copy Image", systemImage: "doc.on.doc") {
                Task {
                    guard let card = try? await loadCard(), let url = CardSheet.imageURLs(card).first,
                          let data = try? await ImagePipeline.shared.data(for: url), Pasteboard.copyImage(data)
                    else { return library.show("Couldn't copy this image.", isError: true) }
                }
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var shareButton: some View {
        switch card.type {
        case .link:
            if let url = SafeURL.sanitize(card.url) {
                ShareLink(item: url, subject: Text(card.title)) { Label("Share", systemImage: "square.and.arrow.up") }
            }
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                ShareLink(item: colors.joined(separator: ", ")) { Label("Share", systemImage: "square.and.arrow.up") }
            }
        case .text, .quote:
            let text = CardText(preview: card.previewText ?? card.title) { [self] in
                try await loadCard()?.content ?? card.previewText ?? card.title
            }
            ShareLink(item: text, preview: SharePreview(card.title)) { Label("Share", systemImage: "square.and.arrow.up") }
        case .image, .video, .audio, .document:
            let file = CardFile(fileName: card.fileName ?? card.title) { [self] in
                guard let full = try await loadCard(), case let .file(url, _, _) = CardSheet.shareTarget(full) else {
                    throw TeakError(message: "Couldn't share this file.")
                }
                return url
            }
            ShareLink(item: file, preview: SharePreview(card.title)) { Label("Share", systemImage: "square.and.arrow.up") }
        }
    }

    private func loadCard() async throws -> Card? {
        try await app.backend.query("cards:getCard", ["id": .string(card.id)])
    }
}

/// iOS and macOS 27 let grid tiles take swipe actions: favorite from the
/// leading edge, delete (or restore in Trash) from the trailing edge.
struct CardSwipeActions: ViewModifier {
    let card: CardSummary
    let library: LibraryModel
    let actions: CardMenuActions

    func body(content: Content) -> some View {
        if #available(iOS 27, macOS 27, *), !library.isSelecting {
            content
                .swipeActions(edge: .leading) {
                    if !library.isTrash {
                        Button(card.favorited ? "Unfavorite" : "Favorite",
                               systemImage: card.favorited ? "heart.slash" : "heart") {
                            Task { await library.setFavorite(card, !card.favorited) }
                        }
                        .tint(.pink)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if library.isTrash {
                        Button("Delete Forever", systemImage: "trash", role: .destructive) {
                            actions.confirmDeleteForever(card)
                        }
                        Button("Restore", systemImage: "arrow.uturn.backward") {
                            Task { await library.restore(card.id) }
                        }
                    } else {
                        Button("Delete", systemImage: "trash", role: .destructive) { actions.confirmDelete(card) }
                    }
                }
        } else {
            content
        }
    }
}

extension View {
    /// Lets the tiles inside this scroll view reveal their swipe actions, one at a time.
    @ViewBuilder func cardSwipeContainer() -> some View {
        if #available(iOS 27, macOS 27, *) {
            swipeActionsContainer()
        } else {
            self
        }
    }
}
