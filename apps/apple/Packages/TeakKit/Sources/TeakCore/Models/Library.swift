import Foundation

public struct Folder: Decodable, Sendable, Identifiable, Hashable {
    public enum Kind: String, Decodable, Sendable { case manual, smart }

    public let id: String
    public var name: String
    public var color: String?
    public var kind: Kind
    public var query: String?
    public var activeCardCount: Double

    enum CodingKeys: String, CodingKey { case id = "_id", name, color, kind, query, activeCardCount }

    public init(id: String, name: String, color: String? = nil, kind: Kind = .manual, query: String? = nil,
                activeCardCount: Double = 0) {
        self.id = id
        self.name = name
        self.color = color
        self.kind = kind
        self.query = query
        self.activeCardCount = activeCardCount
    }

    public var isSmart: Bool { kind == .smart }
    public var symbol: String { isSmart ? "folder.badge.gearshape" : "folder" }
}

public struct BulkUpdateResult: Decodable, Sendable {
    public let updatedIds: [String]
    public let failedIds: [String]
}

public struct FolderMembershipResult: Decodable, Sendable {
    public let updatedIds: [String]
    public let failedIds: [String]
    public let folderLimitIds: [String]
}

public struct ReprocessResult: Decodable, Sendable {
    public let status: String
    public let message: String?

    public var isQueued: Bool { status == "queued" }
}

/// `cards:trashCount`, and what `cards:emptyTrash` will delete: the cards in Trash, stopping at
/// `EmptyTrash.countLimit` ("that many or more").
public struct TrashCount: Decodable, Sendable {
    public let count: Double
}

public struct SemanticResult: Decodable, Sendable {
    /// ok, skipped, rate_limited, unavailable, pending or anchor_unavailable.
    public let outcome: String
}

public struct CardLinkTarget: Decodable, Sendable, Hashable {
    public let id: String
    public let missing: Bool
    public let title: String?
    public let type: CardType?
}

public struct LinkedCard: Decodable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let type: CardType
}

public struct CardBacklinks: Decodable, Sendable, Hashable {
    public let backlinks: [LinkedCard]
    public let hasMore: Bool
}

public struct TagSummary: Decodable, Sendable, Hashable {
    public struct Item: Decodable, Sendable, Hashable, Identifiable {
        public let name: String
        public let count: Double
        public var id: String { name }

        public init(name: String, count: Double) {
            self.name = name
            self.count = count
        }
    }

    public let items: [Item]
    public let isComplete: Bool
    public let computedAt: Double?
}

public struct TagOperation: Decodable, Sendable, Hashable, Identifiable {
    public let id: String
    public let kind: TagOperations.Kind
    public let from: String
    public let to: String?
    public let status: String
    public let total: Double
    public let processed: Double
    public let changed: Double
    public let error: String?

    enum CodingKeys: String, CodingKey { case id = "_id", kind, from, to, status, total, processed, changed, error }

    public var isRunning: Bool { status == "running" }
    public var isFailed: Bool { status == "failed" }
}
