#if os(macOS)
import SwiftUI
import TeakCore

/// A sidebar row: Add, or a view of the library. Library rows read and write
/// the library's filters, so the sidebar and the Filter menu always agree.
enum SidebarItem: Hashable {
    case home, add, favorites, trash, type(CardType)

    /// The library row for these filters, or nil when they match no single row.
    init?(_ filters: LibraryFilters) {
        guard filters.hue == nil else { return nil }
        switch (filters.favoritesOnly, filters.trashOnly, filters.types) {
        case (false, false, []): self = .home
        case (true, false, []): self = .favorites
        case (_, true, []): self = .trash
        case let (false, false, types) where types.count == 1: self = .type(types[0])
        default: return nil
        }
    }

    /// The filters a library row shows; nil for Add.
    var filters: LibraryFilters? {
        switch self {
        case .add: nil
        case .home: .empty
        case .favorites: LibraryFilters(favoritesOnly: true)
        case .trash: LibraryFilters(trashOnly: true)
        case let .type(type): LibraryFilters(types: [type])
        }
    }
}

/// The Mac window: Add, library views and card types in the sidebar, Settings at the bottom.
struct MacMainView: View {
    let namespace: Namespace.ID
    @Environment(AppRouter.self) private var router

    var body: some View {
        @Bindable var router = router
        let library = AppServices.shared.home
        NavigationSplitView {
            List(selection: selection(library)) {
                Label("Home", systemImage: "house").tag(SidebarItem.home)
                Label("Add", systemImage: "plus.circle").tag(SidebarItem.add)
                Label("Favorites", systemImage: "heart").tag(SidebarItem.favorites)
                Label("Trash", systemImage: "trash").tag(SidebarItem.trash)
                Section("Types") {
                    ForEach(CardType.allCases) { type in
                        Label(type.plural, systemImage: type.symbol).tag(SidebarItem.type(type))
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button { AppServices.shared.showSettings() } label: {
                    Label("Settings", systemImage: "gearshape")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 21)
                .padding(.vertical, 12)
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 280)
        } detail: {
            if router.tab == .add {
                NavigationStack { AddView() }
            } else {
                LibraryTab(library: library, path: $router.homePath, namespace: namespace)
            }
        }
    }

    private func selection(_ library: LibraryModel) -> Binding<SidebarItem?> {
        Binding {
            router.tab == .add ? .add : SidebarItem(library.filters)
        } set: { item in
            guard let item else { return }
            if let filters = item.filters {
                library.filters = filters
                router.homePath = []
                router.tab = .home
            } else {
                router.tab = .add
            }
        }
    }
}
#endif
