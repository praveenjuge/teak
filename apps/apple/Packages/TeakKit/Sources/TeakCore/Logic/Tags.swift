import Foundation

/// Tags that hide a card from every view but a search for them. Ports
/// `isHiddenTagList` (`packages/convex/shared/tags.ts`) and the web's hints.
public enum HiddenTags {
    public static var keys: [String] { SharedConstants.shared.hiddenTagKeys }

    public static func isHidden(_ tag: String) -> Bool { keys.contains(SearchQualifiers.tagKey(tag)) }

    public static func isHiddenTagList(_ tags: [String]?) -> Bool { (tags ?? []).contains(where: isHidden) }

    /// What to say when an edit hides a card that wasn't hidden: the first
    /// hidden tag added, as the web's toast words it.
    public static func addedHint(before: [String]?, after: [String]) -> String? {
        guard !isHiddenTagList(before), let tag = after.first(where: isHidden) else { return nil }
        return "Hidden. Search #\(SearchQualifiers.tagKey(tag)) to see it."
    }

    /// The note above results when the search names a hidden tag.
    public static let searchHint = "Shows hidden cards"

    /// Under an empty view whose cards are all hidden.
    public static var emptyViewHint: String {
        "Some cards are hidden. Search \(keys.map { "#\($0)" }.joined(separator: " or ")) to see them."
    }
}

/// Renaming, merging and deleting a tag across every card. Ports
/// `explainInvalidTagName` and the web's progress copy (`apps/web/src/lib/tags.ts`).
public enum TagOperations {
    public enum Kind: String, Codable, Sendable { case rename, merge, delete }

    public static var maxNameLength: Int { SharedConstants.shared.limits.maxTagNameLength }

    public static func message(_ code: String) -> String? { SharedConstants.shared.tagErrorMessages[code] }

    public static func invalidName(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return message("EMPTY_NAME") }
        return trimmed.utf16.count > maxNameLength ? message("NAME_TOO_LONG") : nil
    }

    static func cards(_ count: Int) -> String {
        "\(count.formatted(.number.locale(Locale(identifier: "en_US")))) \(count == 1 ? "card" : "cards")"
    }

    public static func running(_ kind: Kind, from: String, to: String?) -> String {
        switch kind {
        case .rename: "Renaming \u{201C}\(from)\u{201D} to \u{201C}\(to ?? "")\u{201D}…"
        case .merge: "Merging \u{201C}\(from)\u{201D} into \u{201C}\(to ?? "")\u{201D}…"
        case .delete: "Deleting \u{201C}\(from)\u{201D}…"
        }
    }

    public static func progress(changed: Int, total: Int) -> String {
        let total = max(total, 0)
        return "\(min(changed, total).formatted(.number.locale(Locale(identifier: "en_US")))) of \(cards(total)) changed"
    }

    public static func completed(_ kind: Kind, from: String, to: String?) -> String {
        switch kind {
        case .rename: "Renamed \u{201C}\(from)\u{201D} to \u{201C}\(to ?? "")\u{201D}"
        case .merge: "Merged \u{201C}\(from)\u{201D} into \u{201C}\(to ?? "")\u{201D}"
        case .delete: "Deleted \u{201C}\(from)\u{201D}"
        }
    }

    public static func changed(_ count: Int) -> String { "\(cards(count)) changed" }

    /// The tag list as it will read once the summary catches up with a
    /// finished change, so the list doesn't show the old name meanwhile.
    public static func applying(_ kind: Kind, from: String, to: String?, to items: [TagSummary.Item]) -> [TagSummary.Item] {
        let fromKey = SearchQualifiers.tagKey(from)
        guard let source = items.first(where: { SearchQualifiers.tagKey($0.name) == fromKey }) else { return items }
        var rest = items.filter { SearchQualifiers.tagKey($0.name) != fromKey }
        guard kind != .delete, let to = to?.trimmingCharacters(in: .whitespacesAndNewlines), !to.isEmpty else { return rest }
        let toKey = SearchQualifiers.tagKey(to)
        if let index = rest.firstIndex(where: { SearchQualifiers.tagKey($0.name) == toKey }) {
            rest[index] = TagSummary.Item(name: rest[index].name, count: rest[index].count + source.count)
        } else {
            rest.append(TagSummary.Item(name: to, count: source.count))
        }
        return rest.sorted { $0.count != $1.count ? $0.count > $1.count : $0.name < $1.name }
    }

    public static func failed(_ kind: Kind, changed: Int, total: Int) -> String {
        let verb = switch kind {
        case .rename: "renaming"
        case .merge: "merging"
        case .delete: "deleting"
        }
        return "Couldn't finish \(verb). \(progress(changed: changed, total: total))."
    }
}

/// Changing many cards at once through `cards:bulkUpdateCards`, with the
/// web's toast copy (`apps/web/src/lib/bulkCardActions.ts`).
public enum BulkCardAction: String, Sendable, CaseIterable {
    case favorite, unfavorite, archive, unarchive, addTags, removeTags, delete, restore, addToFolder

    /// The backend takes at most this many cards per call.
    public static let chunkSize = 100

    public static func cards(_ count: Int) -> String { count == 1 ? "1 card" : "\(count) cards" }

    public func done(_ count: Int, folder: String? = nil) -> String {
        let cards = Self.cards(count)
        switch self {
        case .favorite: return "Added \(cards) to favorites"
        case .unfavorite: return "Removed \(cards) from favorites"
        case .archive: return "Archived \(cards)"
        case .unarchive: return "Returned \(cards) to the library"
        case .addTags: return "Added tags to \(cards)"
        case .removeTags: return "Removed tags from \(cards)"
        case .delete: return "Moved \(cards) to Trash"
        case .restore: return "Restored \(cards)"
        case .addToFolder: return "Added \(cards) to \(folder ?? "the folder")"
        }
    }

    public var failure: String {
        switch self {
        case .favorite: "Couldn't add these cards to favorites"
        case .unfavorite: "Couldn't remove these cards from favorites"
        case .archive: "Couldn't archive these cards"
        case .unarchive: "Couldn't unarchive these cards"
        case .addTags: "Couldn't add tags to these cards"
        case .removeTags: "Couldn't remove tags from these cards"
        case .delete: "Couldn't move these cards to Trash"
        case .restore: "Couldn't restore these cards"
        case .addToFolder: "Couldn't add these cards to the folder"
        }
    }

    /// The action that puts cards back, for Undo.
    public var undo: BulkCardAction? {
        switch self {
        case .archive: .unarchive
        case .unarchive: .archive
        case .delete: .restore
        case .favorite: .unfavorite
        case .unfavorite: .favorite
        default: nil
        }
    }

    public func message(updated: Int, failed: Int, folder: String? = nil) -> String {
        if updated == 0 { return failure }
        let done = done(updated, folder: folder)
        return failed > 0 ? "\(done). \(failed) couldn't be changed." : done
    }

    /// Ids split into the chunks one call may carry.
    public static func chunks(_ ids: [String]) -> [[String]] {
        stride(from: 0, to: ids.count, by: chunkSize).map { Array(ids[$0..<min($0 + chunkSize, ids.count)]) }
    }
}

/// Seeds for Shuffle, as `nextShuffleSeed` draws them: 0 up to 2^31 and
/// never the one just used, so each shuffle shows a new order.
public enum ShuffleSeed {
    public static let limit = 1 << 31

    public static func next(after previous: Int?, random: () -> Int = { Int.random(in: 0..<ShuffleSeed.limit) }) -> Int {
        let seed = random()
        return seed == previous ? (seed + 1) % limit : seed
    }
}
