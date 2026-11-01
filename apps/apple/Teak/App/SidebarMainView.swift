import SwiftUI
import TeakCore

enum SidebarItem: Hashable {
    case home, add, favorites, archive, trash, tags, settings, type(CardType), folder(String)

    init?(_ filters: LibraryFilters) {
        guard filters.hue == nil else { return nil }
        if let folder = filters.folder {
            guard !filters.favoritesOnly, !filters.trashOnly, !filters.archivedOnly, filters.types.isEmpty else { return nil }
            self = .folder(folder.id)
            return
        }
        switch (filters.favoritesOnly, filters.trashOnly, filters.archivedOnly, filters.types) {
        case (false, false, false, []): self = .home
        case (true, false, false, []): self = .favorites
        case (false, false, true, []): self = .archive
        case (_, true, _, []): self = .trash
        case let (false, false, false, types) where types.count == 1: self = .type(types[0])
        default: return nil
        }
    }

    var filters: LibraryFilters? {
        switch self {
        case .add, .tags, .settings, .folder: nil
        case .home: .empty
        case .favorites: LibraryFilters(favoritesOnly: true)
        case .archive: LibraryFilters(archivedOnly: true)
        case .trash: LibraryFilters(trashOnly: true)
        case let .type(type): LibraryFilters(types: [type])
        }
    }
}

struct SidebarMainView: View {
    let namespace: Namespace.ID
    @Environment(AppRouter.self) private var router
    @State private var prompt: FolderPrompt?

    private var services: AppServices { AppServices.shared }

    var body: some View {
        @Bindable var router = router
        let library = services.home
        let actions = FolderActions(folders: services.folders, library: library)
        NavigationSplitView {
            List(selection: selection(library)) {
                Label(tr("native.filters.home"), systemImage: "house").tag(SidebarItem.home)
                Label(tr("native.app.nav.add"), systemImage: "plus.circle").tag(SidebarItem.add)
                Label(tr("native.filters.favorites"), systemImage: "heart").tag(SidebarItem.favorites)
                Label(tr("native.filters.archive"), systemImage: "archivebox").tag(SidebarItem.archive)
                Label(tr("native.tags.title"), systemImage: "number").tag(SidebarItem.tags)
                Label(tr("native.filters.trash"), systemImage: "trash").tag(SidebarItem.trash)
                #if os(iOS)
                // The Mac keeps Settings in its own window, from the app menu and ⌘,.
                Label(tr("native.settings.title"), systemImage: "gearshape").tag(SidebarItem.settings)
                #endif
                Section {
                    ForEach(services.folders.folders) { folder in
                        FolderLabel(folder: folder)
                            .tag(SidebarItem.folder(folder.id))
                            .contextMenu { FolderMenu(folder: folder, prompt: $prompt, actions: actions) }
                    }
                    #if os(iOS)
                    if services.folders.folders.isEmpty, services.folders.isLoaded {
                        Button(tr("native.folders.newFolder"), systemImage: "folder.badge.plus") { prompt = .create }
                            .buttonStyle(.borderless)
                            .foregroundStyle(.secondary)
                    }
                    #endif
                } header: {
                    #if os(macOS)
                    Text(tr("native.folders.title"))
                    #else
                    HStack {
                        Text(tr("native.folders.title"))
                        Spacer()
                        Button(tr("native.folders.newFolder"), systemImage: "plus") { prompt = .create }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .accessibilityIdentifier("sidebar.newFolder")
                    }
                    #endif
                }
                Section(tr("native.app.nav.types")) {
                    ForEach(CardType.allCases) { type in
                        Label(type.plural, systemImage: type.symbol).tag(SidebarItem.type(type))
                    }
                }
            }
            .navigationTitle("Teak")
            #if os(macOS)
            // A Mac sidebar adds at its foot, as Reminders and Music do.
            .safeAreaInset(edge: .bottom) {
                Button(tr("native.folders.newFolder"), systemImage: "plus.circle") { prompt = .create }
                    .buttonStyle(.borderless)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .accessibilityIdentifier("sidebar.newFolder")
            }
            #endif
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 300)
            .folderPrompt($prompt, actions: actions)
        } detail: {
            switch router.tab {
            case .add:
                NavigationStack { AddView() }
            case .tags:
                NavigationStack {
                    TagsView(model: services.tags) { tag in
                        library.open(nil)
                        library.filterByTag(tag)
                        router.homePath = []
                        router.tab = .home
                    }
                }
            case .settings:
                NavigationStack { SettingsView() }
            case .home, .folders:
                LibraryTab(library: library, path: $router.homePath, namespace: namespace)
            }
        }
    }

    private func selection(_ library: LibraryModel) -> Binding<SidebarItem?> {
        Binding {
            switch router.tab {
            case .add: .add
            case .tags: .tags
            case .settings: .settings
            case .home, .folders: SidebarItem(library.filters)
            }
        } set: { item in
            guard let item else { return }
            // Leave Home with no card pushed: rebuilding the library's stack
            // later with a stale path crashed SwiftUI's split view on iPad.
            if [.add, .tags, .settings].contains(item) { router.homePath = [] }
            switch item {
            case .add: router.tab = .add
            case .tags: router.tab = .tags
            case .settings: router.tab = .settings
            case let .folder(id):
                library.open(services.folders.folder(id))
                router.homePath = []
                router.tab = .home
            default:
                if let filters = item.filters {
                    library.filters = filters
                    router.homePath = []
                    router.tab = .home
                }
            }
        }
    }
}
