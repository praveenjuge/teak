import SwiftUI
import TeakCore

struct LibraryView: View {
    @Bindable var library: LibraryModel
    let namespace: Namespace.ID
    @Environment(AppModel.self) private var app
    @Environment(AppRouter.self) private var router
    private var services: AppServices { AppServices.shared }
    @State private var width = 0.0
    @State private var editing: CardRoute?
    @State private var exporting: CardFile?
    @State private var confirmingEmptyTrash = false
    @State private var confirmingDeleteForever: CardSummary?
    @State private var confirmingBulkDelete = false
    @State private var addingTags = false
    @State private var bulkTags = ""
    @State private var pickingFolder = false
    @State private var folderPrompt: FolderPrompt?
    @State private var revisiting = false
    @FocusState private var focusedCard: String?

    var body: some View {
        GeometryReader { proxy in
            content
                .onAppear { width = proxy.size.width }
                .onChange(of: proxy.size.width) { _, newWidth in width = newWidth }
        }
            .navigationTitle(library.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
            #endif
            .searchable(text: $library.text, tokens: $library.tokens,
                        placement: searchPlacement, prompt: tr("native.library.search")) { token in
                Label(token.label, systemImage: token.symbol)
            }
            // Suggestions, not suggested tokens: iOS shows those only while the field is empty.
            .searchSuggestions {
                ForEach(suggestions) { token in
                    Label(token.label, systemImage: token.symbol).searchCompletion(token)
                }
            }
            .onSubmit(of: .search) { library.commitText() }
            .toolbar { toolbar }
            .overlay(alignment: .bottom) { bottomOverlay }
            .task { library.start() }
            .task(id: library.isTrash) { await library.followTrashCount() }
            .sheet(item: $editing) { route in CardEditView(cardId: route.id) }
            .fileExporter(isPresented: Binding(presenting: $exporting), item: exporting,
                          contentTypes: exporting.map { [$0.contentType] } ?? [],
                          defaultFilename: exporting?.fileName) { result in
                if case .failure = result { library.show(tr("native.card.failed.download"), isError: true) }
                exporting = nil
            }
            .confirmationDialog(tr("native.trash.emptyTitle"), isPresented: $confirmingEmptyTrash) {
                Button(tr("native.trash.empty"), role: .destructive) { Task { await library.emptyTrash() } }
                Button(tr("common.cancel"), role: .cancel) {}
            } message: {
                Text(library.emptyTrashMessage)
            }
            .confirmationDialog(tr("native.card.deleteForever.title"), isPresented: Binding(presenting: $confirmingDeleteForever),
                                presenting: confirmingDeleteForever) { card in
                Button(tr("native.actions.deleteForever"), role: .destructive) { Task { await library.deleteForever(card.id) } }
                Button(tr("common.cancel"), role: .cancel) { confirmingDeleteForever = nil }
            } message: { _ in
                Text(tr("native.card.deleteForever.message"))
            }
            .confirmationDialog(tr("native.card.deleteForever.title"), isPresented: $confirmingBulkDelete) {
                Button(tr("native.actions.deleteForever"), role: .destructive) { Task { await library.deleteSelectedForever() } }
            } message: {
                Text(tr("native.bulk.deleteForeverMessage", count: library.selection?.count ?? 0))
            }
            .alert(tr("native.bulk.addTagsTitle", count: library.selection?.count ?? 0), isPresented: $addingTags) {
                TextField(tr("native.bulk.tagsPlaceholder"), text: $bulkTags)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                Button(tr("common.cancel"), role: .cancel) { bulkTags = "" }
                Button(tr("native.actions.addTags")) {
                    let tags = CardEdit.adding(bulkTags, to: [])
                    bulkTags = ""
                    Task { await library.run(.addTags, tags: tags) }
                }
            } message: {
                Text(tr("native.bulk.tagsHint"))
            }
            .sheet(isPresented: $pickingFolder) {
                FolderPickerView(mode: .bulk(count: library.selection?.count ?? 0), folders: services.folders) { folder in
                    Task { await library.run(.addToFolder, folder: folder) }
                }
            }
            .sheet(isPresented: $revisiting) {
                RevisitView(model: RevisitModel(backend: app.backend, library: library))
            }
            // The menu command asks the main library, never a folder's.
            // `initial`: the command can switch to Home first, so this view may start out already asked.
            .onChange(of: router.isRevisiting, initial: true) { _, asked in
                guard asked, library === services.home else { return }
                router.isRevisiting = false
                revisiting = true
            }
            .folderPrompt($folderPrompt, actions: FolderActions(folders: services.folders, library: library))
            .onChange(of: library.cards.isEmpty) { _, empty in if empty { library.checkHiddenCards() } }
            .onChange(of: library.pager.isLoading) { _, loading in
                if !loading, library.cards.isEmpty { library.checkHiddenCards() }
            }
            .sensoryFeedback(trigger: library.status) { _, status in
                guard let status else { return nil }
                return status.isError ? .error : .success
            }
            .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow]) { press in
                moveFocus(press.key)
            }
            .onKeyPress(.return) {
                guard let id = focusedCard, let card = library.cards.first(where: { $0.id == id }) else { return .ignored }
                open(card)
                return .handled
            }
            .onKeyPress(.escape) {
                guard library.isSelecting else { return .ignored }
                library.endSelection()
                return .handled
            }
    }

    private var searchPlacement: SearchFieldPlacement {
        #if os(iOS)
        .navigationBarDrawer(displayMode: .always)
        #else
        .automatic
        #endif
    }

    private var suggestions: [SearchToken] { SearchTokens.suggestions(for: library.text) }

    private var showsComposer: Bool {
        #if os(macOS)
        false
        #else
        columns >= 3 && !library.isTrash && !library.isSelecting
        #endif
    }

    private var columns: Int { CardGrid.columnCount(width: width) }
    private var columnWidth: Double { max(0, CardGrid.columnWidth(width: width, columns: columns)) }

    @ViewBuilder private var content: some View {
        let cards = library.cards
        if cards.isEmpty, library.pager.error != nil {
            loadFailed
        } else if cards.isEmpty, !library.pager.isLoading {
            emptyState
        } else {
            // One scroll view for the skeleton and the grid, so the large title
            // keeps tracking it when the first page arrives.
            ScrollView {
                if library.query.revealsHiddenCards {
                    Label(HiddenTags.searchHint, systemImage: "eye.slash")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, CardGrid.edge + 4)
                        .padding(.top, 4)
                }
                if library.pager.isStale {
                    refreshFailed
                }
                if cards.isEmpty {
                    SkeletonGrid(columns: columns, columnWidth: columnWidth)
                } else {
                    grid(cards)
                    if library.pager.isLoadingMore {
                        ProgressView().padding(.bottom, 24)
                    } else if library.pager.error != nil, !library.pager.isStale {
                        loadMoreFailed
                    }
                }
            }
            .scrollDisabled(cards.isEmpty)
            .cardSwipeContainer()
            // Offline, a refresh would wait for the connection with the spinner showing.
            .refreshable { if app.isOnline { await library.refresh() } }
        }
    }

    private func grid(_ cards: [CardSummary]) -> some View {
        let nearEnd = Set(cards.suffix(5).map(\.id))
        let laidOut = layout(cards)
        return HStack(alignment: .top, spacing: CardGrid.gap) {
            ForEach(Array(laidOut.enumerated()), id: \.offset) { index, column in
                LazyVStack(spacing: CardGrid.gap) {
                    if index == 0, showsComposer {
                        InlineComposerTile(width: columnWidth)
                    }
                    ForEach(column) { card in
                        tile(card)
                            .onAppear { if nearEnd.contains(card.id) { library.pager.loadMore() } }
                    }
                }
                .frame(width: columnWidth)
            }
        }
        .padding(.horizontal, CardGrid.edge)
        .padding(.top, 8)
        .padding(.bottom, library.isSelecting ? 96 : 24)
    }

    private func layout(_ cards: [CardSummary]) -> [[CardSummary]] {
        CardGrid.distribute(cards, columns: columns, reservedTopHeights: showsComposer ? [120] : []) {
            CardGrid.estimatedHeight($0, columnWidth: columnWidth)
        }
    }

    private func moveFocus(_ direction: KeyEquivalent) -> KeyPress.Result {
        let columns = layout(library.cards).filter { !$0.isEmpty }
        guard !columns.isEmpty else { return .ignored }
        guard let focused = focusedCard,
              let column = columns.firstIndex(where: { $0.contains { $0.id == focused } }),
              let row = columns[column].firstIndex(where: { $0.id == focused })
        else {
            focusedCard = columns[0].first?.id
            return .handled
        }
        var target: (Int, Int) = (column, row)
        switch direction {
        case .upArrow: target.1 = max(0, row - 1)
        case .downArrow: target.1 = min(columns[column].count - 1, row + 1)
        case .leftArrow: target.0 = max(0, column - 1)
        case .rightArrow: target.0 = min(columns.count - 1, column + 1)
        default: return .ignored
        }
        target.1 = min(target.1, columns[target.0].count - 1)
        focusedCard = columns[target.0][target.1].id
        return .handled
    }

    private func tile(_ card: CardSummary) -> some View {
        let selected = library.selection.map { $0.contains(card.id) }
        return Button {
            #if os(macOS)
            // Command-click picks cards, as in Finder.
            if NSEvent.modifierFlags.contains(.command) { return library.toggleSelection(card.id) }
            #endif
            open(card)
        } label: {
            CardTile(card: card, width: columnWidth, isSelected: selected, isTrashed: library.isTrash)
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: card.id, in: namespace)
        .focused($focusedCard, equals: card.id)
        .contextMenu { CardContextMenu(card: card, library: library, actions: menuActions) }
        .modifier(CardSwipeActions(card: card, library: library, actions: menuActions))
        #if os(macOS)
        // Mac only: on iOS a drag interaction beside the context menu kept the
        // app from settling for a minute after the menu opened.
        .draggable(card.url.flatMap(SafeURL.sanitize) ?? CardSheet.webURL(cardId: card.id, base: app.config.webURL))
        #endif
        .accessibilityAddTraits(selected == true ? .isSelected : [])
        .accessibilityIdentifier("card.\(card.id)")
    }

    private func open(_ card: CardSummary) {
        if library.isSelecting {
            library.toggleSelection(card.id)
        } else {
            router.open(CardRoute(id: card.id, summary: card))
        }
    }

    private var menuActions: CardMenuActions {
        CardMenuActions(
            open: open,
            edit: { editing = CardRoute(id: $0.id, summary: $0) },
            export: { card in
                // The full card names the file, with its extension, before the save panel asks where.
                Task {
                    let full = try? await app.backend.query(ConvexFunctions.getCard, ["id": .string(card.id)])
                    guard let full, case let .file(url, name, _) = CardSheet.shareTarget(full) else {
                        return library.show(tr("native.card.failed.download"), isError: true)
                    }
                    exporting = CardFile(fileName: name) { url }
                }
            },
            moveToTrash: { card in Task { await library.moveToTrash(card.id) } },
            confirmDeleteForever: { confirmingDeleteForever = $0 },
            moreLikeThis: { library.moreLike($0.id, title: $0.title) })
    }

    private var loadFailed: some View {
        ContentUnavailableView {
            Label(tr("native.library.loadFailed.title"), systemImage: "exclamationmark.triangle")
        } description: {
            Text(tr("native.errors.offline"))
        } actions: {
            Button(tr("common.retry")) { library.pager.retry() }.buttonStyle(.bordered)
        }
    }

    /// A refresh failed: the cards from before stay, with a way to try again.
    private var refreshFailed: some View {
        HStack {
            Label(tr("native.library.loadFailed.title"), systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Button(tr("common.retry")) { library.pager.retry() }
                .font(.footnote.weight(.semibold))
                .buttonStyle(.borderless)
        }
        .padding(.horizontal, CardGrid.edge + 4)
        .padding(.top, 4)
    }

    private var loadMoreFailed: some View {
        VStack(spacing: 8) {
            Text(tr("native.library.loadMoreFailed")).font(.footnote).foregroundStyle(.secondary)
            Button(tr("common.retry")) { library.pager.retry() }.buttonStyle(.bordered)
        }
        .padding(.bottom, 24)
    }

    @ViewBuilder private var emptyState: some View {
        let query = library.query
        if !query.isNarrowed {
            FirstCardView()
        } else {
            let state = query.emptyState()
            ContentUnavailableView {
                Label(state.title, systemImage: state.symbol)
            } description: {
                VStack(spacing: 8) {
                    if let message = semanticMessage ?? (state.message.isEmpty ? nil : state.message) { Text(message) }
                    if library.hasHiddenCards, !query.hasSearch { Text(HiddenTags.emptyViewHint) }
                }
            } actions: {
                if ["pending", "unavailable", "anchor_unavailable"].contains(library.semanticOutcome) {
                    Button(tr("common.tryAgain")) { library.reload() }.buttonStyle(.bordered)
                } else if !library.tokens.isEmpty || (library.filters.isActive && library.filters.folder == nil) {
                    // A folder page clears its search but stays on the folder.
                    Button(tr("native.library.clearFilters")) {
                        let folder = library.filters.folder
                        library.clearFilters()
                        library.filters.folder = folder
                    }
                    .buttonStyle(.bordered)
                } else if library.filters.folder != nil, library === services.home {
                    Button(tr("native.library.showAllCards")) { library.clearFilters() }.buttonStyle(.bordered)
                }
            }
        }
    }

    /// Why search by meaning found nothing, in the web's words.
    private var semanticMessage: String? {
        switch library.semanticOutcome {
        case "pending", "anchor_unavailable": tr("native.similar.pending")
        case "rate_limited": tr("native.similar.rateLimited")
        case "unavailable": tr("native.similar.unavailable")
        default: nil
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if library.isSelecting {
            ToolbarItem(placement: .confirmationAction) {
                Button(tr("common.done")) { library.endSelection() }
                    .accessibilityLabel(tr("native.library.doneSelecting"))
            }
            ToolbarItem {
                Button(tr("native.library.selectAll")) { library.selectAll() }
            }
        } else {
            #if os(macOS)
            ToolbarItem {
                Menu(tr("native.app.nav.add"), systemImage: "plus") {
                    Button(tr("native.capture.newNote"), systemImage: "square.and.pencil") { router.compose() }
                    Button(tr("native.capture.voiceMemo"), systemImage: "mic") { router.isRecording = true }
                    Button(tr("apple.library.uploadFiles"), systemImage: "arrow.up.doc") { router.isImportingFiles = true }
                }
                .accessibilityIdentifier("library.add")
            }
            #endif
            if library.isTrash {
                ToolbarItem {
                    Button(tr("native.trash.empty"), systemImage: "xmark.bin", role: .destructive) { confirmingEmptyTrash = true }
                        .disabled(!library.canEmptyTrash)
                        .accessibilityIdentifier("library.emptyTrash")
                }
            }
            ToolbarItem {
                LibraryMenu(library: library, revisit: { revisiting = true }, saveSmartFolder: saveSmartFolder,
                            emptyTrash: library.isTrash ? { confirmingEmptyTrash = true } : nil)
            }
        }
    }

    private var saveSmartFolder: (() -> Void)? {
        let query = library.query
        guard let smart = query.smartFolderQuery, query.filters.folder == nil else { return nil }
        return {
            folderPrompt = .smart(query: smart, name: query.suggestedSmartFolderName,
                                  dropsFilters: query.smartFolderDropsFilters)
        }
    }

    @ViewBuilder private var bottomOverlay: some View {
        VStack(spacing: 12) {
            if let status = library.status {
                StatusToast(status: status)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if library.isSelecting {
                SelectionBar(library: library, confirmDeleteForever: { confirmingBulkDelete = true },
                             addTags: { addingTags = true }, addToFolder: { pickingFolder = true })
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.bottom, 16)
        .animation(.smooth, value: library.status)
        .animation(.smooth, value: library.isSelecting)
    }
}

/// The library's one header menu: select and revisit, what to show, and
/// the order to show it in.
struct LibraryMenu: View {
    @Bindable var library: LibraryModel
    let revisit: () -> Void
    let saveSmartFolder: (() -> Void)?
    /// Asks before emptying Trash; set only in Trash.
    var emptyTrash: (() -> Void)?

    var body: some View {
        Menu {
            Section {
                Button(tr("native.actions.select"), systemImage: "checkmark.circle") { library.beginSelection() }
                    .accessibilityIdentifier("library.select")
                Button(tr("native.revisit.title"), systemImage: "rectangle.stack", action: revisit)
                    .disabled(library.isTrash || library.isArchive || library.cards.isEmpty)
                    .accessibilityIdentifier("library.revisit")
            }
            Section(tr("native.library.menu.show")) {
                Toggle(isOn: $library.filters.favoritesOnly) { Label(tr("native.filters.favorites"), systemImage: "heart") }
                Toggle(isOn: $library.filters.archivedOnly) { Label(tr("native.filters.archive"), systemImage: "archivebox") }
                Toggle(isOn: $library.filters.trashOnly) { Label(tr("native.filters.trash"), systemImage: "trash") }
                Menu {
                    ForEach(CardType.allCases) { type in
                        Toggle(type.plural, isOn: Binding(
                            get: { library.filters.types.contains(type) },
                            set: { _ in library.filters = library.filters.togglingType(type) }))
                    }
                } label: {
                    Label(tr("native.library.menu.type"), systemImage: "square.grid.2x2")
                }
                Menu {
                    ForEach(ColorHue.all) { hue in
                        Toggle(isOn: Binding(
                            get: { library.filters.hue == hue },
                            set: { library.filters.hue = $0 ? hue : nil })) {
                            Label {
                                Text(hue.label)
                            } icon: {
                                colorDot(Color(hex: hue.hex) ?? .gray)
                            }
                        }
                    }
                } label: {
                    Label(tr("native.library.menu.color"), systemImage: "paintpalette")
                }
            }
            Picker(tr("native.library.menu.sort"), selection: Binding(get: { sortKind }, set: { chooseSort($0) })) {
                Text(LibrarySort.newest.label).tag(0)
                Text(LibrarySort.oldest.label).tag(1)
                Text(tr("native.filters.sort.shuffle")).tag(2)
            }
            .pickerStyle(.inline)
            if library.sort.isShuffle {
                Section {
                    Button(tr("native.library.menu.reshuffle"), systemImage: "shuffle") { library.shuffle() }
                }
            }
            if let emptyTrash {
                Section {
                    Button(tr("native.trash.empty"), systemImage: "xmark.bin", role: .destructive, action: emptyTrash)
                        .disabled(!library.canEmptyTrash)
                }
            }
            if saveSmartFolder != nil || narrowed {
                Section {
                    if let saveSmartFolder {
                        Button(tr("native.library.menu.saveSmartFolder"), systemImage: "folder.badge.gearshape", action: saveSmartFolder)
                    }
                    if narrowed {
                        // A folder page keeps its folder.
                        Button(tr("native.library.clearFilters"), systemImage: "xmark.circle", role: .destructive) {
                            library.filters = LibraryFilters(folder: library.filters.folder)
                        }
                    }
                }
            }
        } label: {
            Label(tr("common.more"), systemImage: narrowed || library.sort != .newest
                ? "ellipsis.circle.fill" : "ellipsis.circle")
                .labelStyle(.iconOnly)
        }
        .accessibilityLabel(tr("common.more"))
        .accessibilityIdentifier("library.more")
    }

    /// Filters beyond the folder a page is scoped to.
    private var narrowed: Bool {
        var filters = library.filters
        filters.folder = nil
        return filters.isActive
    }

    private var sortKind: Int {
        switch library.sort {
        case .newest: 0
        case .oldest: 1
        case .shuffle: 2
        }
    }

    private func chooseSort(_ kind: Int) {
        switch kind {
        case 1: library.sort = .oldest
        case 2: if !library.sort.isShuffle { library.shuffle() }
        default: library.sort = .newest
        }
    }
}

struct SelectionBar: View {
    let library: LibraryModel
    let confirmDeleteForever: () -> Void
    let addTags: () -> Void
    let addToFolder: () -> Void
    @Namespace private var glass

    var body: some View {
        let disabled = (library.selection?.isEmpty ?? true) || library.isRunningBulkAction
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                if library.isTrash {
                    Button(tr("native.actions.restore"), systemImage: "arrow.uturn.backward") { Task { await library.run(.restore) } }
                        .glassEffectID("restore", in: glass)
                    Button(tr("native.actions.deleteForever"), systemImage: "trash", role: .destructive, action: confirmDeleteForever)
                        .glassEffectID("forever", in: glass)
                } else {
                    if library.isArchive {
                        Button(tr("native.actions.unarchive"), systemImage: "tray.and.arrow.up") { Task { await library.run(.unarchive) } }
                            .glassEffectID("unarchive", in: glass)
                    } else {
                        Button(tr("native.actions.archive"), systemImage: "archivebox") { Task { await library.run(.archive) } }
                            .glassEffectID("archive", in: glass)
                    }
                    Button(tr("native.bulk.addTagsEllipsis"), systemImage: "tag", action: addTags)
                        .glassEffectID("tags", in: glass)
                    Button(tr("native.bulk.addToFolderEllipsis"), systemImage: "folder.badge.plus", action: addToFolder)
                        .glassEffectID("folder", in: glass)
                    // Unfavorites when every chosen card is already a favorite.
                    let unfavorite = !library.selectedCards.isEmpty && library.selectedCards.allSatisfy(\.favorited)
                    Button(unfavorite ? tr("native.bulk.removeFromFavorites") : tr("native.bulk.addToFavorites"),
                           systemImage: unfavorite ? "heart.slash" : "heart") {
                        Task { await library.run(unfavorite ? .unfavorite : .favorite) }
                    }
                    .glassEffectID("favorite", in: glass)
                    Button(tr("native.actions.moveToTrash"), systemImage: "trash", role: .destructive) { Task { await library.run(.delete) } }
                        .glassEffectID("delete", in: glass)
                }
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .controlSize(.large)
            .disabled(disabled)
        }
    }
}

struct StatusToast: View {
    let status: LibraryModel.StatusMessage
    @Environment(\.openURL) private var openURL
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: status.isError ? "exclamationmark.circle" : "checkmark.circle")
                .foregroundStyle(status.isError ? .red : .green)
            Text(status.text).font(.subheadline.weight(.medium))
            if let undo = status.undo {
                Button(tr("common.undo")) { undo() }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("status.undo")
            }
            #if os(macOS)
            if status.isCardLimit {
                Button(tr("native.app.upgrade")) { openURL(app.config.webURL.appending(path: "settings")) }
                    .buttonStyle(.borderless)
            }
            #endif
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: status.undo == nil ? .combine : .contain)
        .accessibilityAddTraits(.isStaticText)
        .onAppear { AccessibilityNotification.Announcement(status.text).post() }
    }
}

struct FirstCardView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        VStack(spacing: 20) {
            Image("Wordmark")
                .resizable()
                .scaledToFit()
                .frame(width: 72)
                .foregroundStyle(.primary)
                .accessibilityLabel("Teak")
            VStack(spacing: 6) {
                Text(tr("native.library.firstCard.title")).font(.headline)
                Text(tr("native.library.firstCard.message"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button(tr("native.library.firstCard.writeNote"), systemImage: "square.and.pencil") { router.compose() }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A colored dot for menus. Menus draw SwiftUI symbols as monochrome
/// templates, so the dot is a platform image that keeps its color.
func colorDot(_ color: Color) -> Image {
    #if os(macOS)
    let configuration = NSImage.SymbolConfiguration(paletteColors: [NSColor(color)])
    if let image = NSImage(systemSymbolName: "circle.fill", accessibilityDescription: nil)?
        .withSymbolConfiguration(configuration) {
        image.isTemplate = false
        return Image(nsImage: image)
    }
    #else
    if let image = UIImage(systemName: "circle.fill")?.withTintColor(UIColor(color), renderingMode: .alwaysOriginal) {
        return Image(uiImage: image)
    }
    #endif
    return Image(systemName: "circle.fill")
}
