import SwiftUI
import TeakCore

/// What the folder name prompt is for.
enum FolderPrompt: Identifiable, Equatable {
    case create
    case rename(Folder)
    case smart(query: String, name: String, dropsFilters: Bool)
    /// A smart folder's name and search, edited together.
    case editSearch(Folder)

    var id: String {
        switch self {
        case .create: "create"
        case let .rename(folder): "rename-\(folder.id)"
        case let .smart(query, _, _): "smart-\(query)"
        case let .editSearch(folder): "search-\(folder.id)"
        }
    }

    var title: String {
        switch self {
        case .create: tr("native.folders.newFolder")
        case .rename: tr("native.folders.renameFolder")
        case .smart: tr("native.folders.saveAsSmartFolder")
        case .editSearch: tr("native.folders.editSmartFolder")
        }
    }

    var message: String {
        switch self {
        case .create: tr("native.folders.createMessage")
        case .rename: tr("native.folders.renameMessage")
        case let .smart(_, _, dropsFilters):
            dropsFilters ? tr("native.folders.smartMessageDropsFilters") : tr("native.folders.smartMessage")
        case .editSearch: tr("native.folders.smartMessage")
        }
    }

    var confirm: String {
        switch self {
        case .create: tr("native.folders.createFolder")
        case .rename, .editSearch: tr("common.save")
        case .smart: tr("native.folders.saveSmartFolder")
        }
    }

    var initialName: String {
        switch self {
        case .create: ""
        case let .rename(folder), let .editSearch(folder): folder.name
        case let .smart(_, name, _): name
        }
    }

    /// The search field's text; nil when the prompt has no search field.
    var initialQuery: String? {
        if case let .editSearch(folder) = self { return folder.query ?? "" }
        return nil
    }
}

/// Folder actions that report through the library's toasts.
@MainActor
struct FolderActions {
    let folders: FoldersModel
    let library: LibraryModel

    func submit(_ prompt: FolderPrompt, name: String, query: String = "", open: Bool = true) async {
        do {
            switch prompt {
            case .create:
                _ = try await folders.create(name: name)
            case let .rename(folder):
                try await folders.rename(folder, to: name)
                if library.filters.folder?.id == folder.id { library.filters.folder?.name = name }
            case let .editSearch(folder):
                let saved = try await folders.update(folder, name: name, query: query)
                // The open folder's page reads the new search.
                if library.filters.folder?.id == folder.id { library.filters.folder = FolderScope(saved) }
                library.show(tr("native.folders.savedName", saved.name))
            case let .smart(query, _, _):
                let saved = try await folders.create(name: name, smartQuery: query)
                library.show(tr("native.folders.savedName", saved.name))
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
            library.show(tr("native.folders.deletedName", folder.name)) {
                Task {
                    library.dismissStatus()
                    do { try await folders.restore(folder) } catch {
                        library.show(tr("native.folders.restoreFailed"), isError: true)
                    }
                }
            }
        } catch {
            library.show(tr("native.folders.deleteFailed"), isError: true)
        }
    }
}

struct FolderPromptModifier: ViewModifier {
    @Binding var prompt: FolderPrompt?
    let actions: FolderActions
    @State private var name = ""
    @State private var query = ""

    func body(content: Content) -> some View {
        content
            .alert(prompt?.title ?? "", isPresented: Binding(presenting: $prompt), presenting: prompt) { prompt in
                TextField(tr("native.folders.folderName"), text: $name)
                    .accessibilityIdentifier("folder.name")
                if prompt.initialQuery != nil {
                    TextField(tr("native.folders.search"), text: $query)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .accessibilityIdentifier("folder.query")
                }
                Button(tr("common.cancel"), role: .cancel) { self.prompt = nil }
                Button(prompt.confirm) {
                    let submitted = (name, query)
                    Task { await actions.submit(prompt, name: submitted.0, query: submitted.1) }
                }
                .disabled(isBlank(name) || (prompt.initialQuery != nil && isBlank(query)))
            } message: { prompt in
                Text(prompt.message)
            }
            .onChange(of: prompt) { _, next in
                name = next?.initialName ?? ""
                query = next?.initialQuery ?? ""
            }
    }

