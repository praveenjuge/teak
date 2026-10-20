import SwiftUI
import TeakCore

/// What the folder name prompt is for.
enum FolderPrompt: Identifiable, Equatable {
    case create
    case rename(Folder)
    case smart(query: String, name: String, dropsFilters: Bool)

    var id: String {
        switch self {
        case .create: "create"
        case let .rename(folder): "rename-\(folder.id)"
        case let .smart(query, _, _): "smart-\(query)"
        }
    }

    var title: String {
        switch self {
        case .create: "New Folder"
        case .rename: "Rename Folder"
        case .smart: "Save as Smart Folder"
        }
    }

    var message: String {
        switch self {
        case .create: "Name the folder."
        case .rename: "Change the folder's name."
        case let .smart(_, _, dropsFilters):
            "Shows every card that matches the search, including cards you save later."
                + (dropsFilters ? " Colors, styles and dates aren't saved in a smart folder." : "")
        }
    }

    var confirm: String {
        switch self {
        case .create: "Create Folder"
        case .rename: "Save"
        case .smart: "Save Smart Folder"
        }
    }

    var initialName: String {
        switch self {
        case .create: ""
        case let .rename(folder): folder.name
        case let .smart(_, name, _): name
        }
    }
}

/// Folder actions that report through the library's toasts.
@MainActor
struct FolderActions {
    let folders: FoldersModel
    let library: LibraryModel

    func submit(_ prompt: FolderPrompt, name: String, open: Bool = true) async {
        do {
            switch prompt {
            case .create:
                _ = try await folders.create(name: name)
            case let .rename(folder):
                try await folders.rename(folder, to: name)
                if library.filters.folder?.id == folder.id { library.filters.folder?.name = name }
            case let .smart(query, _, _):
                let saved = try await folders.create(name: name, smartQuery: query)
                library.show("Saved \u{201C}\(saved.name)\u{201D}")
                if open { library.open(saved) }
            }
        } catch {
            library.show(error.teakMessage, isError: true)
        }
    }

    func delete(_ folder: Folder) async {
        do {
            try await folders.delete(folder)
            if library.filters.folder?.id == folder.id { library.open(nil) }
            library.show("Deleted \u{201C}\(folder.name)\u{201D}") {
                Task {
                    library.dismissStatus()
                    do { try await folders.restore(folder) } catch {
                        library.show("Couldn't restore the folder", isError: true)
                    }
                }
            }
        } catch {
            library.show("Couldn't delete the folder", isError: true)
        }
    }
}

struct FolderPromptModifier: ViewModifier {
    @Binding var prompt: FolderPrompt?
    let actions: FolderActions
    @State private var name = ""

    func body(content: Content) -> some View {
        content
            .alert(prompt?.title ?? "", isPresented: Binding(presenting: $prompt), presenting: prompt) { prompt in
                TextField("Folder name", text: $name)
                    .accessibilityIdentifier("folder.name")
                Button("Cancel", role: .cancel) { self.prompt = nil }
                Button(prompt.confirm) {
                    let submitted = name
                    Task { await actions.submit(prompt, name: submitted) }
                }
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: { prompt in
                Text(prompt.message)
            }
            .onChange(of: prompt) { _, next in name = next?.initialName ?? "" }
    }
}

extension View {
    func folderPrompt(_ prompt: Binding<FolderPrompt?>, actions: FolderActions) -> some View {
        modifier(FolderPromptModifier(prompt: prompt, actions: actions))
    }
}

struct FolderLabel: View {
    let folder: Folder

