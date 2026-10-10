import SwiftUI
import TeakCore

/// The masonry grid of cards with search, filters and selection.
struct LibraryView: View {
    @Bindable var library: LibraryModel
    let namespace: Namespace.ID
    @Environment(AppModel.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var width = 0.0
    @State private var editing: CardRoute?
    @State private var exporting: CardFile?
    @State private var confirmingDelete: CardSummary?
    @State private var confirmingDeleteForever: CardSummary?
    @State private var confirmingBulkDelete = false
    @State private var tapCount = 0
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
            .searchable(text: $library.text, tokens: $library.tokens, suggestedTokens: .constant(suggestions),
                        placement: searchPlacement, prompt: "Search") { token in
                Label(token.label, systemImage: token.symbol)
            }
            .onSubmit(of: .search) { library.commitText() }
            .toolbar { toolbar }
            .overlay(alignment: .bottom) { bottomOverlay }
            .task { library.start() }
            .sheet(item: $editing) { route in CardEditView(cardId: route.id) }
            .fileExporter(isPresented: .constant(exporting != nil), item: exporting,
                          contentTypes: exporting.map { [$0.contentType] } ?? [],
                          defaultFilename: exporting?.fileName) { result in
                if case .failure = result { library.show("Unable to download this file.", isError: true) }
                exporting = nil
            }
            .confirmationDialog("Delete Card", isPresented: .constant(confirmingDelete != nil),
                                presenting: confirmingDelete) { card in
                Button("Delete", role: .destructive) { Task { await library.moveToTrash(card.id) } }
                Button("Cancel", role: .cancel) { confirmingDelete = nil }
            } message: { _ in
                Text("This card will be moved to Trash.")
            }
            .confirmationDialog("Delete Forever?", isPresented: .constant(confirmingDeleteForever != nil),
                                presenting: confirmingDeleteForever) { card in
                Button("Delete Forever", role: .destructive) { Task { await library.deleteForever(card.id) } }
                Button("Cancel", role: .cancel) { confirmingDeleteForever = nil }
            } message: { _ in
                Text("This removes the card and its files. You can't undo it.")
            }
            .confirmationDialog("Delete Forever?", isPresented: $confirmingBulkDelete) {
                Button("Delete Forever", role: .destructive) { Task { await library.run(.deleteForever) } }
            } message: {
                let count = library.selection?.count ?? 0
                Text("\(count == 1 ? "This card" : "\(count) cards") and their files will be removed. You can't undo it.")
            }
            .sensoryFeedback(.impact(weight: .light), trigger: tapCount)
            .sensoryFeedback(trigger: library.status) { _, status in
                guard let status else { return nil }
                return status.isError ? .error : .success
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

    private var columns: Int { CardGrid.columnCount(width: width) }
    private var columnWidth: Double { max(0, CardGrid.columnWidth(width: width, columns: columns)) }

    @ViewBuilder private var content: some View {
        let cards = library.cards
        if library.pager.isLoading && cards.isEmpty {
            ScrollView { SkeletonGrid(columns: columns, columnWidth: columnWidth) }
                .scrollDisabled(true)
        } else if cards.isEmpty {
            emptyState
        } else {
            ScrollView {
                grid(cards)
                if library.pager.isLoadingMore {
                    ProgressView().padding(.bottom, 24)
                }
            }
            .refreshable { await library.refresh() }
        }
    }

    private func grid(_ cards: [CardSummary]) -> some View {
        let nearEnd = Set(cards.suffix(5).map(\.id))
        let laidOut = CardGrid.distribute(cards, columns: columns) { CardGrid.estimatedHeight($0, columnWidth: columnWidth) }
        return HStack(alignment: .top, spacing: CardGrid.gap) {
            ForEach(Array(laidOut.enumerated()), id: \.offset) { _, column in
                LazyVStack(spacing: CardGrid.gap) {
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

    private func tile(_ card: CardSummary) -> some View {
        let selected = library.selection.map { $0.contains(card.id) }
        return Button {
            open(card)
        } label: {
            CardTile(card: card, width: columnWidth, isSelected: selected, isTrashed: library.isTrash)
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: card.id, in: namespace)
        .focused($focusedCard, equals: card.id)
        .contextMenu { CardContextMenu(card: card, library: library, actions: menuActions) }
        #if os(macOS)
        .simultaneousGesture(TapGesture().modifiers(.command).onEnded { library.toggleSelection(card.id) })
        #endif
        .draggable(card.url.flatMap(SafeURL.sanitize) ?? CardSheet.webURL(cardId: card.id, base: app.config.webURL))
        .accessibilityIdentifier("card.\(card.id)")
    }

    private func open(_ card: CardSummary) {
        tapCount += 1
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
                exporting = CardFile(fileName: card.fileName ?? card.title) {
                    let full: Card? = try await app.backend.query("cards:getCard", ["id": .string(card.id)])
                    guard let full, case let .file(url, _, _) = CardSheet.shareTarget(full) else {
                        throw TeakError(message: "Unable to download this file.")
                    }
                    return url
                }
            },
            confirmDelete: { card in
                #if os(macOS)
                Task { await library.moveToTrash(card.id) }
                #else
                confirmingDelete = card
                #endif
            },
            confirmDeleteForever: { confirmingDeleteForever = $0 })
    }

    // MARK: Empty states

    @ViewBuilder private var emptyState: some View {
        let query = library.query
        if !query.isNarrowed {
            FirstCardView()
        } else {
            let state = query.emptyState()
            ContentUnavailableView {
                Label(state.title, systemImage: state.symbol)
            } description: {
                Text(state.message)
            } actions: {
                if library.filters.isActive || !library.tokens.isEmpty {
                    Button("Clear Filters") { library.clearFilters() }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if library.isSelecting {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { library.endSelection() }
                    .accessibilityLabel("Done selecting")
            }
            ToolbarItem {
                Button("Select All") { library.selectAll() }
            }
        } else {
            ToolbarItem {
                Button("Select", systemImage: "checkmark.circle") { library.beginSelection() }
                    .accessibilityLabel("Select cards")
            }
            ToolbarItem {
                FilterMenu(library: library)
            }
        }
    }

    @ViewBuilder private var bottomOverlay: some View {
        VStack(spacing: 12) {
            if let status = library.status {
                StatusToast(status: status)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if library.isSelecting {
                SelectionBar(library: library, confirmDeleteForever: { confirmingBulkDelete = true })
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.bottom, 16)
        .animation(.smooth, value: library.status)
        .animation(.smooth, value: library.isSelecting)
    }
}

/// The filter menu: Favorites, Trash, types, one color, and Clear.
struct FilterMenu: View {
    @Bindable var library: LibraryModel

    var body: some View {
        Menu {
            Toggle(isOn: $library.filters.favoritesOnly) { Label("Favorites", systemImage: "heart") }
            Toggle(isOn: $library.filters.trashOnly) { Label("Trash", systemImage: "trash") }
            Menu {
                ForEach(CardType.allCases) { type in
                    Toggle(type.plural, isOn: Binding(
                        get: { library.filters.types.contains(type) },
                        set: { _ in library.filters = library.filters.togglingType(type) }))
                }
            } label: {
                Label("Type", systemImage: "square.grid.2x2")
            }
            Menu {
                ForEach(ColorHue.all) { hue in
                    Toggle(isOn: Binding(
                        get: { library.filters.hue == hue },
                        set: { library.filters.hue = $0 ? hue : nil })) {
                        Label {
                            Text(hue.label)
                        } icon: {
                            Image(systemName: "circle.fill").foregroundStyle(Color(hex: hue.hex) ?? .gray)
                        }
                    }
                }
            } label: {
                Label("Color", systemImage: "paintpalette")
            }
            if library.filters.isActive {
                Divider()
                Button("Clear Filters", systemImage: "xmark.circle", role: .destructive) { library.filters = .empty }
            }
        } label: {
            Label("Filter", systemImage: library.filters.isActive
                ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .accessibilityLabel("Filter")
    }
}

/// The floating bulk-action bar while selecting.
struct SelectionBar: View {
    let library: LibraryModel
    let confirmDeleteForever: () -> Void
    @Namespace private var glass

    var body: some View {
        let disabled = (library.selection?.isEmpty ?? true) || library.isRunningBulkAction
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                if library.isTrash {
                    Button("Restore", systemImage: "arrow.uturn.backward") { Task { await library.run(.restore) } }
                        .glassEffectID("restore", in: glass)
                    Button("Delete Forever", systemImage: "trash", role: .destructive, action: confirmDeleteForever)
                        .glassEffectID("forever", in: glass)
                } else {
                    Button("Favorite", systemImage: "heart") { Task { await library.run(.favorite) } }
                        .glassEffectID("favorite", in: glass)
                    Button("Unfavorite", systemImage: "heart.slash") { Task { await library.run(.unfavorite) } }
                        .glassEffectID("unfavorite", in: glass)
                    Button("Delete", systemImage: "trash", role: .destructive) { Task { await library.run(.trash) } }
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

/// A short message about the last action.
struct StatusToast: View {
    let status: LibraryModel.StatusMessage
    @Environment(\.openURL) private var openURL
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: status.isError ? "exclamationmark.circle" : "checkmark.circle")
                .foregroundStyle(status.isError ? .red : .green)
            Text(status.text).font(.subheadline.weight(.medium))
            #if os(macOS)
            if status.isCardLimit {
                Button("Upgrade…") { openURL(app.config.webURL.appending(path: "settings")) }
                    .buttonStyle(.borderless)
            }
            #endif
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
        .onAppear { AccessibilityNotification.Announcement(status.text).post() }
    }
}

/// The first-run state: the wordmark, a prompt, and one action.
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
                Text("Let's add your first card!").font(.headline)
                Text("Save notes, links, photos, and voice memos. They'll show up here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button("Write a Note", systemImage: "square.and.pencil") { router.compose() }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
