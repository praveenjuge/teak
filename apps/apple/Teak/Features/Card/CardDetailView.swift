import SwiftUI
import TeakCore

struct CardDetailView: View {
    let route: CardRoute
    let library: LibraryModel
    @Environment(AppModel.self) private var app
    // Leaves through the router and opens links directly: reading
    // `dismiss` or `openURL` here fed a render loop with the library's
    // NavigationStack on iOS 26, and the page never appeared.
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var model: CardDetailModel?
    @State private var showsInspector = true
    @State private var showEditSheet = false
    @State private var exporting: CardFile?
    @State private var confirmDeleteForever = false
    @State private var pickingFolders = false
    @State private var editingLink = false
    @State private var feedback = 0

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                ProgressView()
            }
        }
        .modifier(CardTitle(title: title, editable: editsTitle) { [model] text in Task { await model?.saveTitle(text) } })
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            if model == nil { model = CardDetailModel(id: route.id, backend: app.backend, spotlight: app.spotlight) }
            model?.start()
        }
        .onDisappear { model?.stop() }
    }

    private var editsTitle: Bool {
        guard let card = model?.card else { return false }
        return card.type == .link && !card.deleted
    }

    private var title: String {
        if let card = model?.card {
            return card.type == .link ? CardSheet.linkTitle(card) : CardSheet.title(card, fallback: route.summary?.title)
        }
        switch route.summary?.type {
        case .text: return tr("native.card.note")
        case .quote: return tr("cards.types.quote")
        default: return route.summary?.title ?? tr("native.card.previewTitle")
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
                    if !isWide { sections(card, model) }
                }
                .padding(20)
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
            }
            .scrollEdgeEffectStyle(.soft, for: .top)
            .inspector(isPresented: Binding(get: { isWide && showsInspector }, set: { showsInspector = $0 })) {
                ScrollView { sections(card, model).padding(20) }
                    .inspectorColumnWidth(min: 260, ideal: 320, max: 420)
            }
            .toolbar { toolbar(card, model) }
            .sheet(isPresented: $showEditSheet) { CardEditView(cardId: card.id) }
            .sheet(isPresented: $editingLink) {
                EditLinkSheet(address: card.url ?? "") { await model.saveLink($0) }
            }
            .sheet(isPresented: $pickingFolders) {
                FolderPickerView(mode: .card(id: card.id, folderIds: card.folderIds ?? []), folders: AppServices.shared.folders)
            }
            .overlay(alignment: .bottom) {
                if let notice = model.notice {
                    StatusToast(status: notice)
                        .padding(.bottom, 16)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.smooth, value: model.notice)
            .environment(\.openURL, OpenURLAction { url in
                guard let id = CardLinkURL.cardId(url) else {
                    return ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") ? .systemAction : .discarded
                }
                router.open(CardRoute(id: id, summary: nil))
                return .handled
            })
            .focusedSceneValue(\.cardCommands, commands(card, model))
            .fileExporter(isPresented: Binding(presenting: $exporting), item: exporting,
                          contentTypes: exporting.map { [$0.contentType] } ?? [], defaultFilename: exporting?.fileName) { _ in
                exporting = nil
            }
            .confirmationDialog(tr("native.card.deleteForever.title"), isPresented: $confirmDeleteForever) {
                Button(tr("native.actions.deleteForever"), role: .destructive) { run { await model.deleteForever() } }
            } message: {
                Text(tr("native.card.deleteForever.message"))
            }
            .sensoryFeedback(.success, trigger: feedback)
        } else if model.isLoading {
            ProgressView()
        } else {
            ContentUnavailableView(tr("native.card.unavailable.title"), systemImage: "exclamationmark.triangle",
                                   description: Text(tr("native.card.unavailable.movedMessage")))
        }
    }

    private func sections(_ card: Card, _ model: CardDetailModel) -> some View {
        CardSections(card: model.displayedCard ?? card, backlinks: model.backlinks?.backlinks ?? [],
                     hasMoreBacklinks: model.backlinks?.hasMore == true,
                     folderNames: folderNames(card), openCard: { router.open(CardRoute(id: $0, summary: nil)) },
                     openSource: open, editFolders: card.deleted ? nil : { pickingFolders = true },
                     suggestedTags: card.deleted ? nil : SuggestedTagActions(
                         keep: { tag in Task { await model.keepTag(tag) } },
                         remove: { tag in Task { await model.removeSuggestedTag(tag) } }))
    }

    private func folderNames(_ card: Card) -> [String] {
        let folders = AppServices.shared.folders
        return (card.folderIds ?? []).compactMap { folders.folder($0)?.name }
    }

    private func commands(_ card: Card, _ model: CardDetailModel) -> CardCommands? {
        guard !card.deleted else { return nil }
        return CardCommands(
            archived: card.archived,
            done: card.type == .link ? (LinkDone.verb(card.linkCategoryName), model.isDone) : nil,
            toggleArchive: { toggleArchive(card, model) },
            toggleDone: { Task { if await model.toggleDone() { feedback += 1 } } },
            moreLikeThis: { moreLikeThis(card) },
            refresh: { Task { await model.refreshDetails() } })
    }

    private func toggleArchive(_ card: Card, _ model: CardDetailModel) {
        let archived = !card.archived
        let action: BulkCardAction = archived ? .archive : .unarchive
        run {
            guard await model.setArchived(archived) else { return false }
            library.show(action.done(1)) {
                Task {
                    library.dismissStatus()
                    do { try await library.updateArchive(card.id, !archived) } catch { library.show(error) }
                }
            }
            return true
        }
    }

    private func moreLikeThis(_ card: Card) {
        router.homePath.removeAll()
        router.foldersPath.removeAll()
        router.tab = .home
        AppServices.shared.home.moreLike(card.id, title: CardSheet.title(card, fallback: route.summary?.title))
    }

    @ViewBuilder private func hero(_ card: Card, _ model: CardDetailModel) -> some View {
        CardPreview(card: model.displayedCard ?? card, linkTargets: model.linkTargets,
                    toggleTask: card.deleted ? nil : { item in Task { await model.toggleTask(item) } },
                    palette: card.deleted ? nil : PaletteActions(add: { await model.addColor($0) },
                                                                 remove: { await model.removeColor($0) }))
            #if os(macOS)
            .onTapGesture(count: 2) { if CardEdit.canEditContent(card.type) { showEditSheet = true } }
            #endif
    }

    @ToolbarContentBuilder
    private func toolbar(_ card: Card, _ model: CardDetailModel) -> some ToolbarContent {
        if card.deleted {
            ToolbarItem {
                Button(tr("native.actions.restore"), systemImage: "arrow.uturn.backward") { run { await model.restore() } }
            }
            ToolbarItem {
                Button(tr("native.actions.deleteForever"), systemImage: "trash", role: .destructive) { confirmDeleteForever = true }
                    .tint(.red)
            }
        } else {
            ToolbarItem { shareButton(card) }
            ToolbarSpacer(.fixed)
            ToolbarItemGroup {
                Button(model.isFavorited ? tr("native.actions.unfavorite") : tr("native.actions.favorite"),
                       systemImage: model.isFavorited ? "heart.fill" : "heart") {
                    Task { if await model.toggleFavorite() { feedback += 1 } }
                }
                .tint(model.isFavorited ? .red : nil)
                .symbolEffect(.bounce, value: model.isFavorited)
                if card.type == .link {
                    Button(model.isDone ? LinkDone.doneLabel(card.linkCategoryName) : LinkDone.markLabel(card.linkCategoryName),
                           systemImage: model.isDone ? "checkmark.circle.fill" : "circle") {
                        Task { if await model.toggleDone() { feedback += 1 } }
                    }
                    .tint(model.isDone ? .green : nil)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityAddTraits(model.isDone ? .isSelected : [])
                    .accessibilityIdentifier("detail.done")
                }
                if !editsInMenu(card) {
                    Button(tr("common.edit"), systemImage: "pencil") { showEditSheet = true }
                        .keyboardShortcut("e", modifiers: .command)
                }
                Menu(tr("common.more"), systemImage: "ellipsis") { moreMenu(card, model) }
                    .accessibilityIdentifier("detail.more")
            }
            if isWide {
                ToolbarItem {
                    Button(tr("native.card.sections.info"), systemImage: "sidebar.trailing") { showsInspector.toggle() }
                        .keyboardShortcut("i", modifiers: [.command, .option])
                }
            }
        }
    }

    private func editsInMenu(_ card: Card) -> Bool { !isWide && card.type == .link }

    @ViewBuilder private func moreMenu(_ card: Card, _ model: CardDetailModel) -> some View {
        if editsInMenu(card) {
            Button(tr("common.edit"), systemImage: "pencil") { showEditSheet = true }
        }
        Section {
            if let copy = CardSheet.copyText(card) {
                Button(CardSheet.copyLabel(card), systemImage: "doc.on.doc") {
                    Pasteboard.copy(copy)
                    model.show(tr("native.card.copied"))
                }
            }
            if card.type == .link {
                if let url = SafeURL.sanitize(card.url) {
                    Button(tr("native.actions.openLink"), systemImage: "safari") { open(url) }
                } else if card.url != nil {
                    Button(tr("native.actions.openLink"), systemImage: "safari") { model.message = tr("native.card.unsafeLink") }
                }
                Button(tr("native.card.editLink.menu"), systemImage: "square.and.pencil") { editingLink = true }
                    .accessibilityIdentifier("detail.editLink")
            }
            if case let .file(url, name, _) = CardSheet.shareTarget(card) {
                Button(downloadLabel, systemImage: "arrow.down.circle") {
                    exporting = CardFile(fileName: name) { url }
                }
            }
        }
        Section {
            Button(card.archived ? tr("native.actions.unarchive") : tr("native.actions.archive"),
                   systemImage: card.archived ? "tray.and.arrow.up" : "archivebox") {
                toggleArchive(card, model)
            }
            Button(tr("native.card.folders"), systemImage: "folder") { pickingFolders = true }
            Button(tr("native.actions.moreLikeThis"), systemImage: "sparkles") { moreLikeThis(card) }
            Button(tr("native.actions.refreshDetails"), systemImage: "arrow.clockwise") { Task { await model.refreshDetails() } }
                .disabled(model.isRefreshing)
        }
        Section {
            Button(tr("native.actions.copyLinkToCard"), systemImage: "link") {
                Pasteboard.copy(webURL(card).absoluteString)
                model.show(tr("native.actions.linkCopied"))
            }
            Button(tr("native.actions.openOnWeb"), systemImage: "globe") { open(webURL(card)) }
        }
        Button(tr("native.actions.moveToTrash"), systemImage: "trash", role: .destructive) { moveToTrash(card, model) }
    }

    private func moveToTrash(_ card: Card, _ model: CardDetailModel) {
        run {
            guard await model.moveToTrash() else { return false }
            library.showTrashed(card.id)
            return true
        }
    }

    private var downloadLabel: String {
        #if os(macOS)
        tr("native.actions.download")
        #else
        tr("native.actions.saveToFiles")
        #endif
    }

    @ViewBuilder private func shareButton(_ card: Card) -> some View {
        switch CardSheet.shareTarget(card) {
        case let .text(text, subject):
            if let url = SafeURL.sanitize(text), card.type == .link {
                ShareLink(item: url, subject: subject.map(Text.init)) { Label(tr("native.actions.share"), systemImage: "square.and.arrow.up") }
            } else {
                ShareLink(item: text) { Label(tr("native.actions.share"), systemImage: "square.and.arrow.up") }
            }
        case let .file(url, name, _):
            ShareLink(item: CardFile(fileName: name) { url }, preview: SharePreview(name)) {
                Label(tr("native.actions.share"), systemImage: "square.and.arrow.up")
            }
        case .none:
            Button(tr("native.actions.share"), systemImage: "square.and.arrow.up") {}.disabled(true)
        }
    }

    private func open(_ url: URL) {
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    private func webURL(_ card: Card) -> URL { CardSheet.webURL(cardId: card.id, base: app.config.webURL) }

    private func run(_ action: @escaping () async -> Bool) {
        Task {
            if await action() {
                feedback += 1
                router.close(route.id)
            }
        }
    }
}

