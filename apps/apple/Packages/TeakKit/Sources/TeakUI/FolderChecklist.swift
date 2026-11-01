import SwiftUI
import TeakCore

/// Picks folders for cards from somewhere without the app's live folder list, like the share extension.
/// Lists manual folders with a checkmark each, and a search field once there are more than
/// `FolderChoice.searchThreshold`. Present it in a sheet: Done dismisses it, and the presenter saves.
public struct FolderChecklist: View {
    /// The user's folders; nil while they load.
    let folders: [Folder]?
    let loadError: String?
    @Binding var selection: [String]
    let retry: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    public init(folders: [Folder]?, loadError: String?, selection: Binding<[String]>, retry: @escaping () -> Void) {
        self.folders = folders
        self.loadError = loadError
        _selection = selection
        self.retry = retry
    }

    public var body: some View {
        NavigationStack {
            List {
                if let loadError {
                    Label(loadError, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                    Button(tr("common.tryAgain"), action: retry)
                }
                ForEach(visible) { folder in
                    row(folder)
                }
            }
            .tint(.primary)
            .overlay { placeholder }
            .modifier(FolderSearch(isOn: FolderChoice.showsSearch(folders ?? []), query: $query))
            .navigationTitle(tr("native.folders.title"))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("common.done")) { dismiss() }
                        .accessibilityIdentifier("folderChecklist.done")
                }
            }
        }
        .frame(minWidth: 320, minHeight: 360)
    }

    private var visible: [Folder] { FolderChoice.matching(folders ?? [], query: query) }

    private func row(_ folder: Folder) -> some View {
        let isChecked = selection.contains(folder.id)
        return Button {
            selection = FolderChoice.toggling(folder.id, in: selection)
        } label: {
            HStack {
                Label(folder.name, systemImage: folder.symbol).lineLimit(1)
                Spacer(minLength: 8)
                Text(Int(folder.activeCardCount), format: .number.locale(AppLanguage.locale))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Image(systemName: isChecked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isChecked ? Color.accentColor : .secondary)
            }
            .contentShape(.rect)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(folder.name)
        .accessibilityAddTraits(isChecked ? .isSelected : [])
        .accessibilityIdentifier("folderChecklist.\(folder.id)")
    }

    @ViewBuilder private var placeholder: some View {
        if let folders, loadError == nil, visible.isEmpty {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if FolderChoice.choosable(folders).isEmpty {
                ContentUnavailableView(tr("native.folders.emptyTitle"), systemImage: "folder",
                                       description: Text(tr("native.share.foldersEmpty")))
            } else if !trimmed.isEmpty {
                Text(tr("native.filters.empty.noResults", trimmed)).foregroundStyle(.secondary)
            }
        } else if folders == nil, loadError == nil {
            ProgressView()
        }
    }
}

private struct FolderSearch: ViewModifier {
    let isOn: Bool
    @Binding var query: String

    func body(content: Content) -> some View {
        if isOn {
            content.searchable(text: $query, prompt: tr("native.folders.find"))
        } else {
            content
        }
    }
}
