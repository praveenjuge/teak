import Foundation

/// Filing just-saved cards into folders from the share extension: which folders it offers, when it
/// shows a search field, and what saving a choice changes.
public enum FolderChoice {
    /// The checklist shows a search field once there are more folders than this.
    public static let searchThreshold = 8

    /// The folders a card can go into: manual ones, in the server's order. Smart folders fill
    /// themselves from their search, so cards can't be added to them.
    public static func choosable(_ folders: [Folder]) -> [Folder] {
        folders.filter { !$0.isSmart }
    }

    /// Whether the checklist needs a search field for these folders.
    public static func showsSearch(_ folders: [Folder]) -> Bool {
        choosable(folders).count > searchThreshold
    }

    /// The choosable folders whose name contains the query, ignoring case and surrounding spaces.
    public static func matching(_ folders: [Folder], query: String) -> [Folder] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let manual = choosable(folders)
        return query.isEmpty ? manual : manual.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    /// The selection with the folder added, or taken out when it was already there.
    public static func toggling(_ id: String, in selection: [String]) -> [String] {
        selection.contains(id) ? selection.filter { $0 != id } : selection + [id]
    }

    /// What saving a selection sends, given the folders this sheet already saved. Only those
    /// change: a card shared again keeps the folders it was in before.
    public enum Change: Equatable, Sendable {
        /// Nothing to save.
        case none
        /// Folders to add the cards to (`folders:addCardsToFolder`) and to take them out of
        /// (`folders:removeCardsFromFolder`).
        case update(add: [String], remove: [String])
    }

    public static func change(selected: [String], saved: [String], cardCount: Int) -> Change {
        let add = selected.filter { !saved.contains($0) }
        let remove = saved.filter { !selected.contains($0) }
        guard cardCount > 0, !add.isEmpty || !remove.isEmpty else { return .none }
        return .update(add: add, remove: remove)
    }
}
