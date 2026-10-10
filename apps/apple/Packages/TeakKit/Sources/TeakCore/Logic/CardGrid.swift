import Foundation

/// Masonry layout rules shared with the web, iPhone, Android and Mac grids.
public enum CardGrid {
    public static let gap = 12.0
    public static let edge = 16.0
    public static let tileRadius = 16.0
    public static let waveformBarCount = 45
    private static let linkFallbackRatio = 1.91
    private static let mediaFallbackRatio = 4.0 / 3.0
    private static let documentFallbackRatio = 3.0 / 4.0
    private static let footerHeight = 44.0

    /// Two columns on phones, more as the window widens: 3 at 700 pt, 4 at 1000, 5 at 1300.
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

    /// The tile's media URL, matching what the web grid shows for each type.
    public static func tileImageURL(_ card: CardSummary) -> String? {
        switch card.type {
        case .link: card.linkPreviewImageUrl ?? card.screenshotUrl
        case .image: card.compactUrl ?? card.thumbnailUrl
        case .video, .document: card.thumbnailUrl ?? card.compactUrl
        default: nil
        }
    }

    /// Width / height for a tile's media; extreme panoramas are clamped so tiles stay usable.
    public static func tileImageRatio(_ card: CardSummary) -> Double {
        if let ratio = card.aspectRatio, ratio > 0 { return min(max(ratio, 0.5), 2.5) }
        switch card.type {
        case .link: return linkFallbackRatio
        case .document: return documentFallbackRatio
        default: return mediaFallbackRatio
        }
    }

    /// Approximate tile height, used only to balance the columns.
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

    /// Each item goes to the currently shortest column, so reading order runs left to right.
    public static func distribute<T>(_ items: [T], columns: Int, gap: Double = gap,
                                      estimate: (T) -> Double) -> [[T]] {
        let count = max(1, columns)
        var result = Array(repeating: [T](), count: count)
        var heights = Array(repeating: 0.0, count: count)
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

/// One `cards:updateCardField` call.
public enum CardFieldChange: Hashable, Sendable {
    case content(String)
    case notes(String?)
    case tags([String])
    case removeAiTag(String)

    public func args(cardId: String) -> ConvexArgs {
        switch self {
        case let .content(value): ["cardId": .string(cardId), "field": "content", "value": .string(value)]
        case let .notes(value): ["cardId": .string(cardId), "field": "notes", "value": value.map(ConvexValue.string) ?? .null]
        case let .tags(value): ["cardId": .string(cardId), "field": "tags", "value": .array(value.map(ConvexValue.string))]
        case let .removeAiTag(tag): ["cardId": .string(cardId), "field": "removeAiTag", "tagToRemove": .string(tag)]
        }
    }
}

/// What the edit screen holds. `content` is nil for types whose content isn't editable.
public struct CardEditDraft: Hashable, Sendable {
    public var content: String?
    public var notes: String
    public var tags: [String]
    public var aiTags: [String]

    public init(content: String?, notes: String, tags: [String], aiTags: [String]) {
        self.content = content
        self.notes = notes
        self.tags = tags
        self.aiTags = aiTags
    }
}

/// Port of `apps/mobile/lib/card-edit.ts`.
public enum CardEdit {
    /// Tags are stored trimmed and lowercase, like the web's tag manager.
    public static func normalizeTag(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Adds typed tags (comma separated) without duplicates.
    public static func adding(_ input: String, to tags: [String]) -> [String] {
        var result = tags
        for part in input.split(separator: ",") {
            let tag = normalizeTag(String(part))
            if !tag.isEmpty, !result.contains(tag) { result.append(tag) }
        }
        return result
    }

    /// Only text and quote cards let you rewrite their content.
    public static func canEditContent(_ type: CardType) -> Bool { type == .text || type == .quote }

    public static func draft(for card: Card) -> CardEditDraft {
        CardEditDraft(content: canEditContent(card.type) ? card.content : nil,
                      notes: card.notes ?? "", tags: card.tags ?? [], aiTags: card.aiTags ?? [])
    }

    /// The field updates that turn `card` into `draft`, in save order. Only changed fields are sent.
    public static func changes(from card: Card, to draft: CardEditDraft) -> [CardFieldChange] {
        var changes: [CardFieldChange] = []
        if let content = draft.content, content != card.content { changes.append(.content(content)) }
        let notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if notes != (card.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines) {
            changes.append(.notes(notes.isEmpty ? nil : notes))
        }
        if draft.tags != (card.tags ?? []) { changes.append(.tags(draft.tags)) }
        for tag in card.aiTags ?? [] where !draft.aiTags.contains(tag) { changes.append(.removeAiTag(tag)) }
        return changes
    }

    /// An empty quote can't be saved.
    public static func validationError(for card: Card, draft: CardEditDraft) -> String? {
        if card.type == .quote, (draft.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "A quote can't be empty."
        }
        return nil
    }
}
