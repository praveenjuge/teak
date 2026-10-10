import SwiftUI
import TeakCore

/// A card's page: its media or content, then notes, tags and info. Wide
/// windows move the details into an inspector.
struct CardDetailView: View {
    let route: CardRoute
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var model: CardDetailModel?
    @State private var showsInspector = true
    @State private var showEditSheet = false
    @State private var exporting: CardFile?
    @State private var confirmDeleteForever = false
    @State private var feedback = 0

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            if model == nil { model = CardDetailModel(id: route.id, backend: app.backend) }
            model?.start()
        }
        .onDisappear { model?.stop() }
    }

    private var title: String {
        if let card = model?.card { return CardSheet.title(card, fallback: route.summary?.title) }
        switch route.summary?.type {
        case .text: return "Note"
        case .quote: return "Quote"
        default: return route.summary?.title ?? "Preview"
        }
    }

    private var isWide: Bool {
        #if os(macOS)
        true
        #else
        sizeClass == .regular
        #endif
    }

    @ViewBuilder private func content(_ model: CardDetailModel) -> some View {
        if let card = model.card {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    hero(card, model)
                    if let message = model.message {
                        Label(message, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                    }
                    if !isWide { CardSections(card: card) }
                }
                .padding(20)
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
            }
            .scrollEdgeEffectStyle(.soft, for: .top)
            .inspector(isPresented: .constant(isWide && showsInspector)) {
                ScrollView { CardSections(card: card).padding(20) }
                    .inspectorColumnWidth(min: 260, ideal: 320, max: 420)
            }
            .toolbar { toolbar(card, model) }
            .sheet(isPresented: $showEditSheet) { CardEditView(cardId: card.id) }
            .fileExporter(isPresented: .constant(exporting != nil), item: exporting,
                          contentTypes: exporting.map { [$0.contentType] } ?? [], defaultFilename: exporting?.fileName) { _ in
                exporting = nil
            }
            .confirmationDialog("Delete Forever?", isPresented: $confirmDeleteForever) {
                Button("Delete Forever", role: .destructive) { run { await model.deleteForever() } }
            } message: {
                Text("This card and its files will be deleted. You can't undo this.")
            }
            .sensoryFeedback(.success, trigger: feedback)
        } else if model.isLoading {
            ProgressView()
        } else {
            ContentUnavailableView("Card unavailable", systemImage: "exclamationmark.triangle",
                                   description: Text("It may have been deleted or moved."))
        }
    }

    // MARK: Content

    @ViewBuilder private func hero(_ card: Card, _ model: CardDetailModel) -> some View {
        CardPreview(card: card)
            #if os(macOS)
            .onTapGesture(count: 2) { if CardEdit.canEditContent(card.type) { showEditSheet = true } }
            #endif
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private func toolbar(_ card: Card, _ model: CardDetailModel) -> some ToolbarContent {
        if card.deleted {
            ToolbarItem {
                Button("Restore", systemImage: "arrow.uturn.backward") { run { await model.restore() } }
            }
            ToolbarItem {
                Button("Delete Forever", systemImage: "trash", role: .destructive) { confirmDeleteForever = true }
                    .tint(.red)
            }
        } else {
            ToolbarItem { shareButton(card) }
            ToolbarSpacer(.fixed)
            ToolbarItemGroup {
                Button(model.isFavorited ? "Unfavorite" : "Favorite",
                       systemImage: model.isFavorited ? "heart.fill" : "heart") {
                    Task { if await model.toggleFavorite() { feedback += 1 } }
                }
                .tint(model.isFavorited ? .red : nil)
                .symbolEffect(.bounce, value: model.isFavorited)
                Button("Edit", systemImage: "pencil") { showEditSheet = true }
                .keyboardShortcut("e", modifiers: .command)
                Menu("More", systemImage: "ellipsis") { moreMenu(card, model) }
            }
            if isWide {
                ToolbarItem {
                    Button("Info", systemImage: "sidebar.trailing") { showsInspector.toggle() }
                        .keyboardShortcut("i", modifiers: [.command, .option])
                }
            }
        }
    }

    @ViewBuilder private func moreMenu(_ card: Card, _ model: CardDetailModel) -> some View {
        Section {
            if let copy = CardSheet.copyText(card) {
                Button(CardSheet.copyLabel(card), systemImage: "doc.on.doc") {
                    Pasteboard.copy(copy)
                    feedback += 1
                }
            }
            if card.type == .link {
                if let url = SafeURL.sanitize(card.url) {
                    Button("Open in Browser", systemImage: "safari") { openURL(url) }
                } else if card.url != nil {
                    Button("Open in Browser", systemImage: "safari") { model.message = "This link looks unsafe to open." }
                }
            }
            if case let .file(url, name, _) = CardSheet.shareTarget(card) {
                Button(downloadLabel, systemImage: "arrow.down.circle") {
                    exporting = CardFile(fileName: name) { url }
                }
            }
        }
        Section {
            Button("Copy Link to Card", systemImage: "link") {
                Pasteboard.copy(webURL(card).absoluteString)
                feedback += 1
            }
            Button("Open on Web", systemImage: "globe") { openURL(webURL(card)) }
        }
        Button("Delete Card", systemImage: "trash", role: .destructive) { run { await model.moveToTrash() } }
    }

    private var downloadLabel: String {
        #if os(macOS)
        "Download"
        #else
        "Save to Files"
        #endif
    }

    @ViewBuilder private func shareButton(_ card: Card) -> some View {
        switch CardSheet.shareTarget(card) {
        case let .text(text, subject):
            if let url = SafeURL.sanitize(text), card.type == .link {
                ShareLink(item: url, subject: subject.map(Text.init)) { Label("Share", systemImage: "square.and.arrow.up") }
            } else {
                ShareLink(item: text) { Label("Share", systemImage: "square.and.arrow.up") }
            }
        case let .file(url, name, _):
            ShareLink(item: CardFile(fileName: name) { url }, preview: SharePreview(name)) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
        case .none:
            Button("Share", systemImage: "square.and.arrow.up") {}.disabled(true)
        }
    }

    private func webURL(_ card: Card) -> URL { CardSheet.webURL(cardId: card.id, base: app.config.webURL) }

    /// Runs an action that leaves the page when it works.
    private func run(_ action: @escaping () async -> Bool) {
        Task {
            if await action() {
                feedback += 1
                dismiss()
            }
        }
    }
}
