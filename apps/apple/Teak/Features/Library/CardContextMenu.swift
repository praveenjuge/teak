import CoreTransferable
import SwiftUI
import TeakCore
import UniformTypeIdentifiers

struct CardText: Transferable, Sendable {
    let preview: String
    let load: @Sendable () async throws -> String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .plainText) { item in
            Data(((try? await item.load()) ?? item.preview).utf8)
        }
    }
}

struct CardMenuActions {
    var open: (CardSummary) -> Void
    var edit: (CardSummary) -> Void
    var export: (CardSummary) -> Void
    var moveToTrash: (CardSummary) -> Void
    var confirmDeleteForever: (CardSummary) -> Void
    var moreLikeThis: (CardSummary) -> Void
}

struct CardContextMenu: View {
    let card: CardSummary
    let library: LibraryModel
    let actions: CardMenuActions
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL

    var body: some View {
        if library.isTrash {
            Button(tr("native.actions.restore"), systemImage: "arrow.uturn.backward") {
                Task { await library.restore(card.id) }
            }
            Button(tr("native.actions.deleteForever"), systemImage: "trash", role: .destructive) {
                actions.confirmDeleteForever(card)
            }
        } else {
            Section {
                if card.type == .link, let url = SafeURL.sanitize(card.url) {
                    Button(tr("native.actions.openLink"), systemImage: "safari") { openURL(url) }
                }
                copyButton
                shareButton
                if isFile {
                    Button(saveLabel, systemImage: "arrow.down.circle") { actions.export(card) }
                }
            }
            Section {
                Button(tr("native.actions.addTags"), systemImage: "tag") { actions.edit(card) }
                Button(card.favorited ? tr("native.actions.unfavorite") : tr("native.actions.favorite"), systemImage: card.favorited ? "heart.slash" : "heart") {
                    Task { await library.setFavorite(card, !card.favorited) }
                }
                Button(card.archived ? tr("native.actions.unarchive") : tr("native.actions.archive"), systemImage: card.archived ? "tray.and.arrow.up" : "archivebox") {
                    Task { await library.setArchived(card.id, !card.archived) }
                }
                Button(tr("native.actions.moreLikeThis"), systemImage: "sparkles") { actions.moreLikeThis(card) }
                Button(tr("native.actions.refreshDetails"), systemImage: "arrow.clockwise") { Task { await library.refreshDetails(card.id) } }
                Button(tr("native.actions.copyLinkToCard"), systemImage: "link") {
                    Pasteboard.copy(webURL.absoluteString)
                    library.show(tr("native.actions.linkCopied"))
                }
                Button(tr("native.actions.openOnWeb"), systemImage: "globe") { openURL(webURL) }
                Button(tr("native.actions.select"), systemImage: "checkmark.circle") { library.beginSelection(with: card.id) }
            }
            Button(tr("native.actions.moveToTrash"), systemImage: "trash", role: .destructive) { actions.moveToTrash(card) }
        }
    }

    private var webURL: URL { CardSheet.webURL(cardId: card.id, base: app.config.webURL) }

    private var isFile: Bool { [.image, .video, .audio, .document].contains(card.type) }

    private var saveLabel: String {
        #if os(macOS)
        tr("native.actions.download")
        #else
        tr("native.actions.saveToFiles")
        #endif
    }

    @ViewBuilder private var copyButton: some View {
        switch card.type {
        case .link:
            if let url = card.url {
                Button(tr("native.actions.copyLink"), systemImage: "doc.on.doc") { Pasteboard.copy(url) }
            }
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                Button(tr("native.actions.copyPalette"), systemImage: "doc.on.doc") { Pasteboard.copy(colors.joined(separator: ", ")) }
            }
        case .text, .quote:
            Button(card.type == .quote ? tr("native.actions.copyQuote") : tr("native.actions.copyText"), systemImage: "doc.on.doc") {
                Task {
                    let text = (try? await loadCard())?.content ?? card.previewText ?? card.title
                    Pasteboard.copy(text)
                }
            }
        case .image:
            Button(tr("native.actions.copyImage"), systemImage: "doc.on.doc") {
                Task {
                    guard let card = try? await loadCard(), let url = CardSheet.imageURLs(card).first,
                          let data = try? await ImagePipeline.shared.data(for: url), Pasteboard.copyImage(data)
                    else { return library.show(tr("native.actions.copyImageFailed"), isError: true) }
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
                ShareLink(item: url, subject: Text(card.title)) { Label(tr("native.actions.share"), systemImage: "square.and.arrow.up") }
            }
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                ShareLink(item: colors.joined(separator: ", ")) { Label(tr("native.actions.share"), systemImage: "square.and.arrow.up") }
            }
        case .text, .quote:
            let text = CardText(preview: card.previewText ?? card.title) { [self] in
                try await loadCard()?.content ?? card.previewText ?? card.title
            }
            ShareLink(item: text, preview: SharePreview(card.title)) { Label(tr("native.actions.share"), systemImage: "square.and.arrow.up") }
        case .image, .video, .audio, .document:
            let file = CardFile(fileName: card.fileName ?? card.title) { [self] in
                guard let full = try await loadCard(), case let .file(url, _, _) = CardSheet.shareTarget(full) else {
                    throw TeakError(message: tr("native.actions.shareFailed"))
                }
                return url
            }
            ShareLink(item: file, preview: SharePreview(card.title)) { Label(tr("native.actions.share"), systemImage: "square.and.arrow.up") }
        }
    }

    private func loadCard() async throws -> Card? {
        try await app.backend.query(ConvexFunctions.getCard, ["id": .string(card.id)])
    }
}

struct CardSwipeActions: ViewModifier {
    let card: CardSummary
    let library: LibraryModel
    let actions: CardMenuActions

    func body(content: Content) -> some View {
        if #available(iOS 27, macOS 27, *), !library.isSelecting {
            content
                .swipeActions(edge: .leading) {
                    if !library.isTrash {
                        Button(card.favorited ? tr("native.actions.unfavorite") : tr("native.actions.favorite"),
                               systemImage: card.favorited ? "heart.slash" : "heart") {
                            Task { await library.setFavorite(card, !card.favorited) }
                        }
                        .tint(.pink)
                        Button(card.archived ? tr("native.actions.unarchive") : tr("native.actions.archive"),
                               systemImage: card.archived ? "tray.and.arrow.up" : "archivebox") {
                            Task { await library.setArchived(card.id, !card.archived) }
                        }
                        .tint(.indigo)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if library.isTrash {
                        Button(tr("native.actions.deleteForever"), systemImage: "trash", role: .destructive) {
                            actions.confirmDeleteForever(card)
                        }
                        Button(tr("native.actions.restore"), systemImage: "arrow.uturn.backward") {
                            Task { await library.restore(card.id) }
                        }
                    } else {
                        Button(tr("native.actions.moveToTrash"), systemImage: "trash", role: .destructive) { actions.moveToTrash(card) }
                    }
                }
        } else {
            content
        }
    }
}

extension View {
    @ViewBuilder func cardSwipeContainer() -> some View {
        if #available(iOS 27, macOS 27, *) {
            swipeActionsContainer()
        } else {
            self
        }
    }
}