    var body: some View {
        Label {
            HStack {
                Text(folder.name).lineLimit(1)
                Spacer(minLength: 8)
                if !folder.isSmart {
                    Text(Int(folder.activeCardCount), format: .number)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        } icon: {
            Image(systemName: folder.symbol)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(folder.isSmart ? "\(folder.name), smart folder" : folder.name)
    }
}

/// The context menu a folder row offers in the sidebar and the Folders list.
struct FolderMenu: View {
    let folder: Folder
    @Binding var prompt: FolderPrompt?
    let actions: FolderActions

    var body: some View {
        Button("Rename…", systemImage: "pencil") { prompt = .rename(folder) }
        Button("Delete", systemImage: "trash", role: .destructive) { Task { await actions.delete(folder) } }
    }
}

#if os(iOS)
/// iPhone's Folders tab: every folder and smart folder; tapping one shows its cards.
struct FoldersTab: View {
    let namespace: Namespace.ID
    @Environment(AppRouter.self) private var router

    private var services: AppServices { AppServices.shared }

    var body: some View {
        @Bindable var router = router
        let library = services.folderLibrary
        NavigationStack(path: $router.foldersPath) {
            FoldersPage(library: library, folders: services.folders)
                .navigationDestination(for: FoldersRoute.self) { route in
                    switch route {
                    case .folder:
                        LibraryView(library: library, namespace: namespace)
                    case let .card(card):
                        CardDetailView(route: card)
                            .navigationTransition(.zoom(sourceID: card.id, in: namespace))
                    }
                }
        }
        .environment(\.filterLibrary, LibraryFilterAction(
            tag: { tag in show { services.home.filterByTag(tag) } },
            type: { type in show { services.home.filterByType(type) } }))
    }

    /// A tag or type tapped in a folder's card searches the whole library from Home.
    private func show(_ change: () -> Void) {
        services.home.open(nil)
        change()
        router.foldersPath = []
        router.homePath = []
        router.tab = .home
    }
}

struct FoldersPage: View {
    let library: LibraryModel
    let folders: FoldersModel
    @Environment(AppRouter.self) private var router
    @State private var prompt: FolderPrompt?

    private var actions: FolderActions { FolderActions(folders: folders, library: library) }

    var body: some View {
        List {
            ForEach(folders.folders) { folder in
                Button {
                    library.open(folder)
                    router.foldersPath = [.folder(folder.id)]
                } label: {
                    FolderLabel(folder: folder).contentShape(.rect)
                }
                .accessibilityIdentifier("folder.\(folder.id)")
                .contextMenu { FolderMenu(folder: folder, prompt: $prompt, actions: actions) }
                .swipeActions {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        Task { await actions.delete(folder) }
                    }
                    Button("Rename…", systemImage: "pencil") { prompt = .rename(folder) }
                }
            }
        }
        .tint(.primary)
        .overlay {
            if !folders.isLoaded {
                ProgressView()
            } else if folders.folders.isEmpty {
                ContentUnavailableView {
                    Label("No Folders Yet", systemImage: "folder")
                } description: {
                    Text("Group related cards. Make a folder, then add cards to it.")
                } actions: {
                    Button("New Folder") { prompt = .create }.buttonStyle(.bordered)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let status = library.status {
                StatusToast(status: status)
                    .padding(.bottom, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.smooth, value: library.status)
        .navigationTitle("Folders")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New Folder", systemImage: "folder.badge.plus") { prompt = .create }
                    .accessibilityIdentifier("folders.new")
            }
        }
        .folderPrompt($prompt, actions: actions)
    }
}
#endif

/// Picks folders for one card (a checklist) or for the selected cards (one tap adds them).
struct FolderPickerView: View {
    enum Mode {
        case card(id: String, folderIds: [String])
        case bulk(count: Int)
    }

    let mode: Mode
    let folders: FoldersModel
    var onPick: (Folder) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var checked: [String] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                }
                let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty, !folders.folders.contains(where: { $0.name.caseInsensitiveCompare(trimmed) == .orderedSame }) {
                    Button("Create folder \u{201C}\(trimmed)\u{201D}", systemImage: "folder.badge.plus") {
                        Task { await create(trimmed) }
                    }
                }
                ForEach(visible) { folder in
                    Button { Task { await toggle(folder) } } label: {
                        HStack {
                            FolderLabel(folder: folder)
                            if case .card = mode {
                                Image(systemName: checked.contains(folder.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(checked.contains(folder.id) ? Color.accentColor : .secondary)
                            }
                        }
                    }
                    .accessibilityAddTraits(checked.contains(folder.id) ? .isSelected : [])
                }
                if visible.isEmpty, trimmed.isEmpty, folders.isLoaded {
                    Text("No folders yet. Type a name to create one.").foregroundStyle(.secondary)
                }
            }
            .tint(.primary)
            .searchable(text: $query, prompt: "Find or create a folder")
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .frame(minWidth: 360, minHeight: 420)
        .onAppear { if case let .card(_, ids) = mode { checked = ids } }
    }

    private var title: String {
        switch mode {
        case .card: "Folders"
        case let .bulk(count): "Add \(BulkCardAction.cards(count)) to a Folder"
        }
    }

    private var visible: [Folder] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let manual = folders.manual
        return trimmed.isEmpty ? manual : manual.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    private func create(_ name: String) async {
        do {
            let folder = try await folders.create(name: name)
            query = ""
            await toggle(folder)
        } catch {
            self.error = error.teakMessage
        }
    }

    private func toggle(_ folder: Folder) async {
        switch mode {
        case let .card(id, _):
            let previous = checked
            if let index = checked.firstIndex(of: folder.id) { checked.remove(at: index) } else { checked.append(folder.id) }
            do {
                try await folders.setFolders(cardId: id, folderIds: checked)
                error = nil
            } catch {
                checked = previous
                self.error = error.teakMessage
            }
        case .bulk:
            onPick(folder)
            dismiss()
        }
    }
}
