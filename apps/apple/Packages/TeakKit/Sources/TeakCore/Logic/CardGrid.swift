import Foundation

public enum CardGrid {
    public static let gap = 12.0
    public static let edge = 16.0
    public static let tileRadius = 16.0
    public static let waveformBarCount = 45
    private static let linkFallbackRatio = 1.91
    private static let mediaFallbackRatio = 4.0 / 3.0
    private static let documentFallbackRatio = 3.0 / 4.0
    private static let footerHeight = 44.0

    public static func columnCount(width: Double) -> Int {
        switch width {
        case 1300...: 5
        case 1000...: 4
        case 700...: 3
        default: 2
        }
    }

    public static func columnWidth(width: Double, columns: Int) -> Double {
        ((width - edge * 2 - gap * Double(columns - 1)) / Double(max(1, columns))).rounded(.down)
    }

    public static func tileImageURL(_ card: CardSummary) -> String? {
        switch card.type {
        case .link: card.linkPreviewImageUrl ?? card.screenshotUrl
        case .image: card.compactUrl ?? card.thumbnailUrl
        case .video, .document: card.thumbnailUrl ?? card.compactUrl
        default: nil
        }
    }

    public static func tileImageRatio(_ card: CardSummary) -> Double {
        if let ratio = card.aspectRatio, ratio > 0 { return min(max(ratio, 0.5), 2.5) }
        switch card.type {
        case .link: return linkFallbackRatio
        case .document: return documentFallbackRatio
        default: return mediaFallbackRatio
        }
    }

    public static func estimatedHeight(_ card: CardSummary, columnWidth: Double) -> Double {
        let media = tileImageURL(card) != nil ? columnWidth / tileImageRatio(card) : 0
        switch card.type {
        case .image, .video: return media > 0 ? media : columnWidth / mediaFallbackRatio
        case .link, .document: return media + footerHeight + (media > 0 ? 0 : 8)
        case .palette, .audio: return 56
        case .quote: return 84
        case .text: return 72
        }
    }

    public static func distribute<T>(_ items: [T], columns: Int, gap: Double = gap, reservedTopHeights: [Double] = [],
                                      estimate: (T) -> Double) -> [[T]] {
        let count = max(1, columns)
        var result = Array(repeating: [T](), count: count)
        var heights = (0..<count).map { $0 < reservedTopHeights.count ? reservedTopHeights[$0] : 0 }
        for item in items {
            var shortest = 0
            for index in 1..<count where heights[index] < heights[shortest] { shortest = index }
            result[shortest].append(item)
            heights[shortest] += estimate(item) + gap
        }
        return result
    }

    /// The web's 32-bit string hash waveform, so a recording looks the same everywhere.
    /// Fractions of the available height between 0.2 and 0.8.
    public static func waveformHeights(seed: String) -> [Double] {
        (0..<waveformBarCount).map { index in
            var hash = Int32(index)
            for unit in seed.utf16 {
                hash = (hash &<< 5) &- hash &+ Int32(unit)
            }
            return abs(sin(Double(hash))) * 0.6 + 0.2
        }
    }
}

/// One `cards:updateCardField` write.
public enum CardFieldChange: Hashable, Sendable {
    case content(String)
    case notes(String?)
    case tags([String])
    case removeAiTag(String)
    case metadataTitle(String)
    case url(String)
    /// Appends a palette color, one hex code.
    case addColor(String)
    /// Removes every copy of a palette color, one hex code.
    case removeColor(String)
    case moveToTrash
    case restore

    public func args(cardId: String) -> ConvexArgs {
        switch self {
        case let .content(value): ["cardId": .string(cardId), "field": "content", "value": .string(value)]
        case let .notes(value): ["cardId": .string(cardId), "field": "notes", "value": value.map(ConvexValue.string) ?? .null]
        case let .tags(value): ["cardId": .string(cardId), "field": "tags", "value": .array(value.map(ConvexValue.string))]
        case let .removeAiTag(tag): ["cardId": .string(cardId), "field": "removeAiTag", "tagToRemove": .string(tag)]
        case let .metadataTitle(value): ["cardId": .string(cardId), "field": "metadataTitle", "value": .string(value)]
        case let .url(value): ["cardId": .string(cardId), "field": "url", "value": .string(value)]
        case let .addColor(hex): ["cardId": .string(cardId), "field": "addColor", "value": .string(hex)]
        case let .removeColor(hex): ["cardId": .string(cardId), "field": "removeColor", "value": .string(hex)]
        case .moveToTrash: ["cardId": .string(cardId), "field": "delete"]
        case .restore: ["cardId": .string(cardId), "field": "restore"]
        }
    }
}

/// Changing a link card's address from Edit link…
public enum LinkEdit {
    /// The server's words for an address it refuses.
    public static var invalidMessage: String { tr("native.card.editLink.invalid") }

