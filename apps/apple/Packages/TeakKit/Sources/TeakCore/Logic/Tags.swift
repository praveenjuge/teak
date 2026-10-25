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