private struct CardTitle: ViewModifier {
    let title: String
    let editable: Bool
    let save: (String) -> Void
    @State private var draft = ""
    @State private var sent: String?

    func body(content: Content) -> some View {
        if editable {
            content
                .navigationTitle($draft)
                .toolbarTitleMenu { RenameButton() }
                .onAppear { draft = title }
                .onChange(of: title) { old, saved in
                    if draft == old || draft == sent { draft = saved }
                    if sent == saved { sent = nil }
                }
                .task(id: draft) {
                    let typed = draft
                    guard typed != title else { return }
                    try? await Task.sleep(for: .milliseconds(400))
                    guard !Task.isCancelled else { return }
                    if typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        draft = title
                    } else {
                        flush(typed)
                    }
                }
                .onDisappear { flush(draft) }
        } else {
            content.navigationTitle(title)
        }
    }

    private func flush(_ typed: String) {
        guard typed != title, typed != sent, !typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        sent = typed
        save(typed)
    }
}

private struct EditLinkSheet: View {
    let address: String
    let save: (String) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(tr("native.card.editLink.label"), text: $text)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        #endif
                        .onSubmit(submit)
                        .accessibilityIdentifier("editLink.field")
                } footer: {
                    if let error {
                        Text(error).foregroundStyle(.red)
                    } else {
                        Text(tr("native.card.editLink.message"))
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(tr("native.card.editLink.title"))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("common.save"), action: submit)
                        .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 380, minHeight: 200)
        #else
        .presentationDetents([.medium])
        #endif
        .onAppear { text = address }
    }

    private func submit() {
        guard !isSaving else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            if let message = await save(text) {
                error = message
            } else {
                dismiss()
            }
        }
    }
}
