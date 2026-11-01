import Foundation

public enum FolderChoice {
    public static let searchThreshold = 8

    public static func choosable(_ folders: [Folder]) -> [Folder] {
        folders.filter { !$0.isSmart }
    }

    public static func showsSearch(_ folders: [Folder]) -> Bool {
        choosable(folders).count > searchThreshold
    }

    public static func matching(_ folders: [Folder], query: String) -> [Folder] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let manual = choosable(folders)
        return query.isEmpty ? manual : manual.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    public static func toggling(_ id: String, in selection: [String]) -> [String] {
        selection.contains(id) ? selection.filter { $0 != id } : selection + [id]
    }

    /// What saving a selection sends, given the folders this sheet already saved. Only those
    /// change: a card shared again keeps the folders it was in before.
    public enum Change: Equatable, Sendable {
        case none
        case update(add: [String], remove: [String])
    }

    public static func change(selected: [String], saved: [String], cardCount: Int) -> Change {
        let add = selected.filter { !saved.contains($0) }
        let remove = saved.filter { !selected.contains($0) }
        guard cardCount > 0, !add.isEmpty || !remove.isEmpty else { return .none }
        return .update(add: add, remove: remove)
    }
}
