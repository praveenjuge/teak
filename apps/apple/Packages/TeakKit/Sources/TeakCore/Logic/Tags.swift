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
        return tr("native.tags.card.hiddenAdded", SearchQualifiers.tagKey(tag))
    }

    /// The note above results when the search names a hidden tag.
    public static var searchHint: String { tr("native.tags.card.searchHint") }

    /// Under an empty view whose cards are all hidden. It names #secret and #hidden, the hidden tags.
    public static var emptyViewHint: String { tr("native.tags.card.hiddenCards") }
}

/// Renaming, merging and deleting a tag across every card. Ports
/// `explainInvalidTagName` and the web's progress copy (`apps/web/src/lib/tags.ts`).
public enum TagOperations {
    public enum Kind: String, Codable, Sendable { case rename, merge, delete }

    public static var maxNameLength: Int { SharedConstants.shared.limits.maxTagNameLength }

    /// The web's text for a tag error code, or nil for one it doesn't word.
    public static func message(_ code: String) -> String? {
        switch code {
        case "EMPTY_NAME": tr("errors.tags.EMPTY_NAME")
        case "NAME_TOO_LONG": tr("errors.tags.NAME_TOO_LONG", String(maxNameLength))
        case "NOT_FOUND": tr("errors.tags.NOT_FOUND")
        case "SAME_TAG": tr("errors.tags.SAME_TAG")
        case "OPERATION_RUNNING": tr("errors.tags.OPERATION_RUNNING")
        case "OPERATION_NOT_FOUND": tr("errors.tags.OPERATION_NOT_FOUND")
        default: nil
        }
    }

    public static func invalidName(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return message("EMPTY_NAME") }
        return trimmed.utf16.count > maxNameLength ? message("NAME_TOO_LONG") : nil
    }

    private static func number(_ value: Int) -> String { value.formatted(.number.locale(AppLanguage.locale)) }

    public static func running(_ kind: Kind, from: String, to: String?) -> String {
        switch kind {
        case .rename: tr("native.tags.card.renaming", from, to ?? "")
        case .merge: tr("native.tags.card.merging", from, to ?? "")
        case .delete: tr("native.tags.card.deleting", from)
        }
    }

    public static func progress(changed: Int, total: Int) -> String {
        let total = max(total, 0)
        return tr("native.tags.card.progress", count: total, number(min(changed, total)))
    }

    public static func completed(_ kind: Kind, from: String, to: String?) -> String {
        switch kind {
        case .rename: tr("native.tags.card.renamed", from, to ?? "")
        case .merge: tr("native.tags.card.merged", from, to ?? "")
        case .delete: tr("native.tags.card.deleted", from)
        }
    }

    public static func changed(_ count: Int) -> String { tr("native.tags.card.changed", count: count) }

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
        let total = max(total, 0)
        let changed = number(min(changed, total))
        return switch kind {
        case .rename: tr("native.tags.card.renameFailed", count: total, changed)
        case .merge: tr("native.tags.card.mergeFailed", count: total, changed)
        case .delete: tr("native.tags.card.deleteFailed", count: total, changed)
        }
    }
}

/// Changing many cards at once through `cards:bulkUpdateCards`, with the
/// web's toast copy (`apps/web/src/lib/bulkCardActions.ts`).
public enum BulkCardAction: String, Sendable, CaseIterable {
    case favorite, unfavorite, archive, unarchive, addTags, removeTags, delete, restore, addToFolder

    /// The backend takes at most this many cards per call.
    public static let chunkSize = 100

    public static func cards(_ count: Int) -> String { tr("native.common.cardCount", count: count) }

    public func done(_ count: Int, folder: String? = nil) -> String {
        switch self {
        case .favorite: tr("native.bulk.done.favorite", count: count)
        case .unfavorite: tr("native.bulk.done.unfavorite", count: count)
        case .archive: tr("native.bulk.done.archive", count: count)
        case .unarchive: tr("native.bulk.done.unarchive", count: count)
        case .addTags: tr("native.bulk.done.addTags", count: count)
        case .removeTags: tr("native.bulk.done.removeTags", count: count)
        case .delete: tr("native.bulk.done.delete", count: count)
        case .restore: tr("native.bulk.done.restore", count: count)
        case .addToFolder:
            folder.map { tr("native.bulk.done.addToFolder", count: count, $0) }
                ?? tr("native.bulk.done.addToTheFolder", count: count)
        }
    }

    public var failure: String {
        switch self {
        case .favorite: tr("native.bulk.failed.favorite")
        case .unfavorite: tr("native.bulk.failed.unfavorite")
        case .archive: tr("native.bulk.failed.archive")
        case .unarchive: tr("native.bulk.failed.unarchive")
        case .addTags: tr("native.bulk.failed.addTags")
        case .removeTags: tr("native.bulk.failed.removeTags")
        case .delete: tr("native.bulk.failed.delete")
        case .restore: tr("native.bulk.failed.restore")
        case .addToFolder: tr("native.bulk.failed.addToFolder")
        }
    }

    /// What changed, and how many cards didn't: "Archived 7 cards. 3 couldn't be changed."
    public static func partial(_ done: String, failed: Int) -> String {
        failed > 0 ? tr("native.bulk.partial", count: failed, done) : done
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
        updated == 0 ? failure : Self.partial(done(updated, folder: folder), failed: failed)
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