    /// Why `input` can't be saved, or nil when it's an http or https link.
    public static func validationError(_ input: String) -> String? {
        // An http or https scheme, then a host: what the server's `new URL` check needs, without spaces.
        let link = /(?i)https?:\/\/([^\/?#\s@]+@)?[^\/?#\s:@]+(:\d*)?([\/?#]\S*)?/
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.wholeMatch(of: link) == nil ? invalidMessage : nil
    }

    /// The write saving `input` makes, or nil when it isn't a link or is the address the card has.
    public static func change(_ input: String, current: String?) -> CardFieldChange? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard validationError(trimmed) == nil, trimmed != current else { return nil }
        return .url(trimmed)
    }
}

/// Emptying Trash: what the confirmation and the note after it say.
public enum EmptyTrash {
    /// The confirmation: the count from `cards:trashCount`, as "or more" when Trash holds more.
    public static func message(count: Int, more: Bool) -> String {
        more ? tr("native.trash.emptyMessageMore", count: count) : tr("native.trash.emptyMessage", count: count)
    }

    /// What `cards:emptyTrash` said it will delete.
    public static func done(_ trash: TrashCount) -> String {
        let count = Int(trash.count)
        if count <= 0 { return tr("native.trash.alreadyEmpty") }
        return trash.more ? tr("native.trash.emptyingMore", count: count) : tr("native.trash.emptying", count: count)
    }

    /// Why emptying failed: the server's limit in the app's language, else a general failure.
    public static func failure(_ error: any Error) -> String {
        guard let error = error as? TeakError else { return tr("native.trash.emptyFailed") }
        return error.code == TeakError.rateLimited ? tr("native.trash.rateLimited") : error.message
    }
}

public struct CardEditDraft: Hashable, Sendable {
    public var editableContent: String?
    public var notes: String
    public var tags: [String]
    public var aiTags: [String]

    public init(editableContent: String?, notes: String, tags: [String], aiTags: [String]) {
        self.editableContent = editableContent
        self.notes = notes
        self.tags = tags
        self.aiTags = aiTags
    }
}

public enum CardEdit {
    public static func normalizeTag(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    public static func adding(_ input: String, to tags: [String]) -> [String] {
        var result = tags
        for part in input.split(separator: ",") {
            let tag = normalizeTag(String(part))
            if !tag.isEmpty, !result.contains(tag) { result.append(tag) }
        }
        return result
    }

    public static func canEditContent(_ type: CardType) -> Bool { type == .text || type == .quote }

    public static func draft(for card: Card) -> CardEditDraft {
        CardEditDraft(editableContent: canEditContent(card.type) ? card.content : nil,
                      notes: card.notes ?? "", tags: card.tags ?? [], aiTags: card.aiTags ?? [])
    }

    /// The draft once `card` replaces `previous`: Teak's tags that arrived since join it, so saving doesn't remove tags
    /// the person never saw.
    public static func rebased(_ draft: CardEditDraft, previous: Card, card: Card) -> CardEditDraft {
        let known = Set(previous.aiTags ?? [])
        let arrived = (card.aiTags ?? []).filter { !known.contains($0) && !draft.aiTags.contains($0) }
        guard !arrived.isEmpty else { return draft }
        var rebased = draft
        rebased.aiTags += arrived
        return rebased
    }

    public static func changes(from card: Card, to draft: CardEditDraft) -> [CardFieldChange] {
        var changes: [CardFieldChange] = []
        if let content = draft.editableContent, content != card.content { changes.append(.content(content)) }
        let notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if notes != (card.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines) {
            changes.append(.notes(notes.isEmpty ? nil : notes))
        }
        if draft.tags != (card.tags ?? []) { changes.append(.tags(draft.tags)) }
        for tag in card.aiTags ?? [] where !draft.aiTags.contains(tag) { changes.append(.removeAiTag(tag)) }
        return changes
    }

    /// Teak's tags the card doesn't already have as its own, for "Suggested by Teak".
    public static func suggestedTags(_ card: Card) -> [String] {
        let own = Set((card.tags ?? []).map(SearchQualifiers.tagKey))
        return (card.aiTags ?? []).filter { tag in
            let key = SearchQualifiers.tagKey(tag)
            return !key.isEmpty && !own.contains(key)
        }
    }

    /// Keep: the card's tags plus a tag Teak suggested, as the web writes them. Nil when the card has it already.
    public static func keeping(_ aiTag: String, tags: [String]) -> CardFieldChange? {
        let key = SearchQualifiers.tagKey(aiTag)
        guard !key.isEmpty, !tags.contains(where: { SearchQualifiers.tagKey($0) == key }) else { return nil }
        return .tags(tags + [aiTag])
    }

    /// A link title typed in the header. Nil when it's blank, so the title stays, or unchanged.
    public static func titleChange(_ input: String, current: String) -> CardFieldChange? {
        let title = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title != current.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        return .metadataTitle(title)
    }

    public static func validationError(for card: Card, draft: CardEditDraft) -> String? {
        if card.type == .quote, (draft.editableContent ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return tr("native.card.edit.quoteEmpty")
        }
        return nil
    }
}