    private func isBlank(_ text: String) -> Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
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
                    Text(Int(folder.activeCardCount), format: .number.locale(AppLanguage.locale))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        } icon: {
            Image(systemName: folder.symbol)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(folder.isSmart ? tr("native.folders.smartLabel", folder.name) : folder.name)
    }
}

/// The context menu a folder row offers in the sidebar and the Folders list.
struct FolderMenu: View {
    let folder: Folder
    @Binding var prompt: FolderPrompt?
    let actions: FolderActions

    var body: some View {
        FolderEditButton(folder: folder, prompt: $prompt)
        Button(tr("common.delete"), systemImage: "trash", role: .destructive) { Task { await actions.delete(folder) } }
    }
}

/// Rename… for a folder; Edit search… for a smart folder, whose prompt edits its name too.
struct FolderEditButton: View {
    let folder: Folder
    @Binding var prompt: FolderPrompt?

    var body: some View {
        if folder.isSmart {
            Button(tr("native.folders.editSearchMenu"), systemImage: "magnifyingglass") { prompt = .editSearch(folder) }
        } else {
            Button(tr("native.folders.renameMenu"), systemImage: "pencil") { prompt = .rename(folder) }
        }
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
                        CardDetailView(route: card, library: library)
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
                    Button(tr("common.delete"), systemImage: "trash", role: .destructive) {
                        Task { await actions.delete(folder) }
                    }
                    FolderEditButton(folder: folder, prompt: $prompt)
                }
            }
        }
        .tint(.primary)
        .overlay {
            if !folders.isLoaded {
                ProgressView()
            } else if folders.folders.isEmpty {
                ContentUnavailableView {
                    Label(tr("native.folders.emptyTitle"), systemImage: "folder")
                } description: {
                    Text(tr("native.folders.emptyMessage"))
                } actions: {
                    Button(tr("native.folders.newFolder")) { prompt = .create }.buttonStyle(.bordered)
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
        .navigationTitle(tr("native.folders.title"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(tr("native.folders.newFolder"), systemImage: "folder.badge.plus") { prompt = .create }
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
    /// The card's folders as the server last confirmed them.
    @State private var saved: [String] = []
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                }
                let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty, !folders.folders.contains(where: { $0.name.caseInsensitiveCompare(trimmed) == .orderedSame }) {
                    Button(tr("native.folders.createNamed", trimmed), systemImage: "folder.badge.plus") {
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
                    Text(tr("native.folders.pickerEmpty")).foregroundStyle(.secondary)
                }
            }
            .tint(.primary)
            .searchable(text: $query, prompt: tr("native.folders.findOrCreate"))
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(tr("common.done")) { dismiss() } }
            }
        }
        .frame(minWidth: 360, minHeight: 420)
        .onAppear {
            if case let .card(_, ids) = mode {
                checked = ids
                saved = ids
            }
        }
    }

    private var title: String {
        switch mode {
        case .card: tr("native.folders.title")
        case let .bulk(count): tr("native.folders.addCardsTitle", count: count)
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
            if let index = checked.firstIndex(of: folder.id) { checked.remove(at: index) } else { checked.append(folder.id) }
            // One save at a time, each sending the whole list: a tap during a
            // save is sent when it finishes, so the last tap always wins.
            guard !isSaving else { return }
            isSaving = true
            defer { isSaving = false }
            while checked != saved {
                let next = checked
                do {
                    try await folders.setFolders(cardId: id, folderIds: next)
                    saved = next
                    error = nil
                } catch {
                    checked = saved
                    self.error = error.teakMessage
                }
            }
        case .bulk:
            onPick(folder)
            dismiss()
        }
    }
}
